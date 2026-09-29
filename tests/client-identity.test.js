import { describe, expect, it } from 'vitest';
import { clientBookingIdentity } from '../src/services/clientIdentity.service.js';

describe('trusted booking client identity', () => {
  it('derives the booking name and age from the authenticated user profile', () => {
    expect(clientBookingIdentity({ firstName: 'Asha', lastName: 'Rao', dateOfBirth: new Date('2000-10-10') }, new Date('2030-10-09T10:00:00Z')))
      .toEqual({ clientName: 'Asha Rao', clientAge: 29 });
  });

  it('rejects booking when the authenticated client profile is incomplete', () => {
    expect(() => clientBookingIdentity({ firstName: null, lastName: null, dateOfBirth: null }, new Date()))
      .toThrow(expect.objectContaining({ code: 'CLIENT_PROFILE_INCOMPLETE' }));
  });
});
