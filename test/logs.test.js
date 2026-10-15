// -----------------------------------------------------------------------------
// Quiet logs: a normal cycle writes nothing at info, and no secret of the
// configuration (nor a token of the cloud) ever reaches a log line, at any
// level, in success or in failure.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store.js';
import { PASSWORD, SBS50, SERIALS, createFakeXSense } from './helpers/fakeXSense.js';
import { VALID_CONFIG, createWorld } from './helpers/world.js';

// What must never be written: the password, and what the fake cloud hands out.
const SECRETS = [
  PASSWORD,
  'wrong secret pass',
  'access-token-',
  'refresh-token-',
  'id-token-',
  'fake/secret+key',
  'fake-session-token',
  'FakeClientSecretValue',
];

function leaks(lines) {
  return lines.filter((line) => SECRETS.some((secret) => line.text.includes(secret)));
}

test('a normal refresh cycle writes nothing at info', async () => {
  const world = await createWorld();
  try {
    const startLines = world.logger.lines.length;
    await world.hub.refresh();
    await world.hub.refresh({ account: true });
    // A live update that changes nothing visible.
    await world.hub.handleMqttMessage(
      `$aws/things/SBS50${SBS50}/shadow/name/2nd_mainpage/update`,
      JSON.stringify({ state: { reported: { devs: { [SERIALS.smoke]: { rfLevel: '3' } } } } }),
    );
    const cycle = world.logger.lines.slice(startLines);
    assert.deepEqual(
      cycle.filter((line) => line.level !== 'debug'),
      [],
      'only debug lines during a normal cycle',
    );
  } finally {
    world.app.stop();
  }
});

test('no secret in the logs: start, live updates, test action', async () => {
  const world = await createWorld();
  try {
    await world.hub.handleMqttMessage(
      `$aws/things/SBS50${SBS50}/shadow/name/2nd_mainpage/update`,
      JSON.stringify({ state: { reported: { devs: { [SERIALS.smoke]: { alarmStatus: '1' } } } } }),
    );
    await world.fake.action('test_connection', {});
    assert.ok(world.logger.lines.length > 0);
    assert.deepEqual(leaks(world.logger.lines), []);
  } finally {
    world.app.stop();
  }
});

test('no secret in the logs: refused password, unreachable cloud, expired session', async () => {
  const refused = await createWorld({ config: { ...VALID_CONFIG, password: 'wrong secret pass' } });
  refused.app.stop();
  assert.ok(refused.logger.lines.some((line) => line.level === 'error'));
  assert.deepEqual(leaks(refused.logger.lines), []);

  const cloud = createFakeXSense();
  cloud.setDown(true);
  const down = await createWorld({ cloud });
  down.app.stop();
  assert.ok(down.logger.lines.some((line) => line.level === 'warn'));
  assert.deepEqual(leaks(down.logger.lines), []);

  const store = new MemoryStore();
  const expiring = await createWorld({ store });
  try {
    expiring.cloud.expireTokens();
    expiring.cloud.refuseRefresh();
    await expiring.hub.refresh({ account: true });
    assert.deepEqual(leaks(expiring.logger.lines), []);
  } finally {
    expiring.app.stop();
  }
});
