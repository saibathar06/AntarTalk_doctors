import { z } from 'zod';
import { amount, currency, dateOfBirth, email, isoDate, isoDateTime, pagination, password, phone, uuid } from './common.js';

export const updateProfileSchema = z.object({ body: z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  dateOfBirth: dateOfBirth.optional(),
  gender: z.enum(['FEMALE', 'MALE', 'NON_BINARY', 'OTHER', 'PREFER_NOT_TO_SAY']).nullable().optional(),
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
  timezone: z.literal('Asia/Kolkata').optional(),
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
  useDefault: z.boolean().optional(),
  availableDate: z.string().date().optional(),
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  isActive: z.boolean().default(true)
}).refine((value) => value.startTime !== value.endTime, { message: 'Start and end times must differ' });

export const replaceHoursSchema = z.object({ body: z.object({
  timezone: z.literal('Asia/Kolkata'),
  windows: z.array(workingWindow).max(50)
}) });

export const presetsSchema = z.object({ body: z.object({
  presets: z.array(z.object({
    label: z.string().trim().min(1).max(50),
    startTime: workingWindow.shape.startTime,
    endTime: workingWindow.shape.endTime
  }).refine((v) => v.startTime !== v.endTime, 'Start and end times must differ')).max(20)
}).strict() });

export const defaultTimingSchema = z.object({ body: z.object({
  timing: z.object({
    startTime: workingWindow.shape.startTime,
    endTime: workingWindow.shape.endTime
  }).strict().refine((v) => v.startTime !== v.endTime, 'Start and end times must differ').nullable()
}).strict() });

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
const payoutAccountBase = { displayLabel: z.string().trim().min(2).max(120), isDefault: z.boolean().default(false) };
export const payoutAccountSchema = z.object({ body: z.union([
  z.object({ ...payoutAccountBase, type: z.literal('UPI'), upiId: z.string().trim().regex(/^[A-Za-z0-9._-]{2,100}@[A-Za-z0-9.-]{2,100}$/) }).strict(),
  z.object({ ...payoutAccountBase, type: z.literal('BANK_ACCOUNT'), accountHolderName: z.string().trim().min(2).max(120), accountNumber: z.string().regex(/^\d{6,20}$/), ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/) }).strict(),
  z.object({ ...payoutAccountBase, type: z.enum(['UPI', 'BANK_ACCOUNT']), providerToken: z.string().min(8).max(1000) }).strict()
]) });
