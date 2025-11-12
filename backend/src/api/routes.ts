import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'fs';
import { simulationState } from '../simulation/state.js';
import { startScheduler, stopScheduler, isSchedulerRunning } from '../simulation/scheduler.js';
import { logger, LogLevel, LogCategory } from '../services/logger.js';
import {
  getSimulationMode,
  createInitialMarketData,
  isHistoricalSimulationComplete,
  getMarketDataTelemetry,
} from '../services/marketDataService.js';
import { exportSimulationData } from '../services/exportService.js';
import { exportLogs } from '../services/logExportService.js';
import { S_P500_TICKERS } from '../constants.js';
import { getPersistFilePath, saveSnapshot } from '../store/persistence.js';
import type {
  SimulationStateResponse,
  AgentsResponse,
  MarketDataResponse,
  BenchmarksResponse,
  HistoryResponse,
  StartStopResponse,
  LogsResponse,
  ChatMessageResponse,
} from './dto.js';
import { addUserMessageToChat } from '../services/chatService.js';

export const registerRoutes = async (fastify: FastifyInstance): Promise<void> => {
  // Health check
  fastify.get('/healthz', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Connection status endpoint - returns backend info for frontend verification
  fastify.get('/api/status', async () => {
    const snapshot = simulationState.getSnapshot();
    const telemetry = getMarketDataTelemetry();
    return {
      status: 'connected',
      backend: 'online',
      timestamp: new Date().toISOString(),
      simulation: {
        mode: snapshot.mode,
        day: snapshot.day,
        intradayHour: snapshot.intradayHour,
        agentsCount: snapshot.agents.length,
        tickersCount: Object.keys(snapshot.marketData).length,
        lastUpdated: snapshot.lastUpdated,
      },
      marketData: {
        tickersCount: Object.keys(snapshot.marketData).length,
        sources: telemetry.sources,
        rateLimits: telemetry.rateLimits,
      },
    };
  });

  // Get simulation state
  fastify.get('/api/simulation/state', async (): Promise<SimulationStateResponse> => {
    const snapshot = simulationState.getSnapshot();
    return {
      snapshot,
      isLoading: false, // Backend doesn't track loading state the same way
      isHistoricalSimulationComplete: isHistoricalSimulationComplete(snapshot.day),
      marketTelemetry: getMarketDataTelemetry(),
    };
  });

  // Get agents
  fastify.get('/api/agents', async (): Promise<AgentsResponse> => {
    return {
      agents: simulationState.getAgents(),
    };
  });

  // Get market data
  fastify.get('/api/market-data', async (): Promise<MarketDataResponse> => {
    const snapshot = simulationState.getSnapshot();
    return {
      prices: snapshot.marketData,
      ts: snapshot.lastUpdated,
      source: getSimulationMode(),
    };
  });

  // Get benchmarks
  fastify.get('/api/benchmarks', async (): Promise<BenchmarksResponse> => {
    return {
      series: simulationState.getBenchmarks(),
    };
  });

  // Get simulation history
  fastify.get('/api/simulation/history', async (): Promise<HistoryResponse> => {
    const agents = simulationState.getAgents();
    const benchmarks = simulationState.getBenchmarks();
    
    return {
      timeseries: {
        agents: agents.map(agent => ({
          id: agent.id,
          name: agent.name,
          performanceHistory: agent.performanceHistory,
        })),
        benchmarks: benchmarks.map(b => ({
          id: b.id,
          name: b.name,
          performanceHistory: b.performanceHistory,
        })),
      },
    };
  });

  // Start simulation
  fastify.post('/api/simulation/start', async (request, reply): Promise<StartStopResponse> => {
    try {
      if (!isSchedulerRunning()) {
        await startScheduler();
      }
      return { ok: true };
    } catch (error) {
      reply.code(500);
      return { ok: false };
    }
  });

  // Stop simulation
  fastify.post('/api/simulation/stop', async (): Promise<StartStopResponse> => {
    stopScheduler();
    return { ok: true };
  });

  // Get logs
  fastify.get<{ Querystring: { level?: string; limit?: string } }>('/api/logs', async (request): Promise<LogsResponse> => {
    const level = request.query.level as LogLevel | undefined;
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : undefined;
    
    const logs = logger.getLogs(level, limit);
    
    return {
      lines: logs.map(log => ({
        timestamp: log.timestamp,
        level: log.level,
        category: log.category,
        message: log.message,
        details: log.details,
        error: log.error,
      })),
    };
  });

  // Export simulation data
  fastify.post('/api/simulation/export', async (request, reply) => {
    try {
      const snapshot = simulationState.getSnapshot();
      const filepath = await exportSimulationData(snapshot);
      return { 
        ok: true, 
        filepath,
        message: 'Simulation data exported successfully'
      };
    } catch (error) {
      reply.code(500);
      return { 
        ok: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  });

  // Export logs
  fastify.post('/api/logs/export', async (request, reply) => {
    try {
      const filepath = await exportLogs();
      return { 
        ok: true, 
        filepath,
        message: 'Logs exported successfully'
      };
    } catch (error) {
      reply.code(500);
      return { 
        ok: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  });

  fastify.post<{ Body: { username: string; agentId: string; content: string } }>('/api/chat/messages', async (request, reply): Promise<ChatMessageResponse | { error: string }> => {
    try {
      const { username, agentId, content } = request.body;
      const result = addUserMessageToChat({ username, agentId, content });
      return result;
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : 'Failed to send chat message',
      };
    }
  });

  // Reset simulation (delete snapshot and restart from day 0)
  fastify.post('/api/simulation/reset', async (request, reply) => {
    try {
      stopScheduler();
      
      // Delete snapshot file
      const persistFilePath = getPersistFilePath();

      await fs.unlink(persistFilePath).catch(() => {
        // File doesn't exist, that's fine
      });

      // Reinitialize simulation
      const initialMarketData = await createInitialMarketData(S_P500_TICKERS);
      await simulationState.initialize(initialMarketData);
      
      // Save initial state
      await saveSnapshot(simulationState.getSnapshot()).catch(err => {
        logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
          'Failed to save initial snapshot after reset', { error: err });
      });
      
      // Restart scheduler
      await startScheduler();

      logger.logSimulationEvent('Simulation reset successfully', { path: persistFilePath });

      return {
        ok: true,
        message: 'Simulation reset successfully - starting from day 0'
      };
    } catch (error) {
      reply.code(500);
      return { 
        ok: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  });
};

