import { runEscalations } from '../modules/approvals/approval.service';
import { notifyDueRecords } from '../modules/registers/registers.service';
import { logger } from '../utils/logger';

const HOUR = 60 * 60 * 1000;

/**
 * Hourly control jobs: escalate approvals that waited past their window and
 * warn departments about licences, hearings, and services that fall due.
 * Each job writes its own audit and notification rows.
 */
export async function runGovernanceJobs(): Promise<void> {
  const system = { userId: null, ipAddress: null, userAgent: 'governance-jobs' };
  try {
    const escalations = await runEscalations(system);
    const due = await notifyDueRecords();
    if (escalations.escalated || due) logger.info('Governance jobs ran.', { escalated: escalations.escalated, dueNotices: due });
  } catch (error) {
    logger.error('Governance jobs failed.', { message: error instanceof Error ? error.message : 'Unknown error' });
  }
}

export function startGovernanceJobs(): NodeJS.Timeout {
  setTimeout(() => { void runGovernanceJobs(); }, 30_000).unref();
  const timer = setInterval(() => { void runGovernanceJobs(); }, HOUR);
  timer.unref();
  return timer;
}
