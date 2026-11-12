import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');
const optionalDate = date.nullable().optional();
const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional();

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const employeeParamSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
});

export const leaveListSchema = z.object({
  employeeId: z.coerce.number().int().positive().optional(),
});

export const leaveWriteSchema = z.object({
  leaveTypeCode: z.string().trim().min(1).max(30),
  startDate: date,
  endDate: date,
  reason: z.string().trim().min(8).max(500),
  employeeId: z.number().int().positive().optional(),
});

export const attendanceListSchema = z.object({
  from: date.optional(),
  to: date.optional(),
  employeeId: z.coerce.number().int().positive().optional(),
});

export const attendanceWriteSchema = z.object({
  employeeId: z.number().int().positive().optional(),
  workDate: date,
  status: z.enum(['present', 'absent', 'leave', 'off']),
  checkIn: time,
  checkOut: time,
  notes: z.string().trim().max(300).nullable().optional(),
});

export const vacancyWriteSchema = z.object({
  title: z.string().trim().min(3).max(160),
  departmentId: z.number().int().positive(),
  positionId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  openings: z.number().int().min(1).max(50).default(1),
  description: z.string().trim().max(1000).nullable().optional(),
  submit: z.boolean().optional().default(true),
});

export const applicantWriteSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(180).nullable().optional().or(z.literal('')),
  phone: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const hireSchema = z.object({
  startDate: date,
});

export const promotionSchema = z.object({
  employeeId: z.number().int().positive(),
  departmentId: z.number().int().positive(),
  positionId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  effectiveDate: date,
  reason: z.string().trim().min(8).max(300),
});

export const exitSchema = z.object({
  employeeId: z.number().int().positive(),
  exitDate: date,
  reason: z.string().trim().min(8).max(500),
});

export const contractSchema = z.object({
  employeeId: z.number().int().positive(),
  contractType: z.enum(['permanent', 'fixed_term', 'temporary', 'casual', 'intern']),
  startDate: date,
  endDate: optionalDate,
  notes: z.string().trim().max(500).nullable().optional(),
});

export const disciplineSchema = z.object({
  employeeId: z.number().int().positive(),
  incidentDate: date,
  category: z.string().trim().min(2).max(80),
  description: z.string().trim().min(8).max(1000),
  actionTaken: z.string().trim().max(500).nullable().optional(),
});

export const appraisalSchema = z.object({
  employeeId: z.number().int().positive(),
  periodStart: date,
  periodEnd: date,
  rating: z.number().min(1).max(5),
  summary: z.string().trim().min(8).max(1000),
});

export const trainingSchema = z.object({
  employeeId: z.number().int().positive(),
  courseName: z.string().trim().min(2).max(180),
  provider: z.string().trim().max(160).nullable().optional(),
  startDate: date,
  endDate: optionalDate,
  status: z.enum(['planned', 'completed', 'cancelled']).optional(),
  result: z.string().trim().max(120).nullable().optional(),
});

export const onboardingSchema = z.object({
  employeeId: z.number().int().positive(),
  title: z.string().trim().min(2).max(180),
  dueDate: optionalDate,
});

export const reportQuerySchema = z.object({
  from: date.optional(),
  to: date.optional(),
});
