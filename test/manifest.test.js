// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTION } from '../src/app.js';
import { TRIGGER, WIDGET_KEY } from '../src/hub.js';
import { WIDGET } from '../src/widgets.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { createWorld } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...(manifest.contact_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// Manifest fields older Gladys releases reject as unknown, with the first
// release accepting them. The store validator refuses a manifest whose
// `gladys_version` minimum is lower: these tests catch it before a release.
const CAPABILITY_FIELDS = ['scene_triggers', 'scene_actions', 'widgets'];
const CAPABILITY_MIN_GLADYS_VERSION = [5, 1, 0];
const CATEGORIES_MIN_GLADYS_VERSION = [4, 86, 0];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// Minimum version of the manifest `gladys_version` range, e.g. [5, 1, 0].
function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('every manifest action has a registered handler, and vice versa', async () => {
  assert.deepEqual(keysOf(manifest.actions), Object.values(ACTION));
  const { fake, app } = await createWorld({ connect: false });
  try {
    for (const key of keysOf(manifest.actions)) {
      const ack = await fake.action(key, {});
      assert.notEqual(ack.error, 'not implemented', `action "${key}" has no handler`);
    }
  } finally {
    app.stop();
  }
});

test('the identity of the integration', () => {
  assert.equal(manifest.name, 'X-Sense');
  assert.equal(manifest.type, 'device');
  assert.deepEqual(manifest.categories, ['security']);
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.ok(manifest.docker_image.startsWith('ghcr.io/guim31/gladys-xsense:'));
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-xsense/main/cover.png',
  );
  // No widget button opens a form: Gladys 5.1 is enough.
  assert.equal(manifest.gladys_version, '>=5.1.0');
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  // The store vocabulary itself is checked by the store validator (unknown
  // keys are dropped with a warning there) — what this test pins is the
  // coupling rule: older cores reject any unknown manifest field, so a
  // manifest declaring `categories` must not claim compatibility below the
  // first release that accepts it.
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(
    isAtLeast(minGladysVersion(), CATEGORIES_MIN_GLADYS_VERSION),
    `categories requires gladys_version >= 4.86.0, got "${manifest.gladys_version}"`,
  );
});

test('declaring scene triggers, scene actions or widgets requires Gladys >= 5.1.0', () => {
  const declared = CAPABILITY_FIELDS.filter((field) => manifest[field] !== undefined);
  assert.ok(declared.length > 0, 'the integration declares capability fields');
  assert.ok(
    isAtLeast(minGladysVersion(), CAPABILITY_MIN_GLADYS_VERSION),
    `${declared.join(', ')} requires gladys_version >= 5.1.0, got "${manifest.gladys_version}"`,
  );
});

test('no scene action: X-Sense alarms are not something Gladys commands', () => {
  assert.equal(manifest.scene_actions, undefined);
});

test('every widgets key has an onWidgetGet handler, and vice versa', async () => {
  assert.deepEqual(keysOf(manifest.widgets), Object.values(WIDGET));
  assert.equal(WIDGET.DETECTORS, WIDGET_KEY);
  const { fake, app } = await createWorld({ connect: false });
  try {
    for (const key of keysOf(manifest.widgets)) {
      const ack = await fake.widgetGet(key, { settings: {}, language: 'en', units: 'metric' });
      assert.equal(ack.success, true, `widget "${key}" has no content handler`);
    }
  } finally {
    app.stop();
  }
});

test('every scene trigger the code fires is declared in scene_triggers, and vice versa', () => {
  // An undeclared key is a 404 on publishSceneEvent; a declared key nobody
  // fires is a dead card in the scene editor.
  const declared = keysOf(manifest.scene_triggers);
  const fired = Object.values(TRIGGER);
  for (const key of fired) {
    assert.ok(declared.includes(key), `trigger "${key}" is fired but not declared`);
  }
  for (const key of declared) {
    assert.ok(fired.includes(key), `trigger "${key}" is declared but never fired`);
  }
});

test('every key a trigger event carries is a declared filter or variable', async () => {
  // The core drops an undeclared key: what the scene would read must be declared.
  const declared = Object.fromEntries(
    manifest.scene_triggers.map((trigger) => [
      trigger.key,
      new Set([...keysOf(trigger.fields), ...keysOf(trigger.variables)]),
    ]),
  );
  const { fake, app, hub } = await createWorld();
  try {
    await hub.handleMqttMessage(
      '$aws/things/SBS50SBS50SN0001/shadow/name/2nd_mainpage/update',
      JSON.stringify({
        state: {
          reported: {
            devs: {
              XS01M000001: { alarmStatus: '1' },
              XP0AMR00003: { alarmStatus: '2', coPpm: '80' },
              SWS51000005: { alarmStatus: '1' },
            },
          },
        },
      }),
    );
    const keys = new Set(fake.sceneEvents.map((event) => event.key));
    assert.deepEqual([...keys].sort(), Object.values(TRIGGER).sort());
    for (const event of fake.sceneEvents) {
      for (const key of Object.keys(event.data)) {
        assert.ok(declared[event.key].has(key), `${event.key}: "${key}" is not declared`);
      }
      const variables = manifest.scene_triggers.find((t) => t.key === event.key).variables;
      for (const variable of variables) {
        const value = event.data[variable.key];
        assert.ok(
          value === null || typeof value === variable.type,
          `${event.key}.${variable.key} is a ${typeof value}, declared ${variable.type}`,
        );
      }
    }
  } finally {
    app.stop();
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0, 'the configuration opens with a section block');
  for (const section of sections) {
    // A section stores NO value: declaring `required`, `default` or
    // `placeholder` on it rejects the manifest, and its key must never leak
    // into the config the code manipulates.
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(
      section.placeholder,
      undefined,
      `section "${section.key}" must not have a placeholder`,
    );
    assert.ok(section.label?.en, `section "${section.key}" needs an English label`);
    assert.ok(
      !(section.key in DEFAULT_CONFIG),
      `section "${section.key}" stores no value and must not appear in DEFAULT_CONFIG`,
    );
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0, 'the triggers filter on a detector');
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices', 'the only core-defined source in V1 is "devices"');
    assert.equal(
      field.options,
      undefined,
      `field "${field.key}": declaring source and options together rejects the manifest`,
    );
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  // The Release workflow writes all three: a mismatch means one was edited by
  // hand, and Gladys would offer a version whose image is another one.
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  // A store rule (the catalog card is short): a longer text rejects the
  // manifest.
  assert.ok(manifest.description.en, 'the description needs an English text');
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('field placeholders are multi-language objects', () => {
  // Like `label` and `description`: a plain string rejects the manifest.
  const withPlaceholder = allFields.filter((f) => f.placeholder !== undefined);
  assert.ok(withPlaceholder.length > 0, 'the e-mail field has a placeholder');
  for (const field of withPlaceholder) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
    assert.ok(field.placeholder.en, `field "${field.key}": placeholder needs an English text`);
  }
});
