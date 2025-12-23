export const MARKET_TIMEZONE = 'America/New_York';
export const MARKET_OPEN_MINUTES = 9 * 60 + 30;
export const MARKET_CLOSE_MINUTES = 16 * 60;

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

type EtParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

export const isUnixTimestamp = (timestamp: number): boolean => timestamp >= 1_000_000_000;

export const toUnixSeconds = (timestamp: number): number =>
  timestamp > 1_000_000_000_000 ? Math.floor(timestamp / 1000) : Math.floor(timestamp);

export const formatInMarketTimeZone = (date: Date, options: Intl.DateTimeFormatOptions): string => {
  try {
    return date.toLocaleString('en-US', { timeZone: MARKET_TIMEZONE, ...options });
  } catch {
    return date.toLocaleString('en-US', options);
  }
};

export const getEtParts = (date: Date): EtParts => {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: MARKET_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const getPart = (type: string) => parts.find(part => part.type === type)?.value ?? '0';
    const weekdayLabel = new Intl.DateTimeFormat('en-US', {
      timeZone: MARKET_TIMEZONE,
      weekday: 'short',
    })
      .format(date)
      .toLowerCase()
      .slice(0, 3);

    return {
      year: Number.parseInt(getPart('year'), 10),
      month: Number.parseInt(getPart('month'), 10),
      day: Number.parseInt(getPart('day'), 10),
      hour: Number.parseInt(getPart('hour'), 10),
      minute: Number.parseInt(getPart('minute'), 10),
      weekday: WEEKDAY_INDEX[weekdayLabel] ?? date.getUTCDay(),
    };
  } catch {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      weekday: date.getUTCDay(),
    };
  }
};

export const getEtDayKey = (date: Date): string => {
  const parts = getEtParts(date);
  const month = parts.month.toString().padStart(2, '0');
  const day = parts.day.toString().padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
};

export const getEtMinutes = (date: Date): number => {
  const parts = getEtParts(date);
  return parts.hour * 60 + parts.minute;
};

export const isWeekendEt = (date: Date): boolean => {
  const weekday = getEtParts(date).weekday;
  return weekday === 0 || weekday === 6;
};

export const isWithinMarketHoursSeconds = (timestampSeconds: number): boolean => {
  const date = new Date(timestampSeconds * 1000);
  if (isWeekendEt(date)) {
    return false;
  }
  const minutes = getEtMinutes(date);
  return minutes >= MARKET_OPEN_MINUTES && minutes <= MARKET_CLOSE_MINUTES;
};

const alignToNextTradingDay = (date: Date): Date => {
  const aligned = new Date(date);
  while (isWeekendEt(aligned)) {
    aligned.setUTCDate(aligned.getUTCDate() + 1);
  }
  return aligned;
};

const addTradingDaysUtc = (startDate: Date, tradingDays: number): Date => {
  const result = new Date(startDate);
  if (tradingDays === 0) {
    return result;
  }

  const step = tradingDays > 0 ? 1 : -1;
  let remaining = Math.abs(tradingDays);

  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + step);
    if (!isWeekendEt(result)) {
      remaining -= 1;
    }
  }

  return result;
};

export const normalizeTimestampToUnixSeconds = (timestamp: number, startDate?: string): number | null => {
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  if (isUnixTimestamp(timestamp)) {
    return toUnixSeconds(timestamp);
  }

  if (!startDate) {
    return null;
  }

  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) {
    return timestamp;
  }

  const alignedStart = alignToNextTradingDay(start);
  const dayNumber = Math.floor(timestamp);
  const rawIntradayHour = (timestamp - dayNumber) * 10;
  const intradayHour = Math.max(0, Math.min(6.5, rawIntradayHour));
  const minutesToAdd = Math.round(intradayHour * 60);

  const tradingDate = addTradingDaysUtc(alignedStart, dayNumber);
  tradingDate.setUTCHours(alignedStart.getUTCHours(), alignedStart.getUTCMinutes(), 0, 0);
  tradingDate.setUTCMinutes(tradingDate.getUTCMinutes() + minutesToAdd);

  return Math.floor(tradingDate.getTime() / 1000);
};

export const formatEtDate = (date: Date): string =>
  formatInMarketTimeZone(date, { month: 'short', day: 'numeric' });

export const formatEtTime = (date: Date): string =>
  formatInMarketTimeZone(date, { hour: '2-digit', minute: '2-digit', hour12: false });
