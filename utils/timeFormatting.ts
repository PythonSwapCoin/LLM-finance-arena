import { getTradingDateFromStart } from '../shared/tradingDays';

export type SimulationMode = 'simulated' | 'realtime' | 'historical';

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

    if (simulationMode === 'historical') {
      // For historical: use actual historical dates while skipping weekends
      const daysToAdd = Math.floor(timestamp);
      const date = getTradingDateFromStart(start, daysToAdd);

      const hourDecimal = timestamp - daysToAdd;
      const hours = Math.floor(hourDecimal * 10);
      const minutes = Math.round((hourDecimal * 10 - hours) * 60);

      if (hours === 0 && minutes === 0) {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
      date.setHours(9 + hours, 30 + minutes, 0, 0); // Market hours start at 9:30
      return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } else if (simulationMode === 'realtime') {
      // For real-time mode: timestamp is a Unix timestamp (milliseconds or seconds since epoch)
      // Check if it's a Unix timestamp (large number) or day-based (small number)
      if (timestamp > 1000000000) {
        // Unix timestamp - detect if milliseconds (13 digits) or seconds (10 digits)
        const timestampMs = timestamp > 10000000000 ? timestamp : timestamp * 1000;
        const date = new Date(timestampMs);
        return date.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
      }
      // Fallback: use day-based format (for backward compatibility)
      // For real-time: use actual current dates/times
      if (currentDate) {
        const current = new Date(currentDate);
        const hourDecimal = intradayHour !== undefined ? intradayHour : (timestamp - Math.floor(timestamp)) * 10;
        const hours = Math.floor(hourDecimal);
        const minutes = Math.round((hourDecimal - hours) * 60);
        current.setHours(9 + hours, 30 + minutes, 0, 0);
        return current.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      }
      // Fallback
      const daysToAdd = Math.floor(timestamp);
      const date = getTradingDateFromStart(start, daysToAdd);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
        const timeStr = simulatedDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        
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
        const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        
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
  if (simulationMode === 'realtime' && timestamp > 1000000000) {
    // Unix timestamp - detect if milliseconds (13 digits) or seconds (10 digits)
    const timestampMs = timestamp > 10000000000 ? timestamp : timestamp * 1000;
    const date = new Date(timestampMs);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  if (simulationMode === 'realtime' && currentDate && intradayHour !== undefined && timestamp < 1000000000) {
    const current = new Date(currentDate);
    const hours = Math.floor(intradayHour);
    const minutes = Math.round((intradayHour - hours) * 60);
    current.setHours(9 + hours, 30 + minutes, 0, 0);
    const dateLabel = current.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const timeLabel = current.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${dateLabel} • ${timeLabel}`;
  }

  const dayIndex = Math.floor(timestamp);
  const hourDecimal = timestamp - dayIndex;
  const hours = Math.floor(hourDecimal * 10);
  const minutes = Math.round((hourDecimal * 10 - hours) * 60);

  if (startDate) {
    const baseDate = getTradingDateFromStart(startDate, dayIndex);
    baseDate.setHours(9 + hours, 30 + minutes, 0, 0);
    const dateLabel = baseDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const timeLabel = baseDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${dateLabel} • ${timeLabel}`;
  }

  const displayDay = dayIndex + 1;
  if (hours === 0 && minutes === 0) {
    return `Day ${displayDay} • 9:30 AM`;
  }

  const timeLabel = formatSimulatedIntradayTime(hours, minutes);
  return `Day ${displayDay} • ${timeLabel}`;
};
