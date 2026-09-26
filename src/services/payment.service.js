import { AppError } from '../errors/AppError.js';

// Fields are populated only by a trusted order/pricing integration, never public DTOs.
export function validatePayment(payment, clientId, slot) {
  if (!payment || payment.clientId !== clientId || payment.status !== 'SUCCEEDED') {
    throw new AppError(422, 'PAYMENT_NOT_CONFIRMED', 'A successful payment belonging to this user is required.');
  }
  if (payment.booking) throw new AppError(409, 'PAYMENT_ALREADY_USED', 'This payment has already funded a booking.');
  if (payment.doctorId !== slot.doctorId || payment.slotStart?.getTime() !== slot.startTime.getTime() ||
      payment.slotEnd?.getTime() !== slot.endTime.getTime() || !payment.expectedAmount ||
      !payment.amount.equals(payment.expectedAmount) || payment.currency !== payment.expectedCurrency ||
      payment.doctorEarning == null || payment.doctorEarning.isNegative() || payment.doctorEarning.greaterThan(payment.amount)) {
    throw new AppError(422, 'PAYMENT_ORDER_MISMATCH', 'Payment does not match a trusted priced appointment order.');
  }
}
