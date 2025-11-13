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
  agentId?: string; // optional for general chat messages
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

  // Check if this is a message to a specific agent or a general message
  const isAgentMessage = Boolean(input.agentId);
  let agent: Agent | undefined;

  if (isAgentMessage) {
    agent = snapshot.agents.find(a => a.id === input.agentId);
    if (!agent) {
      throw new Error('Agent not found.');
    }

    // Check message limits for agent messages
    const agentMessagesThisRound = chat.messages.filter(message =>
      message.senderType === 'user'
      && message.roundId === roundId
      && message.agentId === agent!.id
    ).length;

    if (agentMessagesThisRound >= chat.config.maxMessagesPerAgent) {
      throw new Error('This agent already received the maximum community messages for this round.');
    }
  }

  // Check per-user message limit
  const userMessagesThisRound = chat.messages.filter(message =>
    message.senderType === 'user'
    && message.roundId === roundId
    && message.sender.toLowerCase() === username.toLowerCase()
  ).length;

  if (userMessagesThisRound >= chat.config.maxMessagesPerUser) {
    throw new Error('You have reached the message limit for this round.');
  }

  const message: ChatMessage = {
    id: randomUUID(),
    agentId: agent?.id,
    agentName: agent?.name,
    sender: username,
    senderType: 'user',
    content: sanitizedContent,
    roundId,
    createdAt: new Date().toISOString(),
    status: isAgentMessage ? 'pending' : undefined, // Only agent messages have status
  };

  const updatedChat: ChatState = {
    config: chat.config,
    messages: [...chat.messages, message],
  };

  simulationState.updateSnapshot({ chat: updatedChat });
  return { chat: simulationState.getChat(), message };
};

/**
 * Marks pending user messages as 'sent' and sets deliveredRoundId.
 * This should be called at the start of each trading round to deliver pending messages to agents.
 */
export const deliverPendingMessages = (chat: ChatState, currentRoundId: string): ChatState => {
  if (!chat.config.enabled) {
    return chat;
  }

  const updatedMessages = cloneChatMessages(chat.messages);
  let didUpdate = false;

  updatedMessages.forEach(message => {
    if (message.senderType === 'user' && message.status === 'pending' && message.agentId) {
      // Deliver message in the next trading round (current round)
      message.status = 'sent';
      message.deliveredRoundId = currentRoundId;
      didUpdate = true;
    }
  });

  if (!didUpdate) {
    return chat;
  }

  return {
    config: chat.config,
    messages: updatedMessages,
  };
};

/**
 * Applies agent replies to chat and updates message statuses.
 * Only allows agents to reply if they received messages in the current round.
 */
export const applyAgentRepliesToChat = (chat: ChatState, replies: AgentReplyInput[]): ChatState => {
  if (!chat.config.enabled) {
    return chat;
  }

  const updatedMessages = cloneChatMessages(chat.messages);
  const respondedAt = new Date().toISOString();
  let didChange = false;

  // Track which agents have messages to reply to in this round
  const agentMessageMap = new Map<string, ChatMessage[]>();

  replies.forEach(({ agent, roundId }) => {
    // Find messages that were delivered to this agent in this round
    const agentMessages = updatedMessages.filter(message =>
      message.senderType === 'user'
      && message.agentId === agent.id
      && message.deliveredRoundId === roundId
      && message.status === 'sent'
    );

    if (agentMessages.length > 0) {
      agentMessageMap.set(agent.id, agentMessages);
    }
  });

  // Process replies
  replies.forEach(({ agent, reply, roundId }) => {
    const agentMessages = agentMessageMap.get(agent.id);

    // Only allow reply if agent has messages delivered in this round
    if (!agentMessages || agentMessages.length === 0) {
      return;
    }

    // If agent provided a reply, post it and mark messages as responded
    if (reply && reply.trim()) {
      const sanitizedReply = sanitizeOutgoingMessage(reply, chat.config.maxMessageLength);
      if (!sanitizedReply) {
        // If reply is invalid, mark messages as ignored
        agentMessages.forEach(msg => {
          msg.status = 'ignored';
          msg.respondedAt = respondedAt;
        });
        didChange = true;
        return;
      }

      // Get unique senders to create @mentions
      const uniqueSenders = Array.from(new Set(agentMessages.map(message => message.sender)));
      const mentionPrefix = uniqueSenders.map(sender => `@${sender}`).join(' ');
      const prefixWithSpace = `${mentionPrefix} `;
      const availableLength = Math.max(chat.config.maxMessageLength - prefixWithSpace.length, 0);
      const trimmedReply = sanitizedReply.slice(0, availableLength).trim();
      const finalContent = `${prefixWithSpace}${trimmedReply}`.trim();

      if (!finalContent) {
        // If final content is empty, mark as ignored
        agentMessages.forEach(msg => {
          msg.status = 'ignored';
          msg.respondedAt = respondedAt;
        });
        didChange = true;
        return;
      }

      // Check if agent already replied in this round (update instead of create)
      const existingIndex = updatedMessages.findIndex(message =>
        message.senderType === 'agent'
        && message.agentId === agent.id
        && message.roundId === roundId
      );

      const replyMessage: ChatMessage = {
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
        updatedMessages[existingIndex] = replyMessage;
      } else {
        updatedMessages.push(replyMessage);
      }

      // Mark messages as responded
      agentMessages.forEach(msg => {
        msg.status = 'responded';
        msg.respondedAt = respondedAt;
      });

      didChange = true;
    } else {
      // Agent chose not to reply, mark as ignored
      agentMessages.forEach(msg => {
        msg.status = 'ignored';
        msg.respondedAt = respondedAt;
      });
      didChange = true;
    }
  });

  if (!didChange) {
    return chat;
  }

  return {
    config: chat.config,
    messages: updatedMessages,
  };
};
