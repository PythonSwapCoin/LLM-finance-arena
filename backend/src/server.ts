// Load environment variables from .env file
import 'dotenv/config';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { registerRoutes } from './api/routes.js';
import { simulationState } from './simulation/state.js';
import { getPersistFilePath, loadSnapshot, saveSnapshot } from './store/persistence.js';
import { createInitialMarketData } from './services/marketDataService.js';
import { S_P500_TICKERS } from './constants.js';
import { logger, LogLevel, LogCategory } from './services/logger.js';
import { startScheduler, stopScheduler } from './simulation/scheduler.js';

const PORT = parseInt(process.env.BACKEND_PORT || '8080', 10);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map(o => o.trim());
const SNAPSHOT_AUTOSAVE_INTERVAL_MS = parseInt(process.env.SNAPSHOT_AUTOSAVE_INTERVAL_MS || '900000', 10);

let snapshotAutosaveInterval: NodeJS.Timeout | null = null;
let isShuttingDown = false;

const startSnapshotAutosave = (): void => {
  if (SNAPSHOT_AUTOSAVE_INTERVAL_MS <= 0) {
    logger.log(LogLevel.INFO, LogCategory.SYSTEM,
      'Snapshot autosave disabled', { intervalMs: SNAPSHOT_AUTOSAVE_INTERVAL_MS });
    return;
  }

  if (snapshotAutosaveInterval) {
    clearInterval(snapshotAutosaveInterval);
  }

  snapshotAutosaveInterval = setInterval(async () => {
    try {
      await saveSnapshot(simulationState.getSnapshot());
    } catch (error) {
      logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
        'Failed to persist snapshot during autosave', { error });
    }
  }, SNAPSHOT_AUTOSAVE_INTERVAL_MS);

  logger.logSimulationEvent('Snapshot autosave enabled', {
    intervalMs: SNAPSHOT_AUTOSAVE_INTERVAL_MS,
  });
};

const stopSnapshotAutosave = (): void => {
  if (snapshotAutosaveInterval) {
    clearInterval(snapshotAutosaveInterval);
    snapshotAutosaveInterval = null;
    logger.logSimulationEvent('Snapshot autosave stopped', {});
  }
};

const shutdown = async ({ reason, exitCode, error }: { reason: string; exitCode: number; error?: unknown }): Promise<void> => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  if (error) {
    logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
      `${reason} - initiating shutdown`, { error });
  } else {
    logger.logSimulationEvent(`${reason} - initiating shutdown`, {});
  }

  stopSnapshotAutosave();
  stopScheduler();

  await saveSnapshot(simulationState.getSnapshot()).catch(err => {
    logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
      'Failed to save snapshot during shutdown', { error: err });
  });

  await fastify.close().catch(err => {
    logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
      'Failed to close Fastify instance during shutdown', { error: err });
  });

  process.exit(exitCode);
};

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
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      cb(null, true);
      return;
    }
    
    // Check if origin is in allowed list
    if (ALLOWED_ORIGINS.includes(origin)) {
      cb(null, true);
      return;
    }
    
    // Also allow Vercel preview deployments (they have patterns like *.vercel.app)
    if (origin.includes('.vercel.app')) {
      cb(null, true);
      return;
    }
    
    // Log rejected origins for debugging
    console.log(`CORS: Rejected origin: ${origin}`);
    console.log(`CORS: Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
    cb(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
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
  const persistFilePath = getPersistFilePath();

  logger.logSimulationEvent('Simulation persistence configured', {
    path: persistFilePath,
    resetOnStartup: RESET_SIMULATION,
    autosaveIntervalMs: SNAPSHOT_AUTOSAVE_INTERVAL_MS,
  });

  if (!process.env.PERSIST_PATH) {
    logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
      'PERSIST_PATH not set; using default relative path. Mount a persistent volume or override PERSIST_PATH to retain data across restarts.',
      { defaultPath: persistFilePath });
  }

  // If RESET_SIMULATION is true, delete the snapshot and start fresh
  if (RESET_SIMULATION) {
    logger.logSimulationEvent('RESET_SIMULATION=true, starting fresh simulation', {});
    try {
      const { promises: fs } = await import('fs');
      await fs.unlink(persistFilePath).catch(() => {
        // File doesn't exist, that's fine
      });
      logger.logSimulationEvent('Deleted existing snapshot', { path: persistFilePath });
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
    startSnapshotAutosave();

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
    logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
      'Error starting server', { 
        error: err instanceof Error ? err.message : String(err) 
      });
    console.error('Error starting server:', err);
    process.exit(1);
  }
};

// Graceful shutdown and fatal error handling
process.on('SIGTERM', () => {
  void shutdown({ reason: 'SIGTERM received', exitCode: 0 });
});

process.on('SIGINT', () => {
  void shutdown({ reason: 'SIGINT received', exitCode: 0 });
});

process.on('uncaughtException', error => {
  logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
    'Uncaught exception detected', { error });
  void shutdown({ reason: 'Uncaught exception', exitCode: 1, error });
});

process.on('unhandledRejection', error => {
  logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
    'Unhandled promise rejection detected', { error });
  void shutdown({ reason: 'Unhandled promise rejection', exitCode: 1, error });
});

start();

