import { z } from 'zod';

const optionalId = z.number().int().positive().nullable().optional();
const money = z.number().nonnegative().max(999999999999.99).nullable().optional();

export const requestListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional().default(''),
  queue: z.enum(['mine', 'inbox', 'all']).optional().default('mine'),
  status: z.enum([
    'draft',
    'submitted',
    'pending_review',
    'under_approval',
    'approved',
    'rejected',
    'returned_for_correction',
    'processing',
    'completed',
    'cancelled',
    'open',
    'all',
  ]).optional().default('all'),
});

export const requestWriteSchema = z.object({
  workflowCode: z.string().trim().min(2).max(40).optional(),
  title: z.string().trim().min(3).max(180),
  details: z.string().trim().max(2000).nullable().optional(),
  amount: money,
  departmentId: optionalId,
  branchId: optionalId,
  submit: z.boolean().optional(),
});

export const decisionSchema = z.object({
  action: z.enum(['approve', 'reject', 'return']),
  comment: z.string().trim().max(1000).optional(),
});

export const commentSchema = z.object({
  comment: z.string().trim().max(1000).optional(),
});

export const delegationSchema = z.object({
  delegateUserId: z.number().int().positive(),
  workflowId: z.number().int().positive().nullable().optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(8).max(500),
});

export const workflowCreateSchema = z.object({
  code: z.string().trim().min(2).max(40).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(3).max(160),
  description: z.string().trim().max(500).nullable().optional(),
  transactionKind: z.enum(['general', 'expenditure', 'organisational']),
  completionRoleCode: z.string().trim().min(2).max(60),
  steps: z.array(z.unknown()).min(1),
});

export const workflowReplaceSchema = z.object({
  steps: z.array(z.unknown()).min(1),
});

export const stepInputSchema = z.object({
  stepOrder: z.number().int().positive(),
  name: z.string().trim().min(2).max(160),
  resolver: z.enum(['role', 'supervisor', 'department_manager', 'position']),
  roleCode: z.string().trim().min(2).max(60).nullable().optional(),
  positionCode: z.string().trim().min(2).max(40).nullable().optional(),
  parallelGroup: z.number().int().positive().nullable().optional(),
  decisionKind: z.enum(['review', 'verify', 'approve']),
  requiresExpenditureAuthority: z.boolean().optional().default(false),
  isFinalBusinessStep: z.boolean().optional().default(false),
  minAmount: money,
  maxAmount: money,
  appliesToDepartmentId: optionalId,
  appliesToBranchId: optionalId,
});

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
