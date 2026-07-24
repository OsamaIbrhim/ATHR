import { BadRequestException } from '@nestjs/common';

export const BUSINESS_TIME_ZONE =
  process.env.BUSINESS_TIME_ZONE || 'Africa/Cairo';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  const representedUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second,
  );
  return representedUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function localMidnightUtc(
  year: number,
  month: number,
  day: number,
  timeZone = BUSINESS_TIME_ZONE,
) {
  const localAsUtc = Date.UTC(year, month - 1, day);
  let result = new Date(localAsUtc - timeZoneOffsetMs(new Date(localAsUtc), timeZone));
  result = new Date(localAsUtc - timeZoneOffsetMs(result, timeZone));
  return result;
}

function parseDateOnly(value: string) {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) return null;
  return { year, month, day };
}

export function businessDateRange(
  from: string,
  to: string,
  timeZone = BUSINESS_TIME_ZONE,
) {
  const fromDate = parseDateOnly(from);
  const toDate = parseDateOnly(to);
  if (fromDate && toDate) {
    const next = new Date(Date.UTC(toDate.year, toDate.month - 1, toDate.day));
    next.setUTCDate(next.getUTCDate() + 1);
    const gte = localMidnightUtc(
      fromDate.year,
      fromDate.month,
      fromDate.day,
      timeZone,
    );
    const lt = localMidnightUtc(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      timeZone,
    );
    if (gte >= lt) throw new BadRequestException('Report start must be before report end');
    return { gte, lt };
  }

  const gte = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(gte.getTime()) || Number.isNaN(end.getTime())) {
    throw new BadRequestException('Invalid report date range');
  }
  end.setMilliseconds(end.getMilliseconds() + 1);
  if (gte >= end) throw new BadRequestException('Report start must be before report end');
  return { gte, lt: end };
}

export function formatBusinessDateTime(
  value: Date | string | number,
  locale = 'ar-EG',
  timeZone = BUSINESS_TIME_ZONE,
) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}
