export const isWeekendDate = (date: Date): boolean => {
  const day = date.getDay();
  return day === 0 || day === 6;
};

/**
 * Aligns the provided date to the nearest trading day going forward.
 * If the provided date already falls on a weekday, it's returned unchanged.
 */
export const alignToNextTradingDay = (date: Date): Date => {
  const aligned = new Date(date);
  while (isWeekendDate(aligned)) {
    aligned.setDate(aligned.getDate() + 1);
  }
  return aligned;
};

/**
 * Adds (or subtracts) trading days from a given date while skipping weekends.
 */
export const addTradingDays = (date: Date, tradingDays: number): Date => {
  const result = new Date(date);
  if (tradingDays === 0) {
    return result;
  }

  const step = tradingDays > 0 ? 1 : -1;
  let remaining = Math.abs(tradingDays);

  while (remaining > 0) {
    result.setDate(result.getDate() + step);
    if (!isWeekendDate(result)) {
      remaining -= 1;
    }
  }

  return result;
};

/**
 * Returns the calendar date that corresponds to a trading-day offset from the provided start date.
 * Trading days skip weekends so a day offset of 5 from a Monday lands on the following Monday.
 */
export const getTradingDateFromStart = (startDate: string | Date, tradingDayOffset: number): Date => {
  const start = typeof startDate === 'string' ? new Date(startDate) : new Date(startDate);
  if (Number.isNaN(start.getTime())) {
    throw new Error('Invalid start date provided');
  }

  const alignedStart = alignToNextTradingDay(start);
  if (tradingDayOffset === 0) {
    return new Date(alignedStart);
  }

  return addTradingDays(alignedStart, tradingDayOffset);
};
