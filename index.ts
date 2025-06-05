import MessageParser, { encodeMessage, MESSAGE_TYPE, PORT_STATUS } from "./messages";
import ky from "ky";

const hostname = "conduit.ws"; // for http/https subdomains only, not ports
const controlPort = 4225;
const caddyPort = 2019 // the caddy admin port
const logPath: string = "conduit_log.txt";

/*
- gets a connection from a client
- the client tells it what port it wants it to listen on, and leaves the connection open
- the server starts a new proxy server on that port with Bun.listen
- when *that listener* gets a connection, it waits for data
- it just forwards that data back to the client that requested to create the listener on that port
so we either need to maintain a database of client connections, or just use the socket that was used to create the listener
*/

// status info about a client connection
type ClientData = {
    hasRequestedPort: boolean; 
    port: number | null;
    parser: MessageParser;
    listener: Bun.TCPSocketListener<ServerListenerData> | null; // the listener server that is created for this client
}
type ServerListenerData = { connectionId: number };

const portsInUse: Set<number> = new Set();
portsInUse.add(caddyPort); // just in case
const activeConnections: Map<number, {[connectionId: number]: Bun.Socket<ServerListenerData>}> = new Map(); // the outer key is the port, the inner key is the connection ID

/*
1. needs the initiating socket to send data back to
2. the port #

*/

function startListener(port: number, intiatingSocket: Bun.Socket<ClientData>) {

    if (portsInUse.has(port) || isNaN(port)) {
        console.error(`Port ${port} is already in use or invalid.`);
        return null;
    }

    const listener = Bun.listen<ServerListenerData>({
        hostname: "0.0.0.0",
        port,

        // The socket that is being passed here is the one that's between the reverse proxy
        socket: {
            open(socket) {
                try { 
                    // generate a random 32-bit connection ID
                    socket.data = {
                        connectionId: crypto.getRandomValues(new Uint32Array(1))[0] as number
                    };
                    console.log(`New connection established on port ${port} [connectionId: ${socket.data.connectionId}]`);

                    const msg = encodeMessage(socket.data.connectionId, MESSAGE_TYPE.NEW_CONNECTION, null);
                    intiatingSocket.write(msg);

                    if (!activeConnections.has(port)) {
                        activeConnections.set(port, {});
                    }
                    activeConnections.get(port)![socket.data.connectionId] = socket;
                } catch (e) {
                    console.error("Something went wrong while opening the socket:\n",e)
                }
            },
            data(socket, data) {
                // Handle incoming data from this socket
                console.log(`Data received on port ${port} [connectionId: ${socket.data.connectionId}]:`, data);
                // Forward the data back to the initiating socket
                const msg = encodeMessage(socket.data.connectionId, MESSAGE_TYPE.DATA, data);
                intiatingSocket.write(msg);
            },
            close(socket) {
                console.log(`Connection closed on port ${port} [connectionId: ${socket.data.connectionId}]`);
                portsInUse.delete(port);
                
                const msg = encodeMessage(socket.data.connectionId, MESSAGE_TYPE.CONNECTION_CLOSED, null);
                intiatingSocket.write(msg);

                activeConnections.get(port)?.[socket.data.connectionId]?.end();
            }
        }
    });

    const realPort = listener.port;
    portsInUse.add(realPort);
    console.log(`Starting listener on port ${realPort}`);

    return listener;
}


async function log(error: string) {
    // code to write errors to log file, thanks https://blog.stackademic.com/bun-1-0-logging-requests-to-an-output-file-50e54a7393c9
    try {
        const logs = await Bun.file(logPath).text();
        let date = new Date();
        const timestamp: string = date.getTime().toString();
        await Bun.write(logPath, logs.concat(timestamp, ": ", error));
    } catch (e) {
        // if log file doesn't exist, write new content
        let date = new Date()
        const timestamp: string = date.getTime().toString();
        await Bun.write(logPath, ''.concat(timestamp, ": ", error));
    }
}

async function initCaddy() {
    // clear the caddy config and set up our own
    const baseConfig = {
        apps: {
            http: {
                servers: {
                    conduit: {
                        listen: [":80", ":443"],
                        routes: [
                            {
                                match: [{ host: [hostname] }],
                                handle: [{
                                    handler: "static_response",
                                    headers: {
                                        Location: ["https://github.com/scherepi/conduit"]
                                    },
                                    status_code: 302
                                }]
                            }
                        ],
                        tls_connection_policies: [{}]
                    }
                }
            },
            tls: {
                automation: {
                    policies: [{
                        subjects: [hostname],
                        issuer: {
                            module: "internal"
                        }
                    }]
                }
            }
        }
    };

    try {
        const response = await ky.post(`http://localhost:${caddyPort}/config/`, {
            json: baseConfig,
        });
            
        console.log(`✅ Configuration reset with redirect from ${hostname} to GitHub`);
        return response.json();
    } catch (e) {
        console.error("Failed to reset Caddy config");
        if ((e as any).response) {
            const errorText = await (e as any).response.text();
            console.error('Error details:', errorText);
        }
        throw e;
    }
}


async function main() {
    try {
        await initCaddy();
    } catch (e) {
        console.error("Failed to initialize Caddy:", e);
    }

    Bun.listen<ClientData>({
        hostname: "0.0.0.0",
        port: controlPort,
        socket: {
            data(socket, data) {
                socket.data.parser.addData(data);
    
                // if the client has yet to request a port, handle that before anything else
                while (!socket.data.hasRequestedPort) {
                    const message = socket.data.parser.parseMessage();
                    if (!message) continue; // no complete message yet, wait for more data
                    if (message.messageType !== MESSAGE_TYPE.PORT_REQUEST) continue; // not a port request, ignore (this should never happen)
    
                    //TODO: implement port seeking
                    const requestedPort = message.payload ? ((message.payload?.[0] ?? 0) << 8) | (message.payload?.[1] ?? 0) : 0;
    
                    if (portsInUse.has(requestedPort)) {
                        // port is already in use, send an error response
                        const response = encodeMessage(0, MESSAGE_TYPE.PORT_RESPONSE, new Uint8Array([PORT_STATUS.UNAVAILABLE]));
                        socket.write(response);
                    } else {
                        const listener = startListener(requestedPort, socket);
                        if (!listener) { // this should never happen, but if something goes wrong just say the port is unavailable
                            const response = encodeMessage(0, MESSAGE_TYPE.PORT_RESPONSE, new Uint8Array([PORT_STATUS.UNAVAILABLE]));
                            socket.write(response);
                            return;
                        }
    
                        socket.data.listener = listener;
                        socket.data.port = listener.port;
    
                        // port is available, tell the client to move on
                        let response;
                        if (requestedPort == 0) {
                            // If port was randomly assigned, broadcast the assignment to the user
                            response = encodeMessage(0, MESSAGE_TYPE.PORT_ASSIGNED, new Uint8Array([listener.port >> 8, listener.port & 0xFF]));
                        } else {
                            response = encodeMessage(0, MESSAGE_TYPE.PORT_RESPONSE, new Uint8Array([PORT_STATUS.SUCCESS]));
                        }
                        socket.write(response);
                        socket.data.hasRequestedPort = true;
                    }
                }
    
                // if the client already has a port, just handle the incoming data by forwarding it to the correct connection on the listener
                for (const message of socket.data.parser.parseMessages()) {
                    if (message.messageType !== MESSAGE_TYPE.DATA) continue; // only handle data messages-- nothing else should come through
    
                    activeConnections.get(socket.data.port as number)![message.connectionId]?.write(message.payload || new Uint8Array());
                }
            },
            open(socket) {
                // Triggers on receiving new connection to listener server
                console.log(`New connection from ${socket.remoteAddress}:${socket.remotePort}`);
                
                socket.data = {
                    hasRequestedPort: false,
                    port: null,
                    parser: new MessageParser(),
                    listener: null,
                }
            },
            close(socket, _error) {
                // when the connection closes, we need to terminate the associated listener
                console.log(`Connection closed from ${socket.remoteAddress}:${socket.remotePort}`);
                
                if (socket.data.listener) {
                    socket.data.listener.stop();
                    console.log(`Listener on port ${socket.data.port} closed.`);
                    portsInUse.delete(socket.data.port as number);
                }
            },
            drain(_socket) {
                //TODO: implement
            },
            error(_socket, error) {
                console.error(error);
                
                log(error.message);
            }
        },
    })
    
    console.log(`Conduit server listening on port ${controlPort}`);
}

main();