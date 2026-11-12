import { env } from '../config/env';

type Level = 'info' | 'warn' | 'error';

function write(level: Level, message: string, details?: unknown): void {
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...(details === undefined ? {} : { details }),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (!env.isTest) {
    console.log(line);
  }
}

export const logger = {
  info(message: string, details?: unknown): void {
    write('info', message, details);
  },
  warn(message: string, details?: unknown): void {
    write('warn', message, details);
  },
  error(message: string, details?: unknown): void {
    write('error', message, details);
  },
};
