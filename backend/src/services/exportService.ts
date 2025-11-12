import type { SimulationSnapshot, Agent } from '../types.js';
import { promises as fs } from 'fs';
import { dirname } from 'path';
import { logger, LogLevel, LogCategory } from './logger.js';
import { getHistoricalSimulationPeriod } from './marketDataService.js';

const EXPORT_DIR = './data/exports';

export const exportSimulationData = async (snapshot: SimulationSnapshot): Promise<string> => {
  try {
    // Ensure export directory exists
    await fs.mkdir(EXPORT_DIR, { recursive: true });

    const historicalPeriod = getHistoricalSimulationPeriod();
    
    const exportData = {
      simulation: {
        totalDays: snapshot.day + 1,
        daysProcessed: snapshot.day + 1,
        finalDay: snapshot.day,
        timestamp: new Date().toISOString(),
        mode: snapshot.mode,
        ...(historicalPeriod.start && historicalPeriod.end ? {
          historicalPeriod: {
            start: historicalPeriod.start.toISOString().split('T')[0],
            end: historicalPeriod.end.toISOString().split('T')[0],
            description: `Historical simulation using real market data from ${historicalPeriod.start.toISOString().split('T')[0]} to ${historicalPeriod.end.toISOString().split('T')[0]} (Mon-Fri)`,
            note: `Simulation processed days 0-${snapshot.day} (${snapshot.day + 1} trading days total)`
          }
        } : {}),
      },
      agents: snapshot.agents.map(agent => ({
        id: agent.id,
        name: agent.name,
        model: agent.model,
        finalPortfolio: agent.portfolio,
        trades: agent.tradeHistory.map(trade => ({
          day: Math.floor(trade.timestamp),
          intradayHour: Math.round((trade.timestamp - Math.floor(trade.timestamp)) * 10),
          timestamp: trade.timestamp,
          ticker: trade.ticker,
          action: trade.action,
          quantity: trade.quantity,
          price: trade.price,
          value: trade.quantity * trade.price,
          fees: trade.fees ?? 0,
          fairValue: trade.fairValue,
          topOfBox: trade.topOfBox,
          bottomOfBox: trade.bottomOfBox,
          justification: trade.justification,
        })),
        performance: agent.performanceHistory.map(perf => ({
          day: Math.floor(perf.timestamp),
          intradayHour: perf.intradayHour ?? (Math.round((perf.timestamp - Math.floor(perf.timestamp)) * 10)),
          timestamp: perf.timestamp,
          totalValue: perf.totalValue,
          totalReturn: perf.totalReturn,
          dailyReturn: perf.dailyReturn,
          sharpeRatio: perf.sharpeRatio,
          maxDrawdown: perf.maxDrawdown,
          volatility: perf.annualizedVolatility,
          turnover: perf.turnover,
        })),
        summary: {
          totalTrades: agent.tradeHistory.length,
          finalValue: agent.performanceHistory[agent.performanceHistory.length - 1]?.totalValue || 0,
          totalReturn: agent.performanceHistory[agent.performanceHistory.length - 1]?.totalReturn || 0,
          finalSharpeRatio: agent.performanceHistory[agent.performanceHistory.length - 1]?.sharpeRatio || 0,
        }
      })),
    };

    const filename = `simulation-export-day-${snapshot.day}-${new Date().toISOString().split('T')[0]}.json`;
    const filepath = `${EXPORT_DIR}/${filename}`;
    
    await fs.writeFile(filepath, JSON.stringify(exportData, null, 2), 'utf-8');
    
    logger.logSimulationEvent('Simulation data exported', { 
      filepath, 
      day: snapshot.day 
    });
    
    return filepath;
  } catch (error) {
    logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
      'Failed to export simulation data', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    throw error;
  }
};

