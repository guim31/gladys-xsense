// -----------------------------------------------------------------------------
// The minimal MQTT 3.1.1 client, against a fake WebSocket playing the broker.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  connectPacket,
  openMqtt,
  publishPacket,
  readPackets,
  subscribePacket,
} from '../src/xsense/mqtt.js';

class FakeSocket {
  static last = null;
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = 0;
    this.sent = [];
    this.listeners = {};
    FakeSocket.last = this;
    setImmediate(() => {
      this.readyState = 1;
      this.emit('open', {});
    });
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  emit(type, event) {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
  send(bytes) {
    this.sent.push(Buffer.from(bytes));
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    setImmediate(() => this.emit('close', {}));
  }
  /** The broker sends bytes (an ArrayBuffer, like a real WebSocket). */
  deliver(bytes) {
    const buffer = Buffer.from(bytes);
    this.emit('message', {
      data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length),
    });
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('CONNECT carries the client id, the user name and an empty password', () => {
  const bytes = connectPacket({ clientId: 'abc', username: '?SDK=iOS&Version=2.26.5' });
  const { packets } = readPackets(bytes);
  assert.equal(packets.length, 1);
  assert.equal(packets[0].type, 1);
  const body = packets[0].body;
  assert.equal(body.subarray(2, 6).toString(), 'MQTT');
  assert.equal(body[6], 4); // protocol level 3.1.1
  assert.equal(body[7], 0xc2); // user name + password + clean session
  assert.ok(body.includes(Buffer.from('?SDK=iOS&Version=2.26.5')));
});

test('packets are read across frame boundaries, long ones included', () => {
  const long = publishPacket('a/b', Buffer.alloc(300, 0x61), { qos: 1, packetId: 7 });
  const short = publishPacket('c', '{}');
  const stream = Buffer.concat([long, short]);
  const first = readPackets(stream.subarray(0, 100));
  assert.equal(first.packets.length, 0);
  const second = readPackets(Buffer.concat([first.rest, stream.subarray(100)]));
  assert.equal(second.packets.length, 2);
  assert.equal(second.rest.length, 0);
  assert.equal(subscribePacket(1, ['x'])[0], 0x82);
});

test('connects, subscribes, acknowledges QoS 1 messages and reports a closed link', async () => {
  const messages = [];
  let closedWith = null;
  const opening = openMqtt({
    url: 'wss://broker.example/mqtt?X-Amz-Signature=x',
    clientId: 'client-1',
    username: 'user',
    topics: ['$aws/things/T/shadow/name/+/update', '@xsense/events/+/H'],
    onMessage: (topic, payload) => messages.push([topic, payload.toString()]),
    onClose: (reason) => {
      closedWith = reason;
    },
    WebSocket: FakeSocket,
  });
  await tick();
  const socket = FakeSocket.last;
  assert.deepEqual(socket.protocols, ['mqtt']);
  assert.equal(socket.sent[0][0] >> 4, 1); // CONNECT
  socket.deliver([0x20, 2, 0, 0]); // CONNACK accepted
  const link = await opening;
  const subscribe = readPackets(socket.sent[1]).packets[0];
  assert.equal(subscribe.type, 8);
  assert.ok(subscribe.body.includes(Buffer.from('@xsense/events/+/H')));

  // A QoS 1 publish split in two frames.
  const publish = publishPacket('$aws/things/T/shadow/name/2nd_mainpage/update', '{"a":1}', {
    qos: 1,
    packetId: 0x0102,
  });
  socket.deliver(publish.subarray(0, 5));
  socket.deliver(publish.subarray(5));
  assert.deepEqual(messages, [['$aws/things/T/shadow/name/2nd_mainpage/update', '{"a":1}']]);
  assert.deepEqual([...socket.sent.at(-1)], [0x40, 2, 1, 2]); // PUBACK

  socket.close();
  await tick();
  await tick();
  assert.equal(closedWith, 'MQTT connection closed');
  link.close(); // closing twice is harmless
});

test('a refused connection rejects', async () => {
  const opening = openMqtt({
    url: 'wss://broker.example/mqtt',
    clientId: 'c',
    username: 'u',
    topics: [],
    onMessage: () => {},
    WebSocket: FakeSocket,
  });
  await tick();
  FakeSocket.last.deliver([0x20, 2, 0, 5]);
  await assert.rejects(opening, /refused \(code 5\)/);
});

test('a broker that never answers times out', async () => {
  const opening = openMqtt({
    url: 'wss://broker.example/mqtt',
    clientId: 'c',
    username: 'u',
    topics: [],
    onMessage: () => {},
    WebSocket: FakeSocket,
    connectTimeoutMs: 20,
  });
  await assert.rejects(opening, /timed out/);
});
