import { z } from 'zod';
import { codeSchema } from '../organisation/organisation.schema';

export const roleCreateSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(400).optional().nullable(),
  permissions: z.array(z.string().trim().min(3).max(80)).default([]),
});

export const roleUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(400).nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export const permissionUpdateSchema = z.object({
  permissions: z.array(z.string().trim().min(3).max(80)),
});

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
