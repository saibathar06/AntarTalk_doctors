import { z } from 'zod';
import { dateOfBirth, email, phone } from './common.js';

export const websiteRegisterSchema = z.object({ body: z.object({
  email, phoneNumber: phone, dateOfBirth, licenseNumber: z.string().trim().min(2).max(100),
  professionalCategory: z.enum(['PSYCHIATRIST', 'PSYCHOLOGIST', 'COUNSELLOR']),
  timezone: z.string().min(1).max(64).default('UTC')
}).strict() });
