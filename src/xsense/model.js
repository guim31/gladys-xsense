// -----------------------------------------------------------------------------
// From X-Sense data to "units": what Gladys shows as devices.
//
// A unit is either a base station (SBS50, SBS10) or a detector. A detector is
// a child of a base station (RF models: XS01-M, XC01-M, XH02-M, SWS51...) or a
// Wi-Fi model that the account lists as a "station" of its own (XS01-WX,
// XC04-WX, SC07-WX...). Everything else (cameras, keypads, motion and door
// sensors, thermo-hygrometers, lights, mailboxes) is left out: this
// integration is about fire, CO and water alarms.
//
// The raw values of each unit (`data`) are merged from three sources, in the
// shapes the app parses (APK 1400, as documented by the Home Assistant
// integration): the station list of the API, the AWS IoT shadows read on
// every refresh, and the MQTT updates of the same shadows. `deriveState` turns
// them into the values the device features publish.
//
// Pure functions only: no network, no clock (the time is a parameter).
// -----------------------------------------------------------------------------

/** Detector families: what an alarm of the detector means. */
export const FAMILY = {
  SMOKE: 'smoke',
  CO: 'co',
  COMBI: 'combi', // smoke + CO
  HEAT: 'heat',
  WATER: 'water',
};

// Detector models by family, from the model map of the Home Assistant
// integration (entity_map.py, checked against the APK 1420 router).
const MODELS = {
  [FAMILY.SMOKE]: [
    'SD11-MR',
    'SD19-MN',
    'SK0Z-3S',
    'LP/N-SA-0B',
    'XS0X-MN',
    'XP02S-MR',
    'XS01-M',
    'XS01-WX',
    'XS0B-MR',
    'XS03-iWX',
    'XS03-WX',
    'XS0D-MR',
    'XS0B-iR',
    'XS0E-iR',
    'XS0F-PMA',
    'XS0R-iA',
    'XS0AA-iA',
    'XS0AB-iA',
  ],
  [FAMILY.COMBI]: [
    'SC01-MN',
    'SC01-MR',
    'SC06-WX',
    'SC07-MR',
    'SC07-WX',
    'SC07-iA',
    'CB0Z-3S',
    'LP/N-SCA-0A',
    'XP0A-MR',
    'CB0T-3B',
    'LP/R-SCA(VL)-0G',
    'XP0A-iR',
    'CB0T-4B',
    'W/R-SCA(VL)-0G',
    'XP0H-MR',
    'XP0H-iR',
    'XP0J-iA',
    'XP0S-iA',
    'XP0T-iA',
    'XP0V-iA',
    'XP0W-iA',
    'XP0P-MR',
  ],
  [FAMILY.CO]: ['XC0C-iA', 'XC0C-iR', 'XC0M-iR', 'XC01-M', 'XC04-WX', 'XC0C-MR'],
  [FAMILY.HEAT]: ['XH02-M'],
  [FAMILY.WATER]: ['SWS0A', 'SWS0B', 'SWS51'],
};

const FAMILY_BY_MODEL = new Map(
  Object.entries(MODELS).flatMap(([family, models]) => models.map((model) => [model, family])),
);

/** Base stations: the hub of the RF detectors. */
export const BASE_STATION_MODELS = ['SBS50', 'SBS10'];

/**
 * Family of a detector model; a model the map does not know yet is guessed
 * from the X-Sense naming (XS smoke, XC CO, XP/SC combined, XH heat, SWS water).
 * @param {string} model
 * @returns {string|null} null: not a detector this integration handles
 */
export function familyOf(model) {
  const known = FAMILY_BY_MODEL.get(model);
  if (known) {
    return known;
  }
  const m = String(model ?? '').toUpperCase();
  if (m.startsWith('XS')) return FAMILY.SMOKE;
  if (m.startsWith('XC')) return FAMILY.CO;
  if (m.startsWith('XP') || m.startsWith('SC0')) return FAMILY.COMBI;
  if (m.startsWith('XH')) return FAMILY.HEAT;
  if (m.startsWith('SWS')) return FAMILY.WATER;
  return null;
}

// Wi-Fi models whose AWS IoT thing name is `<model>-<serial>` (the app's
// getThingName()); the others are `<model><serial>`, the SBS10 its bare serial.
const DASHED_THING_MODELS = new Set([
  'SC06-WX',
  'SC07-WX',
  'SC07-iA',
  'STH0C',
  'SWS0B',
  'XC04-WX',
  'XC0C-iA',
  'XC0C-iR',
  'XC0M-iR',
  'XP0A-iR',
  'XP0H-iR',
  'XP0J-iA',
  'XP0S-iA',
  'XP0T-iA',
  'XP0V-iA',
  'XP0W-iA',
  'XR0A-iR',
  'XS0B-iR',
  'XS0AA-iA',
  'XS0AB-iA',
  'XS0R-iA',
]);

// Wi-Fi models whose state lives in the HOME shadow (`mainpage` of the house
// thing), not in a shadow of their own.
const HOUSE_STATE_MODELS = new Set([...DASHED_THING_MODELS, 'XS01-WX', 'XS03-WX', 'XS0E-iR']);

/**
 * AWS IoT thing name of a station (base station or Wi-Fi detector).
 * @param {string} model
 * @param {string} serial
 */
export function thingName(model, serial) {
  if (model === 'SBS10') {
    return serial;
  }
  if (DASHED_THING_MODELS.has(model)) {
    return `${model}-${serial}`;
  }
  if (model === 'XS01-WX') {
    // Version 9 serials (EN/UL editions) take the dash.
    const v9 = /EN|UL/i.test(serial);
    return `${model}${v9 ? '-' : ''}${serial}`;
  }
  return `${model}${serial}`;
}

/** The shadows to read on each refresh for a station unit. */
export function stationShadows(unit) {
  if (unit.model === 'SBS10') {
    return { state: ['mainpage'], info: [`info_${unit.serial}`] };
  }
  if (unit.model === 'SBS50') {
    return { state: ['2nd_mainpage'], info: [`2nd_info_${unit.serial}`] };
  }
  if (HOUSE_STATE_MODELS.has(unit.model)) {
    // State from the home shadow; the info shadow for the Wi-Fi signal.
    return { state: [], info: [`2nd_info_${unit.serial}`, `info_${unit.serial}`] };
  }
  return { state: [], info: [`info_${unit.serial}`] };
}

const firstOf = (record, keys) => {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && value !== '') {
      return String(value);
    }
  }
  return null;
};

const SERIAL_KEYS = [
  'deviceSN',
  'deviceSn',
  '_deviceSN',
  '_deviceSn',
  'devSerialNumber',
  'serialNumber',
  'sn',
];
const STATION_SERIAL_KEYS = [
  'stationSN',
  'stationSn',
  '_stationSN',
  '_stationSn',
  'stationSerialNumber',
];

/** Room name from the 102008 answer, whatever its shape. */
function roomNames(rooms) {
  const names = new Map();
  const list = rooms?.houseRooms ?? rooms;
  if (Array.isArray(list)) {
    for (const room of list) {
      if (room?.roomId) {
        names.set(String(room.roomId), room.roomName ?? room.name ?? null);
      }
    }
  } else if (list && typeof list === 'object') {
    for (const [id, room] of Object.entries(list)) {
      names.set(
        String(id),
        typeof room === 'string' ? room : (room?.roomName ?? room?.name ?? null),
      );
    }
  }
  return names;
}

// Keys of a station-list record that are identity, not state.
const IDENTITY_KEYS = new Set(['devices', 'deviceSort', 'groupList', 'cameras']);

/**
 * Units of an account, from the answers of client.loadAccount().
 * @param {Array<{ house: object, rooms: object, stations: object }>} account
 * @returns {{ houses: object[], units: object[] }}
 */
export function buildUnits(account) {
  const houses = [];
  const units = [];
  for (const { house, rooms, stations } of account ?? []) {
    if (!house?.houseId) {
      continue;
    }
    const names = roomNames(rooms);
    const roomOf = (record) =>
      record.roomName || (record.roomId ? names.get(String(record.roomId)) : null) || null;
    houses.push({
      id: String(house.houseId),
      name: house.houseName ?? '',
      mqttRegion: house.mqttRegion,
      mqttServer: house.mqttServer,
    });
    for (const station of stations?.stations ?? []) {
      const serial = firstOf(station, ['stationSn', 'stationSN', 'sn', 'serialNumber']);
      const model = firstOf(station, ['category', 'deviceType', 'type']);
      if (!serial || !model) {
        continue;
      }
      const isBase = BASE_STATION_MODELS.includes(model);
      const family = isBase ? null : familyOf(model);
      if (!isBase && !family) {
        continue; // camera, keypad hub...: not ours
      }
      const stationData = Object.fromEntries(
        Object.entries(station).filter(([key]) => !IDENTITY_KEYS.has(key)),
      );
      const stationUnit = {
        key: `${isBase ? 'base' : 'detector'}:${serial}`,
        kind: isBase ? 'base' : 'detector',
        serial,
        model,
        family,
        rf: false,
        name: station.stationName || `${model} ${serial.slice(-4)}`,
        room: roomOf(station),
        houseId: String(house.houseId),
        stationSerial: serial,
        thing: thingName(model, serial),
        region: house.mqttRegion,
        initial: stationData,
      };
      units.push(stationUnit);
      if (!isBase) {
        continue;
      }
      for (const device of station.devices ?? []) {
        const childSerial = firstOf(device, SERIAL_KEYS);
        const childModel = firstOf(device, ['deviceType', 'type', 'category']);
        const childFamily = familyOf(childModel);
        if (!childSerial || !childFamily) {
          continue;
        }
        units.push({
          key: `detector:${childSerial}`,
          kind: 'detector',
          serial: childSerial,
          model: childModel,
          family: childFamily,
          rf: true,
          name: device.deviceName || `${childModel} ${childSerial.slice(-4)}`,
          room: roomOf(device) ?? stationUnit.room,
          houseId: String(house.houseId),
          stationSerial: serial,
          thing: stationUnit.thing,
          region: house.mqttRegion,
          initial: device,
        });
      }
    }
  }
  return { houses, units };
}

// --- Merging raw values ---------------------------------------------------------

/**
 * Flatten one record the app's way: a nested `status` object is merged in,
 * `peak.coPpmPeak` lifted, and `isAlarm` mirrored into `alarmStatus`.
 * @param {object} record
 */
export function flattenRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return {};
  }
  const data = { ...record };
  if (data.status && typeof data.status === 'object') {
    Object.assign(data, data.status);
    delete data.status;
  }
  delete data.devs;
  if (data.peak && typeof data.peak === 'object') {
    if (data.peak.coPpmPeak !== undefined) data.coPpmPeak = data.peak.coPpmPeak;
    delete data.peak;
  }
  if (data.alarmStatus === undefined && data.a === undefined && data.isAlarm !== undefined) {
    data.alarmStatus = data.isAlarm;
  }
  if (data.onLine !== undefined && data.online === undefined) {
    data.online = data.onLine;
  }
  return data;
}

/**
 * Split a station shadow (or station MQTT update) into the station's own
 * values and one record per child serial. Children come as `devs` (an object
 * keyed by serial, or a list of records naming their serial), or as top-level
 * keys equal to a known child serial.
 * @param {object|Array} reported
 * @param {Set<string>} childSerials
 * @returns {{ station: object, children: Map<string, object> }}
 */
export function splitStationReport(reported, childSerials) {
  const children = new Map();
  const add = (serial, record) => {
    if (serial && record && typeof record === 'object') {
      children.set(String(serial), {
        ...(children.get(String(serial)) ?? {}),
        ...flattenRecord(record),
      });
    }
  };
  if (Array.isArray(reported)) {
    for (const record of reported) add(firstOf(record, SERIAL_KEYS), record);
    return { station: {}, children };
  }
  const station = { ...(reported ?? {}) };
  const devs = station.devs;
  delete station.devs;
  if (Array.isArray(devs)) {
    for (const record of devs) add(firstOf(record, SERIAL_KEYS), record);
  } else if (devs && typeof devs === 'object') {
    for (const [key, record] of Object.entries(devs)) {
      const serial = childSerials.has(key) ? key : (firstOf(record, SERIAL_KEYS) ?? key);
      add(serial, record);
    }
  }
  for (const [key, value] of Object.entries(station)) {
    if (childSerials.has(key) && value && typeof value === 'object') {
      add(key, value);
      delete station[key];
    }
  }
  // A child update sent on the station topic names its child.
  const target = firstOf(station, SERIAL_KEYS);
  if (target && childSerials.has(target)) {
    add(target, station);
    return { station: {}, children };
  }
  return { station: flattenRecord(station), children };
}

/** Station serial named by a payload (MQTT events), if any. */
export const stationSerialOf = (record) => firstOf(record, STATION_SERIAL_KEYS);
/** Device serial named by a payload (MQTT events), if any. */
export const deviceSerialOf = (record) => firstOf(record, SERIAL_KEYS);

// --- Self-test reports -------------------------------------------------------

const SELF_TEST_RESULT_KEYS = [
  'lastSelfTest',
  'selfTest',
  'selfTestResult',
  'selfTestStatus',
  'testResult',
  'testStatus',
  'result',
];
const SELF_TEST_TIME_KEYS = ['lastSelfTestTime', 'selfTestTime', 'testTime', 'eventTime', 'time'];
const SELF_TEST_FAULT_KEYS = [
  'selfTestCoFault',
  'selfTestLifeEnd',
  'selfTestLowPower',
  'selfTestSmokeFault',
];

/** True for the MQTT topics carrying a self-test report. */
export function isSelfTestTopic(topic) {
  return ['_testup/update', 'alarmtestup/update', 'selftestup/update', 'selftestup_v2/update'].some(
    (marker) => topic.includes(marker),
  );
}

/**
 * Normalize a self-test report: { ok: boolean, at: epoch ms | null }, or null
 * when the payload holds no result.
 * @param {object} report
 * @param {number} receivedAt fallback time
 */
export function parseSelfTest(report, receivedAt) {
  if (!report || typeof report !== 'object') {
    return null;
  }
  let ok;
  const raw = firstOf(report, SELF_TEST_RESULT_KEYS);
  if (raw !== null) {
    const text = raw.trim().toLowerCase();
    ok = ['0', 'success', 'successful', 'ok', 'pass', 'passed'].includes(text);
  } else {
    const faults = SELF_TEST_FAULT_KEYS.map((key) => report[key]).filter(
      (value) => value !== undefined && value !== null && value !== '',
    );
    if (faults.length === 0) {
      return null;
    }
    ok = !faults.some((value) =>
      ['1', 'true', 'yes', 'fault', 'failed'].includes(String(value).toLowerCase()),
    );
  }
  return { ok, at: parseXSenseTime(firstOf(report, SELF_TEST_TIME_KEYS)) ?? receivedAt };
}

/**
 * X-Sense times: `yyyyMMddHHmmss` (UTC) or epoch seconds / milliseconds.
 * @returns {number|null} epoch ms
 */
export function parseXSenseTime(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const text = String(value).trim();
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (compact) {
    const [, y, mo, d, h, mi, s] = compact.map(Number);
    return Date.UTC(y, mo - 1, d, h, mi, s);
  }
  if (/^\d{13}$/.test(text)) return Number(text);
  if (/^\d{10}$/.test(text)) return Number(text) * 1000;
  return null;
}

// --- Derived state -----------------------------------------------------------

/** 0/positive code → number; anything else → null. */
function code(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim().toLowerCase();
  if (text === 'true' || text === 'on') return 1;
  if (text === 'false' || text === 'off') return 0;
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const int = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
};

// A detector that has not reported for this long is offline (the app's rule:
// 34 h, 49 h for the SWS0B water sensor and the radon station).
const offlineAfterMs = (model) => (model === 'SWS0B' ? 49 : 34) * 3600 * 1000;

/**
 * Whether the unit is online: the explicit flag first, else the age of its
 * last report. null: unknown.
 */
function onlineOf(unit, data, now) {
  const flag = code(data.online ?? data.onLine);
  if (flag !== null) {
    return flag > 0 ? 1 : 0;
  }
  const reported = parseXSenseTime(data.onlineTime);
  if (reported !== null) {
    const reference = parseXSenseTime(data.utcTime) ?? now;
    return reference <= reported + offlineAfterMs(unit.model) ? 1 : 0;
  }
  return null;
}

/**
 * The alarms of a detector, from its coded `alarmStatus`. A positive code is
 * an alarm; on a smoke + CO detector 1 is smoke, 2 CO, 3 both (APK 1400) —
 * another positive code says an alarm sounds without saying which, so both
 * are raised: better a CO alarm too many than a fire missed.
 * @param {object} unit
 * @param {object} data
 * @param {boolean} known the station state was read at least once: an absent
 *   code then means "no alarm"
 */
function alarmsOf(unit, data, known) {
  const raw = data.alarmStatus ?? data.a;
  let value = code(raw);
  if (unit.family === FAMILY.WATER && data.waterAlarmStatus !== undefined) {
    value = code(data.waterAlarmStatus);
  }
  if (value === null) {
    value = known ? 0 : null;
  }
  if (value === null) {
    return {};
  }
  const on = value > 0 ? 1 : 0;
  switch (unit.family) {
    case FAMILY.SMOKE:
      return { smoke: on };
    case FAMILY.CO:
      return { co: on };
    case FAMILY.HEAT:
      return { heat: on };
    case FAMILY.WATER:
      return { water: on };
    case FAMILY.COMBI:
      return {
        smoke: value === 1 || value === 3 || value > 3 ? 1 : 0,
        co: value === 2 || value === 3 || value > 3 ? 1 : 0,
      };
    default:
      return {};
  }
}

/**
 * The values the device features publish (undefined: nothing known yet).
 * @param {object} unit from buildUnits
 * @param {object} data merged raw values
 * @param {object} context
 * @param {number} context.now
 * @param {boolean} context.known the unit's station state was read
 * @param {{ ok: boolean, at: number }|null} [context.selfTest]
 */
export function deriveState(unit, data, { now, known, selfTest = null }) {
  const state = { online: onlineOf(unit, data, now) };
  if (unit.kind === 'base' || !unit.rf) {
    const rssi = int(data.wifiRSSI ?? data.wifiRssi);
    state.wifi = rssi === null ? null : Math.max(-100, Math.min(0, rssi));
  }
  if (unit.kind === 'base') {
    return state;
  }
  Object.assign(state, alarmsOf(unit, data, known));
  const level = int(data.batInfo);
  if (level !== null && level >= 0) {
    state.battery = Math.min(100, Math.round((level * 100) / 3));
    state.lowBattery = level <= 1;
  }
  if (unit.rf) {
    const rf = int(data.rfLevel);
    state.rf = rf === null ? null : Math.max(0, Math.min(3, rf));
  }
  if (unit.family === FAMILY.CO || unit.family === FAMILY.COMBI) {
    const ppm = int(data.coPpm);
    state.coPpm = ppm === null ? null : Math.max(0, ppm);
  }
  state.endOfLife = code(data.isLifeEnd) === 1;
  state.selfTest = selfTest;
  return state;
}

/** True when any alarm of a derived state is raised. */
export const hasAlarm = (state) =>
  state.smoke === 1 || state.co === 1 || state.heat === 1 || state.water === 1;
