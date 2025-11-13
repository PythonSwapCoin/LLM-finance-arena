import React, { useMemo, useState, useEffect } from 'react';
import type { Agent, ChatState, ChatMessage, MessageStatus } from '../types';

interface LiveChatProps {
  chat: ChatState | null;
  agents: Agent[];
  currentRoundId: string;
  onSendMessage: (payload: { username: string; agentId?: string; content: string }) => Promise<ChatMessage>;
  className?: string;
  nextTradeWindowMs?: number; // Milliseconds until next trade window
}

const LINK_PATTERN = /(https?:\/\/\S+|www\.\S+|[a-z0-9-]+\.[a-z]{2,10}\b)/i;
const GENERAL_CHAT_ID = '__general__';

const formatTimestamp = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatCountdown = (ms: number): string => {
  if (ms <= 0) return 'Starting soon...';

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
};

const getStatusBadge = (status?: MessageStatus): { text: string; color: string } => {
  switch (status) {
    case 'pending':
      return { text: 'Waiting to send', color: 'bg-yellow-100 text-yellow-700' };
    case 'sent':
      return { text: 'Sent', color: 'bg-blue-100 text-blue-700' };
    case 'responded':
      return { text: 'Responded', color: 'bg-green-100 text-green-700' };
    case 'ignored':
      return { text: 'Ignored', color: 'bg-gray-100 text-gray-600' };
    default:
      return { text: '', color: '' };
  }
};

export const LiveChat: React.FC<LiveChatProps> = ({
  chat,
  agents,
  currentRoundId,
  onSendMessage,
  className,
  nextTradeWindowMs
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string>(() => agents[0]?.id ?? '');
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [countdown, setCountdown] = useState<number>(nextTradeWindowMs || 0);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    if (agents.length === 0) {
      setSelectedAgentId('');
      return;
    }
    if (!agents.some(agent => agent.id === selectedAgentId) && selectedAgentId !== GENERAL_CHAT_ID) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  // Update countdown timer
  useEffect(() => {
    if (nextTradeWindowMs !== undefined) {
      setCountdown(nextTradeWindowMs);
    }
  }, [nextTradeWindowMs]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

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

  const isGeneralMessage = selectedAgentId === GENERAL_CHAT_ID;
  const agentMessagesThisRound = !isGeneralMessage ? chat.messages.filter(messageItem =>
    messageItem.senderType === 'user'
    && messageItem.roundId === currentRoundId
    && messageItem.agentId === selectedAgentId
  ).length : 0;
  const remainingForAgent = !isGeneralMessage ? Math.max(chat.config.maxMessagesPerAgent - agentMessagesThisRound, 0) : Infinity;

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
      setError('Please choose an agent or general chat.');
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

    if (!isGeneralMessage && remainingForAgent <= 0) {
      setError('This agent already has the maximum number of community messages for this round.');
      return;
    }

    setIsSending(true);
    setError(null);
    try {
      await onSendMessage({
        username: trimmedName,
        agentId: isGeneralMessage ? undefined : selectedAgentId,
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowInfo(!showInfo)}
            className="text-xs text-arena-text-tertiary hover:text-arena-text-primary transition-colors"
            title="How it works"
          >
            ℹ️
          </button>
          <span className={`text-xs font-medium px-2 py-1 rounded-full ${chatDisabled ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
            {chatDisabled ? 'Offline' : 'Live'}
          </span>
        </div>
      </div>

      {showInfo && (
        <div className="mb-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md text-sm">
          <h3 className="font-semibold text-arena-text-primary mb-2">How Community Chat Works</h3>
          <ul className="space-y-1 text-arena-text-secondary text-xs">
            <li>• Messages to agents are delivered during the <strong>next trading round</strong></li>
            <li>• Agents can choose to reply or ignore messages</li>
            <li>• Once a trading round passes, the opportunity to reply is lost</li>
            <li>• General messages are visible to everyone but don't go to agents</li>
            <li>• Next trading round in: <strong>{formatCountdown(countdown)}</strong></li>
          </ul>
        </div>
      )}

      {!showInfo && countdown > 0 && (
        <div className="mb-3 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
          <div className="flex items-center justify-between text-sm">
            <span className="text-arena-text-secondary">Next trading round in:</span>
            <span className="font-mono font-semibold text-arena-text-primary">{formatCountdown(countdown)}</span>
          </div>
          <p className="text-xs text-arena-text-tertiary mt-1">Messages will be delivered to agents then</p>
        </div>
      )}

      <div className="flex-1 min-h-[220px] max-h-80 overflow-y-auto space-y-3 pr-1">
        {sortedMessages.length === 0 ? (
          <p className="text-sm text-arena-text-secondary">No messages yet. Be the first to reach out to an agent!</p>
        ) : (
          sortedMessages.map(messageItem => {
            const statusBadge = messageItem.senderType === 'user' && messageItem.agentId
              ? getStatusBadge(messageItem.status)
              : null;

            return (
              <div
                key={messageItem.id}
                className={`rounded-md border border-arena-border px-3 py-2 ${messageItem.senderType === 'agent' ? 'bg-arena-bg' : 'bg-arena-surface'}`}
              >
                <div className="flex items-center justify-between text-xs text-arena-text-tertiary mb-1">
                  <span>{formatTimestamp(messageItem.createdAt)}</span>
                  <div className="flex items-center gap-2">
                    {statusBadge && (
                      <span className={`px-2 py-0.5 rounded-full font-medium ${statusBadge.color}`}>
                        {statusBadge.text}
                      </span>
                    )}
                    <span>{messageItem.roundId}</span>
                  </div>
                </div>
                <div className="text-sm font-semibold text-arena-text-primary">
                  {messageItem.senderType === 'user' ? (
                    <>
                      {messageItem.sender}
                      {messageItem.agentName && (
                        <>
                          <span className="text-arena-text-tertiary"> → </span>
                          <span>{messageItem.agentName}</span>
                        </>
                      )}
                      {!messageItem.agentName && (
                        <span className="ml-2 text-xs uppercase tracking-wide text-arena-text-tertiary">general</span>
                      )}
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
            );
          })
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
              value={selectedAgentId}
              onChange={event => setSelectedAgentId(event.target.value)}
              className="mt-1 rounded-md border border-arena-border bg-arena-bg px-3 py-2 text-arena-text-primary focus:outline-none focus:ring-2 focus:ring-arena-border"
              disabled={chatDisabled || noAgentsAvailable}
            >
              <option value={GENERAL_CHAT_ID}>General Chat (everyone)</option>
              <optgroup label="Agents">
                {agents.map(agent => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </optgroup>
            </select>
          </label>
        </div>

        <label className="flex flex-col text-sm text-arena-text-secondary">
          <span className="font-medium text-arena-text-primary">Message</span>
          <textarea
            value={message}
            onChange={event => setMessage(event.target.value.slice(0, maxLength))}
            placeholder={isGeneralMessage ? "Share your thoughts with everyone" : "Keep it respectful and under 140 characters"}
            className="mt-1 h-24 rounded-md border border-arena-border bg-arena-bg px-3 py-2 text-arena-text-primary focus:outline-none focus:ring-2 focus:ring-arena-border resize-none"
            maxLength={maxLength}
            disabled={chatDisabled || noAgentsAvailable}
          />
          <span className="mt-1 text-xs text-arena-text-tertiary">{message.length}/{maxLength} characters</span>
        </label>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-arena-text-tertiary">
          <span>Messages remaining for you this round: {remainingForUser}</span>
          {!isGeneralMessage && selectedAgentId && (
            <span>Messages remaining for {agents.find(agent => agent.id === selectedAgentId)?.name ?? 'agent'}: {remainingForAgent}</span>
          )}
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
