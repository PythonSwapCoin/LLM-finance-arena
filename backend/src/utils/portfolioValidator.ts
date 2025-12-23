import { logger, LogLevel, LogCategory } from '../services/logger.js';
import type { Agent, MarketData } from '../types.js';
import { calculatePortfolioValue } from './portfolioCalculations.js';

// Store previous market data for top-down analysis
const previousMarketDataCache = new Map<number, MarketData>();

/**
 * Validates price movements between market data updates
 * TOP-DOWN checks: Detects unlikely patterns and anomalies
 * Only logs when failures are detected
 */
export const validatePriceMovements = (
  previousMarketData: MarketData,
  currentMarketData: MarketData,
  day: number,
  intradayHour: number
): void => {
  // Only run validation every 2 hours to reduce log noise
  if (intradayHour % 2 !== 0 && intradayHour !== 6) {
    return;
  }

  const failures: Array<{ ticker: string; issue: string; severity: 'ERROR' | 'WARNING'; details: any }> = [];

  // TOP-DOWN TEST 1: Unlikely large price movements (>20% in single tick)
  Object.keys(currentMarketData).forEach(ticker => {
    const current = currentMarketData[ticker];
    const previous = previousMarketData[ticker];

    if (!current || !previous) {
      return;
    }

    const priceChangePercent = Math.abs((current.price - previous.price) / previous.price);
    
    // ERROR: Extreme price jump (>20% in single tick is extremely unlikely)
    if (priceChangePercent > 0.20) {
      failures.push({
        ticker,
        issue: 'EXTREME price jump (>20%)',
        severity: 'ERROR',
        details: {
          previousPrice: previous.price.toFixed(2),
          currentPrice: current.price.toFixed(2),
          changePercent: (priceChangePercent * 100).toFixed(2) + '%',
          day,
          intradayHour,
          note: 'Price movements >20% in a single tick are extremely unlikely'
        }
      });
    }
    // WARNING: Large price jump (>10% but <20%)
    else if (priceChangePercent > 0.10) {
      failures.push({
        ticker,
        issue: 'Large price jump (>10%)',
        severity: 'WARNING',
        details: {
          previousPrice: previous.price.toFixed(2),
          currentPrice: current.price.toFixed(2),
          changePercent: (priceChangePercent * 100).toFixed(2) + '%',
          day,
          intradayHour
        }
      });
    }

    // ERROR: Invalid prices
    if (current.price <= 0 || current.price > 100000) {
      failures.push({
        ticker,
        issue: 'Invalid price value',
        severity: 'ERROR',
        details: {
          price: current.price,
          day,
          intradayHour
        }
      });
    }

    // ERROR: Daily change calculation inconsistency
    const expectedDailyChange = current.price - (previous.price - previous.dailyChange);
    const dailyChangeDiff = Math.abs(current.dailyChange - expectedDailyChange);
    if (dailyChangeDiff > 0.01 && previous.price > 0) {
      failures.push({
        ticker,
        issue: 'Daily change calculation inconsistency',
        severity: 'ERROR',
        details: {
          reportedDailyChange: current.dailyChange.toFixed(2),
          expectedDailyChange: expectedDailyChange.toFixed(2),
          difference: dailyChangeDiff.toFixed(2),
          day,
          intradayHour
        }
      });
    }
  });

  // TOP-DOWN TEST 2: Check for unlikely synchronized movements
  // (Multiple tickers moving >5% in same direction simultaneously is suspicious)
  const largeMovers = Object.keys(currentMarketData).filter(ticker => {
    const current = currentMarketData[ticker];
    const previous = previousMarketData[ticker];
    if (!current || !previous) return false;
    const changePercent = Math.abs((current.price - previous.price) / previous.price);
    return changePercent > 0.05;
  });

  if (largeMovers.length > 5) {
    failures.push({
      ticker: 'MULTIPLE',
      issue: 'Unlikely synchronized price movements',
      severity: 'WARNING',
      details: {
        count: largeMovers.length,
        tickers: largeMovers,
        day,
        intradayHour,
        note: 'More than 5 tickers moved >5% simultaneously - unlikely in real markets'
      }
    });
  }

  // TOP-DOWN TEST 3: Check day-over-day price changes (at day transitions)
  if (intradayHour === 0 && day > 0) {
    const previousDayData = previousMarketDataCache.get(day - 1);
    if (previousDayData) {
      Object.keys(currentMarketData).forEach(ticker => {
        const current = currentMarketData[ticker];
        const prevDayClose = previousDayData[ticker];
        if (!current || !prevDayClose) return;
        
        const dayOverDayChange = Math.abs((current.price - prevDayClose.price) / prevDayClose.price);
        // ERROR: Day-over-day change >30% is extremely unlikely
        if (dayOverDayChange > 0.30) {
          failures.push({
            ticker,
            issue: 'EXTREME day-over-day price change (>30%)',
            severity: 'ERROR',
            details: {
              previousDayClose: prevDayClose.price.toFixed(2),
              currentDayOpen: current.price.toFixed(2),
              changePercent: (dayOverDayChange * 100).toFixed(2) + '%',
              day,
              intradayHour,
              note: 'Day-over-day changes >30% are extremely rare in real markets'
            }
          });
        }
      });
    }
  }

  // Store current market data for next day comparison
  if (intradayHour === 6) {
    previousMarketDataCache.set(day, { ...currentMarketData });
  }

  // Only log failures - no success messages
  if (failures.length > 0) {
    const errors = failures.filter(f => f.severity === 'ERROR');
    const warnings = failures.filter(f => f.severity === 'WARNING');
    
    // Get S&P 500 price and change for consistency testing
    const sp500Data = currentMarketData['^GSPC'];
    const sp500Price = sp500Data?.price || 0;
    const sp500Change = sp500Data?.dailyChange || 0;
    const sp500ChangePercent = sp500Data?.dailyChangePercent || 0;
    
    logger.log(LogLevel.ERROR, LogCategory.MARKET_DATA,
      `🚨 [PRICE VALIDATION FAILURE] Day ${day}, Hour ${intradayHour.toFixed(1)}: ${errors.length} ERROR(s), ${warnings.length} WARNING(s) | S&P 500: $${sp500Price.toFixed(2)} (${sp500Change >= 0 ? '+' : ''}${sp500Change.toFixed(2)}, ${sp500ChangePercent >= 0 ? '+' : ''}${(sp500ChangePercent * 100).toFixed(2)}%)`, {
        day,
        intradayHour,
        errorCount: errors.length,
        warningCount: warnings.length,
        failures: failures.map(f => ({
          ticker: f.ticker,
          severity: f.severity,
          issue: f.issue,
          ...f.details
        })),
        sp500: {
          price: sp500Price.toFixed(2),
          dailyChange: sp500Change.toFixed(2),
          dailyChangePercent: (sp500ChangePercent * 100).toFixed(2) + '%'
        }
      });
  }
};

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

// Cache key format: "simulationId:agentId:day:intradayHour" to prevent cross-day contamination
const previousPortfolioValues = new Map<string, number>();
const latestPortfolioValues = new Map<string, number>();

const getSimulationKey = (simulationId?: string): string => simulationId ?? 'default';

const buildCacheKey = (simulationId: string, agentId: string, day: number, intradayHour: number): string =>
  `${simulationId}:${agentId}:${day}:${intradayHour}`;

const buildLatestKey = (simulationId: string, agentId: string): string =>
  `${simulationId}:${agentId}`;

/**
 * Validates portfolio calculations and logs validation results
 * Runs comprehensive tests and logs results
 */
export const validatePortfolioCalculations = (
  agents: Agent[],
  marketData: MarketData,
  day: number,
  intradayHour: number,
  simulationId?: string
): void => {
  const results: { agent: string; result: PortfolioValidationResult }[] = [];
  const INITIAL_CASH = 1000000; // Should match constants
  const simulationKey = getSimulationKey(simulationId);

  // Run detailed validation tests at market close (hour 6) or every 2 hours
  const shouldRunTests = intradayHour === 6 || intradayHour % 2 === 0;

  for (const agent of agents) {
    const result = validateSinglePortfolio(agent, marketData, simulationKey);
    const portfolioValue = calculatePortfolioValue(agent.portfolio, marketData);
    
    // Always check for errors/warnings
    if (!result.isValid || result.warnings.length > 0) {
      results.push({ agent: agent.name, result });
    }

    // Run comprehensive validation tests (BOTTOM-UP + TOP-DOWN)
    if (shouldRunTests) {
      const positionsValue = Object.values(agent.portfolio.positions).reduce((sum, pos) => {
        const currentPrice = marketData[pos.ticker]?.price || 0;
        return sum + (pos.quantity * currentPrice);
      }, 0);
      const cash = agent.portfolio.cash;
      const calculatedTotal = cash + positionsValue;
      const cashPercent = portfolioValue > 0 ? (cash / portfolioValue) * 100 : 0;
      const positionsPercent = portfolioValue > 0 ? (positionsValue / portfolioValue) * 100 : 0;
      const deviationFromInitial = ((portfolioValue - INITIAL_CASH) / INITIAL_CASH) * 100;

      const testFailures: Array<{ test: string; severity: 'ERROR' | 'WARNING'; details: any }> = [];

      // BOTTOM-UP TEST 1: Cash + Positions = Portfolio Value
      const valueDifference = Math.abs(calculatedTotal - portfolioValue);
      const valueDifferencePercent = portfolioValue > 0 ? (valueDifference / portfolioValue) * 100 : 0;
      if (valueDifferencePercent >= 0.01) {
        testFailures.push({
          test: 'Cash + Positions = Portfolio Value',
          severity: 'ERROR',
          details: {
            calculated: calculatedTotal.toFixed(2),
            reported: portfolioValue.toFixed(2),
            difference: valueDifference.toFixed(2),
            differencePercent: valueDifferencePercent.toFixed(4) + '%'
          }
        });
      }
      
      // BOTTOM-UP TEST 2: Cash + Positions percentages = 100%
      const totalPercent = cashPercent + positionsPercent;
      if (Math.abs(totalPercent - 100) >= 0.1) {
        testFailures.push({
          test: 'Percentages add to 100%',
          severity: 'ERROR',
          details: {
            cashPercent: cashPercent.toFixed(2) + '%',
            positionsPercent: positionsPercent.toFixed(2) + '%',
            totalPercent: totalPercent.toFixed(2) + '%'
          }
        });
      }
      
      // BOTTOM-UP TEST 3: Portfolio value is reasonable
      if (portfolioValue <= 0 || portfolioValue >= INITIAL_CASH * 10) {
        testFailures.push({
          test: 'Portfolio value is reasonable',
          severity: 'ERROR',
          details: {
            portfolioValue: portfolioValue.toFixed(2),
            expectedRange: `$0 - $${(INITIAL_CASH * 10).toFixed(2)}`
          }
        });
      }
      
      // BOTTOM-UP TEST 4: All positions have valid prices
      const positionsWithInvalidPrices = Object.values(agent.portfolio.positions).filter(pos => {
        const price = marketData[pos.ticker]?.price || 0;
        return price <= 0 || price > 100000;
      });
      if (positionsWithInvalidPrices.length > 0) {
        testFailures.push({
          test: 'All positions have valid prices',
          severity: 'ERROR',
          details: {
            invalidPositions: positionsWithInvalidPrices.length,
            positions: positionsWithInvalidPrices.map(p => p.ticker)
          }
        });
      }

      // TOP-DOWN TEST 5: Unlikely portfolio value changes
      // Use a cache key that includes day and hour to prevent cross-day contamination
      // For same-day comparisons, use the previous validation point's value
      // For day transitions (hour 0), compare against the last value of previous day (hour 6)
      const currentCacheKey = buildCacheKey(simulationKey, agent.id, day, intradayHour);
      
      // Find the most recent previous value for comparison
      let previousValue: number | undefined;
      if (intradayHour === 0 && day > 0) {
        // At start of day, try to find the last value from previous day (hour 6, then 4, then 2, then 0)
        const previousDayHours = [6, 4, 2, 0];
        for (const prevHour of previousDayHours) {
          const prevKey = buildCacheKey(simulationKey, agent.id, day - 1, prevHour);
          const cachedValue = previousPortfolioValues.get(prevKey);
          if (cachedValue !== undefined) {
            previousValue = cachedValue;
            break;
          }
        }
      } else {
        // Within day, find the most recent previous validation point
        // Validation runs at hours 0, 2, 4, 6
        const validationHours = [0, 2, 4, 6];
        let foundPreviousHour = -1;
        for (let i = validationHours.length - 1; i >= 0; i--) {
          if (validationHours[i] < intradayHour) {
            foundPreviousHour = validationHours[i];
            break;
          }
        }
        if (foundPreviousHour >= 0) {
          const prevKey = buildCacheKey(simulationKey, agent.id, day, foundPreviousHour);
          previousValue = previousPortfolioValues.get(prevKey);
        }
      }
      if (previousValue !== undefined && previousValue > 0) {
        const valueChangePercent = Math.abs((portfolioValue - previousValue) / previousValue) * 100;
        
        // ERROR: Portfolio value changed >50% in single tick (extremely unlikely without trades)
        if (valueChangePercent > 50) {
          testFailures.push({
            test: 'Portfolio value change is reasonable',
            severity: 'ERROR',
            details: {
              previousValue: previousValue.toFixed(2),
              currentValue: portfolioValue.toFixed(2),
              changePercent: valueChangePercent.toFixed(2) + '%',
              note: 'Portfolio value changed >50% in single tick - extremely unlikely without major trades'
            }
          });
        }
        // WARNING: Portfolio value changed >20% but <50%
        else if (valueChangePercent > 20) {
          testFailures.push({
            test: 'Portfolio value change is reasonable',
            severity: 'WARNING',
            details: {
              previousValue: previousValue.toFixed(2),
              currentValue: portfolioValue.toFixed(2),
              changePercent: valueChangePercent.toFixed(2) + '%',
              note: 'Large portfolio value change - verify if due to trades or price movements'
            }
          });
        }
      }

      // TOP-DOWN TEST 6: Unlikely portfolio composition (all in one position)
      const positionCount = Object.keys(agent.portfolio.positions).length;
      if (positionCount > 0) {
        const maxPositionPercent = Math.max(...Object.values(agent.portfolio.positions).map(pos => {
          const price = marketData[pos.ticker]?.price || 0;
          const positionValue = pos.quantity * price;
          return portfolioValue > 0 ? (positionValue / portfolioValue) * 100 : 0;
        }));
        
        // WARNING: More than 95% in single position (unlikely for diversified portfolios)
        if (maxPositionPercent > 95) {
          testFailures.push({
            test: 'Portfolio diversification',
            severity: 'WARNING',
            details: {
              maxPositionPercent: maxPositionPercent.toFixed(2) + '%',
              note: 'More than 95% of portfolio in single position - unusual concentration'
            }
          });
        }
      }

      // TOP-DOWN TEST 7: Unlikely cash percentage (too high or too low)
      if (cashPercent > 99.5) {
        testFailures.push({
          test: 'Portfolio allocation',
          severity: 'WARNING',
          details: {
            cashPercent: cashPercent.toFixed(2) + '%',
            note: 'Portfolio is >99.5% cash - agent may not be trading'
          }
        });
      } else if (cashPercent < 0.1 && positionCount > 0) {
        testFailures.push({
          test: 'Portfolio allocation',
          severity: 'WARNING',
          details: {
            cashPercent: cashPercent.toFixed(2) + '%',
            note: 'Portfolio is <0.1% cash - agent may be over-leveraged'
          }
        });
      }

      // Get S&P 500 price and change for consistency testing (always log at day transitions)
      const sp500Data = marketData['^GSPC'];
      const sp500Price = sp500Data?.price || 0;
      const sp500Change = sp500Data?.dailyChange || 0;
      const sp500ChangePercent = sp500Data?.dailyChangePercent || 0;
      
      // Always log S&P 500 at day transitions (hour 0) for consistency checking
      if (intradayHour === 0) {
        logger.log(LogLevel.INFO, LogCategory.SIMULATION,
          `[S&P 500] Day ${day} start: $${sp500Price.toFixed(2)} (${sp500Change >= 0 ? '+' : ''}${sp500Change.toFixed(2)}, ${sp500ChangePercent >= 0 ? '+' : ''}${(sp500ChangePercent * 100).toFixed(2)}%)`, {
            day,
            intradayHour,
            sp500: {
              price: sp500Price.toFixed(2),
              dailyChange: sp500Change.toFixed(2),
              dailyChangePercent: (sp500ChangePercent * 100).toFixed(2) + '%'
            }
          });
      }
      
      // Only log if tests failed
      if (testFailures.length > 0) {
        const errors = testFailures.filter(t => t.severity === 'ERROR');
        const warnings = testFailures.filter(t => t.severity === 'WARNING');
        
        logger.log(LogLevel.ERROR, LogCategory.SIMULATION,
          `🚨 [VALIDATION FAILURE] ${agent.name} (Day ${day}, Hour ${intradayHour.toFixed(1)}): ${errors.length} ERROR(s), ${warnings.length} WARNING(s) | S&P 500: $${sp500Price.toFixed(2)} (${sp500Change >= 0 ? '+' : ''}${sp500Change.toFixed(2)}, ${sp500ChangePercent >= 0 ? '+' : ''}${(sp500ChangePercent * 100).toFixed(2)}%)`, {
            agent: agent.name,
            day,
            intradayHour,
            errorCount: errors.length,
            warningCount: warnings.length,
            failures: testFailures.map(t => ({
              test: t.test,
              severity: t.severity,
              ...t.details
            })),
            portfolioSnapshot: {
              portfolioValue: portfolioValue.toFixed(2),
              cash: cash.toFixed(2),
              positionsValue: positionsValue.toFixed(2),
              cashPercent: cashPercent.toFixed(2) + '%',
              positionsPercent: positionsPercent.toFixed(2) + '%',
              deviationFromInitial: deviationFromInitial.toFixed(2) + '%'
            },
            sp500: {
              price: sp500Price.toFixed(2),
              dailyChange: sp500Change.toFixed(2),
              dailyChangePercent: (sp500ChangePercent * 100).toFixed(2) + '%'
            }
          });
      }
    }

    // Track value changes for next validation (store after validation for next call)
    // Use cache key that includes day and hour to prevent cross-day contamination
    const cacheKey = buildCacheKey(simulationKey, agent.id, day, intradayHour);
    previousPortfolioValues.set(cacheKey, portfolioValue);
    latestPortfolioValues.set(buildLatestKey(simulationKey, agent.id), portfolioValue);
    
    // Clean up old entries to prevent memory leak (keep only last 10 days worth)
    if (previousPortfolioValues.size > 1000) {
      const keysToDelete: string[] = [];
      for (const key of previousPortfolioValues.keys()) {
        const keyDay = parseInt(key.split(':')[2]);
        if (keyDay < day - 10) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach(key => previousPortfolioValues.delete(key));
    }
  }

  // Log errors/warnings if any
  if (results.length > 0) {
    logger.log(LogLevel.WARNING, LogCategory.SIMULATION,
      `[PORTFOLIO ERROR] Validation issues found (Day ${day}, Hour ${intradayHour})`, {
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
  marketData: MarketData,
  simulationId?: string
): PortfolioValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Calculate portfolio value from current portfolio state
  const portfolioValue = calculatePortfolioValue(agent.portfolio, marketData);
  
  // 1. Check if portfolio value = cash + sum of positions
  const positionsValue = Object.values(agent.portfolio.positions).reduce((sum, pos) => {
    const currentPrice = marketData[pos.ticker]?.price || 0;
    return sum + (pos.quantity * currentPrice);
  }, 0);

  const calculatedValue = agent.portfolio.cash + positionsValue;
  const valueDifference = Math.abs(calculatedValue - portfolioValue);
  const valueDifferencePercent = portfolioValue > 0 ? (valueDifference / portfolioValue) * 100 : 0;

  if (valueDifferencePercent > 0.01) { // More than 0.01% difference
    errors.push(
      `Portfolio value mismatch: calculated $${portfolioValue.toFixed(2)}, ` +
      `recalculated $${calculatedValue.toFixed(2)} (cash: $${agent.portfolio.cash.toFixed(2)} + ` +
      `positions: $${positionsValue.toFixed(2)}), diff: ${valueDifferencePercent.toFixed(4)}%`
    );
  }

  // 2. Check if position percentages add up to reasonable amount
  const totalPositionPercent = Object.values(agent.portfolio.positions).reduce((sum, pos) => {
    const currentPrice = marketData[pos.ticker]?.price || 0;
    const positionValue = pos.quantity * currentPrice;
    const positionPercent = portfolioValue > 0 ? (positionValue / portfolioValue) * 100 : 0;
    return sum + positionPercent;
  }, 0);

  const cashPercent = portfolioValue > 0 ? (agent.portfolio.cash / portfolioValue) * 100 : 0;
  const totalPercent = totalPositionPercent + cashPercent;

  if (Math.abs(totalPercent - 100) > 0.1) { // More than 0.1% off from 100%
    errors.push(
      `Position percentages don't add to 100%: positions ${totalPositionPercent.toFixed(2)}% + ` +
      `cash ${cashPercent.toFixed(2)}% = ${totalPercent.toFixed(2)}%`
    );
  }

  // 3. Check for large unexplained value changes
  // Note: This function doesn't have day/hour context, so we can't use the day-aware cache
  // This is a simplified check that may not be as accurate in multi-sim scenarios
  // The main validation in validatePortfolioCalculations uses the day-aware cache
  const simulationKey = getSimulationKey(simulationId);
  const previousValue = latestPortfolioValues.get(buildLatestKey(simulationKey, agent.id));
  if (previousValue !== undefined && previousValue > 0) {
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
  for (const position of Object.values(agent.portfolio.positions)) {
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
  const positionsValue = Object.values(agent.portfolio.positions).reduce((sum, pos) => {
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
  latestPortfolioValues.clear();
};

export const clearPortfolioValidationCacheForSimulation = (simulationId?: string): void => {
  if (!simulationId) {
    clearPortfolioValidationCache();
    return;
  }

  const simulationKey = getSimulationKey(simulationId);
  Array.from(previousPortfolioValues.keys())
    .filter(key => key.startsWith(`${simulationKey}:`))
    .forEach(key => previousPortfolioValues.delete(key));
  Array.from(latestPortfolioValues.keys())
    .filter(key => key.startsWith(`${simulationKey}:`))
    .forEach(key => latestPortfolioValues.delete(key));
};
