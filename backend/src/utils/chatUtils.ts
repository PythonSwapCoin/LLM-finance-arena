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
