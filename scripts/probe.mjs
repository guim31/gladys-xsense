#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe the real X-Sense cloud with the integration's own client, read only.
//
//   node scripts/probe.mjs
//       Fake account: calls the real X-Sense API (101001, unauthenticated) and
//       runs the real Cognito SRP sign-in until AWS refuses the made-up
//       account. Proves the app identity, the client secret decoding and the
//       SRP first step against the live services.
//
//   XSENSE_EMAIL=... XSENSE_PASSWORD=... node scripts/probe.mjs [--mqtt]
//       Real account: full sign-in, homes, stations and detectors (models
//       and families only), the shadows found and their keys (never their
//       values), and with --mqtt one live connection to the AWS IoT broker
//       for 15 seconds (counts the messages received).
//
// Nothing sensitive is printed: no e-mail, password, token, key, serial
// number, name or address. Nothing is written to the cloud, nothing to disk.
// -----------------------------------------------------------------------------

import { randomBytes, randomUUID } from 'node:crypto';
import { createXSenseClient, APP } from '../src/xsense/client.js';
import { MemoryStore } from '../src/store.js';
import { buildUnits, stationShadows } from '../src/xsense/model.js';
import { presignMqttUrl } from '../src/xsense/crypto.js';
import { openMqtt } from '../src/xsense/mqtt.js';

const line = (label, value) => console.log(`${label.padEnd(34)} ${value}`);
const keysOf = (value) =>
  value && typeof value === 'object' ? Object.keys(value).sort().join(', ') : String(value);

const email = process.env.XSENSE_EMAIL;
const password = process.env.XSENSE_PASSWORD;
const withMqtt = process.argv.includes('--mqtt');

async function fakeAccount() {
  // A raw 101001 call first, to show the answer's shape.
  const response = await fetch(APP.api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientType: APP.clientType,
      mac: 'abcdefg',
      appVersion: APP.version,
      bizCode: '101001',
      appCode: APP.code,
    }),
  });
  const body = await response.json().catch(() => null);
  line('101001 HTTP status', response.status);
  line('101001 reCode', body?.reCode);
  line('101001 reData keys', keysOf(body?.reData));
  line('Cognito region (cgtRegion)', body?.reData?.cgtRegion ?? '?');

  const client = createXSenseClient({ store: new MemoryStore() });
  client.setCredentials(
    `probe-${randomBytes(6).toString('hex')}@example.invalid`,
    randomBytes(12).toString('base64'),
  );
  try {
    await client.connect();
    line('Sign-in of a made-up account', 'ACCEPTED (unexpected!)');
    process.exitCode = 1;
  } catch (err) {
    line('Sign-in of a made-up account', `${err.kind}: ${err.message}`);
    if (err.kind !== 'auth') {
      process.exitCode = 1;
    } else {
      line('Verdict', 'OK: the app identity and the SRP first step are accepted');
    }
  }
}

async function realAccount() {
  const client = createXSenseClient({ store: new MemoryStore() });
  client.setCredentials(email, password);
  await client.connect();
  line('Sign-in', 'OK');
  const account = await client.loadAccount();
  const { houses, units } = buildUnits(account);
  line('Homes', houses.length);
  const models = {};
  for (const { stations } of account) {
    for (const station of stations?.stations ?? []) {
      const key = `station ${station.category}`;
      models[key] = (models[key] ?? 0) + 1;
      for (const device of station.devices ?? []) {
        const k = `  child ${device.deviceType}`;
        models[k] = (models[k] ?? 0) + 1;
      }
    }
  }
  for (const [model, count] of Object.entries(models)) line(model, count);
  line(
    'Units kept by the integration',
    units
      .map((unit) => `${unit.kind}:${unit.model}${unit.family ? `/${unit.family}` : ''}`)
      .join(' '),
  );

  for (const station of units.filter((unit) => unit.serial === unit.stationSerial)) {
    const shadows = stationShadows(station);
    for (const name of [...shadows.state, ...shadows.info]) {
      const reported = await client.getShadow({
        region: station.region,
        thing: station.thing,
        name,
      });
      line(
        `shadow ${station.model} ${name.replace(station.serial, '<sn>')}`,
        reported ? `keys: ${keysOf(reported)}` : 'none',
      );
      if (reported?.devs) {
        const first = Object.values(reported.devs)[0];
        line('  devs[0] keys', keysOf(first));
      }
    }
  }
  for (const house of houses) {
    for (const name of ['mainpage', '2nd_mainpage']) {
      const reported = await client.getShadow({ region: house.mqttRegion, thing: house.id, name });
      line(`home shadow ${name}`, reported ? `${Object.keys(reported).length} record(s)` : 'none');
    }
  }

  if (withMqtt && houses[0]?.mqttServer) {
    const house = houses[0];
    const credentials = await client.awsCredentials();
    let received = 0;
    const link = await openMqtt({
      url: presignMqttUrl({ server: house.mqttServer, region: house.mqttRegion, credentials }),
      clientId: randomUUID(),
      username: '?SDK=iOS&Version=2.26.5',
      topics: [`$aws/things/${house.id}/shadow/name/+/update`, `@xsense/events/+/${house.id}`],
      onMessage: () => {
        received += 1;
      },
      onClose: (reason) => line('MQTT closed', reason),
    });
    line('MQTT', 'connected, listening 15 s');
    await new Promise((resolve) => setTimeout(resolve, 15000));
    line('MQTT messages received', received);
    link.close();
  }
}

try {
  if (email && password) {
    await realAccount();
  } else {
    await fakeAccount();
  }
} catch (err) {
  const cause = err.cause?.code ? ` (${err.cause.code})` : '';
  line('Failed', `${err.kind ?? err.name}: ${err.message}${cause}`);
  if (err.name === 'TypeError') {
    line('Hint', 'api.x-sense-iot.com unreachable from this machine (network or proxy)');
  }
  process.exitCode = 1;
}
