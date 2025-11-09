import { useState, useCallback, useEffect } from 'react';
import type { Agent, MarketData, Benchmark } from '../types';

// API base URL - use relative path for same origin, or environment variable for different origin
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

interface SimulationState {
  day: number;
  intradayHour: number;
  isLoading: boolean;
}

interface SimulationResponse {
  simulationState: SimulationState;
  marketData: MarketData;
  agents: Agent[];
  benchmarks: Benchmark[];
}

export const useSimulation = () => {
  const [simulationState, setSimulationState] = useState<SimulationState>({ day: 0, intradayHour: 0, isLoading: false });
  const [marketData, setMarketData] = useState<MarketData>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);

  // Fetch simulation state from API
  const fetchSimulationState = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/simulation/state`);
      if (!response.ok) {
        throw new Error(`Failed to fetch simulation state: ${response.statusText}`);
      }
      const data: SimulationResponse = await response.json();
      setSimulationState(data.simulationState);
      setMarketData(data.marketData);
      setAgents(data.agents);
      setBenchmarks(data.benchmarks);
    } catch (error) {
      console.error('Error fetching simulation state:', error);
    }
  }, []);

  // Initialize on mount
  useEffect(() => {
    fetchSimulationState();
  }, [fetchSimulationState]);

  // Advance intraday
  const advanceIntraday = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/simulation/advance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'intraday' }),
      });
      if (!response.ok) {
        throw new Error(`Failed to advance intraday: ${response.statusText}`);
      }
      const data: SimulationResponse = await response.json();
      setSimulationState(data.simulationState);
      setMarketData(data.marketData);
      setAgents(data.agents);
      setBenchmarks(data.benchmarks);
    } catch (error) {
      console.error('Error advancing intraday:', error);
    }
  }, []);

  // Advance day
  const advanceDay = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/simulation/advance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'day' }),
      });
      if (!response.ok) {
        throw new Error(`Failed to advance day: ${response.statusText}`);
      }
      const data: SimulationResponse = await response.json();
      setSimulationState(data.simulationState);
      setMarketData(data.marketData);
      setAgents(data.agents);
      setBenchmarks(data.benchmarks);
    } catch (error) {
      console.error('Error advancing day:', error);
    }
  }, []);

  // Export simulation data
  const exportSimulationData = useCallback(() => {
    const exportData = {
      simulation: {
        totalDays: simulationState.day + 1,
        daysProcessed: simulationState.day + 1,
        finalDay: simulationState.day,
        timestamp: new Date().toISOString(),
      },
      agents: agents.map(agent => ({
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
          fairValue: trade.fairValue,
          topOfBox: trade.topOfBox,
          bottomOfBox: trade.bottomOfBox,
          justification: trade.justification,
        })),
        valuationAnalysis: agent.tradeHistory
          .filter(trade => trade.fairValue !== undefined || trade.topOfBox !== undefined || trade.bottomOfBox !== undefined || trade.justification)
          .map(trade => ({
            day: Math.floor(trade.timestamp),
            intradayHour: Math.round((trade.timestamp - Math.floor(trade.timestamp)) * 10),
            timestamp: trade.timestamp,
            ticker: trade.ticker,
            action: trade.action,
            currentPrice: trade.price,
            fairValue: trade.fairValue,
            topOfBox: trade.topOfBox,
            bottomOfBox: trade.bottomOfBox,
            justification: trade.justification || 'No justification provided',
          })),
        dailyRationales: agent.rationaleHistory,
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

    // Create and download JSON file
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `simulation-export-day-${simulationState.day}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [agents, simulationState.day]);

  return { agents, benchmarks, simulationState, marketData, advanceDay, advanceIntraday, exportSimulationData };
};
