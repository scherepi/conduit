#!/usr/bin/env bun

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

	--subdomain -d				your desired subdomain on the server (instead of specifying a remote port)

	--remotePort, -r			if you want a specific one, the remote port the conduit server should host your service on

	--silentMode, -s 			reduce client verbosity (you hate me don't you :( )

    Usage: conduit <remote-host> -p <localPort>
    `,

	{
		importMeta: import.meta,
		flags: {
			localPort: {
				type: "number",
				shortFlag: "p",
			},
			subdomain: {
				type: "string",
				shortFlag: "d",
				isRequired: false
			},
			remotePort: {
				type: "number",
				shortFlag: "r",
				isRequired: false
			},
			silentMode: {
				type: "boolean",
				shortFlag: "s",
				isRequired: false
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

if (hostname) connectToConduit(hostname, cli.flags);

// the central function that connects to the conduit server
async function connectToConduit(hostname: string, flags: typeof cli.flags) {
	if (flags.remotePort && flags.subdomain) {
		console.error("You can't pick a subdomain and a remote port - your greed is disgusting. Just pick one.");
		process.exit(1);
	}
	if (!flags.localPort) {
			console.error("You need to at least specify the local port, bonehead.");
			process.exit(1);
		}
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
							establishLocalTunnel(parsedMessage.connectionId, flags.localPort ? flags.localPort : 0, flags.silentMode ? true : false);
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
								if (!flags.silentMode) {
									console.log(
										"Try running the command without specifying a remote port - the server will assign you what's open."
									);
								}
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
							if (!flags.silentMode){
								console.log(
								`Successfully connected to conduit server. You've been assigned port ${assignedPort}.`
								);
							}
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
				if (flags.remotePort) {
					const portRequestMessage = encodeMessage(
						0,
						MESSAGE_TYPE.PORT_REQUEST,
						new Uint8Array([flags.remotePort >> 8, flags.remotePort & 0xff])
					);
					socket.write(portRequestMessage);
					assignedPort = flags.remotePort; // set the assigned port to the remote port we requested
				} else if (flags.subdomain) {
					const portRequestMessage = encodeMessage(
						0,
						MESSAGE_TYPE.SUBDOMAIN_REQUEST,
						new Uint8Array(new TextEncoder().encode(flags.subdomain))
					);
					socket.write(portRequestMessage);
				}else {
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

async function establishLocalTunnel(connectionId: number, localPort: number, silent: boolean) {
	localTunnels[connectionId] = await Bun.connect({
		hostname: "localhost",
		port: localPort,

		socket: {
			data(_socket, data) {
				// whenever we receive data from the local port, encode it with the connection ID and pass it to the conduit
				if (!silent) {
					console.log("Data received from local port:", data);
				}
				const encodedMessage = encodeMessage(connectionId, MESSAGE_TYPE.DATA, data);
				conduitSocket?.write(encodedMessage);
			},
			open(_socket) {
				// called when the local tunnel is established
				if (!silent) { console.log("Established local tunnel."); }
				// TODO: implement parity here, make sure server knows to wait til local tunnel is created
			},
			close(_socket, error) {
				// called when the local tunnel is closed by the client
				if (!silent) { console.log("Closed local tunnel."); }	
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
				if (!silent) { console.log("The local application closed the connection."); }
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
