// -----------------------------------------------------------------------------
// From X-Sense payloads to derived states: families, thing names, the shapes
// of the station shadows, the coded alarms, battery, online and self-test.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FAMILY,
  buildUnits,
  deriveState,
  familyOf,
  flattenRecord,
  isSelfTestTopic,
  parseSelfTest,
  parseXSenseTime,
  splitStationReport,
  stationShadows,
  thingName,
} from '../src/xsense/model.js';
import { HOUSE_ID, SBS50, SERIALS, accountFixture } from './helpers/fakeXSense.js';

const loaded = () => {
  const account = accountFixture();
  return [{ house: account.houses[0], rooms: account.rooms, stations: account.stations }];
};

test('detector families come from the model map, unknown models from their prefix', () => {
  assert.equal(familyOf('XS01-M'), FAMILY.SMOKE);
  assert.equal(familyOf('XC01-M'), FAMILY.CO);
  assert.equal(familyOf('XP0A-MR'), FAMILY.COMBI);
  assert.equal(familyOf('SC07-WX'), FAMILY.COMBI);
  assert.equal(familyOf('XH02-M'), FAMILY.HEAT);
  assert.equal(familyOf('SWS51'), FAMILY.WATER);
  assert.equal(familyOf('XS99-NEW'), FAMILY.SMOKE);
  assert.equal(familyOf('STH51'), null);
  assert.equal(familyOf('SSC0A'), null);
  assert.equal(familyOf(undefined), null);
});

test('AWS IoT thing names follow the app', () => {
  assert.equal(thingName('SBS50', 'AB12'), 'SBS50AB12');
  assert.equal(thingName('SBS10', 'AB12'), 'AB12');
  assert.equal(thingName('XC04-WX', 'AB12'), 'XC04-WX-AB12');
  assert.equal(thingName('XS01-WX', 'AB12'), 'XS01-WXAB12');
  assert.equal(thingName('XS01-WX', '12EN34'), 'XS01-WX-12EN34');
});

test('the shadows read for each station', () => {
  assert.deepEqual(stationShadows({ model: 'SBS50', serial: 'S' }), {
    state: ['2nd_mainpage'],
    info: ['2nd_info_S'],
  });
  assert.deepEqual(stationShadows({ model: 'SBS10', serial: 'S' }), {
    state: ['mainpage'],
    info: ['info_S'],
  });
  assert.deepEqual(stationShadows({ model: 'XC04-WX', serial: 'S' }).state, []);
});

test('the account becomes units: base station, RF and Wi-Fi detectors, nothing else', () => {
  const { houses, units } = buildUnits(loaded());
  assert.deepEqual(houses, [
    {
      id: HOUSE_ID,
      name: 'Maison',
      mqttRegion: 'eu-central-1',
      mqttServer: 'fake-ats.iot.eu-central-1.amazonaws.com',
    },
  ]);
  const byKey = Object.fromEntries(units.map((unit) => [unit.key, unit]));
  assert.deepEqual(
    Object.keys(byKey).sort(),
    [
      `base:${SBS50}`,
      `detector:${SERIALS.co}`,
      `detector:${SERIALS.combi}`,
      `detector:${SERIALS.heat}`,
      `detector:${SERIALS.smoke}`,
      `detector:${SERIALS.water}`,
      `detector:${SERIALS.wifiCo}`,
      `detector:${SERIALS.wifiSmoke}`,
    ].sort(),
  );
  const smoke = byKey[`detector:${SERIALS.smoke}`];
  assert.equal(smoke.rf, true);
  assert.equal(smoke.room, 'Cuisine');
  assert.equal(smoke.thing, `SBS50${SBS50}`);
  assert.equal(smoke.stationSerial, SBS50);
  const wifiCo = byKey[`detector:${SERIALS.wifiCo}`];
  assert.equal(wifiCo.rf, false);
  assert.equal(wifiCo.thing, `XC04-WX-${SERIALS.wifiCo}`);
  assert.equal(wifiCo.stationSerial, SERIALS.wifiCo);
});

test('rooms are read from a list, an object of names or an object of records', () => {
  const account = loaded();
  account[0].rooms = { houseRooms: { R1: 'Kitchen', R2: { roomName: 'Hall' } } };
  const { units } = buildUnits(account);
  const room = (serial) => units.find((unit) => unit.serial === serial).room;
  assert.equal(room(SERIALS.smoke), 'Kitchen');
  assert.equal(room(SERIALS.co), 'Hall');
  // Unknown room id: the base station's room is better than nothing.
  assert.equal(room(SERIALS.heat), null);
});

test('a station report splits into the station and its children, in every shape', () => {
  const children = new Set(['C1', 'C2']);
  const fromObject = splitStationReport(
    { wifiRSSI: '-50', devs: { C1: { batInfo: '3', status: { alarmStatus: '1' } } } },
    children,
  );
  assert.deepEqual(fromObject.station, { wifiRSSI: '-50' });
  assert.deepEqual(fromObject.children.get('C1'), { batInfo: '3', alarmStatus: '1' });

  const fromList = splitStationReport({ devs: [{ deviceSN: 'C2', isAlarm: '1' }] }, children);
  assert.equal(fromList.children.get('C2').alarmStatus, '1');

  const topLevel = splitStationReport({ C1: { onLine: '0' }, activate: '0' }, children);
  assert.equal(topLevel.children.get('C1').online, '0');
  assert.deepEqual(topLevel.station, { activate: '0' });

  const listOnly = splitStationReport([{ deviceSn: 'C1', batInfo: '1' }], children);
  assert.equal(listOnly.children.get('C1').batInfo, '1');

  // A child update sent on the station topic, naming its child.
  const targeted = splitStationReport(
    { deviceSN: 'C2', alarmStatus: '2', stationSN: 'S' },
    children,
  );
  assert.equal(targeted.children.get('C2').alarmStatus, '2');
  assert.deepEqual(targeted.station, {});
});

test('flattenRecord lifts the CO peak and mirrors isAlarm', () => {
  assert.deepEqual(flattenRecord({ peak: { coPpmPeak: '12', time: 'x' }, isAlarm: '1' }), {
    coPpmPeak: '12',
    isAlarm: '1',
    alarmStatus: '1',
  });
  assert.deepEqual(flattenRecord(null), {});
});

const unit = (family, extra = {}) => ({ kind: 'detector', family, rf: true, model: 'X', ...extra });
const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);

test('a coded alarm raises the right feature, a combined unknown code raises both', () => {
  const ctx = { now: NOW, known: true };
  assert.equal(deriveState(unit(FAMILY.SMOKE), { alarmStatus: '1' }, ctx).smoke, 1);
  assert.equal(deriveState(unit(FAMILY.SMOKE), { alarmStatus: '0' }, ctx).smoke, 0);
  assert.equal(deriveState(unit(FAMILY.CO), { alarmStatus: '1' }, ctx).co, 1);
  assert.equal(deriveState(unit(FAMILY.HEAT), { alarmStatus: '1' }, ctx).heat, 1);
  assert.equal(deriveState(unit(FAMILY.WATER), { alarmStatus: '1' }, ctx).water, 1);
  assert.equal(
    deriveState(unit(FAMILY.WATER), { alarmStatus: '0', waterAlarmStatus: '1' }, ctx).water,
    1,
  );
  const combi = (value) => {
    const s = deriveState(unit(FAMILY.COMBI), { alarmStatus: value }, ctx);
    return [s.smoke, s.co];
  };
  assert.deepEqual(combi('0'), [0, 0]);
  assert.deepEqual(combi('1'), [1, 0]);
  assert.deepEqual(combi('2'), [0, 1]);
  assert.deepEqual(combi('3'), [1, 1]);
  assert.deepEqual(combi('5'), [1, 1]);
  assert.deepEqual(combi(true), [1, 0]);
});

test('no alarm value is published before the station state was read', () => {
  const s = deriveState(unit(FAMILY.SMOKE), {}, { now: NOW, known: false });
  assert.equal(s.smoke, undefined);
  assert.equal(deriveState(unit(FAMILY.SMOKE), {}, { now: NOW, known: true }).smoke, 0);
  assert.equal(
    deriveState(unit(FAMILY.SMOKE), { alarmStatus: 'garbage' }, { now: NOW, known: false }).smoke,
    undefined,
  );
});

test('battery level 0-3 becomes a percentage, 1 and below is low', () => {
  const battery = (level) => {
    const s = deriveState(unit(FAMILY.SMOKE), { batInfo: level }, { now: NOW, known: true });
    return [s.battery, s.lowBattery];
  };
  assert.deepEqual(battery('3'), [100, false]);
  assert.deepEqual(battery('2'), [67, false]);
  assert.deepEqual(battery('1'), [33, true]);
  assert.deepEqual(battery('0'), [0, true]);
  assert.deepEqual(battery(undefined), [undefined, undefined]);
});

test('online: the explicit flag first, else the age of the last report', () => {
  const online = (data, model = 'XS01-M') =>
    deriveState(unit(FAMILY.SMOKE, { model }), data, { now: NOW, known: true }).online;
  assert.equal(online({ online: '1' }), 1);
  assert.equal(online({ onLine: '0' }), 0);
  assert.equal(online({ onlineTime: '20261015000000' }), 1);
  assert.equal(online({ onlineTime: '20261013000000' }), 0); // 60 h ago
  assert.equal(online({ onlineTime: '20261013000000' }, 'SWS0B'), 0);
  assert.equal(online({ onlineTime: '20261013160000' }, 'SWS0B'), 1); // 44 h ago
  assert.equal(online({}), null);
});

test('signals: radio level 0-3 for RF detectors, Wi-Fi dBm for the others', () => {
  const rf = deriveState(
    unit(FAMILY.SMOKE),
    { rfLevel: '2', wifiRSSI: '-50' },
    { now: NOW, known: true },
  );
  assert.equal(rf.rf, 2);
  assert.equal(rf.wifi, undefined);
  const wifi = deriveState(
    unit(FAMILY.SMOKE, { rf: false }),
    { wifiRssi: '-63' },
    { now: NOW, known: true },
  );
  assert.equal(wifi.wifi, -63);
  assert.equal(wifi.rf, undefined);
  const base = deriveState(
    { kind: 'base', model: 'SBS50' },
    { wifiRSSI: '-120', online: '1' },
    { now: NOW, known: true },
  );
  assert.deepEqual(base, { online: 1, wifi: -100 });
});

test('CO level, end of life', () => {
  const s = deriveState(
    unit(FAMILY.CO),
    { coPpm: '35', isLifeEnd: '1' },
    { now: NOW, known: true },
  );
  assert.equal(s.coPpm, 35);
  assert.equal(s.endOfLife, true);
  assert.equal(
    deriveState(unit(FAMILY.SMOKE), { coPpm: '35' }, { now: NOW, known: true }).coPpm,
    undefined,
  );
});

test('self-test reports: topics, results and times', () => {
  assert.ok(isSelfTestTopic('$aws/things/SBS50X/shadow/name/2nd_selftestup/update'));
  assert.ok(isSelfTestTopic('$aws/things/SBS50X/shadow/name/2nd_xs01m_testup/update'));
  assert.ok(!isSelfTestTopic('$aws/things/SBS50X/shadow/name/2nd_mainpage/update'));
  assert.deepEqual(parseSelfTest({ lastSelfTest: '0', lastSelfTestTime: '20261012100300' }, 1), {
    ok: true,
    at: Date.UTC(2026, 9, 12, 10, 3, 0),
  });
  assert.deepEqual(parseSelfTest({ result: 'failed' }, 42), { ok: false, at: 42 });
  assert.deepEqual(parseSelfTest({ selfTestSmokeFault: '0', selfTestLowPower: '0' }, 42), {
    ok: true,
    at: 42,
  });
  assert.deepEqual(parseSelfTest({ selfTestSmokeFault: '1' }, 42), { ok: false, at: 42 });
  assert.equal(parseSelfTest({ other: 1 }, 42), null);
});

test('X-Sense times', () => {
  assert.equal(parseXSenseTime('20261015080000'), Date.UTC(2026, 9, 15, 8, 0, 0));
  assert.equal(parseXSenseTime('1760515200'), 1760515200000);
  assert.equal(parseXSenseTime(1760515200123), 1760515200123);
  assert.equal(parseXSenseTime('nonsense'), null);
  assert.equal(parseXSenseTime(''), null);
});
