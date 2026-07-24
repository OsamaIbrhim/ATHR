import {
  businessDateRange,
  formatBusinessDateTime,
} from './business-time';

describe('business time', () => {
  it('uses Cairo midnight boundaries during daylight-saving time', () => {
    const range = businessDateRange(
      '2026-07-24',
      '2026-07-24',
      'Africa/Cairo',
    );
    expect(range.gte.toISOString()).toBe('2026-07-23T21:00:00.000Z');
    expect(range.lt.toISOString()).toBe('2026-07-24T21:00:00.000Z');
  });

  it('uses Cairo winter offset without hard-coding an offset', () => {
    const range = businessDateRange(
      '2026-01-15',
      '2026-01-15',
      'Africa/Cairo',
    );
    expect(range.gte.toISOString()).toBe('2026-01-14T22:00:00.000Z');
    expect(range.lt.toISOString()).toBe('2026-01-15T22:00:00.000Z');
  });

  it('formats invoice and notification times in the business timezone', () => {
    expect(formatBusinessDateTime(
      '2026-07-23T22:30:00.000Z',
      'en-GB',
      'Africa/Cairo',
    )).toContain('24 Jul 2026');
  });
})
