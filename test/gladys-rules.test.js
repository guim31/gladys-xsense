// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from the
// realistic fixture account (SBS50 base station with smoke, CO, combined, heat
// and water detectors, Wi-Fi smoke and CO detectors), in every feature-name
// language, and on an SBS10 account with every detector model of the map.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeXSense, accountFixture } from './helpers/fakeXSense.js';
import { VALID_CONFIG, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

// Every detector model the integration maps, under an SBS10 base station.
const EVERY_MODEL = [
  'XS01-M',
  'XS0B-MR',
  'XP02S-MR',
  'XS03-iWX',
  'XC01-M',
  'XC0C-iR',
  'XP0A-MR',
  'SC07-MR',
  'XH02-M',
  'SWS51',
  'SWS0B',
];
function everyModelAccount() {
  const account = accountFixture();
  account.stations.stations = [
    {
      stationId: 'S10',
      stationName: 'SBS10',
      stationSn: 'SBS10SN0001',
      category: 'SBS10',
      devices: EVERY_MODEL.map((model, i) => ({
        deviceId: `D${i}`,
        deviceName: `${model} detector`,
        deviceSn: `SN${String(i).padStart(9, '0')}`,
        deviceType: model,
      })),
    },
  ];
  return account;
}

const scenarios = [
  { label: 'French names', config: VALID_CONFIG },
  { label: 'English names', config: { ...VALID_CONFIG, language: 'en' } },
  { label: 'German names', config: { ...VALID_CONFIG, language: 'de' } },
  { label: 'Spanish names', config: { ...VALID_CONFIG, language: 'es' } },
  {
    label: 'SBS10 with every model',
    config: VALID_CONFIG,
    cloud: () => createFakeXSense({ account: everyModelAccount(), shadows: {} }),
    count: EVERY_MODEL.length + 1,
  },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const { fake, app } = await createWorld({
      config: scenario.config,
      cloud: scenario.cloud?.() ?? createFakeXSense(),
    });
    try {
      const devices = fake.discoveredDevices;
      assert.equal(devices.length, scenario.count ?? 8, 'expected the fixture devices');
      const deviceIds = new Set();

      for (const device of devices) {
        const where = device.name;
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
    } finally {
      app.stop();
    }
  });
}

test('every published state fits its feature', async () => {
  const { fake, app } = await createWorld();
  try {
    const features = new Map(
      fake.discoveredDevices.flatMap((device) => device.features.map((f) => [f.external_id, f])),
    );
    assert.ok(fake.states.length > 20);
    for (const state of fake.states) {
      const feature = features.get(state.device_feature_external_id);
      assert.ok(feature, `state for an unknown feature ${state.device_feature_external_id}`);
      if (feature.category === 'text') {
        assert.equal(typeof state.text, 'string');
        assert.ok(state.text.length > 0);
      } else {
        assert.ok(
          state.state >= feature.min && state.state <= feature.max,
          `${feature.name}: ${state.state} outside [${feature.min}, ${feature.max}]`,
        );
      }
    }
  } finally {
    app.stop();
  }
});
