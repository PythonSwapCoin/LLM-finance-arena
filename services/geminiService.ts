import type { Agent, MarketData, Trade } from '../types';

let hasWarned = false;

export const getTradeDecisions = async (
  agent: Agent,
  _marketData: MarketData,
  _day: number,
  _timeoutMs: number = 30000
): Promise<{ trades: Omit<Trade, 'price' | 'timestamp'>[]; rationale: string }> => {
  if (!hasWarned) {
    console.warn(
      'getTradeDecisions from services/geminiService.ts is deprecated. ' +
      'The backend now handles LLM trade decisions; this frontend stub returns no trades.'
    );
    hasWarned = true;
  }

  return {
    trades: [],
    rationale: `${agent.name} trade decisions are executed by the backend service.`,
  };
};
