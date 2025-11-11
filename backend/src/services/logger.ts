export enum LogLevel {
  DEBUG = 'DEBUG',
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
  private maxLogs = 1000;
  private sessionId: string;
  private logLevel: LogLevel;

  constructor() {
    this.sessionId = `session-${Date.now()}`;
    const envLevel = process.env.LOG_LEVEL || 'INFO';
    this.logLevel = LogLevel[envLevel as keyof typeof LogLevel] || LogLevel.INFO;
    this.log(LogLevel.INFO, LogCategory.SYSTEM, 'Logger initialized', { sessionId: this.sessionId });
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.ERROR, LogLevel.WARNING, LogLevel.INFO, LogLevel.SUCCESS, LogLevel.DEBUG];
    const currentIndex = levels.indexOf(this.logLevel);
    const messageIndex = levels.indexOf(level);
    return messageIndex <= currentIndex;
  }

  private redactApiKey(str: string): string {
    if (!str) return str;
    return str.replace(/(api[_-]?key|apikey|token|secret)\s*[:=]\s*['"]?([a-zA-Z0-9_-]{10,})['"]?/gi, '$1: [REDACTED]');
  }

  log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    details?: any,
    error?: Error | string
  ): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      details: details ? JSON.parse(JSON.stringify(details)) : undefined,
      error: error instanceof Error ? error.message : String(error || ''),
    };

    // Redact API keys from details
    if (entry.details) {
      const detailsStr = JSON.stringify(entry.details);
      entry.details = JSON.parse(this.redactApiKey(detailsStr));
    }

    this.logs.push(entry);

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    const consoleMethod = level === LogLevel.ERROR ? 'error' : level === LogLevel.WARNING ? 'warn' : 'log';
    const prefix = `[${level}] [${category}]`;
    const safeDetails = entry.details ? this.redactApiKey(JSON.stringify(entry.details)) : '';
    console[consoleMethod](prefix, message, safeDetails || '', entry.error || '');
  }

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

  getLogs(level?: LogLevel, limit?: number): LogEntry[] {
    let logs = [...this.logs];
    if (level) {
      logs = logs.filter(log => log.level === level);
    }
    if (limit) {
      logs = logs.slice(-limit);
    }
    return logs;
  }

  getRecentLogs(count: number = 50): LogEntry[] {
    return this.logs.slice(-count);
  }
}

export const logger = new Logger();

