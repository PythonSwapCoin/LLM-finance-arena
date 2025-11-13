// Load environment variables from .env file
import 'dotenv/config';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { registerRoutes } from './api/routes.js';
import { registerMultiSimRoutes } from './api/multiSimRoutes.js';
import { simulationManager } from './simulation/SimulationManager.js';
import { createInitialMarketData } from './services/marketDataService.js';
import { S_P500_TICKERS } from './constants.js';
import { logger, LogLevel, LogCategory } from './services/logger.js';
import { startMultiSimScheduler, stopMultiSimScheduler } from './simulation/multiSimScheduler.js';

const PORT = parseInt(process.env.BACKEND_PORT || '8080', 10);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map(o => o.trim());
const SNAPSHOT_AUTOSAVE_INTERVAL_MS = parseInt(process.env.SNAPSHOT_AUTOSAVE_INTERVAL_MS || '900000', 10);

let isShuttingDown = false;

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

  await stopMultiSimScheduler();

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
await fastify.register(registerMultiSimRoutes);

// Initialize all simulations
const initializeAllSimulations = async (): Promise<void> => {
  logger.logSimulationEvent('Initializing multi-simulation framework', {
    tickers: S_P500_TICKERS.length,
  });

  // Create initial market data (shared across all simulations)
  const initialMarketData = await createInitialMarketData(S_P500_TICKERS);

  // Initialize all simulation types with the same market data
  await simulationManager.initializeAll(initialMarketData);

  logger.logSimulationEvent('All simulations initialized', {
    count: simulationManager.getAllSimulations().size,
  });

  // Auto-start multi-simulation scheduler
  await startMultiSimScheduler();
  logger.logSimulationEvent('Multi-simulation scheduler started', {});
};

// Start server
const start = async (): Promise<void> => {
  try {
    await initializeAllSimulations();

    await fastify.listen({
      port: PORT,
      host: '0.0.0.0'
    });

    logger.logSimulationEvent('Backend server started', {
      port: PORT,
      origins: ALLOWED_ORIGINS
    });
    console.log(`🚀 Backend server running on http://localhost:${PORT}`);
    console.log(`📊 Multi-simulation framework initialized`);
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

