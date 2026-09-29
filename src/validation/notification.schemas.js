import { z } from 'zod';
import { pagination, uuid } from './common.js';

export const registerDeviceSchema = z.object({ body: z.object({
  token: z.string().trim().min(20).max(300).regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/, 'Use an Expo push token.'),
  platform: z.enum(['IOS', 'ANDROID'])
}).strict() });
export const deviceIdSchema = z.object({ params: z.object({ id: uuid }) });
export const notificationIdSchema = z.object({ params: z.object({ id: uuid }) });
export const notificationListSchema = z.object({ query: z.object({ ...pagination, unreadOnly: z.enum(['true', 'false']).default('false').transform((v) => v === 'true') }) });
