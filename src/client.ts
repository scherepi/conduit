#!/usr/bin/env bun
/*
the client doesn't run a listener server, it runs some sort of connector
when it gets a connection from the conduit, it opens a connection with the local port
when it gets data from the conduit, it sends it to the local port
when the connection closes, it closes the local port connection

the client can't recieve connections from the conduit, though
so the conduit needs to communicate "new connection"
conduit signals:
"new connection" - w/ a socket id
"new data"
"connection closed"
essentially, one for every signal we have in the code
*/
import meow from "meow";
import MessageParser, {
	decodeMessage,
	encodeMessage,
	MESSAGE_TYPE,
	PORT_STATUS,
} from "./messages";
const cli = meow(
	// USAGE MESSAGE

	`Conduit: A link between worlds.
    
    --localPort, -p             the local port to forward to the remote host

    Usage: conduit <remote-host> -p <localPort>
    `,

	{
		importMeta: import.meta,
		flags: {
			localPort: {
				type: "number",
				shortFlag: "p",
			},
		},
	}
);

const hostname = cli.input.at(0); // the first argument passed to the CLI
const conduitPort: number = 4225; // hard-coded server control port - "HACK" on a phone!

let conduitSocket: Bun.Socket | undefined; // connection to the central conduit server; value assigned in functions
let localTunnels: { [connectionId: number]: Bun.Socket } = {}; // same here!
let assignedPort: number = 0;
const parser = new MessageParser(); // parser for incoming messages from the conduit server

// the central function that connects to the conduit server
async function connectToConduit(hostname: string, localPort: number, remotePort?: number) {
	conduitSocket = await Bun.connect({
		hostname: hostname, // hostname for the remote conduit server
		port: conduitPort, // this is the port that the conduit server will always run on.

		socket: {
			data(_socket, data) {
				// called on the receiving of new data from the conduit
				parser.addData(data);
				// we've gotta interpret the server message
				for (const parsedMessage of parser.parseMessages()) {
					switch (parsedMessage.messageType) {
						case MESSAGE_TYPE.DATA:
							localTunnels[parsedMessage.connectionId]?.write(
								parsedMessage.payload || new Uint8Array()
							);
							break;
						case MESSAGE_TYPE.NEW_CONNECTION:
							establishLocalTunnel(parsedMessage.connectionId, localPort);
							break;
						case MESSAGE_TYPE.PORT_RESPONSE:
							const portStatus = parsedMessage.payload ? parsedMessage.payload[0] : undefined;
							if (portStatus == PORT_STATUS.SUCCESS) {
								// This means that the server gave us the port we requested
								assignedPort = assignedPort;
								console.log("Successfully connected to server on port " + assignedPort);
								console.log(
									`You (or your friends) should be able to access it at ${hostname}:${assignedPort}`
								);
							} else if (portStatus == PORT_STATUS.UNAVAILABLE) {
								// TODO: review for suitability lolll
								console.error("Sorry babygworl, the server doesn't have your port available.");
								console.log(
									"Try running the command without specifying a remote port - the server will assign you what's open."
								);
							}
							break;
						case MESSAGE_TYPE.PORT_ASSIGNED:
							// unpack the Uint8Array to a port number
							assignedPort =
								((parsedMessage.payload?.[0] ?? 0) << 8) | (parsedMessage.payload?.[1] ?? 0); // dude what does this even mean
							// assignedPort = parsedMessage.payload && parsedMessage.payload.length >= 2 ? parsedMessage.payload[0] << 8 | parsedMessage.payload[1] : 0;
							if (assignedPort == 0 || isNaN(assignedPort)) {
								console.error("Whoops. The conduit server didn't assign you a port.");
								console.error(
									"This shouldn't happen - please leave an issue on the GitHub Repository"
								);
								console.log("Bugs are an important part of the ecosystem ✨");
								break;
							}
							console.log(
								`Successfully connected to conduit server. You've been assigned port ${assignedPort}.`
							);
							console.log(
								`Tell your friends to visit ${hostname}:${assignedPort} to see your work!`
							);
							break;
						case MESSAGE_TYPE.CONNECTION_CLOSED:
							// We receive this message when the
							break;
						case MESSAGE_TYPE.KEEPALIVE:
							// We can safely ignore this message type.
							break;
						case MESSAGE_TYPE.PORT_REQUEST:
							console.error("Uh oh, the client received an erroneous packet.");
							console.error(
								"This shouldn't happen - please leave an issue on the GitHub Repository"
							);
							console.log("Bugs are how flowers grow ✨");
							break;
					}
				}
			},
			open(socket) {
				// called on the opening of a new connection to the conduit
				// first step is to request our port on the conduit server
				if (remotePort) {
					const portRequestMessage = encodeMessage(
						0,
						MESSAGE_TYPE.PORT_REQUEST,
						new Uint8Array([remotePort >> 8, remotePort & 0xff])
					);
					socket.write(portRequestMessage);
					assignedPort = remotePort; // set the assigned port to the remote port we requested
				} else {
					const portRequestMessage = encodeMessage(0, MESSAGE_TYPE.PORT_REQUEST, null);
					socket.write(portRequestMessage);
				}
			},

			close(_socket, _error) {
				console.log("Connection to the conduit server has ended.");
				// close all the local tunnels
				for (const connectionId in localTunnels) {
					localTunnels[connectionId]?.end();
				}
			},
			// client-specific handlers
			connectError(_socket, _error) {
				// called when the connection fails on the client-side
				console.error(
					"Failed to connect to the conduit server. Please check your network connection and the hostname."
				);
			},
		},
	});
}

async function establishLocalTunnel(connectionId: number, localPort: number) {
	localTunnels[connectionId] = await Bun.connect({
		hostname: "localhost",
		port: localPort,

		socket: {
			data(_socket, data) {
				// whenever we receive data from the local port, encode it with the connection ID and pass it to the conduit
				console.log("Data received from local port:", data);
				const encodedMessage = encodeMessage(connectionId, MESSAGE_TYPE.DATA, data);
				conduitSocket?.write(encodedMessage);
			},
			open(_socket) {
				// called when the local tunnel is established
				console.log("Established local tunnel.");
				// TODO: implement parity here, make sure server knows to wait til local tunnel is created
			},
			close(_socket, error) {
				// called when the local tunnel is closed by the client
				console.log("Closed local tunnel.");
				const encodedMessage = encodeMessage(connectionId, MESSAGE_TYPE.CONNECTION_CLOSED, null);
				conduitSocket?.write(encodedMessage);
				delete localTunnels[connectionId];
			},
			drain(_socket) {
				//TODO: implement
			},
			error(_socket, _error) {
				console.error("Uh oh, there was an error in the connection to the local application.");
				console.error(
					"You shouldn't be seeing this - please make an issue on the GitHub repository."
				);
				console.log("Bugs are how flowers grow ✨");
			},

			connectError(_socket, _error) {
				console.error("Something went wrong establishing the local tunnel.");
				console.log(
					"You shouldn't be seeing this - please make an issue on the GitHub repository."
				);
				console.log("Bugs are how flowers grow ✨");
				const encodedMessage = encodeMessage(connectionId, MESSAGE_TYPE.CONNECTION_CLOSED, null);
				conduitSocket?.write(encodedMessage);
				delete localTunnels[connectionId];
			},
			end(_socket) {
				// this is called when the local application closes the connection.
				console.log("The local application closed the connection.");
				// we don't need to handle this, because when this event occurs, one of the other handlers is called too.
			},
			timeout(_socket) {
				// this is called if by some nightmare the local connection times out.
				console.error("Somehow, the connection to the local application timed out.");
				console.log(
					"You shouldn't be seeing this - please make an issue on the GitHub repository."
				);
				console.log(
					"Cool bug fact: bombardier beetles can eject boiling chemical spray from their abdomen when threatened!"
				);
			},
		},
	});
}

console.log("Testing connection to server");
connectToConduit("conduit.ws", 8080, 8080);
