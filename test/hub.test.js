// -----------------------------------------------------------------------------
// The whole integration on the SDK's fake Gladys and the simulated X-Sense
// cloud: devices, states, live updates, scene triggers, failures, and the own
// refresh timer that does not wait for the core's onPoll.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store.js';
import { TEXT } from '../src/i18n.js';
import { HOUSE_ID, SBS50, SERIALS, createFakeXSense } from './helpers/fakeXSense.js';
import { VALID_CONFIG, createAll, createWorld, featureId, settle } from './helpers/world.js';

const STATION_TOPIC = `$aws/things/SBS50${SBS50}/shadow/name/2nd_mainpage/update`;
const report = (reported) => JSON.stringify({ state: { reported } });

test('publishes one device per detector and per base station, with their states', async () => {
  const { gladys, fake, app } = await createWorld();
  try {
    const names = fake.discoveredDevices.map((device) => device.name).sort();
    assert.deepEqual(names, [
      'CO chaudière',
      'CO salon',
      'Chaleur garage',
      'Combiné entrée',
      'Fuite buanderie',
      'Fumée chambre',
      'Fumée cuisine',
      'Station de base',
    ]);
    const state = (serial, key, type) => fake.lastState(featureId(gladys, serial, key, type));
    assert.equal(state(SERIALS.smoke, 'smoke'), 0);
    assert.equal(state(SERIALS.smoke, 'battery'), 100);
    assert.equal(state(SERIALS.smoke, 'online'), 1);
    assert.equal(state(SERIALS.smoke, 'rf_signal'), 3);
    assert.equal(state(SERIALS.co, 'battery'), 67);
    assert.equal(state(SERIALS.combi, 'smoke'), 0);
    assert.equal(state(SERIALS.combi, 'co'), 0);
    assert.equal(state(SERIALS.heat, 'heat'), 0);
    assert.equal(state(SERIALS.water, 'water'), 0);
    assert.equal(state(SERIALS.wifiSmoke, 'wifi_signal'), -63);
    assert.equal(state(SERIALS.wifiCo, 'wifi_signal'), -71);
    assert.equal(state(SERIALS.wifiCo, 'battery'), 33);
    assert.equal(state(SBS50, 'online', 'base_station'), 1);
    assert.equal(state(SBS50, 'wifi_signal', 'base_station'), -58);
    // No self-test report yet: no text published.
    assert.equal(state(SERIALS.smoke, 'last_test'), undefined);
    assert.equal(fake.connectionStatus.connected, true);
    assert.match(fake.connectionStatus.message.fr, /7 détecteur\(s\), 1 station/);
  } finally {
    app.stop();
  }
});

test('a smoke alarm pushed live fires "fire_alarm" with the room, once', async () => {
  const { gladys, fake, app, hub } = await createWorld();
  try {
    const before = fake.widgetRefreshes.length;
    await hub.handleMqttMessage(
      STATION_TOPIC,
      report({ devs: { [SERIALS.smoke]: { alarmStatus: '1', muteStatus: '1' } } }),
    );
    assert.equal(fake.lastState(featureId(gladys, SERIALS.smoke, 'smoke')), 1);
    assert.deepEqual(fake.sceneEvents.at(-1), {
      key: 'fire_alarm',
      data: {
        device: gladys.externalIds('detector', SERIALS.smoke).device,
        device_name: 'Fumée cuisine',
        room: 'Cuisine',
        cause: 'smoke',
      },
    });
    assert.ok(fake.widgetRefreshes.length > before);
    const events = fake.sceneEvents.length;
    // The same alarm again: no new event. Then over.
    await hub.handleMqttMessage(
      STATION_TOPIC,
      report({ devs: { [SERIALS.smoke]: { alarmStatus: '1' } } }),
    );
    await hub.handleMqttMessage(
      STATION_TOPIC,
      report({ devs: { [SERIALS.smoke]: { alarmStatus: '0' } } }),
    );
    assert.equal(fake.sceneEvents.length, events);
    assert.equal(fake.lastState(featureId(gladys, SERIALS.smoke, 'smoke')), 0);
  } finally {
    app.stop();
  }
});

test('a combined detector in smoke + CO alarm fires both triggers, with the CO level', async () => {
  const { gladys, fake, app, hub } = await createWorld();
  try {
    await hub.handleMqttMessage(
      STATION_TOPIC,
      report({ devs: [{ deviceSN: SERIALS.combi, alarmStatus: '3', coPpm: '150' }] }),
    );
    assert.equal(fake.lastState(featureId(gladys, SERIALS.combi, 'smoke')), 1);
    assert.equal(fake.lastState(featureId(gladys, SERIALS.combi, 'co')), 1);
    const keys = fake.sceneEvents.map((event) => event.key);
    assert.ok(keys.includes('fire_alarm'));
    const co = fake.sceneEvents.find((event) => event.key === 'co_alarm');
    assert.equal(co.data.co_ppm, 150);
    assert.equal(co.data.room, 'Entrée');
  } finally {
    app.stop();
  }
});

test('heat, water and Wi-Fi detector alarms', async () => {
  const { gladys, fake, app, hub } = await createWorld();
  try {
    // A child update naming its detector, sent on the station topic.
    await hub.handleMqttMessage(
      `$aws/things/SBS50${SBS50}/shadow/name/2nd_alarm/update`,
      report({ deviceSN: SERIALS.heat, stationSN: SBS50, isAlarm: '1' }),
    );
    assert.equal(fake.lastState(featureId(gladys, SERIALS.heat, 'heat')), 1);
    assert.equal(fake.sceneEvents.at(-1).data.cause, 'heat');

    await hub.handleMqttMessage(STATION_TOPIC, report({ [SERIALS.water]: { alarmStatus: '1' } }));
    assert.equal(fake.lastState(featureId(gladys, SERIALS.water, 'water')), 1);
    assert.equal(fake.sceneEvents.at(-1).key, 'water_leak');
    assert.equal(fake.sceneEvents.at(-1).data.room, 'Buanderie');

    // A Wi-Fi detector reports in the home shadow.
    await hub.handleMqttMessage(
      `$aws/things/${HOUSE_ID}/shadow/name/2nd_mainpage/update`,
      report({ [SERIALS.wifiSmoke]: { alarmStatus: '1' } }),
    );
    assert.equal(fake.lastState(featureId(gladys, SERIALS.wifiSmoke, 'smoke')), 1);
    assert.equal(fake.sceneEvents.at(-1).data.device_name, 'Fumée chambre');

    // An X-Sense event naming its station and device.
    await hub.handleMqttMessage(
      `@xsense/events/alarm/${HOUSE_ID}`,
      JSON.stringify({
        eventData: JSON.stringify({ stationSN: SBS50, deviceSN: SERIALS.co, alarmStatus: '1' }),
      }),
    );
    assert.equal(fake.lastState(featureId(gladys, SERIALS.co, 'co')), 1);
  } finally {
    app.stop();
  }
});

test('low battery fires once per episode, across restarts', async () => {
  const store = new MemoryStore();
  const first = await createWorld({ store });
  const lowEvents = (world) =>
    world.fake.sceneEvents.filter((event) => event.key === 'low_battery');
  try {
    assert.equal(lowEvents(first).length, 1);
    assert.equal(lowEvents(first)[0].data.device_name, 'CO chaudière');
    assert.equal(lowEvents(first)[0].data.battery, 33);
  } finally {
    first.app.stop();
  }
  const second = await createWorld({ store });
  try {
    assert.equal(lowEvents(second).length, 0, 'not again after a restart');
    // New batteries, then low again: a new episode.
    await second.hub.handleMqttMessage(
      `$aws/things/${HOUSE_ID}/shadow/name/2nd_mainpage/update`,
      report({ [SERIALS.wifiCo]: { batInfo: '3' } }),
    );
    await second.hub.handleMqttMessage(
      `$aws/things/${HOUSE_ID}/shadow/name/2nd_mainpage/update`,
      report({ [SERIALS.wifiCo]: { batInfo: '1' } }),
    );
    assert.equal(lowEvents(second).length, 1);
  } finally {
    second.app.stop();
  }
});

test('a self-test report becomes the "last test" text, kept across restarts', async () => {
  const store = new MemoryStore();
  const world = await createWorld({ store });
  try {
    await world.hub.handleMqttMessage(
      `$aws/things/SBS50${SBS50}/shadow/name/2nd_selftestup/update`,
      report({ deviceSN: SERIALS.smoke, lastSelfTest: '0', lastSelfTestTime: '20261012100300' }),
    );
    const text = world.fake.lastState(featureId(world.gladys, SERIALS.smoke, 'last_test'));
    assert.match(text, /^Réussi · /);
    assert.match(text, /2026|26/);
  } finally {
    world.app.stop();
  }
  const again = await createWorld({ store });
  try {
    assert.match(
      again.fake.lastState(featureId(again.gladys, SERIALS.smoke, 'last_test')),
      /^Réussi/,
    );
  } finally {
    again.app.stop();
  }
});

test('station presence events set the base station offline and back', async () => {
  const { gladys, fake, app, hub } = await createWorld();
  try {
    const online = () => fake.lastState(featureId(gladys, SBS50, 'online', 'base_station'));
    await hub.handleMqttMessage(
      `$aws/events/presence/disconnected/SBS50${SBS50}`,
      JSON.stringify({ clientId: `SBS50${SBS50}`, eventType: 'disconnected' }),
    );
    assert.equal(online(), 0);
    await hub.handleMqttMessage(
      `$aws/events/presence/connected/SBS50${SBS50}`,
      JSON.stringify({ clientId: `SBS50${SBS50}`, eventType: 'connected' }),
    );
    assert.equal(online(), 1);
  } finally {
    app.stop();
  }
});

test('unreadable or foreign MQTT messages change nothing', async () => {
  const { fake, app, hub } = await createWorld();
  try {
    const states = fake.states.length;
    await hub.handleMqttMessage(STATION_TOPIC, 'not json');
    await hub.handleMqttMessage(`${STATION_TOPIC}/accepted`, report({ devs: {} }));
    await hub.handleMqttMessage('$aws/things/UNKNOWN/shadow/name/x/update', report({ a: 1 }));
    await hub.handleMqttMessage(STATION_TOPIC, JSON.stringify({ state: { desired: { a: 1 } } }));
    assert.equal(fake.states.length, states);
  } finally {
    app.stop();
  }
});

test('a device added in Gladys gets its states again at once', async () => {
  const world = await createWorld();
  try {
    const before = world.fake.states.length;
    await createAll(world);
    assert.ok(world.fake.states.length > before, 'states re-sent after creation');
  } finally {
    world.app.stop();
  }
});

test('an unreachable cloud is said once, its return once', async () => {
  const cloud = createFakeXSense();
  cloud.setDown(true);
  const world = await createWorld({ cloud });
  try {
    assert.equal(world.fake.connectionStatus.connected, false);
    assert.match(world.fake.connectionStatus.message.en, /unreachable/);
    await world.hub.refresh().catch(() => {});
    await world.hub.refresh().catch(() => {});
    const warnings = world.logger.lines.filter((line) => line.level === 'warn');
    assert.equal(warnings.length, 1);
    cloud.setDown(false);
    await world.hub.refresh();
    assert.equal(world.fake.connectionStatus.connected, true);
    assert.equal(world.fake.discoveredDevices.length, 8);
    assert.ok(
      world.logger.lines.some((line) => line.level === 'info' && /reachable again/.test(line.text)),
    );
  } finally {
    world.app.stop();
  }
});

test('a refused password is reported, not retried, and fixed by a new configuration', async () => {
  const world = await createWorld({ config: { ...VALID_CONFIG, password: 'wrong' } });
  try {
    assert.equal(world.fake.connectionStatus.connected, false);
    assert.deepEqual(world.fake.connectionStatus.message, TEXT.wrongCredentials);
    const signIns = world.cloud.calls.length;
    await world.hub.pollFromCore();
    assert.equal(world.cloud.calls.length, signIns, 'no retry with a refused password');

    const ack = await world.fake.action('test_connection', {});
    assert.equal(ack.success, false);
    assert.match(ack.error, /X-Sense refused the e-mail or the password/);

    await world.fake.configUpdated(VALID_CONFIG);
    await settle();
    assert.equal(world.fake.connectionStatus.connected, true);
    assert.equal(world.fake.discoveredDevices.length, 8);
  } finally {
    world.app.stop();
  }
});

test('without credentials, nothing is requested', async () => {
  const cloud = createFakeXSense();
  const world = await createWorld({ cloud, config: {} });
  try {
    assert.equal(cloud.calls.length, 0);
    assert.deepEqual(world.fake.connectionStatus.message, TEXT.notConfiguredStatus);
    const ack = await world.fake.action('test_connection', {});
    assert.equal(ack.success, false);
  } finally {
    world.app.stop();
  }
});

test('the test action lists what it found', async () => {
  const world = await createWorld();
  try {
    const ack = await world.fake.action('test_connection', {});
    assert.equal(ack.success, true);
    assert.match(ack.data.message.fr, /^Connexion OK : 7 détecteur\(s\), 1 station\(s\) de base\./);
    assert.match(ack.data.message.en, /Fumée cuisine \(Cuisine\)/);
    assert.match(ack.data.message.en, /…$/);
  } finally {
    world.app.stop();
  }
});

test('a scan request publishes the devices again; a new language renames new features', async () => {
  const world = await createWorld();
  try {
    const publications = world.fake.bodies('POST', '/discovered_device').length;
    await world.fake.scanRequest();
    await settle();
    assert.equal(world.fake.bodies('POST', '/discovered_device').length, publications + 1);

    await world.fake.configUpdated({ ...VALID_CONFIG, language: 'de' });
    await settle();
    const smoke = world.fake.discoveredDevices.find((device) => device.name === 'Fumée cuisine');
    assert.deepEqual(
      smoke.features.map((feature) => feature.name),
      ['Rauchalarm', 'Batterie', 'Online', 'Funksignal', 'Letzter Test'],
    );
  } finally {
    world.app.stop();
  }
});

test('the own timer refreshes the states without any onPoll, and onPoll then does nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const links = [];
  const openMqtt = async (options) => {
    links.push(options);
    return { close() {} };
  };
  const world = await createWorld({ timers: true, openMqtt });
  try {
    // Live updates subscribed for the home and the stations.
    assert.equal(links.length, 1);
    assert.ok(links[0].url.startsWith('wss://fake-ats.iot.eu-central-1.amazonaws.com/mqtt?'));
    assert.deepEqual(links[0].topics, [
      `@xsense/events/+/${HOUSE_ID}`,
      `$aws/things/${HOUSE_ID}/shadow/name/+/update`,
      `$aws/things/SBS50${SBS50}/shadow/name/+/update`,
      `$aws/events/presence/+/SBS50${SBS50}`,
      `$aws/things/XS01-WX${SERIALS.wifiSmoke}/shadow/name/+/update`,
      `$aws/events/presence/+/XS01-WX${SERIALS.wifiSmoke}`,
      `$aws/things/XC04-WX-${SERIALS.wifiCo}/shadow/name/+/update`,
      `$aws/events/presence/+/XC04-WX-${SERIALS.wifiCo}`,
    ]);

    // The battery of a detector drops in the cloud; nobody calls onPoll.
    world.cloud.shadows[`SBS50${SBS50}/2nd_mainpage`].devs[SERIALS.smoke].batInfo = '2';
    const id = featureId(world.gladys, SERIALS.smoke, 'battery');
    assert.equal(world.fake.lastState(id), 100);
    t.mock.timers.tick(5 * 60 * 1000);
    await settle();
    assert.equal(world.fake.lastState(id), 67);

    // The core's poll right after: no cloud request.
    const calls = world.cloud.calls.length;
    const [device] = world.fake.discoveredDevices;
    assert.deepEqual(await world.fake.poll(device), { success: true });
    assert.equal(world.cloud.calls.length, calls);

    // MQTT link lost: it comes back on its own.
    links[0].onClose('MQTT connection closed');
    t.mock.timers.tick(10 * 1000);
    await settle();
    assert.equal(links.length, 2);
  } finally {
    world.app.stop();
  }
});

test('the core poll refreshes when the own timer is late', async () => {
  let clock = Date.UTC(2026, 9, 15, 8, 0, 0);
  const world = await createWorld({ now: () => clock });
  try {
    world.cloud.shadows[`SBS50${SBS50}/2nd_mainpage`].devs[SERIALS.co].batInfo = '1';
    clock += 20 * 60 * 1000;
    const [device] = world.fake.discoveredDevices;
    await world.fake.poll(device);
    await settle();
    assert.equal(world.fake.lastState(featureId(world.gladys, SERIALS.co, 'battery')), 33);
  } finally {
    world.app.stop();
  }
});

test('a reconnection of Gladys reports the connection status again', async () => {
  const world = await createWorld();
  try {
    const count = world.fake.connectionStatuses.length;
    await world.gladys.disconnect();
    await world.gladys.connect();
    await settle();
    assert.equal(world.fake.connectionStatuses.length, count + 1);
    assert.equal(world.fake.connectionStatus.connected, true);
  } finally {
    world.app.stop();
  }
});
