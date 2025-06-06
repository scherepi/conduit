import { initCaddy, addReverseProxy, removeReverseProxy } from "./caddy";
import logger from "./logger";
import MessageParser, { encodeMessage, MESSAGE_TYPE, REQUEST_STATUS } from "./messages";
export const hostname = "conduit.ws"; // for http/https subdomains only, not ports
const controlPort = 4225;
export const caddyPort = 2019; // the caddy admin port

// status info about a client connection
type ClientData = {
	hasRequestedPort: boolean;
	port: number | null;
	subdomain: string | null;
	parser: MessageParser;
	listener: Bun.TCPSocketListener<ServerListenerData> | null; // the listener server that is created for this client
};
type ServerListenerData = { connectionId: number };

const portsInUse: Set<number> = new Set();
portsInUse.add(caddyPort); // just in case

const subdomainsInUse: Set<String> = new Set();

const activeConnections: Map<number, { [connectionId: number]: Bun.Socket<ServerListenerData> }> =
	new Map(); // the outer key is the port, the inner key is the connection ID

function startListener(port: number, intiatingSocket: Bun.Socket<ClientData>) {
	if (portsInUse.has(port) || isNaN(port)) {
		logger.error(`Port ${port} is already in use or invalid.`);
		return null;
	}

	const listener = Bun.listen<ServerListenerData>({
		hostname: "0.0.0.0",
		port,

		// The socket that is being passed here is the one that's between the reverse proxy
		socket: {
			open(socket) {
				logger.infoVerbose("Got a connection on the listener")
			
				try {
					// generate a random 32-bit connection ID
					socket.data = {
						connectionId: crypto.getRandomValues(new Uint32Array(1))[0] as number,
					};
					logger.infoVerbose(`New connection established on port ${socket.localPort} [connectionId: ${socket.data.connectionId}]`
)
				

					const msg = encodeMessage(socket.data.connectionId, MESSAGE_TYPE.NEW_CONNECTION, null);
					intiatingSocket.write(msg);

					if (!activeConnections.has(socket.localPort)) {
						activeConnections.set(socket.localPort, {});
					}
					activeConnections.get(socket.localPort)![socket.data.connectionId] = socket;
				} catch (e) {
					logger.error("Something went wrong while opening the socket:\n", e);
				}
			},
			data(socket, data) {
				// Handle incoming data from this socket
				logger.debugVerbose(
					`Data received on port ${socket.localPort} [connectionId: ${socket.data.connectionId}]:`,
					data
				);
				// Forward the data back to the initiating socket
				const msg = encodeMessage(socket.data.connectionId, MESSAGE_TYPE.DATA, data);
				intiatingSocket.write(msg);
			},
			close(socket) {
				logger.debugVerbose(
					`Connection closed on port ${socket.localPort} [connectionId: ${socket.data.connectionId}]`
				);
				portsInUse.delete(socket.localPort);

				const msg = encodeMessage(socket.data.connectionId, MESSAGE_TYPE.CONNECTION_CLOSED, null);
				intiatingSocket.write(msg);

				activeConnections.get(socket.localPort)?.[socket.data.connectionId]?.end();
			},
		},
	});

	const realPort = listener.port;
	portsInUse.add(realPort);
	logger.success(`Starting listener on port ${realPort}`);

	return listener;
}

function startSubdomainListener(subdomain: string, initiatingSocket: Bun.Socket<ClientData>) {
	const portListener = startListener(0, initiatingSocket);
	addReverseProxy(subdomain, portListener ? portListener.port : 65536);
	return portListener;
}

async function main() {
	try {
		await initCaddy("/etc/caddy/certs/domain.cert.pem", "/etc/caddy/certs/private.key.pem");
	} catch (e) {
		if ((e as any).code == "ConnectionRefused") {
			logger.error("Failed to connect to Caddy. Is it running?");
		} else {
			logger.error("An error occurred while initializing Caddy:");
			console.log(e);
			console.log(await (e as { response: Response }).response.text());
		}
	}

	Bun.listen<ClientData>({
		hostname: "0.0.0.0",
		port: controlPort,
		socket: {
			async data(socket, data) {
				socket.data.parser.addData(data);

				// if the client has yet to request a port, handle that before anything else
				while (!socket.data.hasRequestedPort) {
					const message = socket.data.parser.parseMessage();
					if (!message) continue; // no complete message yet, wait for more data
					if (message.messageType !== MESSAGE_TYPE.PORT_REQUEST) continue; // not a port request, ignore (this should never happen)

					const requestedPort = message.payload
						? ((message.payload?.[0] ?? 0) << 8) | (message.payload?.[1] ?? 0)
						: 0;

					if (portsInUse.has(requestedPort)) {
						// port is already in use, send an error response
						const response = encodeMessage(
							0,
							MESSAGE_TYPE.PORT_RESPONSE,
							new Uint8Array([REQUEST_STATUS.UNAVAILABLE])
						);
						socket.write(response);
					} else {
						const listener = startListener(requestedPort, socket);
						if (!listener) {
							// this should never happen, but if something goes wrong just say the port is unavailable
							const response = encodeMessage(
								0,
								MESSAGE_TYPE.PORT_RESPONSE,
								new Uint8Array([REQUEST_STATUS.UNAVAILABLE])
							);
							socket.write(response);
							return;
						}

						socket.data.listener = listener;
						socket.data.port = listener.port;

						// port is available, tell the client to move on
						let response;
						if (requestedPort == 0) {
							// If port was randomly assigned, broadcast the assignment to the user
							response = encodeMessage(
								0,
								MESSAGE_TYPE.PORT_ASSIGNED,
								new Uint8Array([listener.port >> 8, listener.port & 0xff])
							);
						} else {
							response = encodeMessage(
								0,
								MESSAGE_TYPE.PORT_RESPONSE,
								new Uint8Array([REQUEST_STATUS.SUCCESS])
							);
						}
						socket.write(response);
						socket.data.hasRequestedPort = true;
					}
					
					// } else if (message.messageType == MESSAGE_TYPE.SUBDOMAIN_REQUEST) {
					// 	// Handle subdomain requests here
					// 	const requestedSubdomain = message.payload ? new TextDecoder().decode(message.payload) : "";

					// 	if (subdomainsInUse.has(requestedSubdomain)) {
					// 		// send the client a message that says that subdomain is unavailable
					// 		const response = encodeMessage(
					// 			0,
					// 			MESSAGE_TYPE.SUBDOMAIN_RESPONSE,
					// 			new Uint8Array([REQUEST_STATUS.UNAVAILABLE])
					// 		);
					// 		socket.write(response);
					// 	} else {
					// 		subdomainsInUse.add(requestedSubdomain);
					// 		const listener = startSubdomainListener(requestedSubdomain, socket);
					// 		if (!listener) {
					// 			// TODO: make the server accountable to the client for errors
					// 			// something has gone horribly wrong.
					// 			const response = encodeMessage(
					// 				0,
					// 				MESSAGE_TYPE.PORT_RESPONSE,
					// 				new Uint8Array([REQUEST_STATUS.UNAVAILABLE])
					// 			)
					// 			socket.write(response);
					// 			return;
					// 		}

					// 		socket.data.listener = listener;
					// 		socket.data.port = listener.port;

					// 		const response = encodeMessage(
					// 			0,
					// 			MESSAGE_TYPE.SUBDOMAIN_RESPONSE,
					// 			new Uint8Array([REQUEST_STATUS.SUCCESS])
					// 		);
					// 		socket.write(response);
					// 		socket.data.hasRequestedPort = true;

					// 		socket.data.subdomain = requestedSubdomain;
					// 	}
					// }
				}

				// if the client already has a port, just handle the incoming data by forwarding it to the correct connection on the listener
				for (const message of socket.data.parser.parseMessages()) {
					// only handle data and subdomain messages-- nothing else should come through
					if (message.messageType === MESSAGE_TYPE.DATA) {
						activeConnections
							.get(socket.data.port as number)!
							[message.connectionId]?.write(message.payload || new Uint8Array());

					} else if (message.messageType === MESSAGE_TYPE.SUBDOMAIN_REQUEST) {
						const requestedSubdomain = message.payload ? new TextDecoder().decode(message.payload) : "";

						if (subdomainsInUse.has(requestedSubdomain)) {
							// send the client a message that says that subdomain is unavailable
							const response = encodeMessage(
								0,
								MESSAGE_TYPE.SUBDOMAIN_RESPONSE,
								new Uint8Array([REQUEST_STATUS.UNAVAILABLE])
							);
							socket.write(response);
						} else {
							await addReverseProxy(requestedSubdomain, socket.data.port as number);
							
							subdomainsInUse.add(requestedSubdomain);
							socket.data.subdomain = requestedSubdomain;
							
							const response = encodeMessage(
								0,
								MESSAGE_TYPE.SUBDOMAIN_RESPONSE,
								new Uint8Array([REQUEST_STATUS.SUCCESS])
							);
							socket.write(response);
						}
					}
				}
			},
			open(socket) {
				// Triggers on receiving new connection to listener server
			
				logger.success(`New connection from ${socket.remoteAddress}:${socket.remotePort}`)
				socket.data = {
					hasRequestedPort: false,
					port: null,
					subdomain: null,
					parser: new MessageParser(),
					listener: null,
				};
			},
			close(socket, _error) {
				// when the connection closes, we need to terminate the associated listener
				logger.warn(`Connection closed from ${socket.remoteAddress}:${socket.remotePort}`)
				if (socket.data.listener) {
					socket.data.listener.stop();
					if (socket.data.port) {
						logger.info(`Listener on port ${socket.data.port} closed.`);
						portsInUse.delete(socket.data.port as number);
					} else if (socket.data.subdomain) {
						logger.info(`Listener on subdomain ${socket.data.subdomain} closed.`);
						removeReverseProxy(socket.data.subdomain);
						subdomainsInUse.delete(socket.data.subdomain as string);
					}
				}
			},
			drain(_socket) {
				//TODO: implement
			},
			error(_socket, error) {
				logger.error(error);
			},
		},
	});

	logger.success(`Conduit server listening on port ${controlPort}`);
}

main();
