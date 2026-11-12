import { z } from 'zod';

export const codeSchema = z
  .string()
  .trim()
  .min(2)
  .max(30)
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]*$/, 'Use letters, numbers, and hyphens.'));

const optionalId = z.preprocess(
  (value) => (value === undefined || value === '' || value === null ? undefined : value),
  z.coerce.number().int().positive().optional(),
);

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(120).optional().default(''),
  status: z.enum(['active', 'inactive', 'all']).optional().default('active'),
  branchId: optionalId,
});

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const blankToNull = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === null || value === '') return null;
      return value;
    });

const emailSchema = z
  .union([z.string().trim().email().max(180), z.literal(''), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    return value ? value.toLowerCase() : null;
  });

export const branchSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(2).max(160),
  phone: blankToNull(40),
  email: emailSchema,
  addressLine: blankToNull(255),
  city: blankToNull(120),
  isHeadOffice: z.boolean().optional().default(false),
});

export const branchUpdateSchema = z.object({
  code: codeSchema.optional(),
  name: z.string().trim().min(2).max(160).optional(),
  phone: blankToNull(40).optional(),
  email: emailSchema.optional(),
  addressLine: blankToNull(255).optional(),
  city: blankToNull(120).optional(),
  isHeadOffice: z.boolean().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export const locationSchema = z.object({
  branchId: z.number().int().positive(),
  code: codeSchema,
  name: z.string().trim().min(2).max(160),
  locationType: z.enum(['office', 'warehouse', 'farm', 'yard', 'workshop', 'other']).optional(),
  addressLine: blankToNull(255),
  city: blankToNull(120),
});

export const locationUpdateSchema = locationSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});

export const departmentSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(2).max(160),
  description: blankToNull(500),
  parentId: z.number().int().positive().nullable().optional(),
  branchId: z.number().int().positive().nullable().optional(),
});

export const departmentUpdateSchema = departmentSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});

export const positionSchema = z.object({
  code: codeSchema,
  title: z.string().trim().min(2).max(160),
  description: blankToNull(500),
  grade: blankToNull(40),
  departmentId: z.number().int().positive().nullable().optional(),
  reportsToPositionId: z.number().int().positive().nullable().optional(),
  isManagerial: z.boolean().optional().default(false),
});

export const positionUpdateSchema = positionSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});

const reasonSchema = z.string().trim().min(8).max(1000);

export const changeRequestSchema = z.discriminatedUnion('changeType', [
  z.object({ changeType: z.literal('create_department'), reason: reasonSchema, payload: departmentSchema }),
  z.object({
    changeType: z.literal('update_department'),
    reason: reasonSchema,
    payload: departmentUpdateSchema.extend({ departmentId: z.number().int().positive() }),
  }),
  z.object({
    changeType: z.literal('deactivate_department'),
    reason: reasonSchema,
    payload: z.object({ departmentId: z.number().int().positive() }),
  }),
  z.object({ changeType: z.literal('create_position'), reason: reasonSchema, payload: positionSchema }),
  z.object({
    changeType: z.literal('update_position'),
    reason: reasonSchema,
    payload: positionUpdateSchema.extend({ positionId: z.number().int().positive() }),
  }),
  z.object({
    changeType: z.literal('deactivate_position'),
    reason: reasonSchema,
    payload: z.object({ positionId: z.number().int().positive() }),
  }),
]);

export const reviewSchema = z.object({
  comment: reasonSchema,
});

export const changeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(120).optional().default(''),
  status: z.enum(['submitted', 'implemented', 'rejected', 'cancelled', 'all']).optional().default('submitted'),
});

export const companyUpdateSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  tradingName: blankToNull(200),
  registrationNumber: blankToNull(80),
  taxIdentificationNumber: blankToNull(80),
  email: emailSchema,
  phone: blankToNull(40),
  website: blankToNull(255),
  addressLine: blankToNull(255),
  city: blankToNull(120),
  country: blankToNull(120),
  currencyCode: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  timezone: z.string().trim().min(1).max(64),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
});
