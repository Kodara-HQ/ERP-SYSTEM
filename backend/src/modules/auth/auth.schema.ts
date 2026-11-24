import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(128)
  .regex(/[a-z]/, 'Include a lowercase letter.')
  .regex(/[A-Z]/, 'Include an uppercase letter.')
  .regex(/[0-9]/, 'Include a digit.');

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(60),
  password: z.string().min(1).max(128),
});

export const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your username or work email.').max(180),
});

export const resetTokenSchema = z.object({
  token: z.string().min(20).max(200),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
