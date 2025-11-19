import React, { useMemo } from 'react';
import type { Agent, PerformanceMetrics } from '../types';
import { INITIAL_CASH } from '../constants';
import { MainPerformanceChart } from './MainPerformanceChart';

const buildHistory = (values: number[]): PerformanceMetrics[] => {
  return values.map((value, index) => ({
    totalValue: value,
    totalReturn: value / INITIAL_CASH - 1,
    dailyReturn: 0,
    annualizedVolatility: 0,
    sharpeRatio: 0,
    maxDrawdown: 0,
    turnover: 0,
    timestamp: index,
  }));
};

const createAgent = (id: string, name: string, color: string, values: number[]): Agent => ({
  id,
  name,
  model: name,
  color,
  portfolio: { cash: 0, positions: {} },
  tradeHistory: [],
  performanceHistory: buildHistory(values),
  rationale: '',
  rationaleHistory: {},
  memory: undefined,
});

export const SyntheticChartDemo: React.FC = () => {
  const startDate = '2025-11-10T00:00:00-05:00';

  const participants = useMemo(() => {
    const bulls = createAgent('agent-bull', 'Momentum Alpha', '#3b82f6', [
      1_000_000,
      1_010_000,
      1_025_000,
      1_040_000,
      1_060_000,
      1_085_000,
    ]);

    const value = createAgent('agent-value', 'Value Hunter', '#f97316', [
      1_000_000,
      995_000,
      1_005_000,
      1_015_000,
      1_020_000,
      1_045_000,
    ]);

    return [bulls, value];
  }, []);

  return (
    <div className="min-h-screen bg-arena-bg text-arena-text-primary p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Weekend Skip Demo</h1>
        <p className="text-arena-text-secondary max-w-2xl">
          Synthetic six-day dataset that starts on Monday, November 10, 2025 and runs through Monday,
          November 17, 2025. The chart below reuses the production MainPerformanceChart component so we can
          verify that weekend dates (Nov 15-16) are skipped and the timeline jumps directly from Friday to
          the following Monday.
        </p>
      </div>
      <MainPerformanceChart
        participants={participants}
        startDate={startDate}
        simulationMode="historical"
        currentDate="2025-11-17T00:00:00-05:00"
      />
    </div>
  );
};
