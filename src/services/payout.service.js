import { Prisma } from '@prisma/client';
import { AppError } from '../errors/AppError.js';
import { prisma } from '../lib/prisma.js';
import { stableHash } from '../utils/crypto.js';
import { recordAudit } from './audit.service.js';
import { lockUser, lockDoctor, serialTransaction } from './transaction.service.js';
import { encryptProviderToken } from '../utils/encryption.js';
import { reversedAmount } from './earnings.service.js';

const money = (value) => value.toFixed(2);
const jsonSafe = (value) => JSON.parse(JSON.stringify(value));

async function balances(doctorId, currency, tx = prisma) {
  const [earned, withdrawn, reversed] = await Promise.all([
    tx.earning.aggregate({ where: { doctorId, currency, status: 'AVAILABLE' }, _sum: { amount: true } }),
    tx.payoutTransaction.aggregate({ where: { doctorId, currency, status: { in: ['PENDING', 'PROCESSING', 'COMPLETED'] } }, _sum: { amount: true } }),
    reversedAmount(doctorId, currency, tx)
  ]);
  const earnedAmount = (earned._sum.amount ?? new Prisma.Decimal(0)).minus(reversed._sum.amount ?? new Prisma.Decimal(0));
  const withdrawnAmount = withdrawn._sum.amount ?? new Prisma.Decimal(0);
  return { earned: earnedAmount, withdrawn: withdrawnAmount, available: earnedAmount.minus(withdrawnAmount) };
}

export async function earningsSummary(doctorId) {
  const currencies = await prisma.earning.findMany({ where: { doctorId }, distinct: ['currency'], select: { currency: true } });
  return Promise.all(currencies.map(async ({ currency }) => {
    const balance = await balances(doctorId, currency);
    return { currency, earned: money(balance.earned), withdrawn: money(balance.withdrawn), available: money(balance.available) };
  }));
}

export async function earningTransactions(doctorId, { page, limit }) {
  const where = { doctorId };
  const [items, total] = await Promise.all([
    prisma.earning.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.earning.count({ where })
  ]);
  return { items: jsonSafe(items), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function listPayouts(doctorId, { page, limit }) {
  const where = { doctorId };
  const [items, total] = await Promise.all([
    prisma.payoutTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit, include: { payoutAccount: { select: { id: true, type: true, displayLabel: true } } } }),
    prisma.payoutTransaction.count({ where })
  ]);
  return { items: jsonSafe(items), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export function listPayoutAccounts(doctorId) {
  return prisma.payoutAccount.findMany({ where: { doctorId }, select: { id: true, type: true, displayLabel: true, isDefault: true, createdAt: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] });
}

export async function createPayoutAccount(userId, doctorId, input, context = {}) {
  return serialTransaction(async (tx) => {
    await lockUser(tx, userId);
    await lockDoctor(tx, doctorId);
    const doctor = await tx.doctorProfile.findUnique({ where: { id: doctorId } });
    if (!doctor || doctor.userId !== userId || doctor.verificationStatus !== 'VERIFIED') throw new AppError(403, 'DOCTOR_NOT_VERIFIED', 'A verified professional account is required.');
    if (input.isDefault) await tx.payoutAccount.updateMany({ where: { doctorId }, data: { isDefault: false } });
    // providerToken must be an opaque token from a future PCI/bank-data provider; raw account details are never accepted.
    const account = await tx.payoutAccount.create({ data: {
      doctorId, type: input.type, displayLabel: input.displayLabel,
      encryptedProviderDetails: encryptProviderToken(input.providerToken), isDefault: input.isDefault
    }, select: { id: true, type: true, displayLabel: true, isDefault: true, createdAt: true } });
    await recordAudit({ actorId: userId, action: 'PAYOUT_ACCOUNT_CREATED', entityType: 'PayoutAccount', entityId: account.id, ipAddress: context.ip }, tx);
    return account;
  });
}

export async function withdraw(userId, doctorId, input, idempotencyKey, context = {}) {
  const requestHash = stableHash(input);
  const existing = await prisma.idempotencyRecord.findUnique({ where: { userId_scope_key: { userId, scope: 'PAYOUT_WITHDRAW', key: idempotencyKey } } });
  if (existing) {
    if (existing.requestHash !== requestHash) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was used for a different request.');
    return existing.responseBody;
  }
  try {
    return await serialTransaction(async (tx) => {
      await lockUser(tx, userId);
      await lockDoctor(tx, doctorId);
      const doctor = await tx.doctorProfile.findUnique({ where: { id: doctorId } });
      if (!doctor || doctor.userId !== userId || doctor.verificationStatus !== 'VERIFIED') throw new AppError(403, 'DOCTOR_NOT_VERIFIED', 'A verified professional account is required.');
      const replay = await tx.idempotencyRecord.findUnique({ where: { userId_scope_key: { userId, scope: 'PAYOUT_WITHDRAW', key: idempotencyKey } } });
      if (replay) {
        if (replay.requestHash !== requestHash) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This key was used for another request.');
        return replay.responseBody;
      }
      const account = await tx.payoutAccount.findFirst({ where: { id: input.payoutAccountId, doctorId } });
      if (!account) throw new AppError(404, 'PAYOUT_ACCOUNT_NOT_FOUND', 'Payout account not found.');
      const balance = await balances(doctorId, input.currency, tx);
      const requested = new Prisma.Decimal(input.amount);
      if (requested.greaterThan(balance.available)) throw new AppError(422, 'INSUFFICIENT_EARNINGS', 'The withdrawal amount exceeds the available balance.');
      const payout = await tx.payoutTransaction.create({ data: {
        doctorId, payoutAccountId: account.id, amount: requested, currency: input.currency, status: 'PENDING'
      } });
      const response = jsonSafe(payout);
      await tx.idempotencyRecord.create({ data: {
        userId, scope: 'PAYOUT_WITHDRAW', key: idempotencyKey, requestHash,
        responseCode: 201, responseBody: response, resourceId: payout.id,
        expiresAt: new Date(Date.now() + 30 * 86_400_000)
      } });
      await recordAudit({ actorId: userId, action: 'PAYOUT_REQUESTED', entityType: 'PayoutTransaction', entityId: payout.id, metadata: { amount: money(requested), currency: input.currency }, ipAddress: context.ip }, tx);
      return response;
    });
  } catch (error) {
    if (error.code === 'P2034') throw new AppError(409, 'PAYOUT_RETRY_REQUIRED', 'The balance changed while processing. Retry with the same idempotency key.');
    throw error;
  }
}

// Provider implementations will consume PENDING records and transition them through PROCESSING to a terminal state.
export class PayoutProvider {
  async submit(_payout) { throw new Error('Payout provider is not configured'); }
}
