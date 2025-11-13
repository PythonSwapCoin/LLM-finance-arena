import { randomUUID } from 'crypto';
import { simulationState } from '../simulation/state.js';
import type { Agent, ChatMessage, ChatState } from '../types.js';
import {
  createRoundId,
  sanitizeUsername,
  sanitizeIncomingContent,
  containsSpamIndicators,
  sanitizeOutgoingMessage,
  cloneChatMessages,
  calculateTargetRoundId,
} from '../utils/chatUtils.js';
import { getSimInterval } from '../simulation/scheduler.js';

interface AddUserMessageInput {
  username: string;
  agentId: string;
  content: string;
}

export interface AgentReplyInput {
  agent: Agent;
  roundId: string;
  reply?: string;
}

export const addUserMessageToChat = (input: AddUserMessageInput): { chat: ChatState; message: ChatMessage } => {
  const snapshot = simulationState.getSnapshot();
  const chat = snapshot.chat;

  if (!chat.config.enabled) {
    throw new Error('Chat is currently disabled.');
  }

  const agent = snapshot.agents.find(a => a.id === input.agentId);
  if (!agent) {
    throw new Error('Agent not found.');
  }

  const username = sanitizeUsername(input.username);
  if (!username) {
    throw new Error('A display name is required to send messages.');
  }

  const sanitizedContent = sanitizeIncomingContent(input.content, chat.config.maxMessageLength);
  if (!sanitizedContent) {
    throw new Error('Message cannot be empty.');
  }

  if (containsSpamIndicators(sanitizedContent)) {
    throw new Error('Messages cannot include links or promotional content.');
  }

  // Calculate the target round for this message, accounting for 1-minute safety buffer
  // If we're too close to the next round, assign to the round after that
  const simulationMode = snapshot.mode;
  const simIntervalMs = getSimInterval();
  const roundId = calculateTargetRoundId(snapshot.day, snapshot.intradayHour, simulationMode, simIntervalMs);

  const userMessagesThisRound = chat.messages.filter(message =>
    message.senderType === 'user'
    && message.roundId === roundId
    && message.sender.toLowerCase() === username.toLowerCase()
  ).length;

  if (userMessagesThisRound >= chat.config.maxMessagesPerUser) {
    throw new Error('You have reached the message limit for this round.');
  }

  const agentMessagesThisRound = chat.messages.filter(message =>
    message.senderType === 'user'
    && message.roundId === roundId
    && message.agentId === agent.id
  ).length;

  if (agentMessagesThisRound >= chat.config.maxMessagesPerAgent) {
    throw new Error('This agent already received the maximum community messages for this round.');
  }

  const message: ChatMessage = {
    id: randomUUID(),
    agentId: agent.id,
    agentName: agent.name,
    sender: username,
    senderType: 'user',
    content: sanitizedContent,
    roundId,
    createdAt: new Date().toISOString(),
    status: 'pending', // Message is pending until delivered to agent
  };

  const updatedChat: ChatState = {
    config: chat.config,
    messages: [...chat.messages, message],
  };

  simulationState.updateSnapshot({ chat: updatedChat });
  return { chat: simulationState.getChat(), message };
};

export const applyAgentRepliesToChat = (
  chat: ChatState,
  replies: AgentReplyInput[],
  roundId?: string,
  allProcessedAgents?: Agent[],
  mode?: 'simulated' | 'realtime' | 'historical'
): ChatState => {
  if (!chat.config.enabled) {
    return chat;
  }

  const updatedMessages = cloneChatMessages(chat.messages);
  let didAppend = false;

  replies.forEach(({ agent, reply, roundId }) => {
    if (!reply || !reply.trim()) {
      return;
    }

    const sanitizedReply = sanitizeOutgoingMessage(reply, chat.config.maxMessageLength);
    if (!sanitizedReply) {
      return;
    }

    // IMPORTANT: Agent can only reply if they received user messages THIS round
    // Find user messages for this agent from THIS specific round
    const userMessages = updatedMessages.filter(message =>
      message.senderType === 'user'
      && message.agentId === agent.id
      && message.roundId === roundId
    );

    // In historical mode, agents generate chat as part of simulation - no user messages required
    // In other modes, agents can only reply if they received user messages this round
    if (mode !== 'historical' && userMessages.length === 0) {
      return;
    }

    // Add @mentions only if there are user messages to respond to
    const uniqueSenders = Array.from(new Set(userMessages.map(message => message.sender)));
    const mentionPrefix = uniqueSenders.length > 0 ? uniqueSenders.map(sender => `@${sender}`).join(' ') : '';
    const prefixWithSpace = mentionPrefix ? `${mentionPrefix} ` : '';
    const availableLength = Math.max(chat.config.maxMessageLength - prefixWithSpace.length, 0);
    const trimmedReply = sanitizedReply.slice(0, availableLength).trim();
    const finalContent = `${prefixWithSpace}${trimmedReply}`.trim();

    if (!finalContent) {
      return;
    }

    const existingIndex = updatedMessages.findIndex(message =>
      message.senderType === 'agent'
      && message.agentId === agent.id
      && message.roundId === roundId
    );

    const message: ChatMessage = {
      id: existingIndex >= 0 ? updatedMessages[existingIndex].id : randomUUID(),
      agentId: agent.id,
      agentName: agent.name,
      sender: agent.name,
      senderType: 'agent',
      content: finalContent,
      roundId,
      createdAt: new Date().toISOString(),
      // Agent messages don't need status tracking
    };

    if (existingIndex >= 0) {
      updatedMessages[existingIndex] = message;
    } else {
      updatedMessages.push(message);
    }

    // Mark the user messages as 'responded'
    userMessages.forEach(userMsg => {
      const msgIndex = updatedMessages.findIndex(m => m.id === userMsg.id);
      if (msgIndex >= 0 && updatedMessages[msgIndex].status === 'delivered') {
        updatedMessages[msgIndex] = {
          ...updatedMessages[msgIndex],
          status: 'responded' as const,
        };
      }
    });

    didAppend = true;
  });

  // Mark any delivered messages that weren't responded to as 'ignored'
  // This happens when agents received messages but chose not to reply
  let didMarkIgnored = false;
  if (roundId && allProcessedAgents) {
    const repliedAgentIds = new Set(replies.filter(r => r.reply && r.reply.trim()).map(r => r.agent.id));
    const allProcessedAgentIds = new Set(allProcessedAgents.map(a => a.id));

    updatedMessages.forEach((message, index) => {
      if (
        message.senderType === 'user' &&
        message.status === 'delivered' &&
        message.roundId === roundId &&
        allProcessedAgentIds.has(message.agentId) &&
        !repliedAgentIds.has(message.agentId)
      ) {
        updatedMessages[index] = {
          ...message,
          status: 'ignored' as const,
        };
        didMarkIgnored = true;
      }
    });
  }

  if (!didAppend && !didMarkIgnored) {
    return chat;
  }

  return {
    config: chat.config,
    messages: updatedMessages,
  };
};
