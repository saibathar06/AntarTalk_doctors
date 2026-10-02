import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { app } from './app.js';
import { processBookingEmails } from './services/bookingEmail.service.js';
import { processPushDeliveries } from './services/notification.service.js';
import { processVideoProvisioning } from './services/video.service.js';
import { processRazorpayRefunds } from './services/razorpay.service.js';
import { processAutomaticSessionCompletion } from './services/bookingLifecycle.service.js';
import { processPrescriptionEmails } from './services/prescription.service.js';

// Redis-backed middleware may begin the lazy connection while modules load; ping
// waits for that same connection without attempting a second connect().
await redis.ping();
const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'AntarTalk API listening'));
let processingEmails = false;
let processingAsyncJobs = false;
async function emailTick() {
  if (processingEmails) return;
  processingEmails = true;
  try { await processBookingEmails(); }
  catch { logger.error('Booking email queue unavailable'); }
  finally { processingEmails = false; }
}
const emailTimer = globalThis.setInterval(() => { void emailTick(); }, 15000);
emailTimer.unref();
void emailTick();
async function asyncJobTick() {
  if (processingAsyncJobs) return;
  processingAsyncJobs = true;
  try {
    const videoJobs = async () => {
      await processVideoProvisioning();
      await processAutomaticSessionCompletion();
    };
    const results = await Promise.allSettled([processPushDeliveries(), videoJobs(), processRazorpayRefunds(), processPrescriptionEmails()]);
    if (results[0].status === 'rejected') logger.error({ errorType: results[0].reason?.name ?? 'Error' }, 'Push notification queue unavailable');
    if (results[1].status === 'rejected') logger.error({ errorType: results[1].reason?.name ?? 'Error' }, 'Video provisioning queue unavailable');
    if (results[2].status === 'rejected') logger.error({ errorType: results[2].reason?.name ?? 'Error' }, 'Refund queue unavailable');
    if (results[3].status === 'rejected') logger.error({ errorType: results[3].reason?.name ?? 'Error' }, 'Prescription email queue unavailable');
  } finally { processingAsyncJobs = false; }
}
const asyncJobTimer = globalThis.setInterval(() => { void asyncJobTick(); }, 15000);
asyncJobTimer.unref();
void asyncJobTick();

async function shutdown(signal) {
  globalThis.clearInterval(emailTimer);
  globalThis.clearInterval(asyncJobTimer);
  logger.info({ signal }, 'Graceful shutdown started');
  server.close(async () => {
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (error) => logger.fatal({ err: error }, 'Unhandled rejection'));
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  shutdown('uncaughtException');
});
