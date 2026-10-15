import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, isConfigured, normalizeConfig, refreshMs } from '../src/config.js';

test('normalizeConfig returns the defaults when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig trims the e-mail but keeps the password as typed', () => {
  const config = normalizeConfig({ email: ' me@example.com ', password: ' pass ' });
  assert.equal(config.email, 'me@example.com');
  assert.equal(config.password, ' pass ');
  assert.ok(isConfigured(config));
  assert.ok(!isConfigured(normalizeConfig({ email: 'me@example.com' })));
});

test('the refresh interval is a whole number of minutes between 1 and 60', () => {
  assert.equal(normalizeConfig({ refresh_minutes: '10' }).refresh_minutes, 10);
  assert.equal(normalizeConfig({ refresh_minutes: 0 }).refresh_minutes, 1);
  assert.equal(normalizeConfig({ refresh_minutes: 600 }).refresh_minutes, 60);
  assert.equal(normalizeConfig({ refresh_minutes: 'often' }).refresh_minutes, 5);
  assert.equal(refreshMs(normalizeConfig()), 5 * 60 * 1000);
});

test('an unknown language falls back to French', () => {
  assert.equal(normalizeConfig({ language: 'de' }).language, 'de');
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
});

test('unknown keys are dropped', () => {
  assert.deepEqual(
    Object.keys(normalizeConfig({ intro: 'x', other: 1 })).sort(),
    Object.keys(DEFAULT_CONFIG).sort(),
  );
});
