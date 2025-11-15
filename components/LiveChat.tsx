import React, { useMemo, useState, useEffect } from 'react';
import type { Agent, ChatState, ChatMessage, SimulationMode } from '../types';
import { formatCountdownMessage } from '../utils/chatCountdown';
import { apiClient } from '../services/apiClient';

interface LiveChatProps {
  chat: ChatState | null;
  agents: Agent[];
  currentRoundId: string;
  onSendMessage: (payload: { username: string; agentId: string; content: string }) => Promise<ChatMessage>;
  simulationMode: SimulationMode;
  intradayHour: number;
  className?: string;
}

const LINK_PATTERN = /(https?:\/\/\S+|www\.\S+|[a-z0-9-]+\.[a-z]{2,10}\b)/i;

const formatTimestamp = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
  simulationMode,
  intradayHour,
  className
}) => {
  // Single state for target: "general" or agent ID
  const [targetId, setTargetId] = useState<string>('general');
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);
  const [nextTradeWindowTimestamp, setNextTradeWindowTimestamp] = useState<number | null>(null);

  // Fetch timer from server and update countdown
  useEffect(() => {
    if (!chat?.config.enabled) {
      setCountdownSeconds(null);
      setNextTradeWindowTimestamp(null);
      return;
    }

    // Fetch timer from server
    const fetchTimer = async () => {
      try {
        const timer = await apiClient.getTimer();
        setNextTradeWindowTimestamp(timer.nextTradeWindowTimestamp);
        setCountdownSeconds(timer.countdownSeconds);
      } catch (error) {
        console.error('Failed to fetch timer:', error);
        // Fallback to client-side calculation if server fails
        const { calculateNextChatDelivery } = await import('../utils/chatCountdown');
        const result = calculateNextChatDelivery(intradayHour, simulationMode);
        setCountdownSeconds(result.totalSeconds);
      }
    };

    fetchTimer();

    // Update countdown every second using server timestamp
    let lastServerSync = Date.now();
    const interval = setInterval(() => {
      if (nextTradeWindowTimestamp !== null) {
        const now = Date.now();
        const secondsUntilNext = Math.max(0, Math.floor((nextTradeWindowTimestamp - now) / 1000));
        setCountdownSeconds(secondsUntilNext);

        // Refresh timer from server every 30 seconds to stay in sync
        if (now - lastServerSync > 30000) {
          lastServerSync = now;
          fetchTimer().catch(console.error);
        }
      } else {
        // Fallback: decrement if we don't have server timestamp
        setCountdownSeconds((prev) => {
          if (prev === null || prev <= 0) {
            fetchTimer().catch(console.error);
            return prev;
          }
          return prev - 1;
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [chat?.config.enabled, intradayHour, simulationMode]);

  useEffect(() => {
    if (agents.length === 0) {
      setTargetId('general');
      return;
    }
    // If targetId is set to an agent that no longer exists, reset to general chat
    if (targetId !== 'general' && !agents.some(agent => agent.id === targetId)) {
      setTargetId('general');
    }
  }, [agents, targetId]);

  const sortedMessages = useMemo(() => {
    if (!chat) {
      return [];
    }
    // Sort by createdAt, then by id for stability (ensures messages don't disappear/reorder)
    return [...chat.messages].sort((a, b) => {
      const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }
      // If timestamps are equal, sort by id to ensure stable ordering
      return a.id.localeCompare(b.id);
    });
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

  const isGeneralChat = targetId === 'general';
  const selectedAgent = agents.find(a => a.id === targetId);
  
  const agentMessagesThisRound = !isGeneralChat ? chat.messages.filter(messageItem =>
    messageItem.senderType === 'user'
    && messageItem.roundId === currentRoundId
    && messageItem.agentId === targetId
  ).length : 0;
  const remainingForAgent = !isGeneralChat ? Math.max(chat.config.maxMessagesPerAgent - agentMessagesThisRound, 0) : 0;

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

    if (!isGeneralChat) {
      if (!targetId || !selectedAgent) {
        setError('Please select a valid recipient.');
        return;
      }
      if (remainingForAgent <= 0) {
        setError('This agent already has the maximum number of community messages for this round.');
        return;
      }
    }

    setIsSending(true);
    setError(null);
    try {
      await onSendMessage({ 
        username: trimmedName, 
        agentId: isGeneralChat ? undefined : targetId, 
        content: trimmedMessage 
      });
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

      {/* Countdown Timer */}
      {!chatDisabled && countdownSeconds !== null && (
        <div className="mb-3 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-md">
          <p className="text-xs text-blue-400 font-medium">
            {formatCountdownMessage(countdownSeconds)}
          </p>
        </div>
      )}

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
                  messageItem.agentId ? (
                    <>
                      {messageItem.sender}
                      <span className="text-arena-text-tertiary"> → </span>
                      <span>{messageItem.agentName}</span>
                    </>
                  ) : (
                    <>
                      {messageItem.sender}
                      <span className="ml-1 text-xs uppercase tracking-wide text-arena-text-tertiary">general chat</span>
                    </>
                  )
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
            <span className="font-medium text-arena-text-primary">Send to</span>
            <select
              value={targetId}
              onChange={event => setTargetId(event.target.value)}
              className="mt-1 rounded-md border border-arena-border bg-arena-bg px-3 py-2 text-arena-text-primary focus:outline-none focus:ring-2 focus:ring-arena-border"
              disabled={chatDisabled || noAgentsAvailable}
            >
              <option value="general">General Chat</option>
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
          {!isGeneralChat && selectedAgent && (
            <span>Messages remaining for {selectedAgent.name}: {remainingForAgent}</span>
          )}
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          type="submit"
          className="w-full sm:w-auto inline-flex justify-center items-center rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 px-6 py-2.5 text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600 disabled:hover:shadow-md"
          disabled={chatDisabled || noAgentsAvailable || isSending}
        >
          {isSending ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Sending…
            </>
          ) : (
            'Send Message'
          )}
        </button>
      </form>

      {chatDisabled && (
        <p className="mt-3 text-sm text-arena-text-secondary">Live chat is currently disabled by the organizers.</p>
      )}
    </div>
  );
};
