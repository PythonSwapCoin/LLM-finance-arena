import type { SimulationSnapshot } from '../../../shared/types';
import { promises as fs } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger, LogLevel, LogCategory } from '../services/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PERSIST_PATH = process.env.PERSIST_PATH || './data/snapshot.json';

// JSON file adapter
export const loadSnapshot = async (): Promise<SimulationSnapshot | null> => {
  try {
    const fullPath = PERSIST_PATH.startsWith('/') 
      ? PERSIST_PATH 
      : `${process.cwd()}/${PERSIST_PATH}`;
    
    // Ensure directory exists
    const dir = dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    
    const data = await fs.readFile(fullPath, 'utf-8');
    const snapshot = JSON.parse(data) as SimulationSnapshot;
    
    logger.logSimulationEvent('Snapshot loaded from persistence', { 
      path: fullPath, 
      day: snapshot.day 
    });
    
    return snapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.logSimulationEvent('No existing snapshot found, starting fresh', {});
      return null;
    }
    logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
      'Error loading snapshot', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    return null;
  }
};

export const saveSnapshot = async (snapshot: SimulationSnapshot): Promise<void> => {
  try {
    const fullPath = PERSIST_PATH.startsWith('/') 
      ? PERSIST_PATH 
      : `${process.cwd()}/${PERSIST_PATH}`;
    
    // Ensure directory exists
    const dir = dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    
    await fs.writeFile(fullPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    
    logger.logSimulationEvent('Snapshot saved to persistence', { 
      path: fullPath, 
      day: snapshot.day 
    });
  } catch (error) {
    logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
      'Error saving snapshot', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    throw error;
  }
};

// Postgres adapter interface (stub for Phase 2)
export interface PostgresPersistenceAdapter {
  loadSnapshot(): Promise<SimulationSnapshot | null>;
  saveSnapshot(snapshot: SimulationSnapshot): Promise<void>;
}

// Example Postgres adapter stub (not implemented in Phase 1)
export class PostgresAdapter implements PostgresPersistenceAdapter {
  async loadSnapshot(): Promise<SimulationSnapshot | null> {
    // TODO: Implement Postgres persistence in Phase 2
    throw new Error('Postgres adapter not implemented in Phase 1');
  }

  async saveSnapshot(snapshot: SimulationSnapshot): Promise<void> {
    // TODO: Implement Postgres persistence in Phase 2
    throw new Error('Postgres adapter not implemented in Phase 1');
  }
}

