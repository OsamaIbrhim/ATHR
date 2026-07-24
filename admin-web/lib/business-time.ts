export const BUSINESS_TIME_ZONE =
  process.env.NEXT_PUBLIC_BUSINESS_TIME_ZONE || 'Africa/Cairo'

type DateParts = { year: number; month: number; day: number }

export function businessDateParts(
  value: Date = new Date(),
  timeZone = BUSINESS_TIME_ZONE,
): DateParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const values = Object.fromEntries(
    parts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]),
  )
  return { year: values.year, month: values.month, day: values.day }
}

export function businessDate(
  value: Date = new Date(),
  timeZone = BUSINESS_TIME_ZONE,
) {
  const { year, month, day } = businessDateParts(value, timeZone)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function businessMonthRange(
  value: Date = new Date(),
  timeZone = BUSINESS_TIME_ZONE,
) {
  const { year, month } = businessDateParts(value, timeZone)
  return {
    from: `${year}-${String(month).padStart(2, '0')}-01`,
    to: businessDate(value, timeZone),
  }
}
