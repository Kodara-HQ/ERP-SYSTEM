import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';

const app = createApp();

app.listen(env.port, env.host, () => {
  logger.info(`BAJOGO ERP API listening on ${env.host}:${env.port}`);
});
