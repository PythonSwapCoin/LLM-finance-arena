import React, { useMemo, useState, useEffect } from 'react';
import type { Agent, ChatState, ChatMessage } from '../types';

interface LiveChatProps {
  chat: ChatState | null;
  agents: Agent[];
  currentRoundId: string;
  onSendMessage: (payload: { username: string; agentId: string; content: string }) => Promise<ChatMessage>;
  className?: string;
  intradayHour?: number;
  simulationMode?: 'simulated' | 'realtime' | 'historical';
}

const LINK_PATTERN = /(https?:\/\/\S+|www\.\S+|[a-z0-9-]+\.[a-z]{2,10}\b)/i;

const formatTimestamp = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// Calculate seconds until next trading round
// Market hours: 9:30 AM - 4:00 PM ET (6.5 hours)
// In simulated mode, we don't know the timing, so return null
const calculateSecondsUntilNextRound = (
  simulationMode: string | undefined,
  intradayHour: number | undefined
): number | null => {
  if (simulationMode !== 'realtime' || intradayHour === undefined) {
    return null;
  }

  // Assuming trading rounds happen every hour in realtime mode
  // intradayHour is 0-6.5 representing hours since market open
  const currentHourFraction = intradayHour % 1; // Get fractional part
  const secondsIntoCurrentHour = currentHourFraction * 3600;
  const secondsUntilNextHour = 3600 - secondsIntoCurrentHour;

  return Math.max(0, Math.floor(secondsUntilNextHour));
};

// Format seconds into MM:SS
const formatCountdown = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Get status badge color and text
const getStatusBadge = (status: string | undefined): { color: string; text: string } | null => {
  if (!status) return null;

  switch (status) {
    case 'pending':
      return { color: 'bg-yellow-100 text-yellow-700', text: 'Pending' };
    case 'delivered':
      return { color: 'bg-blue-100 text-blue-700', text: 'Delivered' };
    case 'responded':
      return { color: 'bg-green-100 text-green-700', text: 'Responded' };
    case 'ignored':
      return { color: 'bg-gray-100 text-gray-600', text: 'Ignored' };
    default:
      return null;
  }
};

export const LiveChat: React.FC<LiveChatProps> = ({
  chat,
  agents,
  currentRoundId,
  onSendMessage,
  className,
  intradayHour,
  simulationMode
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string>(() => agents[0]?.id ?? '');
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (agents.length === 0) {
      setSelectedAgentId('');
      return;
    }
    if (!agents.some(agent => agent.id === selectedAgentId)) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  // Countdown timer effect
  useEffect(() => {
    const initialSeconds = calculateSecondsUntilNextRound(simulationMode, intradayHour);
    setCountdown(initialSeconds);

    if (initialSeconds === null) {
      return;
    }

    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev === null || prev <= 0) {
          // Recalculate when countdown reaches zero
          return calculateSecondsUntilNextRound(simulationMode, intradayHour);
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [simulationMode, intradayHour]);

  const sortedMessages = useMemo(() => {
    if (!chat) {
      return [];
    }
    return [...chat.messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [chat]);

  if (!chat) {
    return (
      <div className={`bg-arena-surface rounded-lg shadow-lg p-3 sm:p-4 ${className ?? ''}`}>
        <h2 className="text-lg font-semibold text-arena-text-primary mb-2">Community Live Chat</h2>
        <p className="text-sm text-arena-text-secondary">Loading chat…</p>
      </div>
    );
  }

  const maxLength = chat.config.maxMessageLength;

  const normalizedName = username.trim().toLowerCase();
  const userMessagesThisRound = chat.messages.filter(messageItem =>
    messageItem.senderType === 'user'
    && messageItem.roundId === currentRoundId
    && normalizedName !== ''
    && messageItem.sender.toLowerCase() === normalizedName
  ).length;
  const remainingForUser = normalizedName ? Math.max(chat.config.maxMessagesPerUser - userMessagesThisRound, 0) : chat.config.maxMessagesPerUser;

  const agentMessagesThisRound = chat.messages.filter(messageItem =>
    messageItem.senderType === 'user'
    && messageItem.roundId === currentRoundId
    && messageItem.agentId === selectedAgentId
  ).length;
  const remainingForAgent = Math.max(chat.config.maxMessagesPerAgent - agentMessagesThisRound, 0);

  const chatDisabled = !chat.config.enabled;
  const noAgentsAvailable = agents.length === 0;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (chatDisabled || noAgentsAvailable) {
      return;
    }

    const trimmedName = username.trim();
    const trimmedMessage = message.trim();

    if (!trimmedName) {
      setError('Please enter your name.');
      return;
    }

    if (!selectedAgentId) {
      setError('Please choose an agent to message.');
      return;
    }

    if (!trimmedMessage) {
      setError('Message cannot be empty.');
      return;
    }

    if (trimmedMessage.length > maxLength) {
      setError(`Messages must be ${maxLength} characters or fewer.`);
      return;
    }

    if (LINK_PATTERN.test(trimmedMessage)) {
      setError('Messages cannot include links or promotional content.');
      return;
    }

    if (remainingForUser <= 0) {
      setError('You have reached the message limit for this round.');
      return;
    }

    if (remainingForAgent <= 0) {
      setError('This agent already has the maximum number of community messages for this round.');
      return;
    }

    setIsSending(true);
    setError(null);
    try {
      await onSendMessage({ username: trimmedName, agentId: selectedAgentId, content: trimmedMessage });
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className={`bg-arena-surface rounded-lg shadow-lg p-3 sm:p-4 flex flex-col ${className ?? ''}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-arena-text-primary">Community Live Chat</h2>
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${chatDisabled ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
          {chatDisabled ? 'Offline' : 'Live'}
        </span>
      </div>

      <div className="flex-1 min-h-[220px] max-h-80 overflow-y-auto space-y-3 pr-1">
        {sortedMessages.length === 0 ? (
          <p className="text-sm text-arena-text-secondary">No messages yet. Be the first to reach out to an agent!</p>
        ) : (
          sortedMessages.map(messageItem => (
            <div
              key={messageItem.id}
              className={`rounded-md border border-arena-border px-3 py-2 ${messageItem.senderType === 'agent' ? 'bg-arena-bg' : 'bg-arena-surface'}`}
            >
              <div className="flex items-center justify-between text-xs text-arena-text-tertiary mb-1">
                <span>{formatTimestamp(messageItem.createdAt)}</span>
                <div className="flex items-center gap-2">
                  {messageItem.senderType === 'user' && messageItem.status && (() => {
                    const badge = getStatusBadge(messageItem.status);
                    return badge ? (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge.color}`}>
                        {badge.text}
                      </span>
                    ) : null;
                  })()}
                  <span>{messageItem.roundId}</span>
                </div>
              </div>
              <div className="text-sm font-semibold text-arena-text-primary">
                {messageItem.senderType === 'user' ? (
                  <>
                    {messageItem.sender}
                    <span className="text-arena-text-tertiary"> → </span>
                    <span>{messageItem.agentName}</span>
                  </>
                ) : (
                  <>
                    {messageItem.sender}
                    <span className="ml-1 text-xs uppercase tracking-wide text-arena-text-tertiary">reply</span>
                  </>
                )}
              </div>
              <p className="text-sm text-arena-text-secondary mt-1 whitespace-pre-wrap break-words">{messageItem.content}</p>
            </div>
          ))
        )}
      </div>

      {countdown !== null && simulationMode === 'realtime' && (
        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
          <div className="flex items-center justify-between">
            <p className="text-sm text-blue-800">
              <span className="font-semibold">Next trading round in:</span>
            </p>
            <span className="text-lg font-bold text-blue-900 tabular-nums">
              {formatCountdown(countdown)}
            </span>
          </div>
          <p className="text-xs text-blue-600 mt-1">
            Your message will be delivered to the agent during the next trading round.
          </p>
        </div>
      )}

      <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col text-sm text-arena-text-secondary">
            <span className="font-medium text-arena-text-primary">Your name</span>
            <input
              type="text"
              value={username}
              onChange={event => setUsername(event.target.value)}
              placeholder="Trader nickname"
              className="mt-1 rounded-md border border-arena-border bg-arena-bg px-3 py-2 text-arena-text-primary focus:outline-none focus:ring-2 focus:ring-arena-border"
              disabled={chatDisabled}
              maxLength={40}
            />
          </label>
          <label className="flex flex-col text-sm text-arena-text-secondary">
            <span className="font-medium text-arena-text-primary">Target agent</span>
            <select
              value={selectedAgentId}
              onChange={event => setSelectedAgentId(event.target.value)}
              className="mt-1 rounded-md border border-arena-border bg-arena-bg px-3 py-2 text-arena-text-primary focus:outline-none focus:ring-2 focus:ring-arena-border"
              disabled={chatDisabled || noAgentsAvailable}
            >
              {agents.map(agent => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col text-sm text-arena-text-secondary">
          <span className="font-medium text-arena-text-primary">Message</span>
          <textarea
            value={message}
            onChange={event => setMessage(event.target.value.slice(0, maxLength))}
            placeholder="Keep it respectful and under 140 characters"
            className="mt-1 h-24 rounded-md border border-arena-border bg-arena-bg px-3 py-2 text-arena-text-primary focus:outline-none focus:ring-2 focus:ring-arena-border resize-none"
            maxLength={maxLength}
            disabled={chatDisabled || noAgentsAvailable}
          />
          <span className="mt-1 text-xs text-arena-text-tertiary">{message.length}/{maxLength} characters</span>
        </label>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-arena-text-tertiary">
          <span>Messages remaining for you this round: {remainingForUser}</span>
          <span>Messages remaining for {selectedAgentId ? agents.find(agent => agent.id === selectedAgentId)?.name ?? 'agent' : 'agent'}: {remainingForAgent}</span>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          type="submit"
          className="w-full sm:w-auto inline-flex justify-center rounded-md bg-arena-accent px-4 py-2 text-sm font-semibold text-white shadow focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-arena-accent disabled:opacity-60"
          disabled={chatDisabled || noAgentsAvailable || isSending}
        >
          {isSending ? 'Sending…' : 'Send message'}
        </button>
      </form>

      {chatDisabled && (
        <p className="mt-3 text-sm text-arena-text-secondary">Live chat is currently disabled by the organizers.</p>
      )}
    </div>
  );
};
