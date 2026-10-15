// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, the feature names, and the four documentation files with the same
// sections. German says "du", never the polite "Sie".
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { MESSAGES, NAMES, TEXT, thrown } from '../src/i18n.js';
import { selfTestText } from '../src/devices.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  short: 24,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(Object.keys(NAMES), LANGS);
  const select = manifest.config_schema.find((field) => field.key === 'language');
  assert.deepEqual(
    select.options.map((option) => option.value),
    LANGS,
  );
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 45, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the catalog description holds 10 characters at least in every language', () => {
  for (const lang of LANGS) {
    assert.ok(manifest.description[lang].length >= 10, `description.${lang} is too short`);
  }
});

test('every message of the code has the four languages', () => {
  const longTexts = new Set([
    'noDetector',
    'notConfigured',
    'notConnected',
    'notConfiguredStatus',
    'wrongCredentials',
    'initFailed',
  ]);
  const found = [
    ...Object.entries(TEXT).flatMap(([key, value]) =>
      problems(value, `TEXT.${key}`, longTexts.has(key) ? MAX.message : MAX.short),
    ),
    ...problems(MESSAGES.unreachable('ECONNREFUSED'), 'MESSAGES.unreachable', MAX.message),
    ...problems(MESSAGES.connected(12, 2), 'MESSAGES.connected', MAX.message),
    ...problems(MESSAGES.testResult(12, 2, 'Kitchen, Hall'), 'MESSAGES.testResult', MAX.message),
    ...problems(MESSAGES.more(5), 'MESSAGES.more', MAX.message),
  ];
  assert.deepEqual(found, []);
  // A thrown message joins the four languages.
  assert.equal(thrown({ en: 'a', fr: 'b', de: 'c', es: 'd' }), 'a / b / c / d');
});

test('the feature names exist in every language, and the self-test text too', () => {
  const found = [];
  for (const lang of LANGS) {
    if (
      JSON.stringify(sorted(Object.keys(NAMES[lang]))) !==
      JSON.stringify(sorted(Object.keys(NAMES.en)))
    ) {
      found.push(`NAMES.${lang} does not have the keys of NAMES.en`);
    }
    for (const [key, value] of Object.entries(NAMES[lang])) {
      found.push(...textProblems(value, `NAMES.${lang}.${key}`, lang, MAX.featureName));
    }
    const text = selfTestText({ ok: false, at: Date.UTC(2026, 9, 12, 10, 3) }, lang);
    found.push(...textProblems(text, `selfTestText.${lang}`, lang, MAX.featureName));
  }
  assert.deepEqual(found, []);
});

test('the four documentation files have the same sections', async () => {
  const docs = {};
  for (const lang of LANGS) {
    docs[lang] = await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8');
  }
  const sections = (text) => text.split('\n').filter((line) => /^#{1,3} /.test(line));
  const shape = (text) => sections(text).map((line) => line.match(/^#+/)[0]);
  for (const lang of LANGS) {
    assert.deepEqual(shape(docs[lang]), shape(docs.en), `docs/${lang}.md sections`);
    assert.ok(docs[lang].length >= 300, `docs/${lang}.md is too short for the store`);
    // The safety warning and the hardware notice are in every language.
    assert.match(docs[lang], /X-Sense/);
    // Same number of tables and of list items: no paragraph forgotten.
    const count = (re) => (docs[lang].match(re) ?? []).length;
    const countEn = (re) => (docs.en.match(re) ?? []).length;
    assert.equal(count(/^\| ---/gm), countEn(/^\| ---/gm), `docs/${lang}.md tables`);
    assert.equal(count(/^- /gm), countEn(/^- /gm), `docs/${lang}.md list items`);
  }
  assert.equal(sections(docs.en).length, 11);
  assert.ok(!POLITE_GERMAN.test(docs.de), 'docs/de.md uses the polite form');
  assert.match(docs.en, /Developed without the hardware/);
  assert.match(docs.fr, /Développée sans le matériel/);
  assert.match(docs.de, /Ohne die Hardware entwickelt/);
  assert.match(docs.es, /Desarrollada sin el hardware/);
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: 'Licht' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: '', es: 'Luz' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of [
    'Wählen Sie',
    'Ihr Gerät',
    'Ihre IP',
    'mit Ihrem',
    'Ihren',
    'Ihrer',
    'Ihres',
  ]) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_triggers[0].fields[0].label.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_triggers[0].fields[0].label has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});
