import { simulationManager } from '../simulation/SimulationManager.js';
import type { ChatMessage, ChatState } from '../types.js';
import { v4 as uuidv4 } from 'uuid';
import { logger, LogLevel, LogCategory } from './logger.js';

interface UserMessageInput {
  username: string;
  agentId: string;
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
  const { username, agentId, content } = input;

  // Validate chat is enabled
  if (!chat.config.enabled) {
    throw new Error('Chat is disabled');
  }

  // Validate message length
  if (content.length > chat.config.maxMessageLength) {
    throw new Error(`Message too long (max ${chat.config.maxMessageLength} characters)`);
  }

  if (content.trim().length === 0) {
    throw new Error('Message cannot be empty');
  }

  // Validate agent exists
  const agent = snapshot.agents.find(a => a.id === agentId);
  if (!agent) {
    throw new Error(`Agent '${agentId}' not found`);
  }

  // Check for URLs or spam patterns
  const urlPattern = /(https?:\/\/|www\.)/i;
  if (urlPattern.test(content)) {
    throw new Error('Messages cannot contain URLs');
  }

  // Calculate the roundId where this message will be delivered
  // Messages are delivered at the next trade window
  const currentRoundId = `${snapshot.day}-${snapshot.intradayHour.toFixed(3)}`;

  // Add 1 minute safety buffer to ensure message is delivered in next round
  const safetyBufferMinutes = 1;
  const nextIntradayHour = snapshot.intradayHour + (safetyBufferMinutes / 60);

  // Determine the next trade round
  // For simplicity, we'll use the next intraday hour as the delivery round
  const deliveryRoundId = `${snapshot.day}-${nextIntradayHour.toFixed(3)}`;

  // Rate limiting: check messages from this user in this round
  const userMessagesInRound = chat.messages.filter(
    m => m.username === username && m.roundId === deliveryRoundId && m.type === 'user'
  );
  if (userMessagesInRound.length >= chat.config.maxMessagesPerUser) {
    throw new Error(
      `Rate limit exceeded: max ${chat.config.maxMessagesPerUser} messages per user per round`
    );
  }

  // Check messages for this agent in this round
  const agentMessagesInRound = chat.messages.filter(
    m => m.agentId === agentId && m.roundId === deliveryRoundId && m.type === 'user'
  );
  if (agentMessagesInRound.length >= chat.config.maxMessagesPerAgent) {
    throw new Error(
      `Rate limit exceeded: max ${chat.config.maxMessagesPerAgent} messages per agent per round`
    );
  }

  // Create new message
  const newMessage: ChatMessage = {
    id: uuidv4(),
    type: 'user',
    username,
    agentId,
    content: content.trim(),
    timestamp: new Date().toISOString(),
    roundId: deliveryRoundId,
    status: 'pending',
  };

  const updatedMessages = [...chat.messages, newMessage];
  const updatedChat: ChatState = {
    ...chat,
    messages: updatedMessages,
  };

  // Update simulation state
  instance.updateSnapshot({ chat: updatedChat });

  logger.log(LogLevel.INFO, LogCategory.SIMULATION, 'User message added to chat', {
    simulationType: simulationTypeId,
    messageId: newMessage.id,
    username,
    agentId,
    roundId: deliveryRoundId,
    currentRoundId,
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
      ...chat,
      messages: updatedMessages,
    };
    instance.updateSnapshot({ chat: updatedChat });

    logger.log(LogLevel.INFO, LogCategory.SIMULATION, 'Chat messages marked as delivered', {
      simulationType: simulationTypeId,
      roundId: currentRoundId,
      count: updatedMessages.filter(m => m.roundId === currentRoundId && m.status === 'delivered').length,
    });
  }
};

/**
 * Add an agent reply to chat for a specific simulation
 */
export const addAgentReplyToSimulation = (
  simulationTypeId: string,
  agentId: string,
  content: string,
  roundId: string,
  replyToMessageId?: string
): void => {
  const instance = simulationManager.getSimulation(simulationTypeId);
  if (!instance) {
    return;
  }

  const snapshot = instance.getSnapshot();
  const { chat } = snapshot;

  const agentReply: ChatMessage = {
    id: uuidv4(),
    type: 'agent',
    agentId,
    content: content.trim(),
    timestamp: new Date().toISOString(),
    roundId,
    status: 'delivered',
    replyToMessageId,
  };

  const updatedMessages = [...chat.messages, agentReply];
  const updatedChat: ChatState = {
    ...chat,
    messages: updatedMessages,
  };

  instance.updateSnapshot({ chat: updatedChat });

  logger.log(LogLevel.INFO, LogCategory.SIMULATION, 'Agent reply added to chat', {
    simulationType: simulationTypeId,
    messageId: agentReply.id,
    agentId,
    roundId,
    replyToMessageId,
  });
};
