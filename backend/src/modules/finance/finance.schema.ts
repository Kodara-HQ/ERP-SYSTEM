import { z } from 'zod';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');
const money = z.number().positive().max(1_000_000_000);

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const accountWriteSchema = z.object({
  code: z.string().trim().min(2).max(20),
  name: z.string().trim().min(2).max(160),
  accountType: z.enum(['asset', 'liability', 'equity', 'income', 'expense']),
});

export const accountStatusSchema = z.object({
  status: z.enum(['active', 'inactive']),
});

export const cashWriteSchema = z.object({
  code: z.string().trim().min(2).max(20),
  name: z.string().trim().min(2).max(160),
  kind: z.enum(['bank', 'petty', 'cash']),
  ledgerAccountId: z.number().int().positive(),
});

const journalLineSchema = z.object({
  accountId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  debit: z.number().min(0).max(1_000_000_000),
  credit: z.number().min(0).max(1_000_000_000),
  memo: z.string().trim().max(200).optional().nullable(),
}).superRefine((line, context) => {
  if ((line.debit > 0 && line.credit > 0) || (line.debit === 0 && line.credit === 0)) {
    context.addIssue({ code: 'custom', message: 'Each line needs a debit or a credit.', path: ['debit'] });
  }
});

export const journalWriteSchema = z.object({
  journalDate: dateSchema,
  description: z.string().trim().min(8).max(400),
  lines: z.array(journalLineSchema).min(2).max(40),
});

export const reverseSchema = z.object({
  journalDate: dateSchema,
  description: z.string().trim().min(8).max(400),
});

export const paymentWriteSchema = z.object({
  payee: z.string().trim().min(2).max(160),
  purpose: z.string().trim().min(8).max(400),
  amount: money,
  expenseAccountId: z.number().int().positive(),
  cashAccountId: z.number().int().positive(),
  supplierInvoiceId: z.number().int().positive().nullable().optional(),
});

export const supplierPostSchema = z.object({
  expenseAccountId: z.number().int().positive(),
});

export const customerWriteSchema = z.object({
  name: z.string().trim().min(2).max(160),
});

export const customerInvoiceSchema = z.object({
  customerId: z.number().int().positive(),
  invoiceDate: dateSchema,
  description: z.string().trim().min(8).max(400),
  amount: money,
});

export const receiptSchema = z.object({
  cashAccountId: z.number().int().positive(),
  amount: money,
  receivedOn: dateSchema,
});

export const budgetWriteSchema = z.object({
  departmentId: z.number().int().positive(),
  ledgerAccountId: z.number().int().positive(),
  budgetYear: z.number().int().min(2000).max(2100),
  amount: money,
  purpose: z.string().trim().min(8).max(400),
});

export const pettySchema = z.object({
  cashAccountId: z.number().int().positive(),
  expenseAccountId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  journalDate: dateSchema,
  amount: money,
  memo: z.string().trim().min(8).max(400),
});

export const reconcileSchema = z.object({
  statementDate: dateSchema,
  statementBalance: z.number().min(-1_000_000_000).max(1_000_000_000),
  lineIds: z.array(z.number().int().positive()).max(500),
});

export const reportQuerySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  quarter: z.coerce.number().int().min(1).max(4).optional(),
  financialYear: z.coerce.number().int().min(2000).max(2100).optional(),
});
