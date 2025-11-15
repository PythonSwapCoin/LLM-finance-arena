import { describe, it, expect, beforeAll } from '@jest/globals';
import { step, tradeWindow, advanceDay } from '../simulation/engine';
import type { MarketData, Agent, Benchmark } from '../../../shared/types';
import { INITIAL_CASH } from '../constants';

// Simple smoke test for engine functions
describe('Simulation Engine', () => {
  const mockMarketData: MarketData = {
    AAPL: {
      ticker: 'AAPL',
      price: 150,
      dailyChange: 2,
      dailyChangePercent: 0.013,
    },
    MSFT: {
      ticker: 'MSFT',
      price: 300,
      dailyChange: -1,
      dailyChangePercent: -0.003,
    },
  };

  const mockAgent: Agent = {
    id: 'test-agent',
    name: 'Test Agent',
    model: 'test-model',
    color: '#000000',
    portfolio: {
      cash: INITIAL_CASH,
      positions: {},
    },
    tradeHistory: [],
    performanceHistory: [],
    rationale: 'Test',
    rationaleHistory: { 0: 'Test' },
  };

  const mockBenchmark: Benchmark = {
    id: 'SPY',
    name: 'S&P 500',
    color: '#A3A3A3',
    performanceHistory: [],
  };

  it('step() should update portfolio values with new market data', async () => {
    const snapshot = {
      day: 0,
      intradayHour: 0,
      marketData: mockMarketData,
      agents: [mockAgent],
      benchmarks: [mockBenchmark],
    };

    const newMarketData: MarketData = {
      ...mockMarketData,
      AAPL: { ...mockMarketData.AAPL, price: 155 },
    };

    const result = await step(snapshot, newMarketData);

    expect(result.marketData).toEqual(newMarketData);
    expect(result.agents.length).toBe(1);
    expect(result.agents[0].performanceHistory.length).toBeGreaterThan(0);
  });

  it('advanceDay() should increment day and reset intraday hour', async () => {
    const snapshot = {
      day: 0,
      intradayHour: 6,
      marketData: mockMarketData,
      agents: [mockAgent],
      benchmarks: [mockBenchmark],
    };

    const newMarketData: MarketData = {
      ...mockMarketData,
      AAPL: { ...mockMarketData.AAPL, price: 152 },
    };

    const result = await advanceDay(snapshot, newMarketData);

    expect(result.day).toBe(1);
    expect(result.intradayHour).toBe(0);
  });
});


