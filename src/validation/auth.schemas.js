import { z } from 'zod';
import { dateOfBirth, email, isoDate, password, phone } from './common.js';

const registration = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  dateOfBirth,
  phoneNumber: phone,
  email,
  password,
  professionalCategory: z.enum(['PSYCHIATRIST', 'PSYCHOLOGIST', 'COUNSELLOR']),
  professionalStatus: z.enum(['LICENSED_PROFESSIONAL', 'FINAL_YEAR_STUDENT']),
  licenseNumber: z.string().trim().min(2).max(100).optional(),
  licenseAuthority: z.string().trim().min(2).max(160).optional(),
  university: z.string().trim().min(2).max(200).optional(),
  course: z.string().trim().min(2).max(200).optional(),
  specialization: z.string().trim().max(200).optional(),
  expectedGraduationDate: isoDate.optional(),
  enrollmentNumber: z.string().trim().min(2).max(100).optional(),
  timezone: z.string().min(1).max(64).default('UTC')
}).superRefine((data, ctx) => {
  const ageCutoff = new Date();
  ageCutoff.setUTCFullYear(ageCutoff.getUTCFullYear() - 18);
  if (data.dateOfBirth > ageCutoff) ctx.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Professional must be at least 18 years old' });
  if (data.professionalStatus === 'LICENSED_PROFESSIONAL' && !data.licenseNumber) {
    ctx.addIssue({ code: 'custom', path: ['licenseNumber'], message: 'License number is required' });
  }
  if (data.professionalStatus === 'FINAL_YEAR_STUDENT') {
    for (const field of ['university', 'course', 'expectedGraduationDate', 'enrollmentNumber']) {
      if (!data[field]) ctx.addIssue({ code: 'custom', path: [field], message: `${field} is required for students` });
    }
    if (data.licenseNumber) ctx.addIssue({ code: 'custom', path: ['licenseNumber'], message: 'Students cannot register as licensed professionals' });
  }
});

export const registerSchema = z.object({ body: registration });
export const verifyOtpSchema = z.object({ body: z.object({ email, otp: z.string().regex(/^\d{6}$/) }) });
export const resendOtpSchema = z.object({ body: z.object({ email, purpose: z.enum(['VERIFY_EMAIL', 'RESET_PASSWORD']).default('VERIFY_EMAIL') }) });
export const loginSchema = z.object({ body: z.object({ email, password: z.string().min(1).max(128) }) });
export const tokenSchema = z.object({ body: z.object({ refreshToken: z.string().min(40) }) });
export const logoutSchema = z.object({ body: z.object({ refreshToken: z.string().min(40).max(256).optional(), allDevices: z.boolean().default(false) }).refine((data) => data.allDevices || Boolean(data.refreshToken), 'Supply refreshToken or allDevices: true') });
export const forgotPasswordSchema = z.object({ body: z.object({ email }) });
export const resetPasswordSchema = z.object({ body: z.object({ email, otp: z.string().regex(/^\d{6}$/), newPassword: password }) });
