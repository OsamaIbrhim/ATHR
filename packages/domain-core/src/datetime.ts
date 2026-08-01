const UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Wraps an ISO-8601 UTC instant. Only the `Z`-suffixed form is accepted —
 * naive timestamps (no offset) and local-offset timestamps (`+02:00`) are
 * both rejected, forcing every stored/exchanged instant through a single
 * unambiguous UTC representation (Coding Standards v1.0 §14).
 */
export class UtcTimestamp {
  private constructor(private readonly isoInstant: string) {}

  static fromIso(value: string): UtcTimestamp {
    if (!UTC_INSTANT_PATTERN.test(value)) {
      throw new TypeError(
        `UtcTimestamp requires an explicit UTC (Z-suffixed) ISO-8601 instant, got: ${value}`,
      );
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new TypeError(`UtcTimestamp received an invalid instant: ${value}`);
    }
    return new UtcTimestamp(parsed.toISOString());
  }

  static now(clock: { now(): Date } = { now: () => new Date() }): UtcTimestamp {
    return new UtcTimestamp(clock.now().toISOString());
  }

  toIso(): string {
    return this.isoInstant;
  }

  toDate(): Date {
    return new Date(this.isoInstant);
  }

  isBefore(other: UtcTimestamp): boolean {
    return this.toDate().getTime() < other.toDate().getTime();
  }

  isAfter(other: UtcTimestamp): boolean {
    return this.toDate().getTime() > other.toDate().getTime();
  }

  equals(other: UtcTimestamp): boolean {
    return this.isoInstant === other.isoInstant;
  }
}

function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new RangeError(`BusinessDate requires a valid IANA timezone id, got: ${timezone}`);
  }
}

/**
 * A calendar date (`YYYY-MM-DD`) paired with the IANA timezone it is
 * effective in. Deliberately a distinct type from `UtcTimestamp` so the
 * two can never be silently interchanged (Coding Standards v1.0 §14).
 */
export class BusinessDate {
  private constructor(
    private readonly isoDate: string,
    private readonly timezone: string,
  ) {}

  static of(isoDate: string, timezone: string): BusinessDate {
    const match = CALENDAR_DATE_PATTERN.exec(isoDate);
    if (!match) {
      throw new TypeError(`BusinessDate requires a YYYY-MM-DD date, got: ${isoDate}`);
    }
    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const asDate = new Date(Date.UTC(year, month - 1, day));
    if (
      asDate.getUTCFullYear() !== year ||
      asDate.getUTCMonth() !== month - 1 ||
      asDate.getUTCDate() !== day
    ) {
      throw new RangeError(`BusinessDate received an invalid calendar date: ${isoDate}`);
    }
    assertValidTimezone(timezone);
    return new BusinessDate(isoDate, timezone);
  }

  toIsoDate(): string {
    return this.isoDate;
  }

  getTimezone(): string {
    return this.timezone;
  }

  equals(other: BusinessDate): boolean {
    return this.isoDate === other.isoDate && this.timezone === other.timezone;
  }
}

/**
 * Semantic aliases for the three time roles distinguished by Domain Model
 * DM-GEN-010. Each is structurally a `UtcTimestamp` — these types exist so
 * call sites document *which* instant they hold, not to add behavior.
 */
export type OccurredAt = UtcTimestamp;
export type RecordedAt = UtcTimestamp;
export type EffectiveAt = UtcTimestamp;
