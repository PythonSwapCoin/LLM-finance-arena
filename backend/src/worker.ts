// Background Worker Script
// This script runs the simulation scheduler independently
// It's designed to run as a separate process (e.g., Render Background Worker)
// to keep the simulation running even when no one visits the frontend

import 'dotenv/config';
import { simulationManager } from './simulation/SimulationManager.js';
import { createInitialMarketData } from './services/marketDataService.js';
import { S_P500_TICKERS } from './constants.js';
import { logger, LogLevel, LogCategory } from './services/logger.js';
import { startMultiSimScheduler, stopMultiSimScheduler } from './simulation/multiSimScheduler.js';

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

  process.exit(exitCode);
};

// Initialize and start the worker
const startWorker = async (): Promise<void> => {
  try {
    logger.logSimulationEvent('Background worker starting', {
      nodeEnv: process.env.NODE_ENV || 'development',
    });

    // Initialize all simulations
    logger.logSimulationEvent('Initializing multi-simulation framework', {
      tickers: S_P500_TICKERS.length,
    });

    const initialMarketData = await createInitialMarketData(S_P500_TICKERS);
    await simulationManager.initializeAll(initialMarketData);

    logger.logSimulationEvent('All simulations initialized', {
      count: simulationManager.getAllSimulations().size,
    });

    // Start the scheduler
    await startMultiSimScheduler();
    logger.logSimulationEvent('Multi-simulation scheduler started', {});

    logger.logSimulationEvent('Background worker running', {
      mode: process.env.MODE || 'simulated',
    });

    // Keep the process alive
    // The scheduler runs in intervals, so we just need to keep the process running
    const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '300000', 10); // Default 5 minutes
    setInterval(() => {
      // Heartbeat log to show worker is alive
      logger.log(LogLevel.INFO, LogCategory.SYSTEM, 'Worker heartbeat', {
        timestamp: new Date().toISOString(),
      });
    }, HEARTBEAT_INTERVAL_MS);

  } catch (err) {
    logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
      'Error starting worker', {
        error: err instanceof Error ? err.message : String(err)
      });
    console.error('Error starting worker:', err);
    process.exit(1);
  }
};

// Graceful shutdown handling
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

// Start the worker
startWorker();

