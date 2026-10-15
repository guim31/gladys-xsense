// -----------------------------------------------------------------------------
// Wiring: the Gladys handlers on top of the hub. Takes the Gladys client as a
// parameter, so the tests run the whole integration on the SDK's fake Gladys
// with a simulated X-Sense cloud.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { createHub, WIDGET_KEY } from './hub.js';
import { MESSAGES, TEXT, thrown } from './i18n.js';
import { Store } from './store.js';
import { buildDetectorsContent } from './widgets.js';
import { createXSenseClient } from './xsense/client.js';

/** Manifest action keys, forever once published. */
export const ACTION = { TEST_CONNECTION: 'test_connection' };

// The detectors listed in the action result, at most.
const LISTED = 6;

/**
 * @param {object} gladys GladysIntegration (or the SDK's fake)
 * @param {object} [options]
 * @param {object} [options.store]
 * @param {typeof fetch} [options.fetch]
 * @param {Function} [options.openMqtt]
 * @param {boolean} [options.timers]
 * @param {() => number} [options.now]
 * @param {object} [options.logger]
 */
export function registerHandlers(gladys, options = {}) {
  const logger = options.logger ?? createLogger({ name: 'xsense' });
  const store = options.store ?? new Store();
  const client = createXSenseClient({ fetch: options.fetch, store, now: options.now });
  const hub = createHub({
    gladys,
    client,
    store,
    logger,
    now: options.now,
    timers: options.timers ?? true,
    openMqtt: options.openMqtt,
  });
  let config = normalizeConfig();

  gladys.onScanRequest(() => hub.rescan());

  // The container refreshes by itself (src/hub.js): the core's poll is only
  // a fallback, skipped while the own timer runs.
  gladys.onPoll(() => hub.pollFromCore());

  // The SDK forgot what it published for a device the user just added (the
  // core drops the states of a feature it does not know yet): send them now.
  gladys.onDeviceCreated(() => hub.deviceCreated());
  gladys.onDeviceUpdated(() => hub.deviceCreated());

  gladys.onAction(ACTION.TEST_CONNECTION, async () => {
    logger.info('Action: test the X-Sense connection');
    if (!config.email || !config.password) {
      throw new Error(thrown(TEXT.notConfiguredStatus));
    }
    try {
      const { detectors, stations } = await hub.test();
      const names = detectors
        .slice(0, LISTED)
        .map((unit) => (unit.room ? `${unit.name} (${unit.room})` : unit.name));
      if (detectors.length > LISTED) names.push('…');
      return MESSAGES.testResult(detectors.length, stations.length, names.join(', '));
    } catch (err) {
      if (err.kind === 'auth') {
        throw new Error(thrown(TEXT.wrongCredentials), { cause: err });
      }
      throw new Error(thrown(MESSAGES.unreachable(err.message)), { cause: err });
    }
  });

  gladys.onWidgetGet(WIDGET_KEY, async ({ language }) =>
    buildDetectorsContent(hub.snapshot(), language),
  );

  gladys.onConfigUpdated(async (raw) => {
    logger.info('Configuration updated');
    config = normalizeConfig(raw);
    await hub.start(config);
    gladys.requestWidgetRefresh?.(WIDGET_KEY);
  });

  gladys.on('connected', async () => {
    try {
      config = normalizeConfig(await gladys.getConfig());
      await hub.start(config);
      gladys.requestWidgetRefresh?.(WIDGET_KEY);
    } catch (err) {
      logger.error(`Post-connection initialization failed: ${err.message}`);
      await gladys.setConnectionStatus(false, TEXT.initFailed).catch(() => {});
    }
  });

  return { hub, client, stop: () => hub.stop() };
}
