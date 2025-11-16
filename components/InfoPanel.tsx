import React, { useMemo } from 'react';
import type { Agent, PerformanceMetrics } from '../types';

interface InfoPanelProps {
  agents: Agent[];
  isLoading: boolean;
  isStopped: boolean;
  day: number;
  intradayHour?: number;
  simulationMode?: 'simulated' | 'realtime' | 'historical';
  isHistoricalComplete?: boolean;
  variant?: 'desktop' | 'mobile';
  className?: string;
  simulationTypeName?: string;
  simulationTypeDescription?: string;
  startDate?: string;
  currentDate?: string;
}

interface BestPerformer {
  agent: Agent;
  return: number;
  value: number;
}

// Helper to get performance at end of a specific day
const getPerformanceAtDay = (agent: Agent, targetDay: number): PerformanceMetrics | null => {
  // Find the last performance entry for that day (could be intraday)
  const dayEntries = agent.performanceHistory.filter(p => Math.floor(p.timestamp) === targetDay);
  if (dayEntries.length === 0) return null;
  // Return the last entry for that day (highest intraday hour)
  return dayEntries[dayEntries.length - 1];
};

// Calculate top N performers for a period
const calculateTopPerformers = (agents: Agent[], startDay: number, endDay: number, topN: number = 3): BestPerformer[] => {
  const validAgents: BestPerformer[] = [];
  
  for (const agent of agents) {
    const startPerf = getPerformanceAtDay(agent, startDay);
    const endPerf = getPerformanceAtDay(agent, endDay);
    
    if (startPerf && endPerf) {
      const periodReturn = (endPerf.totalValue / startPerf.totalValue) - 1;
      validAgents.push({
        agent,
        return: periodReturn,
        value: endPerf.totalValue,
      });
    }
  }
  
  if (validAgents.length === 0) return [];
  
  // Sort by return (descending) and return top N
  return validAgents
    .sort((a, b) => b.return - a.return)
    .slice(0, topN);
};

// Helper to format date for display
const formatDateForDisplay = (day: number, startDate?: string, simulationMode?: string): string => {
  if (!startDate) {
    return `Day ${day}`;
  }
  
  try {
    const start = new Date(startDate);
    const date = new Date(start);
    date.setDate(start.getDate() + day);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return `Day ${day}`;
  }
};

// Helper to get date from day number
const getDateFromDay = (day: number, startDate?: string): Date | null => {
  if (!startDate) return null;
  try {
    const start = new Date(startDate);
    const date = new Date(start);
    date.setDate(start.getDate() + day);
    return date;
  } catch {
    return null;
  }
};

// Helper to calculate previous Monday-Friday week
const getPreviousWeekMondayFriday = (currentDay: number, startDate?: string): { mondayDay: number; fridayDay: number } | null => {
  if (!startDate) return null;
  
  const currentDate = getDateFromDay(currentDay, startDate);
  if (!currentDate) return null;
  
  // Get day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
  const dayOfWeek = currentDate.getDay();
  
  // Calculate how many days to go back to get to the previous Monday
  // If today is Monday (1), go back 7 days to get previous Monday
  // If today is Tuesday (2), go back 8 days
  // If today is Wednesday (3), go back 9 days
  // etc.
  let daysToPreviousMonday: number;
  if (dayOfWeek === 0) {
    // Sunday - go back 6 days to get to previous Monday
    daysToPreviousMonday = 6;
  } else if (dayOfWeek === 1) {
    // Monday - go back 7 days to get previous Monday
    daysToPreviousMonday = 7;
  } else {
    // Tuesday-Saturday - go back (dayOfWeek - 1 + 7) days
    daysToPreviousMonday = dayOfWeek - 1 + 7;
  }
  
  const previousMondayDay = currentDay - daysToPreviousMonday;
  const previousFridayDay = previousMondayDay + 4; // Friday is 4 days after Monday
  
  // Make sure we don't go negative
  if (previousMondayDay < 0) return null;
  
  return { mondayDay: previousMondayDay, fridayDay: previousFridayDay };
};

export const InfoPanel: React.FC<InfoPanelProps> = ({
  agents,
  isLoading,
  isStopped,
  day,
  intradayHour = 0,
  simulationMode = 'simulated',
  isHistoricalComplete,
  variant = 'desktop',
  className = '',
  simulationTypeName,
  simulationTypeDescription,
  startDate,
  currentDate,
}) => {
  const historicalComplete = simulationMode === 'historical' ? Boolean(isHistoricalComplete) : false;
  const agentsWithPerf = agents.filter(a => a.performanceHistory.length > 0);

  const highestPerformer = agentsWithPerf.length > 0
    ? agentsWithPerf.reduce((max, agent) => {
        const maxPerf = max.performanceHistory.slice(-1)[0];
        const currentPerf = agent.performanceHistory.slice(-1)[0];
        return currentPerf.totalValue > maxPerf.totalValue ? agent : max;
      }, agentsWithPerf[0])
    : null;

  const lowestPerformer = agentsWithPerf.length > 0
    ? agentsWithPerf.reduce((min, agent) => {
        const minPerf = min.performanceHistory.slice(-1)[0];
        const currentPerf = agent.performanceHistory.slice(-1)[0];
        return currentPerf.totalValue < minPerf.totalValue ? agent : min;
      }, agentsWithPerf[0])
    : null;

  // Calculate top 3 performers for different periods
  const topOfDay = useMemo(() => {
    // Best yesterday: compare end of day before yesterday (day - 2) to end of yesterday (day - 1)
    if (day < 2) return [];
    return calculateTopPerformers(agents, day - 2, day - 1, 3);
  }, [agents, day]);

  const topOfWeek = useMemo(() => {
    // Calculate previous Monday-Friday week
    const weekRange = getPreviousWeekMondayFriday(day - 1, startDate); // Use day - 1 as current day (yesterday)
    if (!weekRange || weekRange.mondayDay < 0) return [];
    // Compare end of Sunday (day before Monday) to end of Friday to capture full week performance
    return calculateTopPerformers(agents, weekRange.mondayDay - 1, weekRange.fridayDay, 3);
  }, [agents, day, startDate]);

  // Format dates for display
  const yesterdayDate = useMemo(() => {
    if (day < 1) return '';
    return formatDateForDisplay(day - 1, startDate, simulationMode);
  }, [day, startDate, simulationMode]);

  const weekStartDate = useMemo(() => {
    const weekRange = getPreviousWeekMondayFriday(day - 1, startDate);
    if (!weekRange) return '';
    return formatDateForDisplay(weekRange.mondayDay, startDate, simulationMode);
  }, [day, startDate, simulationMode]);

  const weekEndDate = useMemo(() => {
    const weekRange = getPreviousWeekMondayFriday(day - 1, startDate);
    if (!weekRange) return '';
    return formatDateForDisplay(weekRange.fridayDay, startDate, simulationMode);
  }, [day, startDate, simulationMode]);

  // Get simulation-specific description
  const getSimulationDescription = (): string => {
    if (!simulationTypeName) return '';
    
    switch (simulationTypeName) {
      case 'Wall Street Arena':
        return 'Five different AI models compete using the same prompts and market data. See which model\'s reasoning leads to the best investment decisions.';
      case 'Size Arena':
        return 'Compare how model size affects trading performance. Same prompts, same data, different model capabilities.';
      case 'Legendary Investor Arena':
        return 'Watch your favourite investors compete! From diamond hands to value investing legends - same AI brain, wildly different strategies. Who will come out on top?';
      case 'Hidden Arena':
        return 'Can you guess who is who? Model identities are hidden behind mysterious codenames. Vote on which strategies work best without knowing which AI is pulling the strings.';
      default:
        return 'AI models compete in stock trading using different approaches.';
    }
  };

  // Get mode-specific rules
  const getModeSpecificRules = (): string[] => {
    if (!simulationTypeName) return [];
    
    switch (simulationTypeName) {
      case 'Wall Street Arena':
        return ['Same prompts and market data', 'Different AI models'];
      case 'Size Arena':
        return ['Same prompts and market data', 'Different model sizes'];
      case 'Legendary Investor Arena':
        return ['Same AI model', 'Different investment strategies'];
      case 'Hidden Arena':
        return ['Same prompts and market data', 'Model identities hidden'];
      default:
        return [];
    }
  };

  const containerClasses =
    variant === 'mobile'
      ? 'bg-arena-surface rounded-lg shadow-lg p-4 space-y-4 text-sm'
      : 'bg-arena-surface rounded-lg shadow-lg h-full flex flex-col p-6 space-y-6 text-sm';

  const headerPadding = variant === 'mobile' ? 'pb-3' : 'pb-4';
  const headingSize = variant === 'mobile' ? 'text-2xl' : 'text-3xl';
  const performerLayout =
    variant === 'mobile'
      ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4'
      : 'grid grid-cols-2 gap-4';

  return (
    <div className={`${containerClasses} ${className}`}>
        <div className={`flex justify-between items-center border-b border-arena-border ${headerPadding}`}>
            <div>
                {simulationTypeName && simulationTypeDescription ? (
                  <>
                    <span className="text-arena-text-secondary">{simulationTypeName}</span>
                    <p className={`${headingSize} font-bold text-arena-text-primary`}>{simulationTypeDescription}</p>
                  </>
                ) : (
                  <>
                    <span className="text-arena-text-secondary">Trading Day</span>
                    <p className={`${headingSize} font-bold text-arena-text-primary`}>{day}</p>
                  </>
                )}
                {isStopped && (
                  <span className="text-xs text-arena-text-tertiary block mt-1">Simulation Stopped</span>
                )}
                {historicalComplete && simulationMode === 'historical' && (
                  <span className="text-xs text-blue-400 block mt-1 font-semibold">✓ Historical Week Complete (5 days)</span>
                )}
            </div>
        </div>

        {highestPerformer && lowestPerformer && (
          <div className={performerLayout}>
              <div>
                  <div className="text-xs text-arena-text-secondary">HIGHEST</div>
                  <div className="flex items-center space-x-2 mt-1">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{backgroundColor: highestPerformer.color}}></div>
                      <div className="font-semibold text-arena-text-primary truncate">{highestPerformer.name}</div>
                  </div>
                  <div className="font-mono text-arena-text-primary mt-1">${highestPerformer.performanceHistory.slice(-1)[0].totalValue.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
              </div>
               <div>
                  <div className="text-xs text-arena-text-secondary">LOWEST</div>
                  <div className="flex items-center space-x-2 mt-1">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{backgroundColor: lowestPerformer.color}}></div>
                      <div className="font-semibold text-arena-text-primary truncate">{lowestPerformer.name}</div>
                  </div>
                  <div className="font-mono text-arena-text-primary mt-1">${lowestPerformer.performanceHistory.slice(-1)[0].totalValue.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
              </div>
          </div>
        )}

      <div>
        <h3 className="text-base font-bold text-arena-text-primary mb-2">About This Simulation</h3>
        <p className="text-arena-text-secondary leading-relaxed text-sm">
          {getSimulationDescription()}
        </p>
      </div>

      {/* Best Performers Tables */}
      {(topOfDay.length > 0 || topOfWeek.length > 0) && (
        <div>
          <h3 className="text-base font-bold text-arena-text-primary mb-2">Best Performers</h3>
          <div className="space-y-3 text-xs">
            {topOfDay.length > 0 && (
              <div>
                <div className="text-arena-text-secondary mb-1.5">Best Yesterday ({yesterdayDate}):</div>
                <div className="space-y-1">
                  {topOfDay.map((performer, index) => {
                    const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
                    return (
                      <div key={performer.agent.id} className="flex justify-between items-center py-1 px-2 rounded bg-arena-surface/30">
                        <div className="flex items-center space-x-2">
                          <span>{emoji}</span>
                          <span className="text-arena-text-primary font-medium">{performer.agent.name}</span>
                        </div>
                        <span className="text-arena-text-tertiary font-mono">{(performer.return * 100).toFixed(2)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {topOfWeek.length > 0 && (
              <div>
                <div className="text-arena-text-secondary mb-1.5">Best Last Week ({weekStartDate} to {weekEndDate}):</div>
                <div className="space-y-1">
                  {topOfWeek.map((performer, index) => {
                    const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
                    return (
                      <div key={performer.agent.id} className="flex justify-between items-center py-1 px-2 rounded bg-arena-surface/30">
                        <div className="flex items-center space-x-2">
                          <span>{emoji}</span>
                          <span className="text-arena-text-primary font-medium">{performer.agent.name}</span>
                        </div>
                        <span className="text-arena-text-tertiary font-mono">{(performer.return * 100).toFixed(2)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

       <div>
        <h3 className="text-base font-bold text-arena-text-primary mb-2">Competition Rules</h3>
        <ul className="space-y-1 text-arena-text-secondary list-disc list-inside text-sm">
            <li>Starting Capital: $1,000,000</li>
            <li>Market: S&P 500</li>
            <li>Objective: Maximize returns</li>
            <li>Constraints: No shorting, no margin</li>
            {getModeSpecificRules().map((rule, idx) => (
              <li key={idx}>{rule}</li>
            ))}
        </ul>
      </div>

    </div>
  );
};
