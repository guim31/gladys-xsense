// -----------------------------------------------------------------------------
// The X-Sense client against the simulated cloud: the SRP sign-in end to end
// (the fake Cognito runs the server side of SRP), the saved session, token
// refresh and its fallbacks, the signed shadow reads, and errors that never
// carry a secret.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createXSenseClient, parseExpiration } from '../src/xsense/client.js';
import { MemoryStore } from '../src/store.js';
import { EMAIL, PASSWORD, SBS50, createFakeXSense } from './helpers/fakeXSense.js';

function setup({ password = PASSWORD, store = new MemoryStore(), now } = {}) {
  const cloud = createFakeXSense();
  const client = createXSenseClient({ fetch: cloud.fetch, store, now });
  client.setCredentials(EMAIL, password);
  return { cloud, client, store };
}

test('signs in with SRP and reads the account', async () => {
  const { cloud, client, store } = setup();
  await client.connect();
  assert.equal(cloud.signIns(), 1);
  const account = await client.loadAccount();
  assert.equal(account.length, 1);
  assert.equal(account[0].stations.stations.length, 4);
  assert.equal(account[0].rooms.houseRooms.length, 6);
  // The session is kept in /data, never the password.
  const saved = await store.get('session');
  assert.equal(saved.email, EMAIL);
  assert.ok(saved.refreshToken);
  assert.ok(!JSON.stringify(saved).includes(PASSWORD));
});

test('a wrong password is an "auth" error without the password in it', async () => {
  const { client } = setup({ password: 'wrong password' });
  await assert.rejects(client.connect(), (err) => {
    assert.equal(err.kind, 'auth');
    assert.match(err.message, /NotAuthorizedException/);
    assert.ok(!err.message.includes('wrong password'));
    return true;
  });
});

test('an unknown e-mail is an "auth" error too', async () => {
  const cloud = createFakeXSense();
  const client = createXSenseClient({ fetch: cloud.fetch, store: new MemoryStore() });
  client.setCredentials('nobody@example.com', PASSWORD);
  await assert.rejects(
    client.connect(),
    (err) => err.kind === 'auth' && /UserNotFound/.test(err.message),
  );
});

test('missing credentials are refused before any request', async () => {
  const cloud = createFakeXSense();
  const client = createXSenseClient({ fetch: cloud.fetch, store: new MemoryStore() });
  await assert.rejects(client.connect(), (err) => err.kind === 'auth');
  assert.equal(cloud.calls.length, 0);
});

test('a restart reuses the saved session instead of signing in again', async () => {
  const store = new MemoryStore();
  const first = setup({ store });
  await first.client.connect();
  const client = createXSenseClient({ fetch: first.cloud.fetch, store });
  client.setCredentials(EMAIL, PASSWORD);
  await client.connect();
  await client.loadAccount();
  assert.equal(first.cloud.signIns(), 1);
});

test('an expired access token is refreshed, a refused refresh signs in again', async () => {
  let clock = Date.UTC(2026, 9, 15, 8, 0, 0);
  const { cloud, client } = setup({ now: () => clock });
  await client.connect();
  clock += 2 * 3600 * 1000;
  await client.loadAccount();
  assert.equal(cloud.signIns(), 1);
  assert.ok(
    cloud.calls.some((c) => c.target?.endsWith('InitiateAuth') && c.host.startsWith('cognito')),
  );

  clock += 2 * 3600 * 1000;
  cloud.refuseRefresh();
  await client.loadAccount();
  assert.equal(cloud.signIns(), 2);
});

test('an access token refused by the API signs in again, once', async () => {
  const { cloud, client } = setup();
  await client.connect();
  cloud.expireTokens();
  cloud.refuseRefresh();
  await client.loadAccount();
  assert.equal(cloud.signIns(), 2);
});

test('shadows: signed read, 404 is null, revoked credentials are renewed once', async () => {
  const { cloud, client } = setup();
  await client.connect();
  const reported = await client.getShadow({
    region: 'eu-central-1',
    thing: `SBS50${SBS50}`,
    name: '2nd_mainpage',
  });
  assert.equal(reported.stationSN, SBS50);
  assert.equal(
    await client.getShadow({ region: 'eu-central-1', thing: `SBS50${SBS50}`, name: 'nothing' }),
    null,
  );
  cloud.revokeAws();
  const again = await client.getShadow({
    region: 'eu-central-1',
    thing: `SBS50${SBS50}`,
    name: '2nd_mainpage',
  });
  assert.equal(again.stationSN, SBS50);
});

test('an unreachable cloud is a "network" error', async () => {
  const { cloud, client } = setup();
  cloud.setDown(true);
  await assert.rejects(
    client.connect(),
    (err) => err.kind === 'network' && /ECONNREFUSED/.test(err.message),
  );
});

test('new credentials forget the previous session', async () => {
  const { cloud, client } = setup();
  await client.connect();
  client.setCredentials(EMAIL, 'another password');
  await assert.rejects(client.connect(), (err) => err.kind === 'auth');
  client.setCredentials(EMAIL, PASSWORD);
  await client.connect();
  assert.ok(cloud.signIns() >= 2);
});

test('AWS credential expirations', () => {
  assert.equal(parseExpiration('2026-10-15 10:20:30+0000'), Date.UTC(2026, 9, 15, 10, 20, 30));
  assert.equal(parseExpiration('2026-10-15T10:20:30Z'), Date.UTC(2026, 9, 15, 10, 20, 30));
  assert.equal(parseExpiration('soon'), null);
  assert.equal(parseExpiration(undefined), null);
});
