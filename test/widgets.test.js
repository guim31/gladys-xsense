// -----------------------------------------------------------------------------
// The "X-Sense detectors" widget: valid for the core vocabulary and budget in
// every state, alarms first, pre-localized.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { buildDetectorsContent } from '../src/widgets.js';
import { LANGUAGES } from '../src/config.js';
import { SBS50, SERIALS } from './helpers/fakeXSense.js';
import { createWorld } from './helpers/world.js';

const detector = (name, state, extra = {}) => ({
  unit: { kind: 'detector', name, room: 'Salon', serial: name, ...extra },
  state,
});

test('the widget of the fixture account is valid in every language', async () => {
  const world = await createWorld();
  try {
    for (const language of LANGUAGES) {
      const ack = await world.fake.widgetGet('detectors', {
        settings: {},
        language,
        units: 'metric',
      });
      assert.equal(ack.success, true);
      const content = ack.data.content;
      assert.deepEqual(validateWidgetContent(content), [], language);
      const status = content.components.find((c) => c.type === 'status');
      assert.equal(status.items.length, 7);
    }
  } finally {
    world.app.stop();
  }
});

test('alarms come first, then offline, then low battery', async () => {
  const world = await createWorld();
  try {
    await world.hub.handleMqttMessage(
      `$aws/things/SBS50${SBS50}/shadow/name/2nd_mainpage/update`,
      JSON.stringify({
        state: {
          reported: {
            devs: { [SERIALS.water]: { alarmStatus: '1' }, [SERIALS.heat]: { online: '0' } },
          },
        },
      }),
    );
    const ack = await world.fake.widgetGet('detectors', {
      settings: {},
      language: 'fr',
      units: 'metric',
    });
    const content = ack.data.content;
    const [alarms, low, offline] = content.components.filter((c) => c.type === 'value');
    assert.deepEqual([alarms.value, low.value, offline.value], [1, 1, 1]);
    assert.equal(alarms.color, 'danger');
    const items = content.components.find((c) => c.type === 'status').items;
    assert.deepEqual(items[0], {
      label: 'Fuite buanderie · Buanderie',
      value: 'FUITE · 100 %',
      color: 'danger',
      icon: 'alert-triangle',
    });
    assert.equal(items[1].label, 'Chaleur garage · Garage');
    assert.equal(items[1].value, 'Hors ligne · 100 %');
    assert.equal(items[2].label, 'CO chaudière · Buanderie');
    assert.equal(items[2].color, 'warning');
  } finally {
    world.app.stop();
  }
});

test('more than ten detectors: ten rows and a caption', () => {
  const units = Array.from({ length: 13 }, (_, i) =>
    detector(`Détecteur ${String(i).padStart(2, '0')}`, { online: 1, smoke: 0, battery: 100 }),
  );
  const content = buildDetectorsContent({ configured: true, status: 'ok', units }, 'fr');
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components.find((c) => c.type === 'status').items.length, 10);
  assert.equal(content.components.at(-1).text, '+ 3 autre(s) détecteur(s)');
});

test('empty states say why', () => {
  const notConfigured = buildDetectorsContent(
    { configured: false, status: 'unconfigured', units: [] },
    'de',
  );
  assert.match(notConfigured.components[0].text, /Gib die E-Mail-Adresse/);
  const down = buildDetectorsContent({ configured: true, status: 'unreachable', units: [] }, 'es');
  assert.match(down.components[0].text, /Sin conexión/);
  const none = buildDetectorsContent(
    { configured: true, status: 'ok', units: [{ unit: { kind: 'base', name: 'S' }, state: {} }] },
    'en',
  );
  assert.equal(none.components[0].text, 'No detector found on the X-Sense account.');
  for (const content of [notConfigured, down, none]) {
    assert.deepEqual(validateWidgetContent(content), []);
  }
});

test('long names are clipped to the status row limits; unknown states say so', () => {
  const content = buildDetectorsContent(
    {
      configured: true,
      status: 'ok',
      units: [
        detector('A very long detector name that never ends in the attic', {
          online: 1,
          co: 1,
          smoke: 1,
          battery: 33,
          lowBattery: true,
          coPpm: 300,
        }),
        detector('No news', null),
        detector('Old one', { online: 1, smoke: 0, endOfLife: true }),
      ],
    },
    'en',
  );
  assert.deepEqual(validateWidgetContent(content), []);
  const items = content.components.find((c) => c.type === 'status').items;
  assert.equal(items[0].label.length, 40);
  assert.equal(items[0].value, 'SMOKE + CO · 33 % · 300 ppm');
  assert.equal(items[1].value, 'End of life');
  assert.equal(items[2].value, 'No data yet');
});
