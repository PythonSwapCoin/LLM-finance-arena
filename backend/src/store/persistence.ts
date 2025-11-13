import type { SimulationSnapshot } from '../types.js';
import { promises as fs } from 'fs';
import { dirname, isAbsolute, resolve } from 'path';
import pg from 'pg';
import { logger, LogLevel, LogCategory } from '../services/logger.js';

const { Pool } = pg;

const DEFAULT_PERSIST_PATH = './data/snapshot.json';
const DEFAULT_NAMESPACE = 'default';
const DEFAULT_SNAPSHOT_ID = 'current';

export type PersistenceDriver = 'file' | 'postgres';

let cachedDriver: PersistenceDriver | null = null;

const determineDriver = (): PersistenceDriver => {
  if (cachedDriver) {
    return cachedDriver;
  }

  const explicit = (process.env.PERSISTENCE_DRIVER || '').toLowerCase();
  const hasPostgresUrl = Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL);

  if (explicit === 'postgres') {
    cachedDriver = 'postgres';
  } else if (explicit === 'file') {
    cachedDriver = 'file';
  } else if (hasPostgresUrl) {
    cachedDriver = 'postgres';
  } else {
    cachedDriver = 'file';
  }

  return cachedDriver;
};

export const getPersistenceDriver = (): PersistenceDriver => determineDriver();

export const getPersistFilePath = (): string => {
  if (getPersistenceDriver() !== 'file') {
    throw new Error('File persistence path requested while Postgres persistence is active');
  }

  const persistPath = process.env.PERSIST_PATH || DEFAULT_PERSIST_PATH;
  return isAbsolute(persistPath) ? persistPath : resolve(process.cwd(), persistPath);
};

const ensureDirectoryExists = async (fullPath: string): Promise<void> => {
  const dir = dirname(fullPath);
  await fs.mkdir(dir, { recursive: true });
};

const loadSnapshotFromFile = async (): Promise<SimulationSnapshot | null> => {
  try {
    const fullPath = getPersistFilePath();
    await ensureDirectoryExists(fullPath);

    const data = await fs.readFile(fullPath, 'utf-8');
    const snapshot = JSON.parse(data) as SimulationSnapshot;

    logger.logSimulationEvent('Snapshot loaded from persistence', {
      driver: 'file',
      path: fullPath,
      day: snapshot.day,
    });

    return snapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.logSimulationEvent('No existing snapshot found, starting fresh', { driver: 'file' });
      return null;
    }
    logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
      'Error loading snapshot', {
        driver: 'file',
        error: error instanceof Error ? error.message : String(error)
      });
    return null;
  }
};

const saveSnapshotToFile = async (snapshot: SimulationSnapshot): Promise<void> => {
  try {
    const fullPath = getPersistFilePath();
    await ensureDirectoryExists(fullPath);

    await fs.writeFile(fullPath, JSON.stringify(snapshot, null, 2), 'utf-8');

    logger.logSimulationEvent('Snapshot saved to persistence', {
      driver: 'file',
      path: fullPath,
      day: snapshot.day,
    });
  } catch (error) {
    logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
      'Error saving snapshot', {
        driver: 'file',
        error: error instanceof Error ? error.message : String(error)
      });
    throw error;
  }
};

const clearFileSnapshot = async (): Promise<void> => {
  try {
    const fullPath = getPersistFilePath();
    await fs.unlink(fullPath);
    logger.logSimulationEvent('Deleted snapshot file', { driver: 'file', path: fullPath });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
      'Failed to delete snapshot file', {
        driver: 'file',
        error: error instanceof Error ? error.message : String(error)
      });
    throw error;
  }
};

const getPostgresConnectionString = (): string => {
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Postgres persistence requested but POSTGRES_URL or DATABASE_URL is not set');
  }
  return connectionString;
};

const shouldUsePostgresSSL = (): boolean => {
  const rawValue = (process.env.POSTGRES_SSL || 'true').toLowerCase();
  if (['false', '0', 'disable', 'disabled', 'no', 'off'].includes(rawValue)) {
    return false;
  }
  return true;
};

class PostgresAdapter {
  private pool: any;
  private initializationPromise: Promise<void> | null = null;
  private namespace: string;
  private snapshotId: string;
  private hasLoggedInitialization = false;

  constructor() {
    const connectionString = getPostgresConnectionString();
    const useSSL = shouldUsePostgresSSL();

    this.pool = new Pool({
      connectionString,
      ssl: useSSL ? { rejectUnauthorized: false } : undefined,
    });
    this.namespace = process.env.POSTGRES_NAMESPACE || DEFAULT_NAMESPACE;
    this.snapshotId = process.env.POSTGRES_SNAPSHOT_ID || DEFAULT_SNAPSHOT_ID;
  }

  private async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS simulation_snapshots (
        namespace TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        day INTEGER NOT NULL,
        intraday_hour INTEGER NOT NULL,
        mode TEXT NOT NULL,
        snapshot JSONB NOT NULL,
        last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (namespace, snapshot_id)
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS simulation_snapshot_history (
        namespace TEXT NOT NULL,
        day INTEGER NOT NULL,
        intraday_hour INTEGER NOT NULL,
        mode TEXT NOT NULL,
        snapshot JSONB NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (namespace, day, intraday_hour, mode)
      )
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sim_snapshots_namespace ON simulation_snapshots(namespace)
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sim_snapshots_history_namespace ON simulation_snapshot_history(namespace)
    `);

    if (!this.hasLoggedInitialization) {
      this.hasLoggedInitialization = true;
      logger.logSimulationEvent('Postgres persistence initialized', {
        driver: 'postgres',
        namespace: this.namespace,
        snapshotId: this.snapshotId,
      });
    }
  }

  private ensureInitialized(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.initialize().catch(error => {
        this.initializationPromise = null;
        throw error;
      });
    }
    return this.initializationPromise;
  }

  getTargetDescription(): string {
    try {
      const connectionString = getPostgresConnectionString();
      const url = new URL(connectionString);
      const database = url.pathname.replace(/^\//, '') || '[default]';
      const host = url.hostname || 'localhost';
      const port = url.port ? `:${url.port}` : '';
      return `postgresql://${host}${port}/${database} (namespace="${this.namespace}")`;
    } catch (error) {
      logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
        'Failed to describe Postgres target', {
          error: error instanceof Error ? error.message : String(error)
        });
      return `postgresql://[redacted] (namespace="${this.namespace}")`;
    }
  }

  async loadSnapshot(): Promise<SimulationSnapshot | null> {
    await this.ensureInitialized();
    try {
      const result = await this.pool.query(
        `SELECT snapshot FROM simulation_snapshots WHERE namespace = $1 AND snapshot_id = $2 LIMIT 1`,
        [this.namespace, this.snapshotId]
      ) as { rowCount: number; rows: Array<{ snapshot: SimulationSnapshot }>; };

      if (result.rowCount === 0) {
        logger.logSimulationEvent('No existing snapshot found, starting fresh', {
          driver: 'postgres',
          namespace: this.namespace,
        });
        return null;
      }

      const snapshot = result.rows[0].snapshot;
      logger.logSimulationEvent('Snapshot loaded from persistence', {
        driver: 'postgres',
        namespace: this.namespace,
        day: snapshot.day,
      });
      return snapshot;
    } catch (error) {
      logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
        'Error loading snapshot from Postgres', {
          driver: 'postgres',
          namespace: this.namespace,
          error: error instanceof Error ? error.message : String(error)
        });
      return null;
    }
  }

  async saveSnapshot(snapshot: SimulationSnapshot): Promise<void> {
    await this.ensureInitialized();
    try {
      await this.pool.query(
        `INSERT INTO simulation_snapshots(namespace, snapshot_id, day, intraday_hour, mode, snapshot, last_updated)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (namespace, snapshot_id)
         DO UPDATE SET day = EXCLUDED.day,
           intraday_hour = EXCLUDED.intraday_hour,
           mode = EXCLUDED.mode,
           snapshot = EXCLUDED.snapshot,
           last_updated = NOW()`
        , [
          this.namespace,
          this.snapshotId,
          snapshot.day,
          snapshot.intradayHour,
          snapshot.mode,
          snapshot,
        ]
      );

      await this.pool.query(
        `INSERT INTO simulation_snapshot_history(namespace, day, intraday_hour, mode, snapshot, recorded_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (namespace, day, intraday_hour, mode)
         DO UPDATE SET snapshot = EXCLUDED.snapshot,
           recorded_at = NOW()`
        , [
          this.namespace,
          snapshot.day,
          snapshot.intradayHour,
          snapshot.mode,
          snapshot,
        ]
      );

      logger.logSimulationEvent('Snapshot saved to persistence', {
        driver: 'postgres',
        namespace: this.namespace,
        day: snapshot.day,
      });
    } catch (error) {
      logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
        'Error saving snapshot to Postgres', {
          driver: 'postgres',
          namespace: this.namespace,
          error: error instanceof Error ? error.message : String(error)
        });
      throw error;
    }
  }

  async clearSnapshot(): Promise<void> {
    await this.ensureInitialized();
    try {
      await this.pool.query(
        `DELETE FROM simulation_snapshots WHERE namespace = $1 AND snapshot_id = $2`,
        [this.namespace, this.snapshotId]
      );
      await this.pool.query(
        `DELETE FROM simulation_snapshot_history WHERE namespace = $1`,
        [this.namespace]
      );
      logger.logSimulationEvent('Cleared Postgres snapshot data', {
        driver: 'postgres',
        namespace: this.namespace,
      });
    } catch (error) {
      logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
        'Failed to clear Postgres snapshot data', {
          driver: 'postgres',
          namespace: this.namespace,
          error: error instanceof Error ? error.message : String(error)
        });
      throw error;
    }
  }

  async close(): Promise<void> {
    try {
      await this.pool.end();
    } catch (error) {
      logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
        'Failed to close Postgres pool cleanly', {
          driver: 'postgres',
          namespace: this.namespace,
          error: error instanceof Error ? error.message : String(error)
        });
    }
  }
}

let postgresAdapter: PostgresAdapter | null = null;

const getPostgresAdapter = (): PostgresAdapter => {
  if (!postgresAdapter) {
    postgresAdapter = new PostgresAdapter();
  }
  return postgresAdapter;
};

export const getPersistenceTargetDescription = (): string => {
  if (getPersistenceDriver() === 'postgres') {
    return getPostgresAdapter().getTargetDescription();
  }
  try {
    return getPersistFilePath();
  } catch {
    return DEFAULT_PERSIST_PATH;
  }
};

export const loadSnapshot = async (): Promise<SimulationSnapshot | null> => {
  if (getPersistenceDriver() === 'postgres') {
    return getPostgresAdapter().loadSnapshot();
  }
  return loadSnapshotFromFile();
};

export const saveSnapshot = async (snapshot: SimulationSnapshot): Promise<void> => {
  if (getPersistenceDriver() === 'postgres') {
    return getPostgresAdapter().saveSnapshot(snapshot);
  }
  return saveSnapshotToFile(snapshot);
};

export const clearSnapshot = async (): Promise<void> => {
  if (getPersistenceDriver() === 'postgres') {
    return getPostgresAdapter().clearSnapshot();
  }
  return clearFileSnapshot();
};

export const closePersistence = async (): Promise<void> => {
  if (postgresAdapter) {
    await postgresAdapter.close();
    postgresAdapter = null;
  }
};

