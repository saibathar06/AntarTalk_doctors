import { prisma } from '../lib/prisma.js';
import { AppError } from '../errors/AppError.js';

export async function lockUser(tx, userId) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user || user.accountStatus !== 'ACTIVE') throw new AppError(401, 'SESSION_REVOKED', 'This session is no longer valid.');
  return user;
}

export async function serialTransaction(work) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: 'Serializable', timeout: 5000, maxWait: 3000 });
    } catch (error) {
      // A concurrent idempotency insert may surface as a uniqueness error rather
      // than SSI failure. Retrying the whole rolled-back transaction sees its result.
      if (!['P2034', 'P2002'].includes(error.code) || attempt >= 2) throw error;
    }
  }
}

export async function lockDoctor(tx, doctorId) {
  await tx.$queryRaw`SELECT id FROM "DoctorProfile" WHERE id = ${doctorId}::uuid FOR UPDATE`;
}
