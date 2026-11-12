import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { HttpError } from '../utils/httpError';

interface SqlError extends Error {
  code?: string;
  errno?: number;
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ZodError) {
    res.status(422).json({
      error: {
        message: 'The submitted data is not valid.',
        code: 'VALIDATION_ERROR',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: {
        message: error.message,
        code: error.code ?? 'REQUEST_ERROR',
        details: error.details ?? undefined,
      },
    });
    return;
  }

  const sqlError = error as SqlError;
  if (sqlError.code === 'ER_DUP_ENTRY') {
    res.status(409).json({ error: { message: 'A record with these details already exists.', code: 'DUPLICATE' } });
    return;
  }
  if (sqlError.code === 'ER_NO_REFERENCED_ROW_2' || sqlError.code === 'ER_NO_REFERENCED_ROW') {
    res.status(422).json({ error: { message: 'A related record does not exist.', code: 'INVALID_REFERENCE' } });
    return;
  }
  if (sqlError.code === 'ER_ROW_IS_REFERENCED_2' || sqlError.code === 'ER_SIGNAL_EXCEPTION') {
    res.status(409).json({
      error: {
        message: sqlError.code === 'ER_SIGNAL_EXCEPTION' ? 'This record cannot be changed.' : 'This record is still in use.',
        code: 'CONFLICT',
      },
    });
    return;
  }

  logger.error('Unhandled API error.', {
    message: error instanceof Error ? error.message : 'Unknown error',
    code: sqlError.code,
  });
  res.status(500).json({
    error: {
      message: env.isProduction ? 'An unexpected error occurred.' : error instanceof Error ? error.message : 'An unexpected error occurred.',
      code: 'INTERNAL_ERROR',
    },
  });
}
