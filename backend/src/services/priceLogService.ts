import { promises as fs } from 'fs';
import type { MarketData, Agent, Portfolio } from '../types.js';
import { logger, LogLevel, LogCategory } from './logger.js';
import { calculatePortfolioValue } from '../utils/portfolioCalculations.js';

const PRICE_LOG_DIR = './data/logs';

interface StockPriceLog {
  ticker: string;
  price: number;
  dailyChange: number;
  dailyChangePercent: number;
  timestamp: number;
  day: number;
  intradayHour: number;
}

interface PositionLog {
  ticker: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  positionValue: number;
}

interface PortfolioValueLog {
  simulationId?: string;
  agentId: string;
  agentName: string;
  day: number;
  intradayHour: number;
  timestamp: number;
  cash: number;
  positions: PositionLog[];
  totalValue: number;
  previousValue?: number;
  valueChange?: number;
  valueChangePercent?: number;
}

interface PriceLogEntry {
  simulationId?: string;
  timestamp: number;
  day: number;
  intradayHour: number;
  stockPrices: StockPriceLog[];
  portfolioValues: PortfolioValueLog[];
}

class PriceLogService {
  private logs: PriceLogEntry[] = [];
  private previousPortfolioValues: Map<string, number> = new Map();
  private maxLogs = 10000; // Keep more logs for price tracking

  private getSimulationKey(simulationId?: string): string {
    return simulationId ?? 'default';
  }

  /**
   * Log stock prices and portfolio values for a given time step
   */
  logPricesAndPortfolios(
    marketData: MarketData,
    agents: Agent[],
    day: number,
    intradayHour: number,
    timestamp: number,
    simulationId?: string
  ): void {
    try {
      const simulationKey = this.getSimulationKey(simulationId);

      // Validate inputs
      if (!marketData || Object.keys(marketData).length === 0) {
        logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
          'Price logging skipped: empty market data', { day, intradayHour });
        return;
      }
      if (!agents || agents.length === 0) {
        logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
          'Price logging skipped: no agents', { day, intradayHour });
        return;
      }

      // Log stock prices
      const stockPrices: StockPriceLog[] = Object.values(marketData).map(tickerData => ({
        ticker: tickerData.ticker,
        price: tickerData.price,
        dailyChange: tickerData.dailyChange,
        dailyChangePercent: tickerData.dailyChangePercent,
        timestamp,
        day,
        intradayHour,
      }));

      // Log portfolio values
      const portfolioValues: PortfolioValueLog[] = agents.map(agent => {
        // Calculate positions - include ALL positions, even if price is 0 or missing
        const positions: PositionLog[] = Object.values(agent.portfolio.positions)
          .filter(position => position.quantity > 0) // Only include positions with quantity > 0
          .map(position => {
            const currentPrice = marketData[position.ticker]?.price || 0;
            return {
              ticker: position.ticker,
              quantity: position.quantity,
              averageCost: position.averageCost,
              currentPrice,
              positionValue: position.quantity * currentPrice,
            };
          });

        // Calculate total value: cash + sum of all position values
        const positionsValue = positions.reduce((sum, pos) => sum + pos.positionValue, 0);
        const totalValue = agent.portfolio.cash + positionsValue;
        
        // Verify calculation matches what's in performance history
        const expectedTotalValue = calculatePortfolioValue(agent.portfolio, marketData);
        if (Math.abs(totalValue - expectedTotalValue) > 0.01) {
          logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
            'Portfolio value mismatch in logging', {
              agentId: agent.id,
              loggedValue: totalValue,
              calculatedValue: expectedTotalValue,
              cash: agent.portfolio.cash,
              positionsCount: positions.length,
              positionsValue
            });
        }
        
        const previousKey = `${simulationKey}:${agent.id}`;
        const previousValue = this.previousPortfolioValues.get(previousKey);
        const valueChange = previousValue !== undefined ? totalValue - previousValue : undefined;
        // Store as decimal (0.01 = 1%), not percentage, to match dailyReturn format
        const valueChangePercent = previousValue !== undefined && previousValue > 0 
          ? (valueChange! / previousValue)
          : undefined;

        // Update previous value
        this.previousPortfolioValues.set(previousKey, totalValue);

        return {
          simulationId: simulationKey,
          agentId: agent.id,
          agentName: agent.name,
          day,
          intradayHour,
          timestamp,
          cash: agent.portfolio.cash,
          positions,
          totalValue,
          previousValue,
          valueChange,
          valueChangePercent,
        };
      });

      const logEntry: PriceLogEntry = {
        simulationId: simulationKey,
        timestamp,
        day,
        intradayHour,
        stockPrices,
        portfolioValues,
      };

      this.logs.push(logEntry);

      // Keep only last maxLogs entries
      if (this.logs.length > this.maxLogs) {
        this.logs.shift();
      }
    } catch (error) {
      logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
        'Failed to log prices and portfolios', {
          error: error instanceof Error ? error.message : String(error)
        });
    }
  }

  /**
   * Get all price logs
   */
  getLogs(): PriceLogEntry[] {
    return [...this.logs];
  }

  /**
   * Get logs filtered by day
   */
  getLogsByDay(day: number): PriceLogEntry[] {
    return this.logs.filter(log => log.day === day);
  }

  /**
   * Get logs filtered by day range
   */
  getLogsByDayRange(startDay: number, endDay: number): PriceLogEntry[] {
    return this.logs.filter(log => log.day >= startDay && log.day <= endDay);
  }

  /**
   * Get price history for a specific ticker
   */
  getTickerPriceHistory(ticker: string): StockPriceLog[] {
    const tickerLogs: StockPriceLog[] = [];
    this.logs.forEach(log => {
      const tickerData = log.stockPrices.find(sp => sp.ticker === ticker);
      if (tickerData) {
        tickerLogs.push(tickerData);
      }
    });
    return tickerLogs;
  }

  /**
   * Get portfolio value history for a specific agent
   */
  getAgentPortfolioHistory(agentId: string): PortfolioValueLog[] {
    const agentLogs: PortfolioValueLog[] = [];
    this.logs.forEach(log => {
      const agentData = log.portfolioValues.find(pv => pv.agentId === agentId);
      if (agentData) {
        agentLogs.push(agentData);
      }
    });
    return agentLogs;
  }

  /**
   * Export price logs to a JSON file
   */
  async exportLogs(): Promise<string> {
    try {
      // Ensure export directory exists
      await fs.mkdir(PRICE_LOG_DIR, { recursive: true });

      const sessionId = `session-${Date.now()}`;
      
      // Group logs by day for easier analysis
      const logsByDay: { [day: number]: PriceLogEntry[] } = {};
      this.logs.forEach(log => {
        if (!logsByDay[log.day]) {
          logsByDay[log.day] = [];
        }
        logsByDay[log.day].push(log);
      });

      // Create summary statistics
      const summary = {
        totalEntries: this.logs.length,
        daysCovered: Object.keys(logsByDay).length,
        dayRange: {
          min: this.logs.length > 0 ? Math.min(...this.logs.map(l => l.day)) : 0,
          max: this.logs.length > 0 ? Math.max(...this.logs.map(l => l.day)) : 0,
        },
        tickers: this.logs.length > 0 
          ? [...new Set(this.logs.flatMap(l => l.stockPrices.map(sp => sp.ticker)))]
          : [],
        agents: this.logs.length > 0
          ? [...new Set(this.logs.flatMap(l => l.portfolioValues.map(pv => pv.agentId)))]
          : [],
      };

      const exportData = {
        sessionId,
        exportTimestamp: new Date().toISOString(),
        summary,
        logsByDay,
        allLogs: this.logs, // Full chronological log
      };

      const filename = `price-logs-${sessionId}-${new Date().toISOString().split('T')[0]}.json`;
      const filepath = `${PRICE_LOG_DIR}/${filename}`;
      
      await fs.writeFile(filepath, JSON.stringify(exportData, null, 2), 'utf-8');
      
      logger.log(LogLevel.INFO, LogCategory.SYSTEM,
        'Price logs exported', { filepath, logCount: this.logs.length });
      
      return filepath;
    } catch (error) {
      logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
        'Failed to export price logs', { 
          error: error instanceof Error ? error.message : String(error) 
        });
      throw error;
    }
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.logs = [];
    this.previousPortfolioValues.clear();
  }

  /**
   * Clear logs for a specific simulation (or all if no simulationId provided)
   */
  clearLogsForSimulation(simulationId?: string): void {
    if (!simulationId) {
      this.clearLogs();
      return;
    }

    const simulationKey = this.getSimulationKey(simulationId);
    this.logs = this.logs.filter(log => (log.simulationId ?? 'default') !== simulationKey);
    Array.from(this.previousPortfolioValues.keys())
      .filter(key => key.startsWith(`${simulationKey}:`))
      .forEach(key => this.previousPortfolioValues.delete(key));
  }

  /**
   * Get a summary of price movements for analysis
   */
  getPriceMovementSummary(day?: number): {
    tickers: { [ticker: string]: { min: number; max: number; start: number; end: number; change: number; changePercent: number } };
    agents: { [agentId: string]: { min: number; max: number; start: number; end: number; change: number; changePercent: number } };
  } {
    const logsToAnalyze = day !== undefined ? this.getLogsByDay(day) : this.logs;
    
    const tickerSummary: { [ticker: string]: { prices: number[]; timestamps: number[] } } = {};
    const agentSummary: { [agentId: string]: { values: number[]; timestamps: number[] } } = {};

    logsToAnalyze.forEach(log => {
      log.stockPrices.forEach(sp => {
        if (!tickerSummary[sp.ticker]) {
          tickerSummary[sp.ticker] = { prices: [], timestamps: [] };
        }
        tickerSummary[sp.ticker].prices.push(sp.price);
        tickerSummary[sp.ticker].timestamps.push(sp.timestamp);
      });

      log.portfolioValues.forEach(pv => {
        if (!agentSummary[pv.agentId]) {
          agentSummary[pv.agentId] = { values: [], timestamps: [] };
        }
        agentSummary[pv.agentId].values.push(pv.totalValue);
        agentSummary[pv.agentId].timestamps.push(pv.timestamp);
      });
    });

    const tickerResults: { [ticker: string]: { min: number; max: number; start: number; end: number; change: number; changePercent: number } } = {};
    const agentResults: { [agentId: string]: { min: number; max: number; start: number; end: number; change: number; changePercent: number } } = {};

    Object.keys(tickerSummary).forEach(ticker => {
      const data = tickerSummary[ticker];
      if (data.prices.length > 0) {
        const min = Math.min(...data.prices);
        const max = Math.max(...data.prices);
        const start = data.prices[0];
        const end = data.prices[data.prices.length - 1];
        const change = end - start;
        const changePercent = start > 0 ? (change / start) * 100 : 0;
        tickerResults[ticker] = { min, max, start, end, change, changePercent };
      }
    });

    Object.keys(agentSummary).forEach(agentId => {
      const data = agentSummary[agentId];
      if (data.values.length > 0) {
        const min = Math.min(...data.values);
        const max = Math.max(...data.values);
        const start = data.values[0];
        const end = data.values[data.values.length - 1];
        const change = end - start;
        const changePercent = start > 0 ? (change / start) * 100 : 0;
        agentResults[agentId] = { min, max, start, end, change, changePercent };
      }
    });

    return { tickers: tickerResults, agents: agentResults };
  }
}

export const priceLogService = new PriceLogService();

