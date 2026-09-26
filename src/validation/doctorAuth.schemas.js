import { z } from 'zod';
import { dateOfBirth, email, password, phone } from './common.js';

export const websiteRegisterSchema = z.object({ body: z.object({
  email, password, phoneNumber: phone, dateOfBirth, licenseNumber: z.string().trim().min(2).max(100),
  professionalCategory: z.enum(['PSYCHIATRIST', 'PSYCHOLOGIST', 'COUNSELLOR']),
  timezone: z.string().min(1).max(64).default('UTC')
}).strict() });

export const websiteLoginSchema = z.object({ body: z.object({ email, password: z.string().min(1).max(128) }).strict() });
export const websiteResendSchema = z.object({ body: z.object({ challengeToken: z.string().min(40).max(4096) }).strict() });
export const websiteVerifySchema = z.object({ body: websiteResendSchema.shape.body.extend({ otp: z.string().regex(/^\d{6}$/) }) });
