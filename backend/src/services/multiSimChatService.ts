import { simulationManager } from '../simulation/SimulationManager.js';
import type { ChatMessage, ChatState } from '../types.js';
import { randomUUID } from 'crypto';
import { logger, LogLevel, LogCategory } from './logger.js';
import {
  sanitizeUsername,
  sanitizeIncomingContent,
  containsSpamIndicators,
  sanitizeOutgoingMessage,
  cloneChatMessages,
  calculateTargetRoundId,
} from '../utils/chatUtils.js';
import { getSimInterval } from '../simulation/multiSimScheduler.js';

interface UserMessageInput {
  username: string;
  agentId?: string; // Optional - undefined for general chat
  content: string;
}

interface ChatMessageResult {
  message: ChatMessage;
  chat: ChatState;
}

/**
 * Add a user message to a specific simulation's chat
 */
export const addUserMessageToSimulation = (
  simulationTypeId: string,
  input: UserMessageInput
): ChatMessageResult => {
  const instance = simulationManager.getSimulation(simulationTypeId);
  if (!instance) {
    throw new Error(`Simulation type '${simulationTypeId}' not found`);
  }

  const simType = instance.getSimulationType();
  if (!simType.chatEnabled) {
    throw new Error(`Chat is not enabled for simulation type '${simulationTypeId}'`);
  }

  const snapshot = instance.getSnapshot();
  const { chat } = snapshot;

  // Validate chat is enabled
  if (!chat.config.enabled) {
    throw new Error('Chat is disabled');
  }

  // Validate agent exists (if agentId is provided)
  let agent: typeof snapshot.agents[0] | undefined;
  if (input.agentId) {
    agent = snapshot.agents.find(a => a.id === input.agentId);
    if (!agent) {
      throw new Error(`Agent '${input.agentId}' not found`);
    }
  }

  // Sanitize and validate username
  const username = sanitizeUsername(input.username);
  if (!username) {
    throw new Error('A display name is required to send messages.');
  }

  // Sanitize and validate content
  const sanitizedContent = sanitizeIncomingContent(input.content, chat.config.maxMessageLength);
  if (!sanitizedContent) {
    throw new Error('Message cannot be empty.');
  }

  // Check for spam
  if (containsSpamIndicators(sanitizedContent)) {
    throw new Error('Messages cannot include links or promotional content.');
  }

  // Calculate the target round for this message
  const simulationMode = snapshot.mode;
  const simIntervalMs = getSimInterval();
  const roundId = calculateTargetRoundId(snapshot.day, snapshot.intradayHour, simulationMode, simIntervalMs);

  // Rate limiting: check messages from this user in this round
  const userMessagesThisRound = chat.messages.filter(message =>
    message.senderType === 'user'
    && message.roundId === roundId
    && message.sender.toLowerCase() === username.toLowerCase()
  ).length;

  if (userMessagesThisRound >= chat.config.maxMessagesPerUser) {
    throw new Error('You have reached the message limit for this round.');
  }

  // Check messages for this agent in this round (only if targeting an agent)
  if (agent) {
    const agentMessagesThisRound = chat.messages.filter(message =>
      message.senderType === 'user'
      && message.roundId === roundId
      && message.agentId === agent.id
    ).length;

    if (agentMessagesThisRound >= chat.config.maxMessagesPerAgent) {
      throw new Error('This agent already received the maximum community messages for this round.');
    }
  }

  // Create new message using correct ChatMessage interface
  const newMessage: ChatMessage = {
    id: randomUUID(),
    agentId: agent?.id,
    agentName: agent?.name,
    sender: username,
    senderType: 'user',
    content: sanitizedContent,
    roundId,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };

  const updatedMessages = [...chat.messages, newMessage];
  const updatedChat: ChatState = {
    config: chat.config,
    messages: updatedMessages,
  };

  // Update simulation state
  instance.updateSnapshot({ chat: updatedChat });

  logger.log(LogLevel.INFO, LogCategory.SIMULATION, 'User message added to chat', {
    simulationType: simulationTypeId,
    messageId: newMessage.id,
    username,
    agentId: agent.id,
    roundId,
  });

  return {
    message: newMessage,
    chat: updatedChat,
  };
};

/**
 * Update chat message status for a specific simulation
 */
export const updateChatMessagesStatusForSimulation = (
  simulationTypeId: string,
  day: number,
  intradayHour: number
): void => {
  const instance = simulationManager.getSimulation(simulationTypeId);
  if (!instance) {
    return;
  }

  const snapshot = instance.getSnapshot();
  const { chat } = snapshot;
  const currentRoundId = `${day}-${intradayHour.toFixed(3)}`;

  // Collect debugging info about pending messages
  const pendingMessages = chat.messages.filter(m => m.status === 'pending');
  const messagesForCurrentRound = chat.messages.filter(m => m.roundId === currentRoundId);

  let updated = false;
  const updatedMessages = chat.messages.map(message => {
    if (message.roundId === currentRoundId && message.status === 'pending') {
      updated = true;
      return { ...message, status: 'delivered' as const };
    }
    return message;
  });

  if (updated) {
    const updatedChat: ChatState = {
      config: chat.config,
      messages: updatedMessages,
    };
    instance.updateSnapshot({ chat: updatedChat });

    const deliveredCount = updatedMessages.filter(m => m.roundId === currentRoundId && m.status === 'delivered').length;
    logger.log(LogLevel.INFO, LogCategory.SIMULATION,
      `💬 Chat: ${deliveredCount} message(s) delivered for round ${currentRoundId}`, {
        simulationType: simulationTypeId,
        roundId: currentRoundId,
        deliveredCount,
      });
  } else if (pendingMessages.length > 0) {
    // Debug: why are messages still pending?
    const pendingDebug = pendingMessages.map(m => ({
      roundId: m.roundId,
      sender: m.sender,
      createdAt: m.createdAt,
      expectedRound: currentRoundId,
      matches: m.roundId === currentRoundId
    }));

    logger.log(LogLevel.INFO, LogCategory.SIMULATION,
      `💬 Chat: ${pendingMessages.length} message(s) still pending (current round: ${currentRoundId})`, {
        simulationType: simulationTypeId,
        currentRoundId,
        pendingMessages: pendingDebug.slice(0, 5), // Show first 5
      });
  }
};

/**
 * Add an agent reply to chat for a specific simulation
 */
export const addAgentReplyToSimulation = (
  simulationTypeId: string,
  agentId: string,
  agentName: string,
  content: string,
  roundId: string
): void => {
  const instance = simulationManager.getSimulation(simulationTypeId);
  if (!instance) {
    return;
  }

  const snapshot = instance.getSnapshot();
  const { chat } = snapshot;

  const sanitizedReply = sanitizeOutgoingMessage(content, chat.config.maxMessageLength);
  if (!sanitizedReply) {
    return;
  }

  const agentReply: ChatMessage = {
    id: randomUUID(),
    agentId,
    agentName,
    sender: agentName,
    senderType: 'agent',
    content: sanitizedReply.trim(),
    roundId,
    createdAt: new Date().toISOString(),
    status: 'delivered',
  };

  const updatedMessages = [...chat.messages, agentReply];
  const updatedChat: ChatState = {
    config: chat.config,
    messages: updatedMessages,
  };

  instance.updateSnapshot({ chat: updatedChat });

  logger.log(LogLevel.INFO, LogCategory.SIMULATION, 'Agent reply added to chat', {
    simulationType: simulationTypeId,
    messageId: agentReply.id,
    agentId,
    roundId,
  });
};
