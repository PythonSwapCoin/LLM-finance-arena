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
} from '../utils/chatUtils.js';

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

  const roundId = createRoundId(snapshot.day, snapshot.intradayHour);

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
  };

  const updatedChat: ChatState = {
    config: chat.config,
    messages: [...chat.messages, message],
  };

  simulationState.updateSnapshot({ chat: updatedChat });
  return { chat: simulationState.getChat(), message };
};

export const applyAgentRepliesToChat = (chat: ChatState, replies: AgentReplyInput[]): ChatState => {
  if (!chat.config.enabled) {
    return chat;
  }

  if (replies.length === 0) {
    return chat;
  }

  const updatedMessages = cloneChatMessages(chat.messages);
  let didAppend = false;

  replies.forEach(({ agent, reply, roundId }) => {
    if (!reply || !reply.trim()) {
      return;
    }

    const userMessages = updatedMessages.filter(message =>
      message.senderType === 'user'
      && message.agentId === agent.id
      && message.roundId === roundId
    );

    if (userMessages.length === 0) {
      return;
    }

    const sanitizedReply = sanitizeOutgoingMessage(reply, chat.config.maxMessageLength);
    if (!sanitizedReply) {
      return;
    }

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
    };

    if (existingIndex >= 0) {
      updatedMessages[existingIndex] = message;
    } else {
      updatedMessages.push(message);
    }
    didAppend = true;
  });

  if (!didAppend) {
    return chat;
  }

  return {
    config: chat.config,
    messages: updatedMessages,
  };
};
