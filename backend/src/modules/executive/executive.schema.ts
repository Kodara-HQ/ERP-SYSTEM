import { z } from 'zod';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const reviewSchema = z.object({
  departmentId: z.number().int().positive(),
  reviewDate: dateSchema,
  summary: z.string().trim().min(8).max(2000),
  findings: z.array(z.object({
    description: z.string().trim().min(3).max(1000),
    severity: z.enum(['low', 'medium', 'high']),
  })).max(20).optional(),
});

export const actionSchema = z.object({
  reviewId: z.number().int().positive(),
  findingId: z.number().int().positive().optional(),
  title: z.string().trim().min(3).max(200),
  dueOn: dateSchema,
  assignedToUserId: z.number().int().positive(),
});

export const responseSchema = z.object({
  response: z.string().trim().min(8).max(2000),
});

export const resolveSchema = z.object({
  status: z.enum(['resolved', 'outstanding']),
  reviewNote: z.string().trim().min(8).max(1000),
});

export const meetingSchema = z.object({
  heldOn: dateSchema,
  title: z.string().trim().min(3).max(200),
  notes: z.string().trim().min(8).max(4000),
  actions: z.array(z.object({
    description: z.string().trim().min(3).max(400),
    departmentId: z.number().int().positive(),
    dueOn: dateSchema.optional(),
  })).max(30).optional(),
});
