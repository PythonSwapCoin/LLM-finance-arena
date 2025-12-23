import { getTradingDateFromStart } from '../shared/tradingDays';
import { formatInMarketTimeZone, isUnixTimestamp, toUnixSeconds } from './marketTime';

export type SimulationMode = 'simulated' | 'realtime' | 'historical' | 'hybrid';

const formatSimulatedIntradayTime = (hours: number, minutes: number): string => {
  const base = new Date(Date.UTC(2000, 0, 1, 9, 30, 0, 0));
  base.setUTCHours(9 + hours, 30 + minutes, 0, 0);
  return base.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

export const formatTimestampToDate = (
  timestamp: number,
  startDate?: string,
  currentDate?: string,
  simulationMode?: SimulationMode,
  day?: number,
  intradayHour?: number,
  compact?: boolean // If true, don't include day prefix for intraday hours (for x-axis labels)
): string => {
  const isUnix = isUnixTimestamp(timestamp);
  if (isUnix) {
    const timestampSeconds = toUnixSeconds(timestamp);
    const date = new Date(timestampSeconds * 1000);
    const dateLabel = formatInMarketTimeZone(date, { month: 'short', day: 'numeric' });
    const timeLabel = formatInMarketTimeZone(date, { hour: 'numeric', minute: '2-digit', hour12: true });
    return compact ? timeLabel : `${dateLabel} ${timeLabel}`;
  }

  if (!startDate) {
    // Fallback to Day X format if no date info
    const dayNum = Math.floor(timestamp);
    const hourDecimal = timestamp - dayNum;
    const hours = Math.floor(hourDecimal * 10);
    const minutes = Math.round((hourDecimal * 10 - hours) * 60);
    if (hours === 0 && minutes === 0) {
      return `Day ${dayNum}`;
    }
    return `D${dayNum} ${hours}:${minutes.toString().padStart(2, '0')}`;
  }

  try {
    const start = new Date(startDate);

    if (simulationMode === 'historical' || simulationMode === 'hybrid') {
      // For historical: use actual historical dates while skipping weekends
      const daysToAdd = Math.floor(timestamp);
      const date = getTradingDateFromStart(start, daysToAdd);

      const hourDecimal = timestamp - daysToAdd;
      const hours = Math.floor(hourDecimal * 10);
      const minutes = Math.round((hourDecimal * 10 - hours) * 60);

      if (hours === 0 && minutes === 0) {
        return formatInMarketTimeZone(date, { month: 'short', day: 'numeric' });
      }
      date.setHours(9 + hours, 30 + minutes, 0, 0); // Market hours start at 9:30
      return formatInMarketTimeZone(date, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } else if (simulationMode === 'realtime') {
      // For real-time mode: use actual current dates/times for day-based fallbacks
      if (currentDate) {
        const current = new Date(currentDate);
        const hourDecimal = intradayHour !== undefined ? intradayHour : (timestamp - Math.floor(timestamp)) * 10;
        const hours = Math.floor(hourDecimal);
        const minutes = Math.round((hourDecimal - hours) * 60);
        current.setHours(9 + hours, 30 + minutes, 0, 0);
        return formatInMarketTimeZone(current, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      }
      const daysToAdd = Math.floor(timestamp);
      const date = getTradingDateFromStart(start, daysToAdd);
      return formatInMarketTimeZone(date, { month: 'short', day: 'numeric' });
    } else {
      // Simulated: use startDate to calculate actual dates, format as "06/Jan"
      const daysToAdd = Math.floor(timestamp);
      const hourDecimal = timestamp - daysToAdd;
      const hours = Math.floor(hourDecimal * 10);
      const minutes = Math.round((hourDecimal * 10 - hours) * 60);

      // Calculate the actual date from startDate
      if (startDate) {
        const simulatedDate = getTradingDateFromStart(startDate, daysToAdd);
        simulatedDate.setHours(9 + hours, 30 + minutes, 0, 0);

        // Format as "06/Jan" style
        const day = simulatedDate.getDate();
        const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'short' });
        const month = monthFormatter.format(simulatedDate);
        const dateLabel = `${day.toString().padStart(2, '0')}/${month}`;

        if (hours === 0 && minutes === 0) {
          return dateLabel;
        }
        
        // Format time as "9:30 AM" style
        const timeStr = formatInMarketTimeZone(simulatedDate, { hour: 'numeric', minute: '2-digit', hour12: true });
        
        // For compact format (x-axis labels), show only time for intraday hours
        if (compact) {
          return timeStr;
        }
        
        // For tooltips and other places, show full "06/Jan 10:30 AM" format
        return `${dateLabel} ${timeStr}`;
      } else {
        // Fallback: show "Day X" format if no startDate
        const displayDay = daysToAdd + 1;
        if (hours === 0 && minutes === 0) {
          return `Day ${displayDay}`;
        }
        
        const date = new Date(Date.UTC(2000, 0, 1, 9 + hours, 30 + minutes, 0, 0));
        const timeStr = formatInMarketTimeZone(date, { hour: 'numeric', minute: '2-digit', hour12: true });
        
        if (compact) {
          return timeStr;
        }
        
        return `Day ${displayDay} ${timeStr}`;
      }
    }
  } catch (error) {
    // Fallback on error
    console.error('Error formatting timestamp:', error);
    const dayNum = Math.floor(timestamp);
    return `Day ${dayNum}`;
  }
};

export const formatTradeTimestamp = (
  timestamp: number,
  startDate?: string,
  currentDate?: string,
  simulationMode?: SimulationMode,
  intradayHour?: number
): string => {
  if (isUnixTimestamp(timestamp)) {
    const timestampSeconds = toUnixSeconds(timestamp);
    const date = new Date(timestampSeconds * 1000);
    return formatInMarketTimeZone(date, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  if (simulationMode === 'realtime' && currentDate && intradayHour !== undefined && !isUnixTimestamp(timestamp)) {
    const current = new Date(currentDate);
    const hours = Math.floor(intradayHour);
    const minutes = Math.round((intradayHour - hours) * 60);
    current.setHours(9 + hours, 30 + minutes, 0, 0);
    const dateLabel = formatInMarketTimeZone(current, { month: 'short', day: 'numeric' });
    const timeLabel = formatInMarketTimeZone(current, { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${dateLabel} at ${timeLabel}`;
  }

  const dayIndex = Math.floor(timestamp);
  const hourDecimal = timestamp - dayIndex;
  const hours = Math.floor(hourDecimal * 10);
  const minutes = Math.round((hourDecimal * 10 - hours) * 60);

  if (startDate) {
    const baseDate = getTradingDateFromStart(startDate, dayIndex);
    baseDate.setHours(9 + hours, 30 + minutes, 0, 0);
    const dateLabel = formatInMarketTimeZone(baseDate, { month: 'short', day: 'numeric' });
    const timeLabel = formatInMarketTimeZone(baseDate, { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${dateLabel} at ${timeLabel}`;
  }

  const displayDay = dayIndex + 1;
  if (hours === 0 && minutes === 0) {
    return `Day ${displayDay} at 9:30 AM`;
  }

  const timeLabel = formatSimulatedIntradayTime(hours, minutes);
  return `Day ${displayDay} at ${timeLabel}`;
};

