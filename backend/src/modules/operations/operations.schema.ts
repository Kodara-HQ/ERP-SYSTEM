import { z } from 'zod';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const area = z.enum(['daily', 'procurement', 'loading', 'farm', 'haulage', 'inventory', 'other']);

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const activitySchema = z.object({
  activityDate: dateSchema,
  area,
  summary: z.string().trim().min(3).max(500),
});

export const taskSchema = z.object({
  title: z.string().trim().min(3).max(200),
  area,
  dueOn: dateSchema.optional(),
  notes: z.string().trim().max(1000).optional(),
  assignedToUserId: z.number().int().positive().optional(),
});

export const taskStatusSchema = z.object({
  status: z.enum(['open', 'in_progress', 'done']),
});

export const issueSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(8).max(2000),
  area,
  severity: z.enum(['low', 'medium', 'high']),
});

export const issueUpdateSchema = z.object({
  status: z.enum(['open', 'monitoring', 'resolved']).optional(),
  escalated: z.boolean().optional(),
});
