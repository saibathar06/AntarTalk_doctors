import { describe, expect, it } from 'vitest';
import { IANAZone } from 'luxon';
import { parseTimeToDate, timeParts } from '../src/utils/time.js';

describe('schedule time helpers', () => {
  it('round-trips local wall-clock time stored in a PostgreSQL TIME field', () => {
    expect(timeParts(parseTimeToDate('23:30'))).toEqual({ hour: 23, minute: 30 });
  });

  it('uses IANA timezone data', () => {
    expect(IANAZone.isValidZone('Asia/Kolkata')).toBe(true);
    expect(IANAZone.isValidZone('not/a-zone')).toBe(false);
  });
});
