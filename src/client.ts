#!/usr/bin/env bun

// import meow from "meow";
import MessageParser, {
	decodeMessage,
	encodeMessage,
	MESSAGE_TYPE,
	REQUEST_STATUS,
	SECRET_STATUS
} from "./messages";
import logger from "./logger";
import { isErrored } from "stream";

const conduitPort: number = 4225; // hard-coded server control port - "HACK" on a phone!

let conduitSocket: Bun.Socket | undefined; // connection to the central conduit server; value assigned in functions
let localTunnels: { [connectionId: number]: Bun.Socket } = {}; // same here!
let assignedPort: number = 0;
const pendingData = new Map<number, Array<Uint8Array>>(); // data that is pending to be sent to the local port, index is connection ID
const parser = new MessageParser(); // parser for incoming messages from the conduit server

// the central function that connects to the conduit server
export async function connectToConduit(
	hostname: string,
	localPort: number,
	keepAlive: boolean,
	remotePort?: number | null,
	subdomain?: string,
	secretKey?: string
	
) {
	logger.await(`Connecting to conduit server at ${hostname}:${conduitPort}...`);
	
	try {
		
		conduitSocket = await Bun.connect({
		hostname: hostname, // hostname for the remote conduit server
		port: conduitPort, // this is the port that the conduit server will always run on.

		socket: {
			data(socket, data) {
				// called on the receiving of new data from the conduit
				parser.addData(data);
				// we've gotta interpret the server message
				for (const parsedMessage of parser.parseMessages()) {
					logger.debugVerbose(
						`[MESSAGE_TYPE: ${parsedMessage.messageType}] ${parsedMessage.payloadLength} bytes`
					);
					switch (parsedMessage.messageType) {
						case MESSAGE_TYPE.DATA:
							logger.awaitVerbose(
								"Trying to write data to local tunnel with connection ID:",
								parsedMessage.connectionId,
								"state",
								localTunnels[parsedMessage.connectionId]?.readyState
							);

							if (localTunnels[parsedMessage.connectionId]) {
								localTunnels[parsedMessage.connectionId]?.write(
									parsedMessage.payload || new Uint8Array()
								);
							} else {
								logger.warnVerbose(
									`Local tunnel ${parsedMessage.connectionId} is not open, buffering data`
								);
								if (!pendingData.has(parsedMessage.connectionId)) {
									pendingData.set(parsedMessage.connectionId, []);
								}
								pendingData
									.get(parsedMessage.connectionId)
									?.push(parsedMessage.payload || new Uint8Array());
							}
							break;
						case MESSAGE_TYPE.NEW_CONNECTION:
							logger.debugVerbose(
								"Received new connection request from server with ID:",
								parsedMessage.connectionId
							);
							// this function is async, but we intentionally don't await it
							establishLocalTunnel(parsedMessage.connectionId, localPort ? localPort : 0);
							break;
						case MESSAGE_TYPE.SECRET_EXCHANGE:
							// the client is receiving a message about whether its secret key authenticated it to the server
							const secretStatus = parsedMessage.payload ? parsedMessage.payload[0] : undefined;
							if (secretStatus == SECRET_STATUS.REJECTED) {
								logger.error("You were kicked out of the playground for throwing sand at other kids. (Authentication Failure)");
								process.exit(1);
							} else if (secretStatus == SECRET_STATUS.NOT_SET || secretStatus == SECRET_STATUS.SUCCESS) {
								if (secretStatus == SECRET_STATUS.NOT_SET) {
									logger.warn("You didn't need a key silly! This party is open invite!")
								} else {
									logger.info("Authenticated successfully!");
								}
								
								// Do the thing to log in:
								logger.debugVerbose("Connected successfully to server");
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
									socket.write(encodeMessage(0, MESSAGE_TYPE.PORT_REQUEST, null));
								}
								
								// request a subdomain if one is provided
								if (subdomain) {
									socket.write(
										encodeMessage(
											0,
											MESSAGE_TYPE.SUBDOMAIN_REQUEST,
											new Uint8Array(new TextEncoder().encode(subdomain))
										)
									);
								}
								
							}
							break;
						case MESSAGE_TYPE.PORT_RESPONSE:
							const portStatus = parsedMessage.payload ? parsedMessage.payload[0] : undefined;
							if (portStatus == REQUEST_STATUS.SUCCESS) {
								// This means that the server gave us the port we requested
								assignedPort = assignedPort;
								logger.success("Successfully connected to server on port " + assignedPort);
								logger.info(
									`You (or your friends) should be able to access it at ${hostname}:${assignedPort}`
								);
							} else if (portStatus == REQUEST_STATUS.UNAVAILABLE) {
								// TODO: review for suitability lolll
								logger.error("Sorry babygworl, the server doesn't have your port available.");
								logger.info(
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
								logger.error("Whoops. The conduit server didn't assign you a port.");
								logger.error(
									"This shouldn't happen - please leave an issue on the GitHub Repository"
								);
								logger.info("Bugs are an important part of the ecosystem ✨");
								break;
							}
							logger.success(
								`Successfully connected to conduit server. You've been assigned port ${assignedPort}.`
							);
							logger.info(
								`Tell your friends to visit ${hostname}:${assignedPort} to see your work!`
							);
							break;
						case MESSAGE_TYPE.SUBDOMAIN_RESPONSE:
							const subdomainStatus = parsedMessage.payload ? parsedMessage.payload[0] : 1;
							// this message is received when the server reports the availability of a subdomain to the client.
							if (subdomainStatus == REQUEST_STATUS.SUCCESS) {
								logger.success(`Successfully acquired subdomain ${subdomain}.${hostname}`);
							} else if (subdomainStatus == REQUEST_STATUS.UNAVAILABLE) {
								logger.error(
									"Unable to acquire subdomain. Please try a different subdomain or use a remote port."
								);
								process.exit(1);
							} else if (subdomainStatus == REQUEST_STATUS.UNSUPPORTED) {
								logger.error("The server does not support subdomains. Try requesting a port instead.");
								process.exit(1);
							}
							break;
						case MESSAGE_TYPE.CONNECTION_CLOSED:
							// Can be safely ignored.
							break;
						case MESSAGE_TYPE.KEEPALIVE:
							// We can safely ignore this message type.
							break;
						case MESSAGE_TYPE.PORT_REQUEST:
							logger.error("Uh oh, the client received an erroneous packet.");
							logger.error(
								"This shouldn't happen - please leave an issue on the GitHub Repository"
							);
							logger.info("Bugs are how flowers grow ✨");
							break;
					}
				}
			},
			open(socket) {
				// First, authenticate!
				if (secretKey) {
					logger.debugVerbose("Authenticating to server with secret key " + secretKey);
					const keyMessage = encodeMessage(0, MESSAGE_TYPE.SECRET_EXCHANGE, new Uint8Array(new TextEncoder().encode(secretKey)));
					socket.write(keyMessage);
					return;
				}

				logger.debugVerbose("Connected successfully to server");
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
					socket.write(encodeMessage(0, MESSAGE_TYPE.PORT_REQUEST, null));
				}
				
				// request a subdomain if one is provided
				if (subdomain) {
					socket.write(
						encodeMessage(
							0,
							MESSAGE_TYPE.SUBDOMAIN_REQUEST,
							new Uint8Array(new TextEncoder().encode(subdomain))
						)
					);
				}
			},

			close(_socket, _error) {
				logger.info("Connection with the conduit server has closed.");
				// close all the local tunnels
				for (const connectionId in localTunnels) {
					localTunnels[connectionId]?.end();
				}
				
				process.exit(1);
				
				
			},
			// client-specific handlers
			connectError(_socket, _error: any) {
				// console.log(Object.keys(_error));
				
				if (_error?.code==="ECONNREFUSED") {
					logger.warn(
						"Failed to connect to the conduit server. Please check your network connection and the hostname."
					);
				
					return;
				}
				// called when the connection fails on the client-side
				
			},
		},
	});


	if (!keepAlive) {

		// If the keepAlive is false, it will only be up and running for 6 hours

		try {
			setTimeout(() => {
				conduitSocket?.end()
			},3600*24*1000)
		} catch(e) {
			logger.error("You probably ended your connection earlier. Try again next time.");
		}
		


	}
	} catch(e) {
	
		// console.log(e);
		const listOfLogs = ["We've all had better moments","Ouch! That hurts"]

		logger.error(listOfLogs[Math.floor(Math.random()*listOfLogs.length)]+". Make sure you have something running at the port specified and run again.")
		return;
	}
	
	
}

// connection from the conduit client to the local port
async function establishLocalTunnel(connectionId: number, localPort: number) {
	localTunnels[connectionId] = await Bun.connect({
		hostname: "localhost",
		port: localPort,

		socket: {
			data(_socket, data) {
				// whenever we receive data from the local port, encode it with the connection ID and pass it to the conduit
				logger.debugVerbose("Data received from local port:", data);
				const encodedMessage = encodeMessage(connectionId, MESSAGE_TYPE.DATA, data);
				conduitSocket?.write(encodedMessage);
			},
			open(socket) {
				// called when the local tunnel is established
				logger.debugVerbose("Local connection created.");
				if (pendingData.has(connectionId)) {
					logger.debugVerbose(`Sending pending data for connection ${connectionId}`);
					for (const data of pendingData.get(connectionId) || []) {
						socket.write(data);
					}
					pendingData.delete(connectionId); // clear the pending data after sending
				}
				// TODO: implement parity here, make sure server knows to wait til local tunnel is created
			},
			close(_socket, error) {
				// called when the local tunnel is closed by the client
				logger.debugVerbose("Local connection closed.");
				const encodedMessage = encodeMessage(connectionId, MESSAGE_TYPE.CONNECTION_CLOSED, null);
				conduitSocket?.write(encodedMessage);
				delete localTunnels[connectionId];
			},
			drain(_socket) {
				//TODO: implement
			},
			error(_socket, _error) {
				logger.error("Uh oh, there was an error in the connection to the local application.");
				logger.error(
					"You shouldn't be seeing this - please make an issue on the GitHub repository."
				);
				logger.info("Bugs are how flowers grow ✨");
			},

			connectError(_socket, error) {
				logger.error("Something went wrong establishing the local tunnel:", error);
				logger.info(
					"You shouldn't be seeing this - please make an issue on the GitHub repository."
				);
				logger.info("Bugs are how flowers grow ✨");
				const encodedMessage = encodeMessage(connectionId, MESSAGE_TYPE.CONNECTION_CLOSED, null);
				conduitSocket?.write(encodedMessage);
				delete localTunnels[connectionId];
			},
			end(_socket) {
				// this is called when the local application closes the connection.
				logger.info("The local application closed the connection.");
				// we don't need to handle this, because when this event occurs, one of the other handlers is called too.
			},
			timeout(_socket) {
				// this is called if by some nightmare the local connection times out.
				logger.error("Somehow, the connection to the local application timed out.");
				logger.info(
					"You shouldn't be seeing this - please make an issue on the GitHub repository."
				);
				logger.info(
					"Cool bug fact: bombardier beetles can eject boiling chemical spray from their abdomen when threatened!"
				);
			},
		},
	});
}
