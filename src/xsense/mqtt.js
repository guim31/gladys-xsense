// -----------------------------------------------------------------------------
// A minimal MQTT 3.1.1 client over WebSocket, for the AWS IoT broker of X-Sense.
//
// The X-Sense app (and python-xsense, through paho) receives the shadow
// updates of the base stations live over MQTT: an alarm reaches Gladys in
// seconds instead of waiting for the next shadow read. Only what this needs is
// implemented, so the integration keeps the SDK as its only dependency:
// CONNECT, SUBSCRIBE (QoS 1), incoming PUBLISH (QoS 0 and 1, acknowledged),
// PINGREQ. Nothing is ever published.
//
// The WebSocket class is Node's global one (Node 22+); the tests inject theirs.
// -----------------------------------------------------------------------------

const PACKET = {
  CONNECT: 1,
  CONNACK: 2,
  PUBLISH: 3,
  PUBACK: 4,
  SUBSCRIBE: 8,
  SUBACK: 9,
  PINGREQ: 12,
  PINGRESP: 13,
  DISCONNECT: 14,
};

const utf8 = (text) => {
  const bytes = Buffer.from(text, 'utf8');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length);
  return Buffer.concat([length, bytes]);
};

function remainingLength(length) {
  const bytes = [];
  let value = length;
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) byte |= 0x80;
    bytes.push(byte);
  } while (value > 0);
  return Buffer.from(bytes);
}

const packet = (header, body) =>
  Buffer.concat([Buffer.from([header]), remainingLength(body.length), body]);

/** CONNECT with a clean session, a user name and an (empty) password. */
export function connectPacket({ clientId, username, password = '', keepAlive = 60 }) {
  const variable = Buffer.concat([
    utf8('MQTT'),
    Buffer.from([4, 0x02 | 0x80 | 0x40, keepAlive >> 8, keepAlive & 0xff]),
  ]);
  return packet(
    PACKET.CONNECT << 4,
    Buffer.concat([variable, utf8(clientId), utf8(username), utf8(password)]),
  );
}

export function subscribePacket(packetId, topics, qos = 1) {
  const id = Buffer.from([packetId >> 8, packetId & 0xff]);
  const list = topics.map((topic) => Buffer.concat([utf8(topic), Buffer.from([qos])]));
  return packet((PACKET.SUBSCRIBE << 4) | 0x02, Buffer.concat([id, ...list]));
}

/** PUBLISH packet (the tests use it to play the broker). */
export function publishPacket(topic, payload, { qos = 0, packetId = 1 } = {}) {
  const parts = [utf8(topic)];
  if (qos > 0) parts.push(Buffer.from([packetId >> 8, packetId & 0xff]));
  parts.push(Buffer.from(payload));
  return packet((PACKET.PUBLISH << 4) | (qos << 1), Buffer.concat(parts));
}

/**
 * Split a byte stream into MQTT packets.
 * @returns {{ packets: Array<{ type: number, flags: number, body: Buffer }>, rest: Buffer }}
 */
export function readPackets(buffer) {
  const packets = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    let multiplier = 1;
    let length = 0;
    let index = offset + 1;
    let byte;
    do {
      if (index >= buffer.length) {
        return { packets, rest: buffer.subarray(offset) };
      }
      byte = buffer[index];
      length += (byte & 0x7f) * multiplier;
      multiplier *= 128;
      index += 1;
    } while (byte & 0x80);
    if (index + length > buffer.length) {
      break;
    }
    packets.push({
      type: buffer[offset] >> 4,
      flags: buffer[offset] & 0x0f,
      body: buffer.subarray(index, index + length),
    });
    offset = index + length;
  }
  return { packets, rest: buffer.subarray(offset) };
}

function parsePublish(flags, body) {
  const qos = (flags >> 1) & 0x03;
  const topicLength = body.readUInt16BE(0);
  const topic = body.subarray(2, 2 + topicLength).toString('utf8');
  let offset = 2 + topicLength;
  let packetId = null;
  if (qos > 0) {
    packetId = body.readUInt16BE(offset);
    offset += 2;
  }
  return { topic, qos, packetId, payload: body.subarray(offset) };
}

/**
 * One MQTT connection; resolves once the broker accepted it.
 * @param {object} options
 * @param {string} options.url presigned wss:// URL
 * @param {string} options.clientId
 * @param {string} options.username
 * @param {string[]} options.topics subscribed right after the connection
 * @param {(topic: string, payload: Buffer) => void} options.onMessage
 * @param {(reason: string) => void} options.onClose called once, when the connection ends
 * @param {typeof WebSocket} [options.WebSocket]
 * @param {number} [options.keepAlive] seconds
 * @param {number} [options.connectTimeoutMs]
 */
export function openMqtt({
  url,
  clientId,
  username,
  topics,
  onMessage,
  onClose,
  WebSocket: WebSocketImpl = globalThis.WebSocket,
  keepAlive = 60,
  connectTimeoutMs = 20000,
}) {
  return new Promise((resolve, reject) => {
    let socket;
    try {
      socket = new WebSocketImpl(url, ['mqtt']);
    } catch (err) {
      reject(err);
      return;
    }
    socket.binaryType = 'arraybuffer';
    let buffer = Buffer.alloc(0);
    let connected = false;
    let closed = false;
    let pingTimer = null;
    let packetId = 1;

    const send = (bytes) => {
      if (socket.readyState === 1) socket.send(bytes);
    };

    const finish = (reason) => {
      if (closed) return;
      closed = true;
      clearInterval(pingTimer);
      clearTimeout(connectTimer);
      try {
        socket.close();
      } catch {
        // already closed
      }
      if (connected) {
        onClose?.(reason);
      } else {
        reject(new Error(reason));
      }
    };

    const connectTimer = setTimeout(() => finish('MQTT connection timed out'), connectTimeoutMs);

    socket.addEventListener('open', () => {
      send(connectPacket({ clientId, username, keepAlive }));
    });

    socket.addEventListener('message', (event) => {
      const chunk = Buffer.from(event.data);
      const { packets, rest } = readPackets(Buffer.concat([buffer, chunk]));
      buffer = rest;
      for (const { type, flags, body } of packets) {
        if (type === PACKET.CONNACK) {
          const code = body[1];
          if (code !== 0) {
            finish(`MQTT connection refused (code ${code})`);
            return;
          }
          connected = true;
          clearTimeout(connectTimer);
          if (topics.length > 0) {
            send(subscribePacket(packetId++, topics));
          }
          pingTimer = setInterval(
            () => send(Buffer.from([PACKET.PINGREQ << 4, 0])),
            keepAlive * 750,
          );
          pingTimer.unref?.();
          resolve({
            close() {
              send(Buffer.from([PACKET.DISCONNECT << 4, 0]));
              finish('closed by the integration');
            },
          });
        } else if (type === PACKET.PUBLISH) {
          const message = parsePublish(flags, body);
          if (message.qos === 1) {
            send(
              Buffer.from([PACKET.PUBACK << 4, 2, message.packetId >> 8, message.packetId & 0xff]),
            );
          }
          try {
            onMessage(message.topic, message.payload);
          } catch {
            // a bad message never breaks the connection
          }
        }
        // SUBACK, PINGRESP: nothing to do.
      }
    });

    socket.addEventListener('close', () => finish('MQTT connection closed'));
    socket.addEventListener('error', () => finish('MQTT connection error'));
  });
}
