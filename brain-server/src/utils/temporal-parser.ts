export type TemporalPrecision = 'day' | 'week' | 'month' | 'year';

export interface TemporalParseOptions {
  reference?: Date;
  timezone?: string;
}

export interface ParsedTemporalExpression {
  start: string;
  end: string;
  precision: TemporalPrecision;
  confidence: number;
  temporalSource: 'explicit_date' | 'relative_expression' | 'relative_expression_unknown_timezone';
  timezone?: string;
  originalText: string;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function validCalendarDate(date: CalendarDate): boolean {
  const candidate = new Date(Date.UTC(date.year, date.month - 1, date.day));
  return candidate.getUTCFullYear() === date.year
    && candidate.getUTCMonth() === date.month - 1
    && candidate.getUTCDate() === date.day;
}

function calendarDateInZone(date: Date, timezone?: string): CalendarDate | null {
  if (!timezone) {
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    return { year: value('year'), month: value('month'), day: value('day') };
  } catch {
    return null;
  }
}

function timezoneOffsetMs(at: Date, timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    const representedAsUtc = Date.UTC(
      value('year'), value('month') - 1, value('day'),
      value('hour'), value('minute'), value('second'),
    );
    return representedAsUtc - Math.floor(at.getTime() / 1000) * 1000;
  } catch {
    return null;
  }
}

function localMidnight(date: CalendarDate, timezone?: string): Date | null {
  const naiveUtc = Date.UTC(date.year, date.month - 1, date.day);
  if (!timezone) return new Date(naiveUtc);
  let candidate = new Date(naiveUtc);
  for (let attempt = 0; attempt < 3; attempt++) {
    const offset = timezoneOffsetMs(candidate, timezone);
    if (offset == null) return null;
    const adjusted = new Date(naiveUtc - offset);
    if (adjusted.getTime() === candidate.getTime()) return adjusted;
    candidate = adjusted;
  }
  return candidate;
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function makeRange(
  startDate: CalendarDate,
  endDate: CalendarDate,
  precision: TemporalPrecision,
  originalText: string,
  timezone: string | undefined,
  explicit: boolean,
): ParsedTemporalExpression | null {
  const start = localMidnight(startDate, timezone);
  const end = localMidnight(endDate, timezone);
  if (!start || !end) return null;
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    precision,
    confidence: explicit ? 1 : timezone ? 0.9 : 0.6,
    temporalSource: explicit
      ? 'explicit_date'
      : timezone
        ? 'relative_expression'
        : 'relative_expression_unknown_timezone',
    timezone,
    originalText,
  };
}

export function parseTemporalExpression(
  text: string,
  options: TemporalParseOptions = {},
): ParsedTemporalExpression | null {
  const originalText = text.trim();
  if (!originalText) return null;
  const normalized = originalText.toLowerCase();
  const reference = options.reference || new Date();
  if (!Number.isFinite(reference.getTime())) return null;
  const today = calendarDateInZone(reference, options.timezone);
  if (!today) return null;

  const explicit = normalized.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/)
    || normalized.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (explicit) {
    const date = { year: Number(explicit[1]), month: Number(explicit[2]), day: Number(explicit[3]) };
    if (!validCalendarDate(date)) return null;
    return makeRange(date, addCalendarDays(date, 1), 'day', originalText, options.timezone, true);
  }

  let relativeDays: number | null = null;
  if (/前天|day before yesterday/.test(normalized)) relativeDays = -2;
  else if (/昨[天日]|\byesterday\b/.test(normalized)) relativeDays = -1;
  else if (/今[天日]|\btoday\b/.test(normalized)) relativeDays = 0;
  else if (/明[天日]|\btomorrow\b/.test(normalized)) relativeDays = 1;
  else if (/后天|day after tomorrow/.test(normalized)) relativeDays = 2;
  else {
    const ago = normalized.match(/(\d{1,4})\s*(?:天前|days?\s+ago)/);
    const ahead = normalized.match(/(?:未来|接下来)\s*(\d{1,4})\s*天|in\s+(\d{1,4})\s+days?/);
    if (ago) relativeDays = -Math.min(Number(ago[1]), 3660);
    else if (ahead) relativeDays = Math.min(Number(ahead[1] || ahead[2]), 3660);
  }
  if (relativeDays != null) {
    const start = addCalendarDays(today, relativeDays);
    return makeRange(start, addCalendarDays(start, 1), 'day', originalText, options.timezone, false);
  }

  let weekOffset: number | null = null;
  if (/上周|上星期|\blast week\b/.test(normalized)) weekOffset = -1;
  else if (/本周|这周|这个星期|\bthis week\b/.test(normalized)) weekOffset = 0;
  else if (/下周|下星期|\bnext week\b/.test(normalized)) weekOffset = 1;
  if (weekOffset != null) {
    const weekday = (new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay() + 6) % 7;
    const start = addCalendarDays(today, -weekday + weekOffset * 7);
    return makeRange(start, addCalendarDays(start, 7), 'week', originalText, options.timezone, false);
  }

  return null;
}
