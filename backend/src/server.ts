import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { startGovernanceJobs } from './services/governanceJobs';

const app = createApp();

app.listen(env.port, env.host, () => {
  logger.info(`BAJOGO ERP API listening on ${env.host}:${env.port}`);
  if (!env.isTest) startGovernanceJobs();
});
