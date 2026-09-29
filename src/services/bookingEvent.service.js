import crypto from 'node:crypto';
import { enqueueBookingEventNotifications } from './notification.service.js';

export async function enqueueBookingEvent(tx, booking, doctor, kind, eventData = {}, audiences = ['CLIENT', 'DOCTOR'], eventKey = crypto.randomUUID()) {
  await tx.bookingEmail.createMany({
    data: audiences.map((audience) => ({ bookingId: booking.id, audience, kind, eventKey, eventData }))
  });
  await enqueueBookingEventNotifications(tx, booking, doctor, kind, eventData, audiences);
}
