// -----------------------------------------------------------------------------
// Entry point of the X-Sense integration for Gladys Assistant.
//
// SDK wiring only: the handlers live in src/app.js (registered before
// connect()), the X-Sense work in src/hub.js and src/xsense/.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR
//     (read by the SDK);
//   - TZ, the time zone of Gladys (dates of the self-test reports).
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from './src/app.js';

const gladys = new GladysIntegration();
const app = registerHandlers(gladys);

gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  app.stop();
});

logger.info('Starting the X-Sense integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
