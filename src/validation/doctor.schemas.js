import { z } from 'zod';
import { amount, currency, dateOfBirth, email, isoDate, isoDateTime, pagination, password, phone, uuid } from './common.js';

export const updateProfileSchema = z.object({ body: z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  dateOfBirth: dateOfBirth.optional(),
  phoneNumber: phone.optional(),
  professionalCategory: z.enum(['PSYCHIATRIST', 'PSYCHOLOGIST', 'COUNSELLOR']).optional(),
  professionalStatus: z.enum(['LICENSED_PROFESSIONAL', 'FINAL_YEAR_STUDENT']).optional(),
  licenseNumber: z.string().trim().min(2).max(100).nullable().optional(),
  licenseAuthority: z.string().trim().min(2).max(160).nullable().optional(),
  university: z.string().trim().min(2).max(200).nullable().optional(),
  course: z.string().trim().min(2).max(200).nullable().optional(),
  specialization: z.string().trim().max(200).nullable().optional(),
  expectedGraduationDate: isoDate.nullable().optional(),
  enrollmentNumber: z.string().trim().min(2).max(100).nullable().optional(),
  timezone: z.string().min(1).max(64).optional(),
  bio: z.string().trim().max(2000).nullable().optional(),
  qualification: z.string().trim().min(2).max(200).nullable().optional(),
  institution: z.string().trim().min(2).max(200).nullable().optional(),
  graduationYear: z.number().int().min(1900).max(2200).nullable().optional(),
  experienceYears: z.number().int().min(0).max(80).nullable().optional(),
  languages: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  preferredSessionLanguage: z.string().trim().min(1).max(80).nullable().optional(),
  expertise: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  consultationFee: amount.nullable().optional(),
  emailNotifications: z.boolean().optional(),
  isAcceptingBookings: z.boolean().optional(),
  email: email.optional(),
  currentPassword: z.string().min(1).max(128).optional()
}).strict()
  .refine((body) => Object.keys(body).some((key) => key !== 'currentPassword'), 'At least one profile field is required')
  .refine((body) => !body.email || Boolean(body.currentPassword), { message: 'Current password is required to change email', path: ['currentPassword'] }) });

const workingWindow = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  isActive: z.boolean().default(true)
}).refine((value) => value.startTime !== value.endTime, { message: 'Start and end times must differ' });

export const replaceHoursSchema = z.object({ body: z.object({
  timezone: z.string().min(1).max(64),
  windows: z.array(workingWindow).max(50)
}) });

export const createBlockedSlotSchema = z.object({ body: z.object({
  startTime: isoDateTime,
  endTime: isoDateTime,
  reason: z.string().trim().max(500).optional()
}).refine((value) => value.startTime < value.endTime, { message: 'endTime must be after startTime', path: ['endTime'] }) });

export const blockedIdSchema = z.object({ params: z.object({ id: uuid }) });
export const changePasswordSchema = z.object({ body: z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password
}) });
export const sessionListSchema = z.object({ query: z.object({ ...pagination, status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']).optional() }) });

export const payoutListSchema = z.object({ query: z.object({ ...pagination }) });
export const withdrawSchema = z.object({
  headers: z.object({ 'idempotency-key': z.string().min(8).max(128) }).passthrough(),
  body: z.object({ amount, currency, payoutAccountId: uuid }).strict()
});
export const payoutAccountSchema = z.object({ body: z.object({
  type: z.enum(['BANK_ACCOUNT', 'UPI']),
  displayLabel: z.string().trim().min(2).max(120),
  providerToken: z.string().min(8).max(1000),
  isDefault: z.boolean().default(false)
}) });
