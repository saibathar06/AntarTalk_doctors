import { DateTime } from 'luxon';
import { AppError } from '../errors/AppError.js';

export function clientBookingIdentity(user, appointmentStart) {
  const firstName = String(user?.firstName ?? '').trim();
  const lastName = String(user?.lastName ?? '').trim();
  const birthDate = user?.dateOfBirth instanceof Date
    ? DateTime.fromJSDate(user.dateOfBirth, { zone: 'utc' }).startOf('day')
    : DateTime.invalid('missing date of birth');
  const appointmentDate = DateTime.fromJSDate(appointmentStart, { zone: 'Asia/Kolkata' }).startOf('day');
  if (!firstName || !lastName || !birthDate.isValid) {
    throw new AppError(422, 'CLIENT_PROFILE_INCOMPLETE', 'Complete your client name and date of birth before booking a session.');
  }
  let age = appointmentDate.year - birthDate.year;
  if (appointmentDate.month < birthDate.month || (appointmentDate.month === birthDate.month && appointmentDate.day < birthDate.day)) age -= 1;
  const name = `${firstName} ${lastName}`;
  if (age < 1 || age > 120 || name.length > 200) {
    throw new AppError(422, 'CLIENT_PROFILE_INVALID', 'Your client profile contains invalid booking information.');
  }
  return { clientName: name, clientAge: age };
}
