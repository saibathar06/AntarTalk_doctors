import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { AppError } from '../errors/AppError.js';
import { prisma } from '../lib/prisma.js';
import { stableHash } from '../utils/crypto.js';
import { recordAudit } from './audit.service.js';
import { lockUser, lockDoctor, serialTransaction } from './transaction.service.js';
import { decryptProviderToken, encryptProviderToken } from '../utils/encryption.js';
import { reversedAmount } from './earnings.service.js';

const money = (value) => value.toFixed(2);
const jsonSafe = (value) => JSON.parse(JSON.stringify(value));
function payoutDestination(encrypted) {
  try {
    const details = JSON.parse(decryptProviderToken(encrypted));
    if (details.type === 'UPI' && details.upiId || details.type === 'BANK_ACCOUNT' && details.accountHolderName && details.accountNumber && details.ifsc) return details;
  } catch (error) {
    if (error instanceof AppError && error.code === 'PAYOUT_CONFIGURATION_REQUIRED') throw error;
  }
  throw new AppError(422, 'PAYOUT_ACCOUNT_UPDATE_REQUIRED', 'This payout account needs a valid UPI ID or bank account before transfer.');
}

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
    const accountDetails = input.type === 'UPI' && input.upiId
      ? { type: 'UPI', upiId: input.upiId }
      : input.type === 'BANK_ACCOUNT' && input.accountNumber
        ? { type: 'BANK_ACCOUNT', accountHolderName: input.accountHolderName, accountNumber: input.accountNumber, ifsc: input.ifsc }
        : { type: 'LEGACY_TOKEN', providerToken: input.providerToken };
    const account = await tx.payoutAccount.create({ data: {
      doctorId, type: input.type, displayLabel: input.displayLabel,
      encryptedProviderDetails: encryptProviderToken(JSON.stringify(accountDetails)), isDefault: input.isDefault
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
  if (input.currency !== 'INR') throw new AppError(422, 'PAYOUT_CURRENCY_UNSUPPORTED', 'Withdrawals currently support INR only.');
  if (new Prisma.Decimal(input.amount).lessThan(500)) throw new AppError(422, 'PAYOUT_MINIMUM_NOT_MET', 'The minimum withdrawal amount is ₹500.');
  if (DateTime.fromJSDate(context.now ?? new Date(), { zone: 'Asia/Kolkata' }).weekday !== 2) {
    throw new AppError(422, 'PAYOUT_DAY_RESTRICTED', 'Withdrawal requests can be submitted on Tuesday in India Standard Time.');
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
      payoutDestination(account.encryptedProviderDetails);
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

const payoutAdminInclude = {
  doctor: { select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } } },
  payoutAccount: { select: { id: true, type: true, displayLabel: true } }
};

export async function listPayoutRequests({ page, limit, status }) {
  const where = status ? { status } : { status: 'PENDING' };
  const [items, total] = await Promise.all([
    prisma.payoutTransaction.findMany({ where, include: payoutAdminInclude, orderBy: { createdAt: 'asc' }, skip: (page - 1) * limit, take: limit }),
    prisma.payoutTransaction.count({ where })
  ]);
  return { items: jsonSafe(items.map(({ doctor, ...item }) => ({ ...item, doctor: { ...doctor, email: doctor.user.email, user: undefined } }))), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function getPayoutRequest(id) {
  const payout = await prisma.payoutTransaction.findUnique({ where: { id }, include: {
    doctor: { select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } } },
    payoutAccount: true
  } });
  if (!payout) throw new AppError(404, 'PAYOUT_NOT_FOUND', 'Payout request not found.');
  let accountDetails;
  try { accountDetails = payoutDestination(payout.payoutAccount.encryptedProviderDetails); }
  catch (error) {
    if (error.code !== 'PAYOUT_ACCOUNT_UPDATE_REQUIRED') throw error;
    accountDetails = { type: 'UNAVAILABLE' };
  }
  const { encryptedProviderDetails: _encryptedProviderDetails, ...account } = payout.payoutAccount;
  return jsonSafe({ ...payout, doctor: { id: payout.doctor.id, firstName: payout.doctor.firstName, lastName: payout.doctor.lastName, email: payout.doctor.user.email }, payoutAccount: { ...account, details: accountDetails } });
}

export async function reviewPayout(adminId, payoutId, { decision, reason }, context = {}) {
  return serialTransaction(async (tx) => {
    const admin = await lockUser(tx, adminId);
    if (admin.role !== 'ADMIN') throw new AppError(403, 'FORBIDDEN', 'Administrator access is required.');
    const existing = await tx.payoutTransaction.findUnique({ where: { id: payoutId }, select: { doctorId: true, payoutAccountId: true } });
    if (!existing) throw new AppError(404, 'PAYOUT_NOT_FOUND', 'Payout request not found.');
    await lockDoctor(tx, existing.doctorId);
    if (decision === 'APPROVE') {
      const account = await tx.payoutAccount.findUnique({ where: { id: existing.payoutAccountId }, select: { encryptedProviderDetails: true } });
      if (!account) throw new AppError(422, 'PAYOUT_ACCOUNT_UPDATE_REQUIRED', 'This payout account is no longer available.');
      payoutDestination(account.encryptedProviderDetails);
    }
    const changed = await tx.payoutTransaction.updateMany({ where: { id: payoutId, status: 'PENDING' }, data: {
      status: decision === 'APPROVE' ? 'PROCESSING' : 'CANCELLED',
      failureReason: decision === 'REJECT' ? reason : null
    } });
    if (changed.count !== 1) throw new AppError(409, 'PAYOUT_REQUEST_CHANGED', 'This payout request has already been reviewed.');
    await recordAudit({ actorId: adminId, action: decision === 'APPROVE' ? 'PAYOUT_APPROVED' : 'PAYOUT_REJECTED', entityType: 'PayoutTransaction', entityId: payoutId, metadata: decision === 'REJECT' ? { reason } : undefined, ipAddress: context.ip }, tx);
    return tx.payoutTransaction.findUnique({ where: { id: payoutId }, include: payoutAdminInclude });
  });
}

export async function completePayout(adminId, payoutId, providerReference, context = {}) {
  return serialTransaction(async (tx) => {
    const admin = await lockUser(tx, adminId);
    if (admin.role !== 'ADMIN') throw new AppError(403, 'FORBIDDEN', 'Administrator access is required.');
    const existing = await tx.payoutTransaction.findUnique({ where: { id: payoutId }, select: { doctorId: true } });
    if (!existing) throw new AppError(404, 'PAYOUT_NOT_FOUND', 'Payout request not found.');
    await lockDoctor(tx, existing.doctorId);
    const changed = await tx.payoutTransaction.updateMany({ where: { id: payoutId, status: 'PROCESSING' }, data: { status: 'COMPLETED', completedAt: new Date(), providerReference } });
    if (changed.count !== 1) throw new AppError(409, 'PAYOUT_REQUEST_CHANGED', 'This payout is not awaiting transfer confirmation.');
    await recordAudit({ actorId: adminId, action: 'PAYOUT_TRANSFER_RECORDED', entityType: 'PayoutTransaction', entityId: payoutId, metadata: { providerReference }, ipAddress: context.ip }, tx);
    return tx.payoutTransaction.findUnique({ where: { id: payoutId }, include: payoutAdminInclude });
  });
}

// Provider implementations will consume PENDING records and transition them through PROCESSING to a terminal state.
export class PayoutProvider {
  async submit(_payout) { throw new Error('Payout provider is not configured'); }
}
