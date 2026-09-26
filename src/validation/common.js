import { z } from 'zod';

export const uuid = z.string().uuid();
export const email = z.string().trim().email().max(320).transform((value) => value.toLowerCase());
export const password = z.string().min(10).max(128)
  .regex(/[a-z]/, 'Must include a lowercase letter')
  .regex(/[A-Z]/, 'Must include an uppercase letter')
  .regex(/[0-9]/, 'Must include a number');
export const phone = z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Use E.164 format, for example +919876543210');
export const isoDate = z.string().date().transform((value) => new Date(`${value}T00:00:00.000Z`));
export const dateOfBirth = isoDate.refine((date) => {
  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 18);
  return date <= cutoff && date.getUTCFullYear() >= 1900;
}, 'Professional must be at least 18 and born after 1899');
export const isoDateTime = z.string().datetime({ offset: true }).transform((value) => new Date(value));
export const pagination = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
};
export const currency = z.string().transform((v) => v.toUpperCase()).refine(
  (v) => /^[A-Z]{3}$/.test(v) && !['XXX', 'XTS'].includes(v) && Intl.supportedValuesOf('currency').includes(v),
  'Use a recognized currency code'
);
export const amount = z.union([z.number(), z.string().regex(/^\d+(?:\.\d{1,2})?$/)])
  .transform((v) => Number(v)).pipe(z.number().finite().positive().max(10000000))
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-7, 'Use at most two decimal places');
