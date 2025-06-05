export const MESSAGE_TYPE = {
	NEW_CONNECTION: 0,
	DATA: 1,
	CONNECTION_CLOSED: 2,
	KEEPALIVE: 3,
	PORT_REQUEST: 4,
	PORT_RESPONSE: 5,
	PORT_ASSIGNED: 6,
	SUBDOMAIN_REQUEST: 7,
	SUBDOMAIN_RESPONSE: 8
};
// status codes for PORT_RESPONSE
export const PORT_STATUS = {
	SUCCESS: 0, // sent when the port requested is available on the server, and not in use by another tunnel.
	UNAVAILABLE: 1, // sorry, port is taken bbg
};

export const SUBDOMAIN_STATUS = {
	SUCCESS: 0,
	UNAVAILABLE: 1
}

/*
outsider opens connection to a a listening port
the client and outsider can send data back and forth
a second outsider opens a connection to the same port
when the second outsider sends data, it is sent to the 
*/

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

// [4 bytes: connection id][1 byte: message type][4 bytes: payload length][n bytes: payload]
export const HEADER_SIZE = 4 + 1 + 4;
export type ClientMessage = {
	connectionId: number;
	messageType: (typeof MESSAGE_TYPE)[keyof typeof MESSAGE_TYPE];
	payloadLength: number;
	payload?: Uint8Array | null;
};

export default class MessageParser {
	private buffer: Uint8Array;
	private offset: number = 0;

	constructor() {
		this.buffer = new Uint8Array(4096);
	}

	// adds incoming data to the buffer
	addData(data: Uint8Array) {
		// do we need to resize the buffer?
		if (this.offset + data.length > this.buffer.length) {
			const newBuffer = new Uint8Array(this.buffer.length + data.length);
			newBuffer.set(this.buffer);
			this.buffer = newBuffer;
		}

		// add the new data
		this.buffer.set(data, this.offset);
		this.offset += data.length;
	}

	// attempt to parse a complete message
	parseMessage() {
		if (this.offset < HEADER_SIZE) return null; // not enough data to parse the header

		const view = new DataView(this.buffer.buffer, 0, this.offset);
		const payloadLength = view.getUint32(5, false);
		const totalLength = HEADER_SIZE + payloadLength;

		if (this.offset < totalLength) return null; // the full message hasn't been received yet

		const messageData = decodeMessage(this.buffer.subarray(0, totalLength));

		// shift the remaining data to the start of the buffer
		const remainingBytes = this.offset - totalLength;
		if (remainingBytes > 0) {
			this.buffer.copyWithin(0, totalLength, this.offset);
		}
		this.offset -= totalLength;

		return messageData;
	}

	// extract all complete messages from the buffer
	parseMessages() {
		const messages = [];

		while (true) {
			const result = this.parseMessage();
			if (!result) break; // no more complete messages

			messages.push(result);
		}

		return messages;
	}
}

export function encodeMessage(
	connectionId: number,
	messageType: number,
	payload: Uint8Array | null
): Uint8Array {
	const payloadLength = payload ? payload.length : 0;

	const size = HEADER_SIZE + payloadLength;

	const buffer = new Uint8Array(size);
	const view = new DataView(buffer.buffer);

	view.setUint32(0, connectionId, false);
	view.setUint8(4, messageType);
	view.setUint32(5, payloadLength, false);

	if (payload && payloadLength > 0) buffer.set(payload, 9);

	return buffer;
}

export function decodeMessage(data: Uint8Array): ClientMessage {
	const view = new DataView(data.buffer);

	const connectionId = view.getUint32(0, false);
	const messageType = view.getUint8(4);
	const payloadLength = view.getUint32(5, false);

	let payload: Uint8Array | null = null;
	if (payloadLength > 0) {
		payload = data.slice(HEADER_SIZE, HEADER_SIZE + payloadLength);
	}

	return {
		connectionId,
		messageType,
		payloadLength,
		payload: payload,
	};
}
