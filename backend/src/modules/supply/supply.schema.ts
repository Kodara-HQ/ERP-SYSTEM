import { z } from 'zod';

const blank = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((value) => (value ? value : null));

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');
const money = z.number().min(0).max(1_000_000_000);
const quantity = z.number().positive().max(1_000_000);

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const supplierWriteSchema = z.object({
  name: z.string().trim().min(2).max(160),
  contactName: blank(120),
  phone: blank(40),
  email: z.union([z.string().trim().email().max(180), z.literal(''), z.null()]).optional().transform((value) => (value ? value.toLowerCase() : null)),
  notes: blank(400),
});

export const supplierStatusSchema = z.object({
  status: z.enum(['active', 'inactive']),
});

export const categoryWriteSchema = z.object({
  name: z.string().trim().min(2).max(120),
});

export const warehouseWriteSchema = z.object({
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(2).max(160),
  branchId: z.number().int().positive().nullable().optional(),
  notes: blank(400),
});

export const itemWriteSchema = z.object({
  sku: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(160),
  categoryId: z.number().int().positive().nullable().optional(),
  unit: z.string().trim().min(1).max(20).default('unit'),
  reorderLevel: z.number().min(0).max(1_000_000).default(0),
});

export const itemStatusSchema = z.object({
  status: z.enum(['active', 'inactive']),
});

const requisitionLineSchema = z.object({
  itemId: z.number().int().positive().nullable().optional(),
  description: z.string().trim().min(1).max(200),
  quantity,
  estimatedUnitCost: money,
});

export const requisitionWriteSchema = z.object({
  purpose: z.string().trim().min(8).max(400),
  lines: z.array(requisitionLineSchema).min(1).max(40),
});

const orderLineSchema = z.object({
  requisitionLineId: z.number().int().positive(),
  unitCost: money,
});

export const orderWriteSchema = z.object({
  requisitionId: z.number().int().positive(),
  supplierId: z.number().int().positive(),
  lines: z.array(orderLineSchema).min(1).max(40),
});

const receiptLineSchema = z.object({
  orderLineId: z.number().int().positive(),
  quantity: z.number().min(0).max(1_000_000),
  damagedQuantity: z.number().min(0).max(1_000_000).default(0),
  lotCode: blank(40),
  expiryDate: dateSchema.nullable().optional(),
});

export const receiptWriteSchema = z.object({
  purchaseOrderId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  receivedOn: dateSchema,
  notes: blank(400),
  lines: z.array(receiptLineSchema).min(1).max(40),
});

export const invoiceWriteSchema = z.object({
  supplierId: z.number().int().positive(),
  purchaseOrderId: z.number().int().positive().nullable().optional(),
  invoiceNumber: z.string().trim().min(1).max(60),
  invoiceDate: dateSchema,
  amount: z.number().positive().max(1_000_000_000),
  notes: blank(400),
});

export const movementWriteSchema = z.object({
  type: z.enum(['issue', 'transfer', 'adjustment', 'damage']),
  warehouseId: z.number().int().positive(),
  destinationWarehouseId: z.number().int().positive().nullable().optional(),
  itemId: z.number().int().positive(),
  quantity,
  direction: z.enum(['increase', 'decrease']).optional(),
  notes: z.string().trim().min(8).max(400),
}).superRefine((value, context) => {
  if (value.type === 'transfer' && !value.destinationWarehouseId) {
    context.addIssue({ code: 'custom', message: 'Choose the destination warehouse.', path: ['destinationWarehouseId'] });
  }
  if (value.type === 'adjustment' && !value.direction) {
    context.addIssue({ code: 'custom', message: 'Choose whether the adjustment increases or decreases stock.', path: ['direction'] });
  }
});

export const reportQuerySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});
