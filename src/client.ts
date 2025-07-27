#!/usr/bin/env bun

// import meow from "meow";
import MessageParser, {
	decodeMessage,
	encodeMessage,
	MESSAGE_TYPE,
	REQUEST_STATUS,
	SECRET_STATUS
} from "./messages";
import { generateKeyPair, deriveSharedSecret, importKey, exportKey, decryptData, encryptData } from "./crypto"
import logger from "./logger";
import { isErrored } from "stream";
import { parse } from "path";

const conduitPort: number = 4225; // hard-coded server control port - "HACK" on a phone!
let conduitSocket: Bun.Socket | undefined; // connection to the central conduit server; value assigned in functions
let localTunnels: { [connectionId: number]: Bun.Socket } = {}; // same here!
let assignedPort: number = 0;
const pendingData = new Map<number, Array<Uint8Array>>(); // data that is pending to be sent to the local port, index is connection ID
const parser = new MessageParser(); // parser for incoming messages from the conduit server
let clientKeyPair: CryptoKeyPair; // The key-pair generated for ECDH key exchange.
let sharedSymKey: CryptoKey;

/**
 * The central function for the client to connect to a running Conduit server. 
 * @param hostname - The hostname of the Conduit server.
 * @param localPort - The port on the client's machine to forward to the server.
 * @param keepAlive - Whether or not to maintain the connection longer than the default six hours.
 * @param remotePort - The remote port to request on the server.
 * @param subdomain - The subdomain to request on the server.
 * @param secretKey - The secret key with which to authenticate to the server.
 * @returns nothing.
 */

export async function connectToConduit(
	hostname: string,
	localPort: number,
	keepAlive: boolean,
	remotePort?: number | null,
	subdomain?: string,
	secretKey?: string
	
) {
	logger.await("Generating personal ECDH key-pair...");
	clientKeyPair = await generateKeyPair();
	const publicKey = await crypto.subtle.exportKey("jwk", clientKeyPair.publicKey);
	logger.await(`Connecting to conduit server at ${hostname}:${conduitPort}...`);
	try {
		
		conduitSocket = await Bun.connect({
		hostname: hostname, // hostname for the remote conduit server
		port: conduitPort, // this is the port that the conduit server will always run on.

		socket: {
			async data(socket, data) {
				// called on the receiving of new data from the conduit
				parser.addData(data);
				// we've gotta interpret the server message
				for (const parsedMessage of parser.parseMessages()) {
					logger.debugVerbose(`MESSAGE RECEIVED: MESSAGE_TYPE ${parsedMessage.messageType}, PAYLOAD: ${parsedMessage.payload}`)
					let decryptedPayload: Uint8Array | null = new Uint8Array();
					// If we need to decrypt, we do it first.
					if (parsedMessage.messageType !== MESSAGE_TYPE.CRYPTO_EXCHANGE && parsedMessage.messageType !== MESSAGE_TYPE.NEW_CONNECTION && parsedMessage.messageType !== MESSAGE_TYPE.CONNECTION_CLOSED) {
						decryptedPayload = await decryptData(sharedSymKey, parsedMessage.payload ? parsedMessage.payload : new Uint8Array());
					}
					logger.debugVerbose(
						`[MESSAGE_TYPE: ${parsedMessage.messageType}] ${parsedMessage.payloadLength} bytes`
					);
					switch (parsedMessage.messageType) {
						case MESSAGE_TYPE.DATA:
							if (!decryptedPayload) {
								logger.info("Received data packet with null payload. Dropping it.");
								break;
							}
							logger.awaitVerbose(
								"Trying to write data to local tunnel with connection ID:",
								parsedMessage.connectionId,
								"state",
								localTunnels[parsedMessage.connectionId]?.readyState
							);

							if (localTunnels[parsedMessage.connectionId]) {
								localTunnels[parsedMessage.connectionId]?.write(decryptedPayload);
							} else {
								logger.warnVerbose(
									`Local tunnel ${parsedMessage.connectionId} is not open, buffering data`
								);
								if (!pendingData.has(parsedMessage.connectionId)) {
									pendingData.set(parsedMessage.connectionId, []);
								}
								pendingData
									.get(parsedMessage.connectionId)
									?.push(decryptedPayload);
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
							const secretStatus = decryptedPayload ? decryptedPayload[0] : undefined;
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
										await encryptData(sharedSymKey, new Uint8Array([remotePort >> 8, remotePort & 0xff]))
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
											await encryptData(sharedSymKey, new Uint8Array(new TextEncoder().encode(subdomain)))
										)
									);
								}
								
							}
							break;
						case MESSAGE_TYPE.CRYPTO_EXCHANGE:
							if (sharedSymKey) {
								logger.warn("Received cryptographic exchange request despite existing symmetric key.");
								break;
							}
							// Used to negotiate an ECDH key exchange.
							// The payload for this type of message will be the public key generated by the server.
							if (!parsedMessage.payload) {
								logger.error("Something went wrong with the key exchange. If this occurs often, please raise an issue in the GitHub repo.");
								process.exit(1);
							}
							logger.debugVerbose("Received payload: " + parsedMessage.payload);
							logger.debugVerbose("Payload type: " + typeof parsedMessage.payload);
							logger.debugVerbose("Decoded payload: " + new TextDecoder().decode(parsedMessage.payload));
							const receivedKey: CryptoKey = await importKey(parsedMessage.payload);
							logger.infoVerbose(`Received key ${receivedKey}`);
							sharedSymKey = await deriveSharedSecret(receivedKey, clientKeyPair.privateKey);
							logger.infoVerbose(`Shared sym key: ${sharedSymKey}`);
							logger.debugVerbose("Successfully generated symmetric key from key exchange! Sending port request/secret key.");

							if (secretKey) {
								logger.debugVerbose("Authenticating to server with secret key " + secretKey);
								const keyMessage = encodeMessage(0, MESSAGE_TYPE.SECRET_EXCHANGE, new Uint8Array(new TextEncoder().encode(secretKey)));
								socket.write(keyMessage);
								return;
							}

							logger.debugVerbose("Connected successfully to server, with encryption");
							// called on the opening of a new connection to the conduit
							// first step is to request our port on the conduit server
							if (remotePort) {
								logger.debugVerbose(`Requesting remote port ${remotePort} from Conduit server`);
								const portRequestMessage = encodeMessage(
									0,
									MESSAGE_TYPE.PORT_REQUEST,
									await encryptData(sharedSymKey, new Uint8Array([remotePort >> 8, remotePort & 0xff]))
								);
								socket.write(portRequestMessage);
								assignedPort = remotePort; // set the assigned port to the remote port we requested
							} else {
								logger.debugVerbose(`No remote port specified, sending a port request with a null payload.`);
								socket.write(encodeMessage(0, MESSAGE_TYPE.PORT_REQUEST, await encryptData(sharedSymKey, null)));
							}
							
							// request a subdomain if one is provided
							if (subdomain) {
								logger.debugVerbose(`Requesting subdomain ${subdomain} from Conduit server.`);
								socket.write(
									encodeMessage(
										0,
										MESSAGE_TYPE.SUBDOMAIN_REQUEST,
										await encryptData(sharedSymKey, new Uint8Array(new TextEncoder().encode(subdomain)))
									)
								);
							}
							
							break;
						case MESSAGE_TYPE.PORT_RESPONSE:
							if (decryptedPayload == undefined) { 
								logger.warn("Uh oh. Something went wrong with the port response. Please raise an issue on the GitHub repo."); 
								process.exit(1);
							}
							const portStatus = decryptedPayload[0];
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
							if (decryptedPayload == undefined) {
								logger.warn("Couldn't figure out what port you were assigned - something went very wrong. Please raise an issue on the GitHub repository.");
								process.exit(1);
							}
							assignedPort =
								((decryptedPayload[0] ?? 0) << 8) | (decryptedPayload[1] ?? 0);
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
							if (decryptedPayload == undefined) {
								logger.warn("Something went wrong with parsing the subdomain response. Please raise an issue on the GitHub repository.");
								process.exit(1);
							}
							const subdomainStatus = decryptedPayload[0];
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
				// First thing's first, we gotta make sure we're secure.
				logger.debugVerbose("Sending ECDH public key to Conduit server.");
				logger.infoVerbose("Exported JWK: " + JSON.stringify(publicKey));
				const publicKeyMessage = encodeMessage(0, MESSAGE_TYPE.CRYPTO_EXCHANGE, new TextEncoder().encode(JSON.stringify(publicKey))); // Yes, this is a total mess.
				socket.write(publicKeyMessage);
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

/**
 * Creates a local tunnel on the client's machine between the Conduit client and the local port to be forwarded.
 * @param connectionId - The connection ID provided by the Conduit server, to identify different communication streams.
 * @param localPort - The local port to create a tunnel to.
 */
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
