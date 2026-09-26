import { prisma } from '../lib/prisma.js';

/** @param {{actorId?: string, action: string, entityType: string, entityId?: string, metadata?: import('@prisma/client').Prisma.InputJsonValue, ipAddress?: string}} input
 * @param {import('@prisma/client').Prisma.TransactionClient} tx */
export function recordAudit({ actorId, action, entityType, entityId, metadata, ipAddress }, tx = prisma) {
  return tx.auditLog.create({ data: { actorId, action, entityType, entityId, metadata, ipAddress } });
}
