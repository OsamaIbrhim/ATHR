const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalized (trimmed, lowercased) email address. */
export class EmailAddress {
  private constructor(private readonly normalized: string) {}

  static parse(value: string): EmailAddress {
    const normalized = value.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
      throw new TypeError(`EmailAddress requires a valid email address, got: ${value}`);
    }
    return new EmailAddress(normalized);
  }

  toString(): string {
    return this.normalized;
  }

  equals(other: EmailAddress): boolean {
    return this.normalized === other.normalized;
  }
}

const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

/** E.164-normalized phone number (e.g. `+201012345678`). */
export class PhoneNumber {
  private constructor(private readonly e164: string) {}

  static parse(value: string): PhoneNumber {
    const normalized = value.trim().replace(/[\s()-]/g, '');
    if (!E164_PATTERN.test(normalized)) {
      throw new TypeError(
        `PhoneNumber requires E.164 format (e.g. +201012345678), got: ${value}`,
      );
    }
    return new PhoneNumber(normalized);
  }

  toE164(): string {
    return this.e164;
  }

  equals(other: PhoneNumber): boolean {
    return this.e164 === other.e164;
  }
}
