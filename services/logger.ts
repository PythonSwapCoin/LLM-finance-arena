/**
 * Logger Service
 * Tracks API calls, errors, and important events during simulation
 */

export enum LogLevel {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  SUCCESS = 'SUCCESS',
}

export enum LogCategory {
  API = 'API',
  SIMULATION = 'SIMULATION',
  MARKET_DATA = 'MARKET_DATA',
  LLM = 'LLM',
  SYSTEM = 'SYSTEM',
  TRADE = 'TRADE',
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  details?: any;
  error?: string;
}

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 1000; // Keep last 1000 logs in memory
  private sessionId: string;

  constructor() {
    this.sessionId = `session-${Date.now()}`;
    this.log(LogLevel.INFO, LogCategory.SYSTEM, 'Logger initialized', { sessionId: this.sessionId });
  }

  /**
   * Add a log entry
   */
  log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    details?: any,
    error?: Error | string
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      details: details ? JSON.parse(JSON.stringify(details)) : undefined, // Deep clone to avoid reference issues
      error: error instanceof Error ? error.message : error,
    };

    this.logs.push(entry);

    // Keep only last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Also log to console for debugging
    const consoleMethod = level === LogLevel.ERROR ? 'error' : level === LogLevel.WARNING ? 'warn' : 'log';
    const prefix = `[${level}] [${category}]`;
    console[consoleMethod](prefix, message, details || '', error || '');
  }

  /**
   * Log API call
   */
  logApiCall(
    apiName: string,
    endpoint: string,
    success: boolean,
    statusCode?: number,
    error?: Error | string,
    responseTime?: number
  ): void {
    const level = success ? LogLevel.SUCCESS : LogLevel.ERROR;
    const message = success
      ? `API call successful: ${apiName}`
      : `API call failed: ${apiName}`;
    
    this.log(
      level,
      LogCategory.API,
      message,
      {
        apiName,
        endpoint,
        statusCode,
        responseTime: responseTime ? `${responseTime}ms` : undefined,
      },
      error
    );
  }

  /**
   * Log market data fetch
   */
  logMarketData(
    source: string,
    ticker: string,
    success: boolean,
    price?: number,
    error?: Error | string
  ): void {
    const level = success ? LogLevel.SUCCESS : LogLevel.ERROR;
    const message = success
      ? `Market data fetched: ${ticker} from ${source}`
      : `Market data fetch failed: ${ticker} from ${source}`;
    
    this.log(
      level,
      LogCategory.MARKET_DATA,
      message,
      {
        source,
        ticker,
        price,
      },
      error
    );
  }

  /**
   * Log LLM API call
   */
  logLLMCall(
    agentName: string,
    model: string,
    success: boolean,
    tokensUsed?: number,
    responseTime?: number,
    error?: Error | string
  ): void {
    const level = success ? LogLevel.SUCCESS : LogLevel.ERROR;
    const message = success
      ? `LLM call successful: ${agentName} (${model})`
      : `LLM call failed: ${agentName} (${model})`;
    
    this.log(
      level,
      LogCategory.LLM,
      message,
      {
        agentName,
        model,
        tokensUsed,
        responseTime: responseTime ? `${responseTime}ms` : undefined,
      },
      error
    );
  }

  /**
   * Log simulation event
   */
  logSimulationEvent(
    event: string,
    details?: any
  ): void {
    this.log(
      LogLevel.INFO,
      LogCategory.SIMULATION,
      event,
      details
    );
  }

  /**
   * Log trade execution
   */
  logTrade(
    agentName: string,
    ticker: string,
    action: string,
    quantity: number,
    price: number,
    success: boolean,
    error?: string
  ): void {
    const level = success ? LogLevel.SUCCESS : LogLevel.ERROR;
    const message = success
      ? `Trade executed: ${agentName} ${action} ${quantity} ${ticker} @ $${price.toFixed(2)}`
      : `Trade failed: ${agentName} ${action} ${quantity} ${ticker}`;
    
    this.log(
      level,
      LogCategory.TRADE,
      message,
      {
        agentName,
        ticker,
        action,
        quantity,
        price,
      },
      error
    );
  }

  /**
   * Get all logs
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Get logs by category
   */
  getLogsByCategory(category: LogCategory): LogEntry[] {
    return this.logs.filter(log => log.category === category);
  }

  /**
   * Get logs by level
   */
  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter(log => log.level === level);
  }

  /**
   * Get error logs
   */
  getErrors(): LogEntry[] {
    return this.logs.filter(log => log.level === LogLevel.ERROR);
  }

  /**
   * Get API status summary
   */
  getApiStatusSummary(): {
    total: number;
    successful: number;
    failed: number;
    apis: { [apiName: string]: { total: number; successful: number; failed: number } };
  } {
    const apiLogs = this.getLogsByCategory(LogCategory.API);
    const summary = {
      total: apiLogs.length,
      successful: 0,
      failed: 0,
      apis: {} as { [apiName: string]: { total: number; successful: number; failed: number } },
    };

    apiLogs.forEach(log => {
      const apiName = log.details?.apiName || 'unknown';
      if (!summary.apis[apiName]) {
        summary.apis[apiName] = { total: 0, successful: 0, failed: 0 };
      }
      summary.apis[apiName].total++;
      if (log.level === LogLevel.SUCCESS) {
        summary.successful++;
        summary.apis[apiName].successful++;
      } else if (log.level === LogLevel.ERROR) {
        summary.failed++;
        summary.apis[apiName].failed++;
      }
    });

    return summary;
  }

  /**
   * Get system health summary
   */
  getHealthSummary(): {
    totalLogs: number;
    errors: number;
    warnings: number;
    apiStatus: ReturnType<typeof this.getApiStatusSummary>;
    recentErrors: LogEntry[];
  } {
    return {
      totalLogs: this.logs.length,
      errors: this.getLogsByLevel(LogLevel.ERROR).length,
      warnings: this.getLogsByLevel(LogLevel.WARNING).length,
      apiStatus: this.getApiStatusSummary(),
      recentErrors: this.getErrors().slice(-10), // Last 10 errors
    };
  }

  /**
   * Export logs to JSON file
   */
  exportLogs(): void {
    const exportData = {
      sessionId: this.sessionId,
      exportTimestamp: new Date().toISOString(),
      summary: this.getHealthSummary(),
      logs: this.logs,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simulation-logs-${this.sessionId}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.log(LogLevel.INFO, LogCategory.SYSTEM, 'Logs exported', { logCount: this.logs.length });
  }

  /**
   * Clear logs
   */
  clear(): void {
    this.logs = [];
    this.log(LogLevel.INFO, LogCategory.SYSTEM, 'Logs cleared');
  }

  /**
   * Get recent logs (last N entries)
   */
  getRecentLogs(count: number = 50): LogEntry[] {
    return this.logs.slice(-count);
  }
}

// Export singleton instance
export const logger = new Logger();

