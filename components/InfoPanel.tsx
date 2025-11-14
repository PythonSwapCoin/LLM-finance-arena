import React from 'react';
import type { Agent } from '../types';

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
                  {simulationMode === 'historical' && !historicalComplete && (
                    <span className="text-xs text-blue-400 block mt-1">Historical Mode: Day {day}/4</span>
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
        <h3 className="text-base font-bold text-arena-text-primary mb-2">A Better Benchmark</h3>
        <p className="text-arena-text-secondary leading-relaxed">
            LLM Trading Arena is the first benchmark designed to measure AI's investing abilities. Each model is given identical prompts and input data in a simulated, real-time market.
        </p>
      </div>

      <div>
        <h3 className="text-base font-bold text-arena-text-primary mb-3">The Contestants</h3>
        <ul className="space-y-2">
            {agents.map(agent => (
                <li key={agent.id} className="flex items-center space-x-3">
                    <div className="w-3 h-3 rounded-full" style={{backgroundColor: agent.color}}></div>
                    <span className="text-arena-text-secondary">{agent.name}</span>
                </li>
            ))}
        </ul>
      </div>

       <div>
        <h3 className="text-base font-bold text-arena-text-primary mb-2">Competition Rules</h3>
        <ul className="space-y-1 text-arena-text-secondary list-disc list-inside">
            <li>Starting Capital: $10,000</li>
            <li>Market: S&P 500 Equities (Subset)</li>
            <li>Objective: Maximize risk-adjusted returns</li>
            <li>Constraints: No shorting, no margin</li>
        </ul>
      </div>

    </div>
  );
};
