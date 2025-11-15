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

// Calculate best performer for a period
const calculateBestPerformer = (agents: Agent[], startDay: number, endDay: number): BestPerformer | null => {
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
  
  if (validAgents.length === 0) return null;
  
  return validAgents.reduce((best, current) => 
    current.return > best.return ? current : best
  );
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

  // Calculate best performers for different periods
  const bestOfDay = useMemo(() => {
    if (day < 1) return null;
    return calculateBestPerformer(agents, day - 1, day - 1);
  }, [agents, day]);

  const bestOfWeek = useMemo(() => {
    if (day < 7) return null;
    return calculateBestPerformer(agents, Math.max(0, day - 7), day - 1);
  }, [agents, day]);

  const bestOfMonth = useMemo(() => {
    if (day < 30) return null;
    return calculateBestPerformer(agents, Math.max(0, day - 30), day - 1);
  }, [agents, day]);

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
                {intradayHour > 0 && (
                  <span className="text-xs text-arena-text-secondary block mt-1">
                    Intraday: {Math.floor(intradayHour)}:{(intradayHour % 1 * 60).toFixed(0).padStart(2, '0')}
                  </span>
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
      {(bestOfDay || bestOfWeek || bestOfMonth) && (
        <div>
          <h3 className="text-base font-bold text-arena-text-primary mb-2">Best Performers</h3>
          <div className="space-y-2 text-xs">
            {bestOfDay && (
              <div className="flex justify-between items-center py-1 border-b border-arena-border/50">
                <span className="text-arena-text-secondary">Best of Day (Yesterday):</span>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full" style={{backgroundColor: bestOfDay.agent.color}}></div>
                  <span className="text-arena-text-primary font-medium">{bestOfDay.agent.name}</span>
                  <span className="text-arena-text-tertiary">({(bestOfDay.return * 100).toFixed(2)}%)</span>
                </div>
              </div>
            )}
            {bestOfWeek && (
              <div className="flex justify-between items-center py-1 border-b border-arena-border/50">
                <span className="text-arena-text-secondary">Best of Week:</span>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full" style={{backgroundColor: bestOfWeek.agent.color}}></div>
                  <span className="text-arena-text-primary font-medium">{bestOfWeek.agent.name}</span>
                  <span className="text-arena-text-tertiary">({(bestOfWeek.return * 100).toFixed(2)}%)</span>
                </div>
              </div>
            )}
            {bestOfMonth && (
              <div className="flex justify-between items-center py-1">
                <span className="text-arena-text-secondary">Best of Month:</span>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full" style={{backgroundColor: bestOfMonth.agent.color}}></div>
                  <span className="text-arena-text-primary font-medium">{bestOfMonth.agent.name}</span>
                  <span className="text-arena-text-tertiary">({(bestOfMonth.return * 100).toFixed(2)}%)</span>
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
            <li>Objective: Maximize risk-adjusted returns</li>
            <li>Constraints: No shorting, no margin</li>
            {getModeSpecificRules().map((rule, idx) => (
              <li key={idx}>{rule}</li>
            ))}
        </ul>
      </div>

    </div>
  );
};
