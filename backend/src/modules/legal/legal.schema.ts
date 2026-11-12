import { z } from 'zod';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const documentSchema = z.object({
  documentType: z.enum(['contract', 'mou', 'agreement']),
  title: z.string().trim().min(3).max(200),
  counterparty: z.string().trim().min(2).max(200),
  effectiveOn: dateSchema.optional(),
  expiryOn: dateSchema.optional(),
  custodyNote: z.string().trim().max(500).optional(),
  summary: z.string().trim().min(8).max(2000),
});

export const obligationSchema = z.object({
  description: z.string().trim().min(3).max(400),
  dueOn: dateSchema,
});

export const obligationStatusSchema = z.object({
  status: z.enum(['open', 'met', 'overdue']),
});

export const legalDecisionSchema = z.object({
  action: z.enum(['approve', 'reject', 'return']),
  recommendation: z.enum(['recommend', 'amend', 'concern']),
  comment: z.string().trim().min(8).max(1000),
});

export const riskSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(8).max(2000),
  likelihood: z.enum(['low', 'medium', 'high']),
  impact: z.enum(['low', 'medium', 'high']),
  departmentId: z.number().int().positive().optional(),
});

export const riskStatusSchema = z.object({
  status: z.enum(['open', 'monitoring', 'closed']),
});
