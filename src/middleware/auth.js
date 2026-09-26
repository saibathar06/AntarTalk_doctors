import { prisma } from '../lib/prisma.js';
import { AppError } from '../errors/AppError.js';
import { verifyAccessToken } from '../utils/tokens.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const authenticateUser = asyncHandler(async (req, _res, next) => {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');

  let claims;
  try {
    claims = verifyAccessToken(header.slice(7));
  } catch {
    throw new AppError(401, 'INVALID_ACCESS_TOKEN', 'The access token is invalid or expired.');
  }
  if (typeof claims !== 'object' || !/^[0-9a-f-]{36}$/i.test(claims.sub ?? '') || !Number.isInteger(claims.tokenVersion)) throw new AppError(401, 'INVALID_ACCESS_TOKEN', 'The access token is invalid or expired.');

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, role: true, tokenVersion: true, accountStatus: true, emailVerifiedAt: true, doctorProfile: { select: { id: true, verificationStatus: true } } }
  });
  if (!user || user.accountStatus !== 'ACTIVE' || !user.emailVerifiedAt || user.tokenVersion !== claims.tokenVersion) {
    throw new AppError(401, 'SESSION_REVOKED', 'This session is no longer valid.');
  }
  req.user = user;
  next();
});

export function requireRole(role) {
  return (req, _res, next) => req.user?.role === role
    ? next()
    : next(new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
}

export const requireDoctor = (req, res, next) => {
  if (req.user?.role === 'DOCTOR' && !req.user.doctorProfile) return next(new AppError(403, 'FORBIDDEN', 'Doctor profile required.'));
  return requireRole('DOCTOR')(req, res, next);
};
export const requireClient = requireRole('CLIENT');

export const requireVerifiedDoctor = (req, _res, next) => {
  if (req.user?.doctorProfile?.verificationStatus !== 'VERIFIED') {
    return next(new AppError(403, 'DOCTOR_NOT_VERIFIED', 'A verified professional account is required.'));
  }
  next();
};
