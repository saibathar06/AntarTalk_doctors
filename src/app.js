import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { AppError } from './errors/AppError.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimits.js';
import { adminRouter } from './routes/admin.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { bookingRouter } from './routes/booking.routes.js';
import { doctorRouter } from './routes/doctor.routes.js';
import { doctorAuthRouter } from './routes/doctorAuth.routes.js';
import { asyncHandler } from './utils/asyncHandler.js';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY ? env.TRUST_PROXY.split(',').map((v) => v.trim()) : false);
app.use((req, res, next) => {
  const supplied = req.get('x-request-id');
  req.id = supplied && /^[a-zA-Z0-9_-]{1,64}$/.test(supplied) ? supplied : crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  next();
});
app.use(pinoHttp({ logger, genReqId: (req) => req.id, serializers: {
  req: (req) => ({ id: req.id, method: req.method }),
  res: (res) => ({ statusCode: res.statusCode }),
  err: (err) => ({ type: err.type, code: err.code })
} }));
app.use(helmet({ contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'data:', 'blob:'] } } }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new AppError(403, 'CORS_ORIGIN_DENIED', 'This origin is not allowed.'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id']
}));
app.use(compression());
app.use(express.json({ limit: '32kb' }));
app.get('/health/live', (_req, res) => res.json({ success: true, data: { status: 'ok' } }));
app.get('/health/ready', asyncHandler(async (_req, res) => {
  try { await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]); }
  catch { throw new AppError(503, 'NOT_READY', 'Service is not ready.'); }
  res.json({ success: true, data: { status: 'ready' } });
}));
app.use(apiLimiter);

app.use('/api/auth', authRouter);
app.use('/api/doctor/auth', doctorAuthRouter);
app.use('/api/doctor', doctorRouter);
app.use('/api/bookings', bookingRouter);
// Singular alias preserves the requested POST /api/booking/confirm contract.
app.use('/api/booking', bookingRouter);
app.use('/api/admin', adminRouter);

const webRoot = fileURLToPath(new URL('../web/dist/', import.meta.url));
app.use('/assets', express.static(path.join(webRoot, 'assets'), { immutable: true, maxAge: '1y' }));
app.get(['/doctor', '/doctor/{*route}'], (_req, res, next) => res.sendFile(path.join(webRoot, 'index.html'), (error) => { if (error) next(error); }));

app.use(notFound);
app.use(errorHandler);
