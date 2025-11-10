import React from 'react';
import type { Agent } from '../types';
import { ArrowPathIcon, PlayIcon, StopIcon } from './icons/Icons';
import { getSimulationMode, isHistoricalSimulationComplete } from '../services/marketDataService';

interface InfoPanelProps {
  agents: Agent[];
  onAdvanceDay: () => void;
  onStop: () => void;
  onExportLogs?: () => void;
  isLoading: boolean;
  isLive: boolean;
  isStopped: boolean;
  day: number;
  intradayHour?: number;
}

export const InfoPanel: React.FC<InfoPanelProps> = ({ agents, onAdvanceDay, onStop, onExportLogs, isLoading, isLive, isStopped, day, intradayHour = 0 }) => {
  const simulationMode = getSimulationMode();
  const isHistoricalComplete = isHistoricalSimulationComplete(day);
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

  return (
    <div className="bg-arena-surface rounded-lg shadow-lg h-full flex flex-col p-6 space-y-6 text-sm">
        <div className="flex justify-between items-center border-b border-arena-border pb-4">
            <div>
                <span className="text-arena-text-secondary">Trading Day</span>
                <p className="text-3xl font-bold text-arena-text-primary">{day + 1}</p>
                {intradayHour > 0 && (
                  <span className="text-xs text-arena-text-secondary block mt-1">
                    Intraday: {Math.floor(intradayHour)}:{(intradayHour % 1 * 60).toFixed(0).padStart(2, '0')}
                  </span>
                )}
                {isStopped && (
                  <span className="text-xs text-arena-text-tertiary block mt-1">Simulation Stopped</span>
                )}
                {isHistoricalComplete && simulationMode === 'historical' && (
                  <span className="text-xs text-blue-400 block mt-1 font-semibold">✓ Historical Week Complete (5 days)</span>
                )}
                {simulationMode === 'historical' && !isHistoricalComplete && (
                  <span className="text-xs text-blue-400 block mt-1">Historical Mode: {day + 1}/5 days</span>
                )}
            </div>
            <div className="flex gap-2">
              {!isStopped && (
                <button
                  onClick={onAdvanceDay}
                  disabled={isLoading || isLive}
                  className="flex items-center justify-center bg-arena-surface hover:bg-arena-border disabled:opacity-50 disabled:cursor-not-allowed border border-arena-border text-white font-bold py-2 px-4 rounded-md transition-colors duration-200"
                >
                  {isLoading ? (
                    <ArrowPathIcon className="animate-spin h-5 w-5 mr-2" />
                  ) : (
                    <PlayIcon className="h-5 w-5 mr-2" />
                  )}
                  {isLoading ? 'Simulating...' : 'Next Day'}
                </button>
              )}
              {day > 0 && !isStopped && (
                <button
                  onClick={onStop}
                  disabled={isLoading}
                  className="flex items-center justify-center bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed border border-red-700 text-white font-bold py-2 px-4 rounded-md transition-colors duration-200"
                  title="Stop simulation and export results"
                >
                  <StopIcon className="h-5 w-5 mr-2" />
                  Stop & Export
                </button>
              )}
              {onExportLogs && (
                <button
                  onClick={onExportLogs}
                  className="flex items-center justify-center bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed border border-blue-700 text-white font-bold py-2 px-4 rounded-md transition-colors duration-200 text-xs"
                  title="Export system logs"
                >
                  📋 Logs
                </button>
              )}
            </div>
        </div>

        {highestPerformer && lowestPerformer && (
          <div className="grid grid-cols-2 gap-4">
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