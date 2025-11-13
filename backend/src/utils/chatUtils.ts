import type { ChatMessage } from '../types.js';

const DOMAIN_PATTERN = /(https?:\/\/\S+|www\.\S+|[a-z0-9-]+\.[a-z]{2,10}\b)/i;
const MAX_USERNAME_LENGTH = 40;

export const createRoundId = (day: number, intradayHour: number): string => {
  const safeHour = Number.isFinite(intradayHour) ? intradayHour : 0;
  return `${day}-${safeHour.toFixed(3)}`;
};

export const sanitizeUsername = (input: string): string => {
  const trimmed = input.trim().replace(/\s+/g, ' ');
  const cleaned = trimmed.replace(/[^a-zA-Z0-9\s_\-\.]/g, '');
  return cleaned.slice(0, MAX_USERNAME_LENGTH);
};

export const sanitizeIncomingContent = (input: string, maxLength: number): string => {
  const normalized = input.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, Math.max(maxLength, 1));
};

export const containsSpamIndicators = (input: string): boolean => {
  return DOMAIN_PATTERN.test(input);
};

export const sanitizeOutgoingMessage = (input: string, maxLength: number): string => {
  if (!input) {
    return '';
  }
  let sanitized = input.replace(/\s+/g, ' ').trim();
  sanitized = sanitized.replace(/https?:\/\/\S+/gi, '');
  sanitized = sanitized.replace(/www\.\S+/gi, '');
  sanitized = sanitized.replace(/[a-z0-9-]+\.[a-z]{2,10}\b/gi, '');
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength).trim();
  }
  return sanitized;
};

export const cloneChatMessages = (messages: ChatMessage[]): ChatMessage[] => {
  return messages.map(message => ({ ...message }));
};

/**
 * Calculate the target round ID for a new message, accounting for the 1-minute safety buffer.
 * If there's less than 60 seconds until the next round, skip to the round after that.
 *
 * @param day - Current simulation day
 * @param intradayHour - Current intraday hour (0-6.5)
 * @param simulationMode - Current simulation mode ('realtime', 'simulated', or 'historical')
 * @param simIntervalMs - Simulation interval in milliseconds
 * @returns The round ID where the message should be delivered
 */
export const calculateTargetRoundId = (
  day: number,
  intradayHour: number,
  simulationMode: string | undefined,
  simIntervalMs: number | undefined
): string => {
  const SAFETY_BUFFER_SECONDS = 60; // 1 minute safety buffer

  if (simulationMode === 'realtime') {
    // For realtime: trading rounds happen every hour
    const currentHourFraction = intradayHour % 1; // Get fractional part
    const secondsIntoCurrentHour = currentHourFraction * 3600;
    const secondsUntilNextHour = 3600 - secondsIntoCurrentHour;

    // If less than 60 seconds until next round, assign to the round after next
    if (secondsUntilNextHour <= SAFETY_BUFFER_SECONDS) {
      // Calculate the hour that's 2 rounds away
      const nextNextHour = Math.ceil(intradayHour) + 1;

      // Handle day rollover (if nextNextHour >= 7, it's the next day)
      if (nextNextHour >= 7) {
        return createRoundId(day + 1, 0);
      }

      return createRoundId(day, nextNextHour);
    }

    // Otherwise, assign to the next round
    const nextHour = Math.ceil(intradayHour);

    // Handle day rollover
    if (nextHour >= 7) {
      return createRoundId(day + 1, 0);
    }

    return createRoundId(day, nextHour);
  }

  // For simulated/historical mode
  if (simIntervalMs !== undefined) {
    const intervalSeconds = Math.floor(simIntervalMs / 1000);

    // If the interval is less than or equal to the safety buffer, assign to next-next round
    if (intervalSeconds <= SAFETY_BUFFER_SECONDS) {
      // For simulated mode, we need to calculate what the intraday hour will be after 2 intervals
      const minutesPerInterval = intervalSeconds / 60;
      const hoursPerInterval = minutesPerInterval / 60;
      const nextNextHour = intradayHour + (hoursPerInterval * 2);

      // Handle day rollover
      if (nextNextHour >= 6.5) {
        const overflow = nextNextHour - 6.5;
        return createRoundId(day + 1, overflow);
      }

      return createRoundId(day, nextNextHour);
    }
  }

  // Default: assign to current round (this maintains backward compatibility)
  return createRoundId(day, intradayHour);
};
