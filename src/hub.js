// -----------------------------------------------------------------------------
// The hub: one X-Sense account, its detectors, and what Gladys receives.
//
//   - Reads the account (homes, stations, detectors) at start, every 30
//     minutes and on demand, and publishes the devices.
//   - Reads the AWS IoT shadows of every station on its OWN timer, every
//     `refresh_minutes`: the core cannot be trusted to poll external devices
//     (GladysAssistant/Gladys#3198, not fixed in 5.2.1). The core's onPoll is
//     a fallback that does nothing while the timer runs.
//   - Listens to the same shadows live over MQTT: an alarm reaches Gladys in
//     seconds. Every MQTT update of a station also schedules a read of its
//     shadows, so a payload shape this code misreads is corrected at once.
//   - Publishes only the changed states (SDK deduplication), with a 6-hour
//     heartbeat so a quiet detector never shows "no recent value".
//   - Fires the scene triggers on a rising edge: fire alarm, CO alarm, water
//     leak, low battery.
//
// Logs: nothing at info for a normal cycle. Info is for the lifecycle (start,
// account read, cloud or MQTT lost and back), the alarms, and errors once.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { randomUUID } from 'node:crypto';
import { isConfigured, refreshMs } from './config.js';
import { buildDevices, unitIds, unitStates } from './devices.js';
import { MESSAGES, TEXT } from './i18n.js';
import { createIssueLog } from './issues.js';
import { presignMqttUrl } from './xsense/crypto.js';
import { openMqtt as defaultOpenMqtt } from './xsense/mqtt.js';
import {
  buildUnits,
  deriveState,
  deviceSerialOf,
  flattenRecord,
  isSelfTestTopic,
  parseSelfTest,
  splitStationReport,
  stationSerialOf,
  stationShadows,
} from './xsense/model.js';

/** Scene trigger keys: forever once published. */
export const TRIGGER = {
  FIRE_ALARM: 'fire_alarm',
  CO_ALARM: 'co_alarm',
  WATER_LEAK: 'water_leak',
  LOW_BATTERY: 'low_battery',
};

/** The widget key, refreshed when a visible value changes. */
export const WIDGET_KEY = 'detectors';

const ACCOUNT_REFRESH_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 6 * 3600 * 1000;
const STATION_READ_DEBOUNCE_MS = 1500;
const MQTT_RETRY_MIN_MS = 10 * 1000;
const MQTT_RETRY_MAX_MS = 10 * 60 * 1000;
// The username the app's AWS SDK presents to the broker.
const MQTT_USERNAME = '?SDK=iOS&Version=2.26.5';

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration (or the SDK's fake)
 * @param {object} options.client createXSenseClient()
 * @param {object} options.store src/store.js
 * @param {object} [options.logger]
 * @param {() => number} [options.now]
 * @param {boolean} [options.timers] run the refresh timer and the MQTT link
 * @param {Function} [options.openMqtt]
 */
export function createHub({
  gladys,
  client,
  store,
  logger = createLogger({ name: 'xsense' }),
  now = () => Date.now(),
  timers = true,
  openMqtt = defaultOpenMqtt,
}) {
  const issues = createIssueLog(logger);
  let config = null;
  let houses = [];
  let units = [];
  /** raw values by unit key */
  const data = new Map();
  /** last derived state by unit key (trigger edges) */
  const derived = new Map();
  /** station serials whose state shadow was read */
  const known = new Set();
  let accountLoadedAt = 0;
  let lastRefreshAt = 0;
  let refreshing = null;
  let timer = null;
  let stopped = true;
  let status = 'idle'; // idle | ok | auth | unreachable | unconfigured
  let publishedSignature = '';
  const mqttLinks = new Map(); // mqttServer -> { link, retryMs, retryTimer }
  const stationReads = new Map(); // station serial -> timeout

  const unitsByKey = () => new Map(units.map((unit) => [unit.key, unit]));

  // --- Raw values ----------------------------------------------------------

  function merge(unit, record) {
    if (!unit || !record || Object.keys(record).length === 0) {
      return;
    }
    data.set(unit.key, { ...(data.get(unit.key) ?? {}), ...record });
  }

  const stationUnits = () => units.filter((unit) => unit.serial === unit.stationSerial);
  const childrenOf = (station) =>
    units.filter((unit) => unit.rf && unit.stationSerial === station.serial);
  const unitBySerial = (serial) => units.find((unit) => unit.serial === serial);

  /** A station shadow (or MQTT update) into the station and its children. */
  function applyStationReport(station, reported) {
    const children = childrenOf(station);
    const serials = new Set(children.map((unit) => unit.serial));
    const split = splitStationReport(reported, serials);
    merge(station, split.station);
    for (const [serial, record] of split.children) {
      merge(unitBySerial(serial), record);
    }
  }

  /** The home shadow: one record per Wi-Fi station serial. */
  function applyHouseReport(reported) {
    for (const [serial, record] of Object.entries(reported ?? {})) {
      const station = unitBySerial(serial);
      if (
        station &&
        station.serial === station.stationSerial &&
        record &&
        typeof record === 'object'
      ) {
        applyStationReport(station, record);
        known.add(station.serial);
      }
    }
  }

  // --- Reading the cloud -----------------------------------------------------

  async function loadAccount({ publish = false } = {}) {
    const account = await client.loadAccount();
    const built = buildUnits(account);
    const firstLoad = units.length === 0;
    houses = built.houses;
    units = built.units;
    for (const unit of units) {
      // The station list carries online flags and battery levels too.
      merge(unit, flattenRecord(unit.initial));
    }
    accountLoadedAt = now();
    const detectors = units.filter((unit) => unit.kind === 'detector').length;
    const stations = units.filter((unit) => unit.kind === 'base').length;
    const signature = JSON.stringify(
      units.map((unit) => [unit.key, unit.name, unit.model, unit.room]),
    );
    if (publish || signature !== publishedSignature) {
      await gladys.publishDiscoveredDevices(buildDevices(gladys, units, config.language));
    }
    if (signature !== publishedSignature) {
      publishedSignature = signature;
      if (firstLoad) {
        logger.info(`X-Sense account read: ${detectors} detector(s), ${stations} base station(s)`);
      } else {
        logger.info(
          `X-Sense account changed: ${detectors} detector(s), ${stations} base station(s)`,
        );
      }
      if (timers) {
        restartMqtt();
      }
    }
    return { detectors, stations };
  }

  async function readStation(station) {
    const shadows = stationShadows(station);
    for (const name of shadows.state) {
      const reported = await client.getShadow({
        region: station.region,
        thing: station.thing,
        name,
      });
      if (reported) {
        applyStationReport(station, reported);
        known.add(station.serial);
        break;
      }
    }
    for (const name of shadows.info) {
      const reported = await client.getShadow({
        region: station.region,
        thing: station.thing,
        name,
      });
      if (reported) {
        merge(station, flattenRecord(reported));
        break;
      }
    }
  }

  async function readHouses() {
    for (const house of houses) {
      const wifi = units.some(
        (unit) => unit.houseId === house.id && unit.kind === 'detector' && !unit.rf,
      );
      if (!wifi) {
        continue;
      }
      for (const name of ['mainpage', '2nd_mainpage']) {
        const reported = await client.getShadow({
          region: house.mqttRegion,
          thing: house.id,
          name,
        });
        applyHouseReport(reported);
      }
    }
  }

  /** One full refresh: account if due, every shadow, then the states. */
  async function doRefresh({ account = false, publish = false } = {}) {
    if (!config || !isConfigured(config)) {
      return;
    }
    lastRefreshAt = now();
    try {
      await client.connect();
      let counts = null;
      if (
        account ||
        publish ||
        units.length === 0 ||
        now() - accountLoadedAt >= ACCOUNT_REFRESH_MS
      ) {
        counts = await loadAccount({ publish });
      }
      await readHouses();
      for (const station of stationUnits()) {
        await readStation(station);
      }
      await publishStates();
      issues.ok('cloud', 'X-Sense cloud reachable again');
      if (status !== 'ok') {
        status = 'ok';
        const detectors = counts?.detectors ?? units.filter((u) => u.kind === 'detector').length;
        const stations = counts?.stations ?? units.filter((u) => u.kind === 'base').length;
        await gladys
          .setConnectionStatus(true, MESSAGES.connected(detectors, stations))
          .catch(() => {});
        logger.info(
          `Connected to the X-Sense cloud: ${detectors} detector(s), ${stations} base station(s)`,
        );
      }
    } catch (err) {
      await onRefreshError(err);
      throw err;
    }
  }

  async function onRefreshError(err) {
    if (err.kind === 'auth') {
      // Retrying a refused password could lock the account: wait for a new
      // configuration (the action "Test the connection" retries on demand).
      if (status !== 'auth') {
        status = 'auth';
        logger.error(`X-Sense sign-in refused: ${err.message}. Waiting for new credentials.`);
        await gladys.setConnectionStatus(false, TEXT.wrongCredentials).catch(() => {});
      }
      stopTimer();
      return;
    }
    issues.fail('cloud', `X-Sense cloud unreachable: ${err.message}`);
    if (status !== 'unreachable') {
      status = 'unreachable';
      await gladys.setConnectionStatus(false, MESSAGES.unreachable(err.message)).catch(() => {});
    }
  }

  /** A refresh, unless one is running (then the same one). */
  function refresh(options) {
    if (!refreshing) {
      refreshing = doRefresh(options).finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  // --- States and triggers ---------------------------------------------------

  function stateOf(unit, selfTests) {
    return deriveState(unit, data.get(unit.key) ?? {}, {
      now: now(),
      known: known.has(unit.stationSerial),
      selfTest: selfTests?.[unit.serial] ?? null,
    });
  }

  async function publishStates() {
    const selfTests = (await store.get('selfTests')) ?? {};
    const lowBattery = new Set((await store.get('lowBattery')) ?? []);
    let lowBatteryChanged = false;
    const states = [];
    let visibleChange = false;
    const events = [];
    for (const unit of units) {
      const state = stateOf(unit, selfTests);
      const before = derived.get(unit.key);
      derived.set(unit.key, state);
      states.push(...unitStates(gladys, unit, state, config.language));
      if (!before || summary(before) !== summary(state)) {
        visibleChange = true;
      }
      if (unit.kind !== 'detector') {
        continue;
      }
      const device = unitIds(gladys, unit).device;
      const base = { device, device_name: unit.name, room: unit.room ?? '' };
      const rose = (key) => state[key] === 1 && before?.[key] !== 1;
      const fell = (key) => state[key] === 0 && before?.[key] === 1;
      for (const [key, cause] of [
        ['smoke', 'smoke'],
        ['heat', 'heat'],
      ]) {
        if (rose(key)) {
          logger.info(`ALARM: ${cause} on "${unit.name}"${unit.room ? ` (${unit.room})` : ''}`);
          events.push([TRIGGER.FIRE_ALARM, { ...base, cause }]);
        } else if (fell(key)) {
          logger.info(`Alarm over: ${cause} on "${unit.name}"`);
        }
      }
      if (rose('co')) {
        logger.info(`ALARM: CO on "${unit.name}"${unit.room ? ` (${unit.room})` : ''}`);
        events.push([TRIGGER.CO_ALARM, { ...base, co_ppm: state.coPpm ?? null }]);
      } else if (fell('co')) {
        logger.info(`Alarm over: CO on "${unit.name}"`);
      }
      if (rose('water')) {
        logger.info(`ALARM: water leak on "${unit.name}"${unit.room ? ` (${unit.room})` : ''}`);
        events.push([TRIGGER.WATER_LEAK, base]);
      } else if (fell('water')) {
        logger.info(`Alarm over: water leak on "${unit.name}"`);
      }
      // Low battery: once per episode, remembered across restarts.
      if (state.lowBattery === true && !lowBattery.has(unit.serial)) {
        lowBattery.add(unit.serial);
        lowBatteryChanged = true;
        logger.info(`Low battery on "${unit.name}"`);
        events.push([TRIGGER.LOW_BATTERY, { ...base, battery: state.battery ?? null }]);
      } else if (state.lowBattery === false && lowBattery.has(unit.serial)) {
        lowBattery.delete(unit.serial);
        lowBatteryChanged = true;
      }
    }
    if (lowBatteryChanged) {
      await store.set('lowBattery', [...lowBattery]);
    }
    if (states.length > 0) {
      // A refusal by Gladys is not a cloud problem: logged on its own, and
      // the SDK sends the refused states again with the next call.
      await gladys
        .publishChangedStates(states, { heartbeat: HEARTBEAT_MS })
        .then(() => issues.ok('gladys', 'Gladys accepts the states again'))
        .catch((err) => issues.fail('gladys', `Gladys refused the states: ${err.message}`));
    }
    for (const [key, eventData] of events) {
      await gladys
        .publishSceneEvent(key, eventData)
        .catch((err) => logger.error(`Scene trigger ${key} not delivered: ${err.message}`));
    }
    if (visibleChange) {
      gladys.requestWidgetRefresh?.(WIDGET_KEY);
    }
  }

  // What the widget shows of a unit: a change means a widget refresh.
  const summary = (state) =>
    JSON.stringify([
      state.online,
      state.smoke,
      state.co,
      state.heat,
      state.water,
      state.battery,
      state.coPpm,
      state.endOfLife,
    ]);

  // --- MQTT --------------------------------------------------------------------

  function topicsFor(house) {
    const topics = [`@xsense/events/+/${house.id}`, `$aws/things/${house.id}/shadow/name/+/update`];
    for (const station of stationUnits().filter((unit) => unit.houseId === house.id)) {
      topics.push(`$aws/things/${station.thing}/shadow/name/+/update`);
      topics.push(`$aws/events/presence/+/${station.thing}`);
    }
    return topics;
  }

  function stopMqtt() {
    for (const entry of mqttLinks.values()) {
      clearTimeout(entry.retryTimer);
      entry.closing = true;
      entry.link?.close();
    }
    mqttLinks.clear();
  }

  function restartMqtt() {
    stopMqtt();
    const servers = new Map();
    for (const house of houses) {
      if (!house.mqttServer || !house.mqttRegion) continue;
      const list = servers.get(house.mqttServer) ?? [];
      list.push(house);
      servers.set(house.mqttServer, list);
    }
    for (const [server, serverHouses] of servers) {
      const entry = { link: null, retryMs: MQTT_RETRY_MIN_MS, retryTimer: null, closing: false };
      mqttLinks.set(server, entry);
      connectMqtt(server, serverHouses, entry);
    }
  }

  async function connectMqtt(server, serverHouses, entry) {
    if (stopped || entry.closing) return;
    try {
      const credentials = await client.awsCredentials();
      const url = presignMqttUrl({
        server,
        region: serverHouses[0].mqttRegion,
        credentials,
        date: new Date(now()),
      });
      entry.link = await openMqtt({
        url,
        clientId: randomUUID(),
        username: MQTT_USERNAME,
        topics: serverHouses.flatMap(topicsFor),
        onMessage: (topic, payload) => onMqttMessage(topic, payload),
        onClose: (reason) => {
          entry.link = null;
          if (stopped || entry.closing) return;
          issues.fail(`mqtt:${server}`, `X-Sense live updates interrupted (${reason})`);
          scheduleMqtt(server, serverHouses, entry);
        },
      });
      entry.retryMs = MQTT_RETRY_MIN_MS;
      if (!issues.isFailing(`mqtt:${server}`)) {
        logger.debug(`X-Sense live updates connected (${serverHouses.length} home(s))`);
      }
      issues.ok(`mqtt:${server}`, 'X-Sense live updates connected again');
    } catch (err) {
      issues.fail(`mqtt:${server}`, `X-Sense live updates unavailable (${err.message})`);
      scheduleMqtt(server, serverHouses, entry);
    }
  }

  function scheduleMqtt(server, serverHouses, entry) {
    if (stopped || entry.closing || !timers) return;
    clearTimeout(entry.retryTimer);
    entry.retryTimer = setTimeout(() => connectMqtt(server, serverHouses, entry), entry.retryMs);
    entry.retryTimer.unref?.();
    entry.retryMs = Math.min(MQTT_RETRY_MAX_MS, entry.retryMs * 2);
  }

  /** Read a station's shadows soon (several updates in a row: one read). */
  function scheduleStationRead(station) {
    if (!timers || stopped) return;
    clearTimeout(stationReads.get(station.serial));
    const handle = setTimeout(async () => {
      stationReads.delete(station.serial);
      try {
        await readStation(station);
        await publishStates();
      } catch (err) {
        logger.debug(`Station read after a live update failed: ${err.message}`);
      }
    }, STATION_READ_DEBOUNCE_MS);
    handle.unref?.();
    stationReads.set(station.serial, handle);
  }

  /**
   * One MQTT message: a shadow update, a presence event, an X-Sense event.
   * @param {string} topic
   * @param {Buffer|string} payload
   */
  async function onMqttMessage(topic, payload) {
    if (/\/update\/(accepted|rejected|documents|delta)$/.test(topic)) {
      return;
    }
    let message;
    try {
      message = JSON.parse(Buffer.from(payload).toString('utf8'));
    } catch {
      logger.debug(`MQTT: unreadable payload on ${topic}`);
      return;
    }
    if (!message || typeof message !== 'object') return;
    logger.debug(`MQTT update on ${topic}`);

    const parts = topic.split('/');
    // $aws/events/presence/<connected|disconnected>/<clientId>
    if (topic.startsWith('$aws/events/presence/')) {
      const station = stationUnits().find((unit) => unit.thing === (message.clientId ?? parts[4]));
      if (station && (message.eventType === 'connected' || message.eventType === 'disconnected')) {
        merge(station, { online: message.eventType === 'connected' ? '1' : '0' });
        await publishStates();
      }
      return;
    }

    let reported = message.state?.reported;
    if (reported === undefined && message.eventData !== undefined) {
      reported = message.eventData;
      if (typeof reported === 'string') {
        try {
          reported = JSON.parse(reported);
        } catch {
          reported = null;
        }
      }
    }
    if (!reported || typeof reported !== 'object') {
      return;
    }

    // $aws/things/<thing>/shadow/name/<name>/update
    const thing = topic.startsWith('$aws/things/') ? parts[2] : null;
    const house = houses.find((h) => h.id === thing);
    if (house) {
      applyHouseReport(reported);
      await publishStates();
      return;
    }
    let station = stationUnits().find((unit) => unit.thing === thing);
    if (!station) {
      const named = stationSerialOf(reported) ?? deviceSerialOf(reported);
      const unit = named ? unitBySerial(named) : null;
      station = unit ? unitBySerial(unit.stationSerial) : null;
    }
    if (!station) {
      logger.debug(`MQTT: no known station for ${topic}`);
      return;
    }

    if (isSelfTestTopic(topic) && !Array.isArray(reported)) {
      const result = parseSelfTest(reported, now());
      const serial = deviceSerialOf(reported) ?? station.serial;
      const target = unitBySerial(serial);
      if (result && target && target.kind === 'detector') {
        const selfTests = (await store.get('selfTests')) ?? {};
        selfTests[target.serial] = result;
        await store.set('selfTests', selfTests);
        logger.info(`Self-test of "${target.name}": ${result.ok ? 'passed' : 'FAILED'}`);
      }
    } else {
      applyStationReport(station, reported);
    }
    await publishStates();
    scheduleStationRead(station);
  }

  // --- Timer -------------------------------------------------------------------

  function stopTimer() {
    clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    stopTimer();
    if (!timers || stopped || !config || status === 'auth') return;
    timer = setTimeout(async () => {
      timer = null;
      await refresh().catch(() => {});
      schedule();
    }, refreshMs(config));
    timer.unref?.();
  }

  // --- API -----------------------------------------------------------------------

  return {
    /**
     * (Re)start with a configuration: a new account, a new pace or a new
     * language. Reads everything now, then on the timer.
     */
    async start(newConfig) {
      const accountChanged =
        !config || newConfig.email !== config.email || newConfig.password !== config.password;
      const languageChanged = config && newConfig.language !== config.language;
      config = newConfig;
      stopped = false;
      stopTimer();
      if (!isConfigured(config)) {
        status = 'unconfigured';
        stopMqtt();
        logger.info('Not configured yet: waiting for the X-Sense e-mail and password');
        await gladys.setConnectionStatus(false, TEXT.notConfiguredStatus).catch(() => {});
        return;
      }
      client.setCredentials(config.email, config.password);
      // A (re)start always reports the connection status again: Gladys may
      // have restarted and forgotten it.
      status = 'idle';
      if (accountChanged) {
        houses = [];
        units = [];
        data.clear();
        derived.clear();
        known.clear();
        publishedSignature = '';
        stopMqtt();
      }
      if (languageChanged) {
        publishedSignature = '';
      }
      try {
        await refresh({ account: true });
      } catch {
        // reported by onRefreshError
      }
      if (timers && mqttLinks.size === 0 && status === 'ok') {
        restartMqtt();
      }
      schedule();
    },

    /** The core's onPoll: a refresh only when the own timer seems stalled. */
    async pollFromCore() {
      if (!config || status === 'auth' || !isConfigured(config)) return;
      if (now() - lastRefreshAt < refreshMs(config) * 1.5) return;
      logger.debug('onPoll: own timer late, refreshing');
      await refresh().catch(() => {});
    },

    /** A device was just added in Gladys: send its states again now. */
    async deviceCreated() {
      if (units.length === 0) return;
      await publishStates();
      gladys.requestWidgetRefresh?.(WIDGET_KEY);
    },

    /** The "Test the connection" action: a full read, now. */
    async test() {
      if (status === 'auth') status = 'idle';
      await refresh({ account: true });
      schedule();
      if (timers && mqttLinks.size === 0) restartMqtt();
      return {
        detectors: units.filter((unit) => unit.kind === 'detector'),
        stations: units.filter((unit) => unit.kind === 'base'),
      };
    },

    /** Units and their derived states, for the widget. */
    snapshot() {
      return {
        status,
        configured: Boolean(config && isConfigured(config)),
        units: units.map((unit) => ({ unit, state: derived.get(unit.key) ?? null })),
      };
    },

    /** Gladys asks for the devices: read the account and publish them. */
    async rescan() {
      if (!config || !isConfigured(config)) return;
      await refresh({ publish: true }).catch(() => {});
    },

    handleMqttMessage: onMqttMessage,
    refresh,

    stop() {
      stopped = true;
      stopTimer();
      stopMqtt();
      for (const handle of stationReads.values()) clearTimeout(handle);
      stationReads.clear();
    },

    get status() {
      return status;
    },
    get units() {
      return unitsByKey();
    },
  };
}
