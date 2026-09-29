import { Injectable } from '@nestjs/common';
import { AthrDomainError } from '../common/http/athr-exception.filter';

const WINDOW_MS = 60 * 60 * 1000;
const MAX_SIGNUPS_PER_WINDOW = 5;
const MAX_TRACKED_KEYS = 10_000;

/** Simple in-process limit on public signups per client address. */
@Injectable()
export class SignupRateLimiter {
  private readonly hits = new Map<string, number[]>();

  /** Records an attempt; throws once `key` has made too many within the window. */
  check(key: string, now = Date.now()): void {
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
    if (recent.length >= MAX_SIGNUPS_PER_WINDOW) {
      throw new AthrDomainError(
        'SIGNUP_RATE_LIMITED',
        'Too many signup attempts. Try again later.',
        undefined,
        { httpStatus: 429, messageAr: 'محاولات تسجيل كثيرة. حاول لاحقاً.' },
      );
    }
    if (this.hits.size >= MAX_TRACKED_KEYS) this.hits.delete(this.hits.keys().next().value!);
    this.hits.set(key, [...recent, now]);
  }
}
