// -----------------------------------------------------------------------------
// The "X-Sense detectors" dashboard widget: every detector, its state and its
// battery, alarms first.
//
//   - three tiles: detectors in alarm, low batteries, offline devices;
//   - one status list (10 rows at most, the core's cap): alarms, then offline,
//     then low battery or end of life, then the others;
//   - a caption when some detectors do not fit.
//
// The content is pre-localized from the widget's `language` (the core caches
// it per settings, language and units). Pure builder: the hub gives the data.
// Read only: no button — an alarm is silenced on the detector itself.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { hasAlarm } from './xsense/model.js';
import { MESSAGES, TEXT, pick } from './i18n.js';

export const WIDGET = { DETECTORS: 'detectors' };

const MAX_ROWS = 10;
const MAX_LABEL = 40;
const MAX_VALUE = 40;

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Sort rank: what needs attention first. */
function rank({ state }) {
  if (!state) return 4;
  if (hasAlarm(state)) return 0;
  if (state.online === 0) return 1;
  if (state.lowBattery || state.endOfLife) return 2;
  return 3;
}

function row({ unit, state }, language) {
  const t = (text) => pick(text, language);
  const label = clip(unit.room ? `${unit.name} · ${unit.room}` : unit.name, MAX_LABEL);
  if (!state) {
    return { label, value: t(TEXT.noData), color: WIDGET_COLORS.NEUTRAL, icon: 'help-circle' };
  }
  const parts = [];
  let color = WIDGET_COLORS.SUCCESS;
  let icon = 'check-circle';
  const alarms = ['smoke', 'heat', 'co', 'water'].filter((key) => state[key] === 1);
  if (alarms.length > 0) {
    parts.push(alarms.map((key) => t(TEXT[key])).join(' + '));
    color = WIDGET_COLORS.DANGER;
    icon = 'alert-triangle';
  } else if (state.online === 0) {
    parts.push(t(TEXT.offline));
    color = WIDGET_COLORS.WARNING;
    icon = 'wifi-off';
  } else if (state.endOfLife) {
    parts.push(t(TEXT.endOfLife));
    color = WIDGET_COLORS.WARNING;
    icon = 'alert-circle';
  } else {
    parts.push(t(TEXT.ok));
  }
  if (typeof state.battery === 'number') {
    parts.push(`${state.battery} %`);
    if (state.lowBattery && color === WIDGET_COLORS.SUCCESS) {
      color = WIDGET_COLORS.WARNING;
      icon = 'battery';
    }
  }
  if (typeof state.coPpm === 'number') {
    parts.push(`${state.coPpm} ppm`);
  }
  return { label, value: clip(parts.join(' · '), MAX_VALUE), color, icon };
}

const textContent = (text, language) => ({
  ttl_seconds: 60,
  components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
});

/**
 * @param {{ configured: boolean, status: string, units: Array<{ unit, state }> }} snapshot
 * @param {string} language
 */
export function buildDetectorsContent(snapshot, language) {
  if (!snapshot.configured) {
    return textContent(TEXT.notConfigured, language);
  }
  if (snapshot.units.length === 0) {
    return textContent(snapshot.status === 'ok' ? TEXT.noDetector : TEXT.notConnected, language);
  }
  const detectors = snapshot.units.filter(({ unit }) => unit.kind === 'detector');
  if (detectors.length === 0) {
    return textContent(TEXT.noDetector, language);
  }
  const alarms = detectors.filter(({ state }) => state && hasAlarm(state)).length;
  const low = detectors.filter(({ state }) => state?.lowBattery).length;
  const offline = snapshot.units.filter(({ state }) => state?.online === 0).length;
  const sorted = [...detectors].sort(
    (a, b) => rank(a) - rank(b) || a.unit.name.localeCompare(b.unit.name, language),
  );
  const components = [
    {
      type: 'value',
      label: pick(TEXT.alarms, language),
      value: alarms,
      icon: 'alert-triangle',
      color: alarms > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
    {
      type: 'value',
      label: pick(TEXT.lowBattery, language),
      value: low,
      icon: 'battery',
      color: low > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    },
    {
      type: 'value',
      label: pick(TEXT.offline, language),
      value: offline,
      icon: 'wifi-off',
      color: offline > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    },
    { type: 'status', items: sorted.slice(0, MAX_ROWS).map((entry) => row(entry, language)) },
  ];
  if (sorted.length > MAX_ROWS) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: pick(MESSAGES.more(sorted.length - MAX_ROWS), language),
    });
  }
  // A refresh every minute at most: the alarms also nudge it at once.
  return { ttl_seconds: 60, components };
}
