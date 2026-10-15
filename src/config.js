// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the `config_schema` of
// `gladys-assistant-integration.json`; the SDK fetches it (`getConfig()`) and
// notifies every change (`onConfigUpdated()`). This module provides the
// defaults and normalizes the received object.
// -----------------------------------------------------------------------------

/** The languages of the Gladys interface, every visible text carries them. */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js).
export const DEFAULT_CONFIG = {
  email: '',
  password: '',
  // Language of the feature names given to the devices (Gladys keeps a
  // feature's name from its creation) and of the texts the container writes.
  language: 'fr',
  // Minutes between two reads of the cloud. The alarms also arrive live over
  // MQTT: this read is the safety net and refreshes battery and signal.
  refresh_minutes: 5,
};

export const REFRESH_MINUTES = { min: 1, max: 60 };

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const minutes = Number.parseInt(
    String(raw.refresh_minutes ?? DEFAULT_CONFIG.refresh_minutes),
    10,
  );
  return {
    email: String(raw.email ?? DEFAULT_CONFIG.email).trim(),
    password: String(raw.password ?? DEFAULT_CONFIG.password),
    language: LANGUAGES.includes(raw.language) ? raw.language : DEFAULT_CONFIG.language,
    refresh_minutes: Number.isFinite(minutes)
      ? Math.min(REFRESH_MINUTES.max, Math.max(REFRESH_MINUTES.min, minutes))
      : DEFAULT_CONFIG.refresh_minutes,
  };
}

/** The integration can only reach the cloud once both are set. */
export function isConfigured(config) {
  return Boolean(config.email && config.password);
}

/** Milliseconds between two cloud reads. */
export const refreshMs = (config) => config.refresh_minutes * 60 * 1000;
