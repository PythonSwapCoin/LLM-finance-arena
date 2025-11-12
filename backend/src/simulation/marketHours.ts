// Market hours and holiday checking
// Converts to America/New_York (ET) timezone for accurate market hours

export interface MarketHoursConfig {
  timezone?: string;
  openHour?: number;
  openMinute?: number;
  closeHour?: number;
  closeMinute?: number;
}

const DEFAULT_CONFIG: Required<MarketHoursConfig> = {
  timezone: 'America/New_York',
  openHour: 9,
  openMinute: 30, // Market opens at 9:30 AM ET
  closeHour: 16,
  closeMinute: 0, // Market closes at 4:00 PM ET
};

// Convert a date to ET timezone
// ET is UTC-5 (EST) or UTC-4 (EDT) depending on DST
const toET = (date: Date): { hour: number; minute: number; dayOfWeek: number; month: number; day: number } => {
  // Get UTC time
  const utc = new Date(date.toISOString());
  
  // ET offset: EST is UTC-5, EDT is UTC-4
  // DST starts 2nd Sunday in March, ends 1st Sunday in November
  const year = utc.getUTCFullYear();
  
  // Find DST start (2nd Sunday in March)
  const march1 = new Date(Date.UTC(year, 2, 1));
  const march1Day = march1.getUTCDay();
  const dstStart = new Date(Date.UTC(year, 2, (8 - march1Day) % 7 + 8)); // 2nd Sunday
  
  // Find DST end (1st Sunday in November)
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const nov1Day = nov1.getUTCDay();
  const dstEnd = new Date(Date.UTC(year, 10, (8 - nov1Day) % 7 + 1)); // 1st Sunday
  
  // Check if date is in DST period
  const isDST = utc >= dstStart && utc < dstEnd;
  const etOffset = isDST ? -4 : -5; // EDT is UTC-4, EST is UTC-5
  
  // Convert to ET
  const etTime = new Date(utc.getTime() + (etOffset * 60 * 60 * 1000));
  
  return {
    hour: etTime.getUTCHours(),
    minute: etTime.getUTCMinutes(),
    dayOfWeek: etTime.getUTCDay(),
    month: etTime.getUTCMonth(),
    day: etTime.getUTCDate(),
  };
};

// Simple holiday check (can be expanded)
const isHoliday = (etTime: { month: number; day: number; dayOfWeek: number }): boolean => {
  const { month, day, dayOfWeek } = etTime;
  
  // Weekend
  if (dayOfWeek === 0 || dayOfWeek === 6) return true;
  
  // New Year's Day
  if (month === 0 && day === 1) return true;
  // Independence Day
  if (month === 6 && day === 4) return true;
  // Christmas
  if (month === 11 && day === 25) return true;
  
  return false;
};

export const isMarketOpen = (date: Date = new Date(), config: MarketHoursConfig = {}): boolean => {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  // Convert to ET time
  const et = toET(date);
  
  // Check if holiday/weekend
  if (isHoliday(et)) {
    return false;
  }
  
  // Check market hours (9:30 AM - 4:00 PM ET)
  const currentTimeMinutes = et.hour * 60 + et.minute;
  const openTimeMinutes = cfg.openHour * 60 + cfg.openMinute;
  const closeTimeMinutes = cfg.closeHour * 60 + cfg.closeMinute;
  
  return currentTimeMinutes >= openTimeMinutes && currentTimeMinutes < closeTimeMinutes;
};

// Get current ET time as a Date object (for display/logging)
// Returns a Date object where the UTC components represent ET time
export const getETTime = (date: Date = new Date()): Date => {
  const utc = new Date(date.toISOString());
  const year = utc.getUTCFullYear();
  
  // Find DST start (2nd Sunday in March)
  const march1 = new Date(Date.UTC(year, 2, 1));
  const march1Day = march1.getUTCDay();
  const dstStart = new Date(Date.UTC(year, 2, (8 - march1Day) % 7 + 8));
  
  // Find DST end (1st Sunday in November)
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const nov1Day = nov1.getUTCDay();
  const dstEnd = new Date(Date.UTC(year, 10, (8 - nov1Day) % 7 + 1));
  
  const isDST = utc >= dstStart && utc < dstEnd;
  const etOffsetHours = isDST ? -4 : -5;
  
  // Create a new date with ET offset applied
  // We'll store ET time as UTC for easier manipulation
  const etMilliseconds = utc.getTime() + (etOffsetHours * 60 * 60 * 1000);
  return new Date(etMilliseconds);
};

export const getNextMarketOpen = (date: Date = new Date(), config: MarketHoursConfig = {}): Date => {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const next = new Date(date);
  
  // If it's a weekend, move to Monday
  const dayOfWeek = next.getDay();
  if (dayOfWeek === 0) {
    next.setDate(next.getDate() + 1);
  } else if (dayOfWeek === 6) {
    next.setDate(next.getDate() + 2);
  }
  
  // Set to market open time
  next.setHours(cfg.openHour, 0, 0, 0);
  
  // If already past market open today, move to next day
  const etTime = toET(next);
  if (date.getHours() >= cfg.closeHour || isHoliday(etTime)) {
    next.setDate(next.getDate() + 1);
    // Skip weekends and holidays
    let nextEtTime = toET(next);
    while (isHoliday(nextEtTime) || nextEtTime.dayOfWeek === 0 || nextEtTime.dayOfWeek === 6) {
      next.setDate(next.getDate() + 1);
      nextEtTime = toET(next);
    }
  }
  
  return next;
};

