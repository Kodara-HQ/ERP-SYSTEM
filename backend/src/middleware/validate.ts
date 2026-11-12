import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';

export function validate(schema: { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny }) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schema.body) {
        req.body = schema.body.parse(req.body);
      }
      if (schema.query) {
        Object.defineProperty(req, 'query', {
          value: schema.query.parse(req.query),
          writable: true,
          configurable: true,
        });
      }
      if (schema.params) {
        Object.defineProperty(req, 'params', {
          value: schema.params.parse(req.params),
          writable: true,
          configurable: true,
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
