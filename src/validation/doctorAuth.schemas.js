import { z } from 'zod';
import { dateOfBirth, email, password, phone } from './common.js';

export const websiteRegisterSchema = z.object({ body: z.object({
  firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100),
  email, password, phoneNumber: phone, dateOfBirth,
  gender: z.enum(['FEMALE', 'MALE', 'NON_BINARY', 'OTHER', 'PREFER_NOT_TO_SAY']),
  licenseNumber: z.string().trim().min(2).max(100),
  professionalCategory: z.enum(['PSYCHIATRIST', 'PSYCHOLOGIST', 'COUNSELLOR']),
  timezone: z.literal('Asia/Kolkata').default('Asia/Kolkata')
}).strict() });

export const websiteLoginSchema = z.object({ body: z.object({ email, password: z.string().min(1).max(128) }).strict() });
const recaptchaToken = z.string().trim().min(1).max(4096);
export const websiteRegisterWithRecaptchaSchema = z.object({ body: websiteRegisterSchema.shape.body.extend({ recaptchaToken }).strict() });
export const websiteLoginWithRecaptchaSchema = z.object({ body: websiteLoginSchema.shape.body.extend({ recaptchaToken }).strict() });
export const websiteResendSchema = z.object({ body: z.object({ challengeToken: z.string().min(40).max(4096) }).strict() });
export const websiteVerifySchema = z.object({ body: websiteResendSchema.shape.body.extend({ otp: z.string().regex(/^\d{6}$/) }) });
export const websiteForgotPasswordSchema = z.object({ body: z.object({ email, recaptchaToken }).strict() });
export const websiteResetPasswordSchema = z.object({ body: z.object({ email, otp: z.string().regex(/^\d{6}$/), newPassword: password }).strict() });
