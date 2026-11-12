import { z } from 'zod';

const money = z.number().min(0).max(1_000_000_000);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const compensationSchema = z.object({
  employeeId: z.number().int().positive(),
  effectiveFrom: dateSchema,
  basicSalary: z.number().positive().max(1_000_000_000),
  allowances: money,
  deductions: money,
  notes: z.string().trim().max(400).optional(),
});

export const payrollCreateSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

export const payrollLinesSchema = z.object({
  lines: z.array(z.object({
    id: z.number().int().positive(),
    basicSalary: z.number().positive().max(1_000_000_000),
    allowances: money,
    deductions: money,
  })).min(1).max(500),
});

export const payrollNoteSchema = z.object({
  comment: z.string().trim().min(8).max(500),
});

export const payrollDecisionSchema = z.object({
  action: z.enum(['approve', 'reject', 'return']),
  comment: z.string().trim().max(500).optional(),
});

export const salaryPaySchema = z.object({
  lineIds: z.array(z.number().int().positive()).min(1).max(200),
  cashAccountId: z.number().int().positive(),
  paymentDate: dateSchema,
});

export const salaryFailSchema = z.object({
  lineId: z.number().int().positive(),
  reason: z.string().trim().min(8).max(400),
});
