import { promises as fs } from 'fs';
import { logger, LogLevel, LogCategory } from './logger.js';

const LOG_EXPORT_DIR = './data/logs';

export const exportLogs = async (): Promise<string> => {
  try {
    // Ensure export directory exists
    await fs.mkdir(LOG_EXPORT_DIR, { recursive: true });

    const allLogs = logger.getLogs();
    const sessionId = `session-${Date.now()}`;
    
    const exportData = {
      sessionId,
      exportTimestamp: new Date().toISOString(),
      totalLogs: allLogs.length,
      logs: allLogs,
    };

    const filename = `simulation-logs-${sessionId}-${new Date().toISOString().split('T')[0]}.json`;
    const filepath = `${LOG_EXPORT_DIR}/${filename}`;
    
    await fs.writeFile(filepath, JSON.stringify(exportData, null, 2), 'utf-8');
    
    logger.logSimulationEvent('Logs exported', { filepath, logCount: allLogs.length });
    
    return filepath;
  } catch (error) {
    logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
      'Failed to export logs', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    throw error;
  }
};

