import { logger, LogLevel, LogCategory } from '../services/logger.js';
import type { Agent, MarketData } from '../types.js';

interface PortfolioValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

interface AgentSnapshot {
  agentId: string;
  agentName: string;
  previousValue?: number;
  currentValue: number;
}

const previousPortfolioValues = new Map<string, number>();

/**
 * Validates portfolio calculations and logs only when issues are found
 */
export const validatePortfolioCalculations = (
  agents: Agent[],
  marketData: MarketData,
  day: number,
  intradayHour: number
): void => {
  const results: { agent: string; result: PortfolioValidationResult }[] = [];

  for (const agent of agents) {
    const result = validateSinglePortfolio(agent, marketData);

    if (!result.isValid || result.warnings.length > 0) {
      results.push({ agent: agent.name, result });
    }

    // Track value changes for next validation
    const agentKey = `${agent.id}_${day}_${intradayHour}`;
    const latestPerf = agent.performanceHistory[agent.performanceHistory.length - 1];
    if (latestPerf) {
      previousPortfolioValues.set(agentKey, latestPerf.totalValue);
    }
  }

  // Only log if there are issues
  if (results.length > 0) {
    logger.log(LogLevel.WARNING, LogCategory.SIMULATION,
      `Portfolio validation issues found (Day ${day}, Hour ${intradayHour})`, {
        day,
        intradayHour,
        issues: results.map(r => ({
          agent: r.agent,
          errors: r.result.errors,
          warnings: r.result.warnings
        }))
      });
  }
};

/**
 * Validates a single agent's portfolio
 */
const validateSinglePortfolio = (
  agent: Agent,
  marketData: MarketData
): PortfolioValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Get latest performance metrics
  const latestPerf = agent.performanceHistory[agent.performanceHistory.length - 1];
  if (!latestPerf) {
    return { isValid: true, errors: [], warnings: [] }; // No performance history yet
  }

  const portfolioValue = latestPerf.totalValue;
  const cash = agent.portfolio.cash;
  const positions = Object.values(agent.portfolio.positions);

  // 1. Check if portfolio value = cash + sum of positions
  const positionsValue = positions.reduce((sum, pos) => {
    const currentPrice = marketData[pos.ticker]?.price || 0;
    return sum + (pos.quantity * currentPrice);
  }, 0);

  const calculatedValue = cash + positionsValue;
  const valueDifference = Math.abs(calculatedValue - portfolioValue);
  const valueDifferencePercent = (valueDifference / portfolioValue) * 100;

  if (valueDifferencePercent > 0.01) { // More than 0.01% difference
    errors.push(
      `Portfolio value mismatch: reported $${portfolioValue.toFixed(2)}, ` +
      `calculated $${calculatedValue.toFixed(2)} (cash: $${cash.toFixed(2)} + ` +
      `positions: $${positionsValue.toFixed(2)}), diff: ${valueDifferencePercent.toFixed(4)}%`
    );
  }

  // 2. Check if position percentages add up to reasonable amount
  const totalPositionPercent = positions.reduce((sum, pos) => {
    const currentPrice = marketData[pos.ticker]?.price || 0;
    const positionValue = pos.quantity * currentPrice;
    const positionPercent = (positionValue / portfolioValue) * 100;
    return sum + positionPercent;
  }, 0);

  const cashPercent = (cash / portfolioValue) * 100;
  const totalPercent = totalPositionPercent + cashPercent;

  if (Math.abs(totalPercent - 100) > 0.1) { // More than 0.1% off from 100%
    errors.push(
      `Position percentages don't add to 100%: positions ${totalPositionPercent.toFixed(2)}% + ` +
      `cash ${cashPercent.toFixed(2)}% = ${totalPercent.toFixed(2)}%`
    );
  }

  // 3. Check for large unexplained value changes
  const previousValue = previousPortfolioValues.get(agent.id);
  if (previousValue !== undefined) {
    const valueChange = portfolioValue - previousValue;
    const valueChangePercent = (valueChange / previousValue) * 100;

    // If value changed by more than 5%, check if it's explained by price movements
    if (Math.abs(valueChangePercent) > 5) {
      // Calculate what the portfolio would be worth if no trades happened
      const expectedValue = calculateExpectedValue(agent, previousValue, marketData);
      const unexplainedChange = Math.abs((portfolioValue - expectedValue) / previousValue * 100);

      if (unexplainedChange > 2) { // More than 2% unexplained
        warnings.push(
          `Large value change: ${valueChangePercent.toFixed(2)}% ` +
          `($${previousValue.toFixed(2)} → $${portfolioValue.toFixed(2)}). ` +
          `${unexplainedChange.toFixed(2)}% is unexplained by market movements.`
        );
      }
    }
  }

  // 4. Check for invalid positions
  for (const position of positions) {
    if (position.quantity < 0) {
      errors.push(`Negative position quantity for ${position.ticker}: ${position.quantity}`);
    }
    if (position.averageCost <= 0) {
      errors.push(`Invalid average cost for ${position.ticker}: ${position.averageCost}`);
    }
    if (!marketData[position.ticker]) {
      warnings.push(`No market data available for position ${position.ticker}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};

/**
 * Calculates expected portfolio value based on price movements only (no trades)
 */
const calculateExpectedValue = (
  agent: Agent,
  previousValue: number,
  currentMarketData: MarketData
): number => {
  // This is a simplified calculation - we don't have previous prices stored
  // So we assume the portfolio composition is the same and just apply current prices
  const positions = Object.values(agent.portfolio.positions);
  const positionsValue = positions.reduce((sum, pos) => {
    const currentPrice = currentMarketData[pos.ticker]?.price || 0;
    return sum + (pos.quantity * currentPrice);
  }, 0);

  return agent.portfolio.cash + positionsValue;
};

/**
 * Clears the previous values cache (useful when starting a new simulation)
 */
export const clearPortfolioValidationCache = (): void => {
  previousPortfolioValues.clear();
};
