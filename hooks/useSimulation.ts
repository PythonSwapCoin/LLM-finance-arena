
import { useState, useCallback, useEffect } from 'react';
import type { Agent, MarketData, Trade, PerformanceMetrics, Benchmark } from '../types';
import { INITIAL_AGENTS, S_P500_TICKERS, INITIAL_CASH, S_P500_BENCHMARK_ID, AI_MANAGERS_INDEX_ID } from '../constants';
import { generateNextDayMarketData, createInitialMarketData } from '../services/marketDataService';
import { getTradeDecisions } from '../services/geminiService';
import { calculateAllMetrics } from '../utils/portfolioCalculations';

export const useSimulation = () => {
  const [simulationState, setSimulationState] = useState({ day: 0, isLoading: false });
  const [marketData, setMarketData] = useState<MarketData>({});
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);

  useEffect(() => {
    const initialMarketData = createInitialMarketData(S_P500_TICKERS);
    setMarketData(initialMarketData);
    
    const initialAgentStates = INITIAL_AGENTS.map(agent => {
        const initialMetrics = calculateAllMetrics(agent.portfolio, initialMarketData, [], 0);
        return { ...agent, performanceHistory: [initialMetrics] };
    });
    setAgents(initialAgentStates);

    const initialBenchmarkMetrics = calculateAllMetrics({cash: INITIAL_CASH, positions: {}}, initialMarketData, [], 0);
    setBenchmarks([
        { id: S_P500_BENCHMARK_ID, name: 'S&P 500', performanceHistory: [initialBenchmarkMetrics] },
        { id: AI_MANAGERS_INDEX_ID, name: 'AI Managers Index', performanceHistory: [initialBenchmarkMetrics] }
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const advanceDay = useCallback(async () => {
    setSimulationState(prev => ({ ...prev, isLoading: true }));

    const nextDay = simulationState.day + 1;
    const newMarketData = generateNextDayMarketData(marketData);
    setMarketData(newMarketData);

    const updatedAgents: Agent[] = await Promise.all(
      agents.map(async (agent) => {
        try {
          const { trades: decidedTrades, rationale } = await getTradeDecisions(agent, newMarketData, nextDay);
          const newTradeHistory = [...agent.tradeHistory];
          const newPortfolio = { ...agent.portfolio, positions: { ...agent.portfolio.positions } };
          
          decidedTrades.forEach(trade => {
            const tradePrice = newMarketData[trade.ticker]?.price;
            if (!tradePrice) return;

            if (trade.action === 'buy') {
                const cost = trade.quantity * tradePrice;
                if(newPortfolio.cash >= cost) {
                    newPortfolio.cash -= cost;
                    const existingPosition = newPortfolio.positions[trade.ticker];
                    if (existingPosition) {
                        const totalCost = (existingPosition.averageCost * existingPosition.quantity) + cost;
                        existingPosition.quantity += trade.quantity;
                        existingPosition.averageCost = totalCost / existingPosition.quantity;
                    } else {
                        newPortfolio.positions[trade.ticker] = { ticker: trade.ticker, quantity: trade.quantity, averageCost: tradePrice };
                    }
                    newTradeHistory.push({ ...trade, price: tradePrice, timestamp: nextDay });
                }
            } else if (trade.action === 'sell') {
                const existingPosition = newPortfolio.positions[trade.ticker];
                if(existingPosition && existingPosition.quantity > 0) {
                    const quantityToSell = Math.min(trade.quantity, existingPosition.quantity);
                    newPortfolio.cash += quantityToSell * tradePrice;
                    existingPosition.quantity -= quantityToSell;
                    if(existingPosition.quantity === 0) {
                        delete newPortfolio.positions[trade.ticker];
                    }
                    newTradeHistory.push({ ...trade, quantity: quantityToSell, price: tradePrice, timestamp: nextDay });
                }
            }
          });

          const dailyTrades = newTradeHistory.filter(t => t.timestamp === nextDay);
          const newMetrics = calculateAllMetrics(newPortfolio, newMarketData, agent.performanceHistory, nextDay, dailyTrades);
          
          return {
            ...agent,
            portfolio: newPortfolio,
            tradeHistory: newTradeHistory,
            performanceHistory: [...agent.performanceHistory, newMetrics],
            rationale,
          };
        } catch (error) {
          console.error(`Failed to process agent ${agent.name}:`, error);
          const newMetrics = calculateAllMetrics(agent.portfolio, newMarketData, agent.performanceHistory, nextDay);
          return { ...agent, performanceHistory: [...agent.performanceHistory, newMetrics], rationale: `Error: Could not retrieve trade decision. Holding positions. ${error}`};
        }
      })
    );
    
    // Update Benchmarks
    const updatedBenchmarks = benchmarks.map(b => {
        const lastPerf = b.performanceHistory[b.performanceHistory.length - 1];
        let newTotalValue = lastPerf.totalValue;

        if (b.id === S_P500_BENCHMARK_ID) {
            const marketReturn = Object.values(newMarketData).reduce((acc, stock) => acc + stock.dailyChangePercent, 0) / Object.values(newMarketData).length;
            newTotalValue *= (1 + marketReturn);
        } else if (b.id === AI_MANAGERS_INDEX_ID) {
            const avgAgentReturn = updatedAgents.reduce((acc, agent) => acc + (agent.performanceHistory.slice(-1)[0]?.dailyReturn ?? 0), 0) / updatedAgents.length;
            newTotalValue *= (1 + avgAgentReturn);
        }
        
        const newHistory = [...b.performanceHistory];
        const newDailyReturn = (newTotalValue / lastPerf.totalValue) - 1;
        const newTotalReturn = (newTotalValue / INITIAL_CASH) - 1;
        
        const newMetrics: PerformanceMetrics = {
            ...lastPerf,
            totalValue: newTotalValue,
            dailyReturn: newDailyReturn,
            totalReturn: newTotalReturn,
            timestamp: nextDay
        };
        newHistory.push(newMetrics);
        
        return { ...b, performanceHistory: newHistory };
    });

    setBenchmarks(updatedBenchmarks);
    setAgents(updatedAgents);
    setSimulationState({ day: nextDay, isLoading: false });
  }, [simulationState.day, marketData, agents, benchmarks]);

  return { agents, benchmarks, simulationState, advanceDay };
};
