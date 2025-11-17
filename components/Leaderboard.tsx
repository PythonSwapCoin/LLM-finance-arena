import React, { useState, useMemo } from 'react';
import type { Agent, PerformanceMetrics } from '../types';
import { getAgentDisplayName } from '../utils/modelNameFormatter';
import { InformationCircleIcon } from './icons/Icons';

interface LeaderboardProps {
  agents: Agent[];
  onAgentClick: (agent: Agent) => void;
  showModelNames?: boolean;
  simulationTypeName?: string;
}

type SortKey = keyof PerformanceMetrics | 'name';

const formatPercent = (value: number | null | undefined) => {
  if (value == null || isNaN(value)) return '0.00%';
  return `${(value * 100).toFixed(2)}%`;
};
const formatNumber = (value: number | null | undefined) => {
  if (value == null || isNaN(value)) return '0.00';
  return value.toFixed(2);
};
const formatValue = (value: number | null | undefined) => {
  if (value == null || isNaN(value)) return '$0.00';
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const columns: { key: SortKey; label: string; format: (val: any) => string; className?: string }[] = [
  { key: 'name', label: 'Agent Name', format: (val) => val, className: 'text-left font-semibold' },
  { key: 'totalValue', label: 'Total Value', format: formatValue, className: 'text-right' },
  { key: 'totalReturn', label: 'Total Return', format: formatPercent, className: 'text-right' },
  { key: 'dailyReturn', label: 'Daily Return', format: formatPercent, className: 'text-right' },
  { key: 'sharpeRatio', label: 'Sharpe Ratio', format: formatNumber, className: 'text-right' },
  { key: 'maxDrawdown', label: 'Max Drawdown', format: formatPercent, className: 'text-right' },
  { key: 'annualizedVolatility', label: 'Volatility (Ann.)', format: formatPercent, className: 'text-right' },
];

export const Leaderboard: React.FC<LeaderboardProps> = ({ agents, onAgentClick, showModelNames = true, simulationTypeName }) => {
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'totalReturn', direction: 'desc' });
  
  const sortedAgents = useMemo(() => {
    const sortableAgents = [...agents];
    if (sortableAgents.length === 0 || sortableAgents[0].performanceHistory.length === 0) {
        return [];
    }
    sortableAgents.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      if (sortConfig.key === 'name') {
        aValue = a.name;
        bValue = b.name;
      } else {
        aValue = a.performanceHistory[a.performanceHistory.length - 1]?.[sortConfig.key as keyof PerformanceMetrics] ?? -Infinity;
        bValue = b.performanceHistory[b.performanceHistory.length - 1]?.[sortConfig.key as keyof PerformanceMetrics] ?? -Infinity;
      }

      if (aValue < bValue) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
    return sortableAgents;
  }, [agents, sortConfig]);

  const requestSort = (key: SortKey) => {
    let direction: 'asc' | 'desc' = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };
  
  return (
    <div className="bg-arena-surface rounded-lg shadow-lg overflow-hidden">
      <div className="p-4 sm:p-6 border-b border-arena-border">
        <h2 className="text-lg font-semibold text-arena-text-primary">Performance Leaderboard</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-arena-bg text-arena-text-secondary uppercase tracking-wider">
            <tr>
              <th className="p-3 text-left">Rank</th>
              <th className="p-3 text-center">Check Individual Trades</th>
              {columns.map(col => (
                <th key={col.key} className={`p-3 cursor-pointer ${col.className || 'text-left'}`} onClick={() => requestSort(col.key)}>
                  <div className={`flex items-center ${col.className?.includes('right') ? 'justify-end' : 'justify-start'}`}>
                    {col.label}
                    {sortConfig.key === col.key && (<span>{sortConfig.direction === 'desc' ? ' ▼' : ' ▲'}</span>)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-arena-border">
            {sortedAgents.map((agent, index) => {
              const latestPerf = agent.performanceHistory[agent.performanceHistory.length - 1];
              if (!latestPerf) return null;
              return (
                <tr key={`agent-${agent.id}-${index}`} className="hover:bg-arena-border transition-colors duration-150">
                  <td className="p-3 font-bold text-center">{index + 1}</td>
                  <td className="p-3 text-center">
                      <button onClick={() => onAgentClick(agent)} className="text-arena-text-secondary hover:text-arena-text-primary">
                          <InformationCircleIcon className="h-6 w-6" />
                      </button>
                  </td>
                  <td className="p-3 text-left">
                     <div className="flex items-center space-x-3">
                        {agent.image ? (
                          <img
                            src={agent.image}
                            alt={getAgentDisplayName(agent, simulationTypeName)}
                            className="w-8 h-8 rounded-full object-cover border border-arena-border"
                            onError={(e) => {
                              // Fallback to color dot if image fails to load
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              const fallback = document.createElement('div');
                              fallback.className = 'w-3 h-3 rounded-full';
                              fallback.style.backgroundColor = agent.color;
                              target.parentNode?.insertBefore(fallback, target);
                            }}
                          />
                        ) : (
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: agent.color }}></div>
                        )}
                        <div>
                            <div className="font-semibold text-arena-text-primary">{getAgentDisplayName(agent, simulationTypeName)}</div>
                        </div>
                    </div>
                  </td>
                  {columns.slice(1).map(col => {
                    const value = latestPerf[col.key as keyof PerformanceMetrics] as number | null | undefined;
                    return (
                      <td key={col.key} className={`p-3 font-mono ${col.className}`}>
                        {col.key === 'totalReturn' || col.key === 'dailyReturn' ? (
                          <span className={(value ?? 0) >= 0 ? 'text-brand-positive' : 'text-brand-negative'}>
                              {col.format(value)}
                          </span>
                        ) : (
                          col.format(value)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};