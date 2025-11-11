// Load environment variables from .env file
import 'dotenv/config';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { registerRoutes } from './api/routes';
import { simulationState } from './simulation/state';
import { loadSnapshot, saveSnapshot } from './store/persistence';
import { createInitialMarketData } from './services/marketDataService';
import { S_P500_TICKERS } from './constants';
import { logger, LogLevel, LogCategory } from './services/logger';
import { startScheduler } from './simulation/scheduler';

const PORT = parseInt(process.env.BACKEND_PORT || '8080', 10);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map(o => o.trim());

// Verify environment variables are loaded
if (process.env.OPENROUTER_API_KEY) {
  console.log('✅ OPENROUTER_API_KEY loaded successfully');
} else {
  console.warn('⚠️ OPENROUTER_API_KEY not found in environment variables');
}

const fastify = Fastify({
  logger: false, // We use our own logger
});

// Register plugins
await fastify.register(helmet, {
  contentSecurityPolicy: false, // Adjust as needed
});

await fastify.register(cors, {
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true,
});

await fastify.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

// Register routes
await fastify.register(registerRoutes);

// Initialize simulation state
const initializeSimulation = async (): Promise<void> => {
  logger.logSimulationEvent('Initializing simulation', { tickers: S_P500_TICKERS.length });
  
  const RESET_SIMULATION = process.env.RESET_SIMULATION === 'true';
  
  // If RESET_SIMULATION is true, delete the snapshot and start fresh
  if (RESET_SIMULATION) {
    logger.logSimulationEvent('RESET_SIMULATION=true, starting fresh simulation', {});
    try {
      const { promises: fs } = await import('fs');
      const snapshotPath = process.env.PERSIST_PATH || './data/snapshot.json';
      const fullPath = snapshotPath.startsWith('/') 
        ? snapshotPath 
        : `${process.cwd()}/${snapshotPath}`;
      await fs.unlink(fullPath).catch(() => {
        // File doesn't exist, that's fine
      });
      logger.logSimulationEvent('Deleted existing snapshot', { path: fullPath });
    } catch (error) {
      logger.log(LogLevel.WARNING, LogCategory.SYSTEM, 
        'Failed to delete snapshot for reset', { error });
    }
  }
  
  // Try to load persisted snapshot
  const savedSnapshot = await loadSnapshot();
  
  if (savedSnapshot && !RESET_SIMULATION) {
    logger.logSimulationEvent('Loaded snapshot from persistence', { 
      day: savedSnapshot.day, 
      mode: savedSnapshot.mode 
    });
    simulationState.loadFromSnapshot(savedSnapshot);
  } else {
    // Initialize fresh
    logger.logSimulationEvent('Creating fresh simulation', {});
    const initialMarketData = await createInitialMarketData(S_P500_TICKERS);
      await simulationState.initialize(initialMarketData);
    
    // Save initial state
    await saveSnapshot(simulationState.getSnapshot()).catch(err => {
      logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
        'Failed to save initial snapshot', { error: err });
    });
  }
  
  // Auto-start scheduler
  await startScheduler();
  logger.logSimulationEvent('Simulation scheduler started', {});
};

// Start server
const start = async (): Promise<void> => {
  try {
    await initializeSimulation();
    
    await fastify.listen({ 
      port: PORT, 
      host: '0.0.0.0' 
    });
    
    logger.logSimulationEvent('Backend server started', { 
      port: PORT, 
      origins: ALLOWED_ORIGINS 
    });
    console.log(`🚀 Backend server running on http://localhost:${PORT}`);
    console.log(`📊 Simulation mode: ${simulationState.getMode()}`);
    console.log(`🔒 CORS allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  } catch (err) {
    logger.log(require('./services/logger').LogLevel.ERROR, require('./services/logger').LogCategory.SYSTEM, 
      'Error starting server', { 
        error: err instanceof Error ? err.message : String(err) 
      });
    console.error('Error starting server:', err);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.logSimulationEvent('SIGTERM received, shutting down gracefully', {});
  await saveSnapshot(simulationState.getSnapshot()).catch(err => {
    logger.log(require('./services/logger').LogLevel.ERROR, require('./services/logger').LogCategory.SYSTEM, 
      'Failed to save snapshot on shutdown', { error: err });
  });
  await fastify.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.logSimulationEvent('SIGINT received, shutting down gracefully', {});
  await saveSnapshot(simulationState.getSnapshot()).catch(err => {
    logger.log(require('./services/logger').LogLevel.ERROR, require('./services/logger').LogCategory.SYSTEM, 
      'Failed to save snapshot on shutdown', { error: err });
  });
  await fastify.close();
  process.exit(0);
});

start();

