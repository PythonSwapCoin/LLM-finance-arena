import type { FastifyInstance } from 'fastify';
import { simulationManager } from '../simulation/SimulationManager.js';
import { startMultiSimScheduler, stopMultiSimScheduler, isSchedulerRunning } from '../simulation/multiSimScheduler.js';
import { logger, LogLevel, LogCategory } from '../services/logger.js';
import { createInitialMarketData, getMarketDataTelemetry } from '../services/marketDataService.js';
import { S_P500_TICKERS } from '../constants.js';
import { addUserMessageToSimulation } from '../services/multiSimChatService.js';
import { getTimerState } from '../services/timerService.js';
import type { ChatMessageResponse } from './dto.js';

export const registerMultiSimRoutes = async (fastify: FastifyInstance): Promise<void> => {
  // Get list of all simulation types (including disabled ones)
  fastify.get('/api/simulations/types', async () => {
    const types = simulationManager.getAllSimulationTypesWithStatus();
    return {
      types: types.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        chatEnabled: t.chatEnabled,
        showModelNames: t.showModelNames,
        agentCount: t.traderConfigs.length,
        enabled: t.enabled,
      })),
    };
  });

  // Get state for a specific simulation
  fastify.get<{ Params: { typeId: string } }>('/api/simulations/:typeId/state', async (request, reply) => {
    const { typeId } = request.params;
    const instance = simulationManager.getSimulation(typeId);

    if (!instance) {
      // Check if this simulation type exists but is disabled
      const allTypes = simulationManager.getAllSimulationTypesWithStatus();
      const simType = allTypes.find(t => t.id === typeId);
      
      if (simType && !simType.enabled) {
        reply.code(403); // Forbidden - exists but disabled
        return { error: `Simulation type '${typeId}' is currently disabled` };
      }
      
      reply.code(404);
      return { error: `Simulation type '${typeId}' not found` };
    }

    const snapshot = instance.getSnapshot();
    const simType = instance.getSimulationType();

    return {
      snapshot,
      simulationType: {
        id: simType.id,
        name: simType.name,
        description: simType.description,
        chatEnabled: simType.chatEnabled,
        showModelNames: simType.showModelNames,
      },
      isLoading: false,
      marketTelemetry: getMarketDataTelemetry(),
    };
  });

  // Start all simulations
  fastify.post('/api/simulations/start', async (request, reply) => {
    try {
      if (!isSchedulerRunning()) {
        await startMultiSimScheduler();
      }
      return { ok: true, message: 'All simulations started' };
    } catch (error) {
      reply.code(500);
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Stop all simulations
  fastify.post('/api/simulations/stop', async () => {
    await stopMultiSimScheduler();
    return { ok: true, message: 'All simulations stopped' };
  });

  // Reset a specific simulation
  fastify.post<{ Params: { typeId: string } }>('/api/simulations/:typeId/reset', async (request, reply) => {
    const { typeId } = request.params;

    try {
      // Clear snapshot from persistence
      const { clearSnapshot } = await import('../store/persistence.js');
      await clearSnapshot(typeId).catch(err => {
        logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
          `Failed to clear snapshot for ${typeId}`, { error: err });
      });

      // Reset the simulation
      await simulationManager.resetSimulation(typeId);
      
      // Save fresh snapshot
      const instance = simulationManager.getSimulation(typeId);
      if (instance) {
        const { saveSnapshot } = await import('../store/persistence.js');
        await saveSnapshot(instance.getSnapshot(), typeId).catch(err => {
          logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
            `Failed to save snapshot for ${typeId}`, { error: err });
        });
      }

      logger.logSimulationEvent(`Simulation ${typeId} reset successfully`, { typeId });

      return {
        ok: true,
        message: `Simulation '${typeId}' reset successfully`,
      };
    } catch (error) {
      reply.code(500);
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Reset all simulations
  fastify.post('/api/simulations/reset', async (request, reply) => {
    try {
      const disableScheduler = process.env.DISABLE_SCHEDULER === 'true';
      
      // Stop scheduler if it's running
      if (!disableScheduler) {
        await stopMultiSimScheduler();
      }

      // Clear all snapshots from persistence
      const { clearSnapshot } = await import('../store/persistence.js');
      const enabledTypes = simulationManager.getSimulationTypes();
      for (const simType of enabledTypes) {
        await clearSnapshot(simType.id).catch(err => {
          logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
            `Failed to clear snapshot for ${simType.id}`, { error: err });
        });
      }

      // Reset all simulations (this will create fresh ones)
      const { createInitialMarketData } = await import('../services/marketDataService.js');
      const { S_P500_TICKERS } = await import('../constants.js');
      const initialMarketData = await createInitialMarketData(S_P500_TICKERS);
      await simulationManager.initializeAll(initialMarketData);

      // Restart scheduler if it should be running
      if (!disableScheduler) {
        await startMultiSimScheduler();
      }

      logger.logSimulationEvent('All simulations reset successfully', {});

      return {
        ok: true,
        message: 'All simulations reset successfully',
      };
    } catch (error) {
      reply.code(500);
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Send chat message to a specific simulation
  fastify.post<{
    Params: { typeId: string };
    Body: { username: string; agentId?: string; content: string };
  }>('/api/simulations/:typeId/chat/messages', async (request, reply): Promise<ChatMessageResponse | { error: string }> => {
    const { typeId } = request.params;
    const { username, agentId, content } = request.body;

    if (!username || !content) {
      reply.code(400);
      return { error: 'Missing required fields: username and content are required' };
    }

    try {
      const instance = simulationManager.getSimulation(typeId);
      if (!instance) {
        reply.code(404);
        return { error: `Simulation type '${typeId}' not found` };
      }

      const simType = instance.getSimulationType();
      if (!simType.chatEnabled) {
        reply.code(403);
        return { error: `Chat is not enabled for simulation type '${typeId}'` };
      }

      logger.log(LogLevel.INFO, LogCategory.SYSTEM,
        `[CHAT] Received message for simulation ${typeId}`, { username, agentId, contentLength: content?.length ?? 0 });

      const result = addUserMessageToSimulation(typeId, { username, agentId, content });

      logger.log(LogLevel.INFO, LogCategory.SYSTEM,
        `[CHAT] Message added to simulation ${typeId}`, {
          messageId: result.message.id,
          roundId: result.message.roundId,
          totalMessages: result.chat.messages.length,
        });

      return result;
    } catch (error) {
      reply.code(400);
      logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
        `[CHAT] Message rejected for simulation ${typeId}`, {
          username,
          agentId,
          error: error instanceof Error ? error.message : String(error),
        });
      return {
        error: error instanceof Error ? error.message : 'Failed to send chat message',
      };
    }
  });

  // Get scheduler status
  fastify.get('/api/simulations/scheduler/status', async () => {
    return {
      isRunning: isSchedulerRunning(),
      timestamp: new Date().toISOString(),
    };
  });

  // Get timer countdown for next trade window
  fastify.get('/api/timer', async () => {
    const timerState = getTimerState();
    return {
      countdownSeconds: timerState.countdownSeconds,
      nextTradeWindowTimestamp: timerState.nextTradeWindowTimestamp,
      nextTradeWindowISO: new Date(timerState.nextTradeWindowTimestamp).toISOString(),
    };
  });

  // Note: Price log export endpoints are in routes.ts to avoid duplication
};
