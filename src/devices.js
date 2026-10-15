// -----------------------------------------------------------------------------
// The Gladys devices: one per X-Sense detector, one per base station.
//
// External ids are built from the serial number X-Sense gives the device
// (`gladys.externalIds(type, serial)`), never from a name: they are forever.
// The feature keys below are forever too.
//
// Feature choices, all from the couples the Gladys front draws
// (test/fixtures/gladys-feature-table.json):
//   - smoke alarm        smoke-sensor/binary   1 = smoke
//   - heat alarm         smoke-sensor/binary   1 = heat (a fire alarm: Gladys
//                                              has no heat category, and a
//                                              "smoke" scene must see it)
//   - CO alarm           co-sensor/binary      1 = CO
//   - water leak         leak-sensor/binary    1 = leak
//   - battery            battery/integer       %, from the 0-3 level X-Sense gives
//   - online             input/binary          1 = online
//   - radio signal       signal/integer        0-3 (RF detectors)
//   - Wi-Fi signal       signal/integer        dBm, -100 to -40 (stations, Wi-Fi detectors)
//   - last test          text/text             "Passed · 12/10/2026 10:03"
// The CO level in ppm has no couple Gladys draws (co-sensor knows only
// `binary`): it is shown by the widget and carried by the CO alarm trigger.
//
// Everything is read only: X-Sense alarms are not something Gladys controls.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { FAMILY } from './xsense/model.js';
import { NAMES, TEXT, pick } from './i18n.js';

/** Feature keys: part of the external ids, never renamed. */
export const FEATURE = {
  SMOKE: 'smoke',
  CO: 'co',
  HEAT: 'heat',
  WATER: 'water',
  BATTERY: 'battery',
  ONLINE: 'online',
  RF_SIGNAL: 'rf_signal',
  WIFI_SIGNAL: 'wifi_signal',
  LAST_TEST: 'last_test',
};

/** Device types of the external ids. */
export const DEVICE_TYPE = { DETECTOR: 'detector', BASE: 'base_station' };

const ALARM_FEATURES = {
  [FAMILY.SMOKE]: [FEATURE.SMOKE],
  [FAMILY.CO]: [FEATURE.CO],
  [FAMILY.COMBI]: [FEATURE.SMOKE, FEATURE.CO],
  [FAMILY.HEAT]: [FEATURE.HEAT],
  [FAMILY.WATER]: [FEATURE.WATER],
};

const SPEC = {
  [FEATURE.SMOKE]: { category: CATEGORIES.SMOKE_SENSOR, type: TYPES.SENSOR.BINARY, min: 0, max: 1 },
  [FEATURE.HEAT]: { category: CATEGORIES.SMOKE_SENSOR, type: TYPES.SENSOR.BINARY, min: 0, max: 1 },
  [FEATURE.CO]: { category: CATEGORIES.CO_SENSOR, type: TYPES.SENSOR.BINARY, min: 0, max: 1 },
  [FEATURE.WATER]: { category: CATEGORIES.LEAK_SENSOR, type: TYPES.SENSOR.BINARY, min: 0, max: 1 },
  [FEATURE.BATTERY]: {
    category: CATEGORIES.BATTERY,
    type: TYPES.BATTERY.INTEGER,
    unit: UNITS.PERCENT,
    min: 0,
    max: 100,
  },
  [FEATURE.ONLINE]: { category: CATEGORIES.INPUT, type: TYPES.INPUT.BINARY, min: 0, max: 1 },
  [FEATURE.RF_SIGNAL]: { category: CATEGORIES.SIGNAL, type: TYPES.SIGNAL.QUALITY, min: 0, max: 3 },
  // The signal bars are (value - min) / (max - min): -40 dBm and above is full.
  [FEATURE.WIFI_SIGNAL]: {
    category: CATEGORIES.SIGNAL,
    type: TYPES.SIGNAL.QUALITY,
    min: -100,
    max: -40,
  },
  // text/text: min and max are NOT NULL in the core (422 otherwise).
  [FEATURE.LAST_TEST]: { category: CATEGORIES.TEXT, type: TYPES.TEXT.TEXT, min: 0, max: 0 },
};

// Alarms and online state keep their history; signal and test text do not.
const KEEP_HISTORY = new Set([
  FEATURE.SMOKE,
  FEATURE.HEAT,
  FEATURE.CO,
  FEATURE.WATER,
  FEATURE.BATTERY,
  FEATURE.ONLINE,
]);

/** The feature keys of a unit. */
export function featureKeys(unit) {
  if (unit.kind === 'base') {
    return [FEATURE.ONLINE, FEATURE.WIFI_SIGNAL];
  }
  return [
    ...ALARM_FEATURES[unit.family],
    FEATURE.BATTERY,
    FEATURE.ONLINE,
    unit.rf ? FEATURE.RF_SIGNAL : FEATURE.WIFI_SIGNAL,
    FEATURE.LAST_TEST,
  ];
}

/** External ids of a unit: `{ device, feature(key) }`. */
export const unitIds = (gladys, unit) =>
  gladys.externalIds(unit.kind === 'base' ? DEVICE_TYPE.BASE : DEVICE_TYPE.DETECTOR, unit.serial);

/**
 * The Gladys device of a unit.
 * @param {object} gladys
 * @param {object} unit from buildUnits
 * @param {string} language feature names
 */
export function buildDevice(gladys, unit, language) {
  const ids = unitIds(gladys, unit);
  const names = NAMES[language] ?? NAMES.en;
  const params = [{ name: 'model', value: unit.model }];
  if (unit.room) {
    params.push({ name: 'room', value: unit.room });
  }
  return {
    name: unit.name,
    external_id: ids.device,
    model: unit.model,
    // The container refreshes by itself (src/hub.js); the core's poll is the
    // fallback, at the slowest pace it schedules.
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    params,
    features: featureKeys(unit).map((key) => ({
      name: names[key],
      external_id: ids.feature(key),
      ...SPEC[key],
      read_only: true,
      has_feedback: false,
      keep_history: KEEP_HISTORY.has(key),
    })),
  };
}

/** Every device of the account. */
export const buildDevices = (gladys, units, language) =>
  units.map((unit) => buildDevice(gladys, unit, language));

/**
 * "Passed · 12/10/2026 10:03" in the configured language and the Gladys time
 * zone (TZ, injected by the supervisor).
 * @param {{ ok: boolean, at: number }} selfTest
 * @param {string} language
 */
export function selfTestText(selfTest, language) {
  const result = pick(selfTest.ok ? TEXT.testPassed : TEXT.testFailed, language);
  let when;
  try {
    when = new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(
      new Date(selfTest.at),
    );
  } catch {
    when = new Date(selfTest.at).toISOString().slice(0, 16).replace('T', ' ');
  }
  return `${result} · ${when}`;
}

/**
 * The states of a unit's features, from its derived state: only the known
 * values (Gladys keeps the last one).
 * @returns {Array<{ device_feature_external_id: string, state?: number, text?: string }>}
 */
export function unitStates(gladys, unit, state, language) {
  const ids = unitIds(gladys, unit);
  const keys = new Set(featureKeys(unit));
  const out = [];
  const number = (key, value) => {
    if (keys.has(key) && typeof value === 'number' && Number.isFinite(value)) {
      out.push({ device_feature_external_id: ids.feature(key), state: value });
    }
  };
  number(FEATURE.SMOKE, state.smoke);
  number(FEATURE.CO, state.co);
  number(FEATURE.HEAT, state.heat);
  number(FEATURE.WATER, state.water);
  number(FEATURE.BATTERY, state.battery);
  number(FEATURE.ONLINE, state.online);
  number(FEATURE.RF_SIGNAL, state.rf);
  number(FEATURE.WIFI_SIGNAL, state.wifi);
  if (keys.has(FEATURE.LAST_TEST) && state.selfTest) {
    out.push({
      device_feature_external_id: ids.feature(FEATURE.LAST_TEST),
      text: selfTestText(state.selfTest, language),
    });
  }
  return out;
}
