// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, the simulated X-Sense cloud, an
// in-memory /data, and the integration wired on top through registerHandlers.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { MemoryStore } from '../../src/store.js';
import { EMAIL, PASSWORD, createFakeXSense } from './fakeXSense.js';

/** A logger that records every line, at every level. */
export function createRecordingLogger() {
  const lines = [];
  const record =
    (level) =>
    (...args) =>
      lines.push({
        level,
        text: args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '),
      });
  return {
    lines,
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    child: () => createRecordingLogger(),
  };
}

/** Let the pending promises (fake network included) run. */
export async function settle(rounds = 30) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export const VALID_CONFIG = {
  email: EMAIL,
  password: PASSWORD,
  language: 'fr',
  refresh_minutes: 5,
};

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {object} [options.cloud] options of createFakeXSense, or a cloud
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {object} [options.store]
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers]
 * @param {Function} [options.openMqtt]
 * @param {() => number} [options.now]
 */
export async function createWorld({
  config = VALID_CONFIG,
  cloud = createFakeXSense(),
  devices = [],
  store = new MemoryStore(),
  connect = true,
  timers = false,
  openMqtt,
  now,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const logger = createRecordingLogger();
  const app = registerHandlers(gladys, {
    store,
    fetch: cloud.fetch,
    timers,
    openMqtt,
    now,
    logger,
  });
  if (connect) {
    await gladys.connect();
    await settle();
  }
  return { gladys, fake: gladys.fake, cloud, app, hub: app.hub, store, logger };
}

/** Create every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  await settle();
}

/** The external id of a detector feature. */
export const featureId = (gladys, serial, key, type = 'detector') =>
  gladys.externalIds(type, serial).feature(key);
