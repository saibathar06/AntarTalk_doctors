import { Prisma } from '@prisma/client';
import { AppError } from '../errors/AppError.js';
import { logger } from '../lib/logger.js';

export function notFound(req, _res, next) {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `No route exists for ${req.method} ${req.path}.`));
}

export function errorHandler(error, req, res, _next) {
  if (error.type === 'entity.parse.failed') error = new AppError(400, 'INVALID_JSON', 'Malformed JSON request.');
  if (error.type === 'entity.too.large') error = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds the allowed size.');
  if (error.code === 'P2034') error = new AppError(409, 'RETRY_REQUIRED', 'Concurrent update. Retry with the same idempotency key.');
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      error = new AppError(409, 'RESOURCE_CONFLICT', 'A record with these unique values already exists.');
    } else if (error.code === 'P2025') {
      error = new AppError(404, 'RESOURCE_NOT_FOUND', 'The requested record does not exist.');
    }
  }

  const known = error instanceof AppError;
  if (!known) logger.error({ errorType: error.name, errorCode: error.code, requestId: req.id }, 'Unhandled request error');
  const status = known ? error.status : 500;
  res.status(status).json({
    success: false,
    error: {
      code: known ? error.code : 'INTERNAL_SERVER_ERROR',
      message: known ? error.message : 'An unexpected error occurred.',
      ...(known && error.details ? { details: error.details } : {})
    }
  });
}
