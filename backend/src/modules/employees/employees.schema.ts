import { z } from 'zod';

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

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.')
  .nullable()
  .optional();

const optionalId = z.preprocess(
  (value) => (value === undefined || value === '' || value === null ? undefined : value),
  z.coerce.number().int().positive().optional(),
);

export const employeeListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(120).optional().default(''),
  status: z.enum(['current', 'active', 'probation', 'suspended', 'exited', 'all']).optional().default('current'),
  departmentId: optionalId,
});

export const employeeCreateSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  otherNames: blankToNull(120),
  workEmail: emailSchema,
  personalEmail: emailSchema,
  phone: blankToNull(40),
  dateOfBirth: dateSchema,
  gender: z.enum(['female', 'male', 'other', 'undisclosed']).nullable().optional(),
  nationalId: blankToNull(80),
  hireDate: dateSchema,
  employmentStatus: z.enum(['active', 'probation', 'suspended', 'exited']).optional().default('active'),
  employmentType: z.enum(['permanent', 'fixed_term', 'temporary', 'casual', 'intern']),
  confidentialityLevel: z.enum(['standard', 'confidential', 'restricted']).optional().default('standard'),
  departmentId: z.number().int().positive(),
  positionId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  locationId: z.number().int().positive().nullable().optional(),
  supervisorEmployeeId: z.number().int().positive().nullable().optional(),
  assignmentStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const employeeUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  otherNames: blankToNull(120),
  workEmail: emailSchema,
  personalEmail: emailSchema,
  phone: blankToNull(40),
  dateOfBirth: dateSchema,
  gender: z.enum(['female', 'male', 'other', 'undisclosed']).nullable().optional(),
  nationalId: blankToNull(80),
  hireDate: dateSchema,
  employmentStatus: z.enum(['active', 'probation', 'suspended', 'exited']).optional(),
  confidentialityLevel: z.enum(['standard', 'confidential', 'restricted']).optional(),
});

export const transferSchema = z.object({
  departmentId: z.number().int().positive(),
  positionId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  locationId: z.number().int().positive().nullable().optional(),
  supervisorEmployeeId: z.number().int().positive().nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(8).max(300),
});

export const assignmentSchema = z.object({
  departmentId: z.number().int().positive(),
  positionId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  locationId: z.number().int().positive().nullable().optional(),
  supervisorEmployeeId: z.number().int().positive().nullable().optional(),
  assignmentType: z.enum(['substantive', 'acting', 'temporary']),
  isPrimary: z.boolean().optional().default(false),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().max(300).optional().nullable(),
});

export const reportingSchema = z.object({
  reportsToEmployeeId: z.number().int().positive(),
  relationshipType: z.enum(['line', 'functional', 'dotted', 'acting']).optional().default('line'),
  isPrimary: z.boolean().optional().default(false),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(300).optional().nullable(),
});

export const endDateSchema = z.object({
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const relationshipParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  relationshipId: z.coerce.number().int().positive(),
});
