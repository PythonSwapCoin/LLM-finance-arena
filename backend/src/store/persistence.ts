import type { SimulationSnapshot } from '../types.js';
import { promises as fs } from 'fs';
import { dirname, isAbsolute, resolve } from 'path';
import pg from 'pg';
import type { Pool } from 'pg';
import { logger, LogLevel, LogCategory } from '../services/logger.js';

const { Pool: PgPool } = pg;

const DEFAULT_PERSIST_PATH = './data/snapshot.json';
const DEFAULT_NAMESPACE = 'default';
const DEFAULT_SNAPSHOT_ID = 'current';

export type PersistenceDriver = 'file' | 'postgres';

export type HistoryCleanupResult = {
  tableExisted: boolean;
  deletedRows: number;
  sizeBeforeBytes?: number;
  sizeAfterBytes?: number;
  freedBytes?: number;
};

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

    // Only log snapshot saves on day changes or errors (reduce noise)
    // (Logging removed to reduce terminal noise - errors still logged below)
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
  private pool: Pool;
  private initializationPromise: Promise<void> | null = null;
  private namespace: string;
  private snapshotId: string;
  private hasLoggedInitialization = false;

  private static toIntradayKey(intradayHour: number): number {
    if (!Number.isFinite(intradayHour)) {
      return 0;
    }
    // Store intraday progress with millisecond-like precision (thousandths of an hour)
    // so fractional ticks (e.g., 0.5 = 30 minutes) can be persisted in integer columns.
    return Math.round(intradayHour * 1000);
  }

  constructor() {
    const connectionString = getPostgresConnectionString();
    const useSSL = shouldUsePostgresSSL();

    this.pool = new PgPool({
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
      CREATE INDEX IF NOT EXISTS idx_sim_snapshots_namespace ON simulation_snapshots(namespace)
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

  async loadSnapshot(customSnapshotId?: string): Promise<SimulationSnapshot | null> {
    await this.ensureInitialized();
    try {
      const snapshotId = customSnapshotId || this.snapshotId;
      const result = await this.pool.query(
        `SELECT snapshot FROM simulation_snapshots WHERE namespace = $1 AND snapshot_id = $2 LIMIT 1`,
        [this.namespace, snapshotId]
      ) as { rowCount: number; rows: Array<{ snapshot: SimulationSnapshot }>; };

      if (result.rowCount === 0) {
        logger.logSimulationEvent('No existing snapshot found, starting fresh', {
          driver: 'postgres',
          namespace: this.namespace,
          snapshotId,
        });
        return null;
      }

      const snapshot = result.rows[0].snapshot;
      logger.logSimulationEvent('Snapshot loaded from persistence', {
        driver: 'postgres',
        namespace: this.namespace,
        snapshotId,
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

  async saveSnapshot(snapshot: SimulationSnapshot, customSnapshotId?: string): Promise<void> {
    await this.ensureInitialized();
    try {
      const snapshotId = customSnapshotId || this.snapshotId;
      const intradayKey = PostgresAdapter.toIntradayKey(snapshot.intradayHour);
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
          snapshotId,
          snapshot.day,
          intradayKey,
          snapshot.mode,
          snapshot,
        ]
      );

      // Only log snapshot saves on day changes or errors (reduce noise)
      // (Logging removed to reduce terminal noise - errors still logged below)
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

  async clearSnapshot(customSnapshotId?: string): Promise<void> {
    await this.ensureInitialized();
    try {
      const snapshotId = customSnapshotId || this.snapshotId;
      await this.pool.query(
        `DELETE FROM simulation_snapshots WHERE namespace = $1 AND snapshot_id = $2`,
        [this.namespace, snapshotId]
      );
      logger.logSimulationEvent('Cleared Postgres snapshot data', {
        driver: 'postgres',
        namespace: this.namespace,
        snapshotId,
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

  async cleanupHistoryTable(): Promise<HistoryCleanupResult> {
    await this.ensureInitialized();

    try {
      const existence = await this.pool.query<{ oid: string | null }>(
        `SELECT to_regclass('simulation_snapshot_history') AS oid`
      );

      const exists = Boolean(existence.rows[0]?.oid);
      if (!exists) {
        return { tableExisted: false, deletedRows: 0 };
      }

      const preMetrics = await this.pool.query<{
        size_bytes: string;
        row_count: string;
      }>(
        `SELECT pg_total_relation_size('simulation_snapshot_history') AS size_bytes,
                COUNT(*)::bigint AS row_count
         FROM simulation_snapshot_history`
      );

      const sizeBeforeBytes = Number(preMetrics.rows[0]?.size_bytes || 0);
      const rowCountBefore = Number(preMetrics.rows[0]?.row_count || 0);

      const deletion = await this.pool.query('DELETE FROM simulation_snapshot_history');
      const deletedRows = deletion.rowCount ?? rowCountBefore;

      const postMetrics = await this.pool.query<{ size_bytes: string }>(
        `SELECT pg_total_relation_size('simulation_snapshot_history') AS size_bytes`
      );

      const sizeAfterBytes = Number(postMetrics.rows[0]?.size_bytes || 0);
      const freedBytes = Math.max(sizeBeforeBytes - sizeAfterBytes, 0);

      logger.logSimulationEvent('Cleared Postgres snapshot history', {
        driver: 'postgres',
        namespace: this.namespace,
        deletedRows,
        freedBytes,
      });

      return {
        tableExisted: true,
        deletedRows,
        sizeBeforeBytes,
        sizeAfterBytes,
        freedBytes,
      };
    } catch (error) {
      logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
        'Failed to clean Postgres snapshot history', {
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

export const loadSnapshot = async (snapshotId?: string): Promise<SimulationSnapshot | null> => {
  if (getPersistenceDriver() === 'postgres') {
    const adapter = getPostgresAdapter();
    return adapter.loadSnapshot(snapshotId);
  }
  // For file persistence, use snapshotId in filename if provided
  if (snapshotId) {
    try {
      const fullPath = getPersistFilePath();
      const baseName = fullPath.replace(/\.[^/.]+$/, '');
      const ext = fullPath.match(/\.[^/.]+$/) || ['.json'];
      const customPath = `${baseName}_${snapshotId}${ext}`;
      await ensureDirectoryExists(customPath);
      const data = await fs.readFile(customPath, 'utf-8');
      const snapshot = JSON.parse(data) as SimulationSnapshot;
      logger.logSimulationEvent('Snapshot loaded from persistence', {
        driver: 'file',
        path: customPath,
        day: snapshot.day,
      });
      return snapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.logSimulationEvent('No existing snapshot found, starting fresh', { driver: 'file', snapshotId });
        return null;
      }
      logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
        'Error loading snapshot', {
          driver: 'file',
          snapshotId,
          error: error instanceof Error ? error.message : String(error)
        });
      return null;
    }
  }
  return loadSnapshotFromFile();
};

export const saveSnapshot = async (snapshot: SimulationSnapshot, snapshotId?: string): Promise<void> => {
  if (getPersistenceDriver() === 'postgres') {
    const adapter = getPostgresAdapter();
    return adapter.saveSnapshot(snapshot, snapshotId);
  }
  // For file persistence, use snapshotId in filename if provided
  if (snapshotId) {
    const fullPath = getPersistFilePath();
    const dir = dirname(fullPath);
    const baseName = fullPath.replace(/\.[^/.]+$/, '');
    const ext = fullPath.match(/\.[^/.]+$/) || ['.json'];
    const customPath = `${baseName}_${snapshotId}${ext}`;
    await ensureDirectoryExists(customPath);
    await fs.writeFile(customPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    // Snapshot save logging removed to reduce terminal noise
    return;
  }
  return saveSnapshotToFile(snapshot);
};

export const cleanupHistorySnapshots = async (): Promise<HistoryCleanupResult> => {
  if (getPersistenceDriver() !== 'postgres') {
    throw new Error('History cleanup is only available for Postgres persistence');
  }

  const adapter = getPostgresAdapter();
  return adapter.cleanupHistoryTable();
};

export const clearSnapshot = async (snapshotId?: string): Promise<void> => {
  if (getPersistenceDriver() === 'postgres') {
    const adapter = getPostgresAdapter();
    return adapter.clearSnapshot(snapshotId);
  }
  // For file persistence, delete the snapshot file
  if (snapshotId) {
    try {
      const fullPath = getPersistFilePath();
      const baseName = fullPath.replace(/\.[^/.]+$/, '');
      const ext = fullPath.match(/\.[^/.]+$/) || ['.json'];
      const customPath = `${baseName}_${snapshotId}${ext}`;
      await fs.unlink(customPath);
      logger.logSimulationEvent('Cleared file snapshot', { driver: 'file', path: customPath });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
          'Failed to clear file snapshot', {
            driver: 'file',
            snapshotId,
            error: error instanceof Error ? error.message : String(error)
          });
      }
    }
    return;
  }
  return clearFileSnapshot();
};

export const closePersistence = async (): Promise<void> => {
  if (postgresAdapter) {
    await postgresAdapter.close();
    postgresAdapter = null;
  }
};

