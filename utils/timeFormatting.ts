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
  intradayHour?: number
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
      // For historical: use actual historical dates
      const daysToAdd = Math.floor(timestamp);
      const date = new Date(start);
      date.setDate(start.getDate() + daysToAdd);

      const hourDecimal = timestamp - daysToAdd;
      const hours = Math.floor(hourDecimal * 10);
      const minutes = Math.round((hourDecimal * 10 - hours) * 60);

      if (hours === 0 && minutes === 0) {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
      date.setHours(9 + hours, 30 + minutes, 0, 0); // Market hours start at 9:30
      return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } else if (simulationMode === 'realtime') {
      // For real-time mode: timestamp is a Unix timestamp (seconds since epoch)
      // Check if it's a Unix timestamp (large number, > 1000000000) or day-based (small number)
      if (timestamp > 1000000000) {
        // Unix timestamp (seconds) - convert directly to date
        const date = new Date(timestamp * 1000); // Convert seconds to milliseconds
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
      const date = new Date(start);
      date.setDate(start.getDate() + daysToAdd);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else {
      // Simulated: generate dates from start date
      const daysToAdd = Math.floor(timestamp);
      const date = new Date(start);
      date.setDate(start.getDate() + daysToAdd);

      const hourDecimal = timestamp - daysToAdd;
      const hours = Math.floor(hourDecimal * 10);
      const minutes = Math.round((hourDecimal * 10 - hours) * 60);

      if (hours === 0 && minutes === 0) {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
      date.setHours(9 + hours, 30 + minutes, 0, 0);
      return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
    const date = new Date(timestamp * 1000);
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
    const baseDate = new Date(startDate);
    baseDate.setDate(baseDate.getDate() + dayIndex);
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
