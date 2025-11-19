export const isWeekend = (date: Date, timeZone?: string): boolean => {
  try {
    if (timeZone) {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'long'
      });
      const weekday = formatter.format(date).toLowerCase();
      return weekday === 'saturday' || weekday === 'sunday';
    }
    const dayOfWeek = date.getUTCDay();
    return dayOfWeek === 0 || dayOfWeek === 6;
  } catch {
    const dayOfWeek = date.getUTCDay();
    return dayOfWeek === 0 || dayOfWeek === 6;
  }
};

export const getNextTradingDay = (date: Date, timeZone?: string): Date => {
  const nextDay = new Date(date);
  nextDay.setHours(0, 0, 0, 0);
  do {
    nextDay.setDate(nextDay.getDate() + 1);
  } while (isWeekend(nextDay, timeZone));
  return nextDay;
};

const normalizeToMidnight = (date: Date): Date => {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
};

export const addTradingDays = (startDate: Date, tradingDays: number, timeZone?: string): Date => {
  const result = normalizeToMidnight(startDate);
  if (tradingDays === 0) {
    return result;
  }

  const direction = tradingDays > 0 ? 1 : -1;
  let remaining = Math.abs(tradingDays);

  while (remaining > 0) {
    result.setDate(result.getDate() + direction);
    if (!isWeekend(result, timeZone)) {
      remaining -= 1;
    }
  }

  return result;
};

export const getTradingDayIndexForDate = (startDate: Date, targetDate: Date, timeZone?: string): number => {
  const start = normalizeToMidnight(startDate);
  const target = normalizeToMidnight(targetDate);

  if (target < start) {
    return -1;
  }

  let index = 0;
  const cursor = new Date(start);
  while (cursor < target) {
    cursor.setDate(cursor.getDate() + 1);
    if (!isWeekend(cursor, timeZone)) {
      index += 1;
    }
  }

  return index;
};
