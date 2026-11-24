import { z } from 'zod';
import { passwordSchema } from '../auth/auth.schema';

const optionalId = z.preprocess(
  (value) => (value === undefined || value === '' || value === null ? undefined : value),
  z.coerce.number().int().positive().optional(),
);

export const userListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(120).optional().default(''),
  status: z.enum(['active', 'locked', 'disabled', 'all']).optional().default('all'),
});

export const userUpdateSchema = z.object({
  email: z.string().trim().email().max(180).transform((value) => value.toLowerCase()).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  employeeId: z.number().int().positive().nullable().optional(),
});

export const passwordResetSchema = z.object({
  temporaryPassword: passwordSchema,
});

export const roleAssignmentSchema = z.object({
  roleId: z.number().int().positive(),
  scopeType: z.enum(['global', 'branch', 'department', 'own']),
  scopeId: optionalId,
  reason: z.string().trim().max(500).optional(),
});

export const userCreateSchema = z.object({
  username: z.string().trim().min(3).max(60).transform((value) => value.toLowerCase()),
  email: z.string().trim().email().max(180).transform((value) => value.toLowerCase()),
  password: passwordSchema,
  employeeId: z.number().int().positive().nullable().optional(),
  role: roleAssignmentSchema.optional(),
});

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
export const userRoleParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  userRoleId: z.coerce.number().int().positive(),
});
