import { z } from 'zod';
import { uuid } from './common.js';

export const verificationSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({ status: z.enum(['PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED']), reason: z.string().trim().max(500).optional() })
});
