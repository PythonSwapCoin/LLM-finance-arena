import React from 'react';
import type { Agent, Position } from '../types';
import { PerformanceChart } from './PerformanceChart';
import { XMarkIcon } from './icons/Icons';
import { getAgentDisplayName } from '../utils/modelNameFormatter';

interface AgentDetailViewProps {
  agent: Agent;
  onClose: () => void;
  marketData?: { [ticker: string]: { price: number; longName?: string } } | { [ticker: string]: import('../types').TickerData }; // Optional market data for current prices
  startDate?: string;
  currentDate?: string;
  simulationMode?: 'simulated' | 'realtime' | 'historical' | 'hybrid';
  showModelName?: boolean;
  simulationTypeName?: string;
}

const StatCard: React.FC<{ label: string; value: string; className?: string }> = ({ label, value, className = '' }) => (
    <div className="bg-arena-bg p-4 rounded-lg">
        <p className="text-sm text-arena-text-secondary">{label}</p>
        <p className={`text-xl font-bold ${className}`}>{value}</p>
    </div>
);
export const AgentDetailView: React.FC<AgentDetailViewProps> = ({ agent, onClose, marketData = {}, startDate, currentDate, simulationMode, showModelName = true, simulationTypeName }) => {
    const latestPerf = agent.performanceHistory[agent.performanceHistory.length - 1];
    const positions = Object.values(agent.portfolio.positions).filter((p: Position) => p.quantity > 0);
    
    // Calculate portfolio value for percentage calculations
    const portfolioValue = latestPerf?.totalValue ?? agent.portfolio.cash;
    const cashValue = agent.portfolio.cash;
    
    // Calculate position values with current market prices if available
    // Also find the most recent trade justification for each position
    const positionsWithValues = positions.map((pos: Position) => {
      const avgCost = pos.averageCost ?? 0;
      const tickerData = marketData[pos.ticker];
      
      // Get price - handle both TickerData object and simple price object
      const currentPrice = tickerData 
        ? ('price' in tickerData ? tickerData.price : (tickerData as any).price ?? avgCost)
        : avgCost;
      
      const positionValue = pos.quantity * currentPrice;
      const positionPercent = portfolioValue > 0 ? (positionValue / portfolioValue) * 100 : 0;
      const totalGain = (currentPrice - avgCost) * pos.quantity;
      const totalGainPercent = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;
      
      // Find the most recent trade justification for this ticker
      const recentTrade = [...agent.tradeHistory]
        .filter(t => t.ticker === pos.ticker)
        .sort((a, b) => b.timestamp - a.timestamp)[0];
      const rationale = recentTrade?.justification || '-';
      
      // Get stock name from market data - check for longName or shortName in TickerData
      let stockName = pos.ticker; // Default to ticker
      if (tickerData) {
        // Try to get longName first (full company name), then shortName as fallback
        const longName = (tickerData as any).longName;
        const shortName = (tickerData as any).shortName;
        
        // Prefer longName (e.g., "Microsoft Corporation"), fallback to shortName (e.g., "Microsoft")
        if (longName && typeof longName === 'string' && longName.trim() !== '') {
          stockName = longName;
        } else if (shortName && typeof shortName === 'string' && shortName.trim() !== '') {
          stockName = shortName;
        }
      }
      
      return {
        ...pos,
        currentPrice,
        positionValue,
        positionPercent,
        totalGain,
        totalGainPercent,
        averageCost: avgCost,
        rationale,
        stockName,
      };
    }).sort((a, b) => b.positionPercent - a.positionPercent); // Sort by % of portfolio descending
    
  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4" onClick={onClose}>
        <div className="bg-arena-surface rounded-lg shadow-2xl w-full max-w-6xl max-h-[95vh] overflow-y-auto border border-arena-border" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-arena-surface p-4 border-b border-arena-border flex justify-between items-center z-10">
                <div className="flex items-center space-x-3">
                    {agent.image ? (
                      <img 
                        src={agent.image} 
                        alt={getAgentDisplayName(agent, simulationTypeName)}
                        className="w-10 h-10 rounded-full object-cover border border-arena-border"
                        onError={(e) => {
                          // Fallback to color dot if image fails to load
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          const fallback = document.createElement('div');
                          fallback.className = 'w-4 h-4 rounded-full';
                          fallback.style.backgroundColor = agent.color;
                          target.parentNode?.insertBefore(fallback, target);
                        }}
                      />
                    ) : (
                      <div className="w-4 h-4 rounded-full" style={{backgroundColor: agent.color}}></div>
                    )}
                    <div>
                        <h2 className="text-xl font-bold text-arena-text-primary">{getAgentDisplayName(agent, simulationTypeName)}</h2>
                    </div>
                </div>
                <button onClick={onClose} className="text-arena-text-secondary hover:text-arena-text-primary">
                    <XMarkIcon className="h-6 w-6" />
                </button>
            </div>

            <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Performance Chart */}
                <div className="md:col-span-2 bg-arena-bg p-4 rounded-lg">
                    <h3 className="text-lg font-semibold mb-2">Equity Curve</h3>
                    <div className="h-64">
                      <PerformanceChart
                        data={agent.performanceHistory}
                        dataKey="totalValue"
                        color={agent.color}
                        startDate={startDate}
                        currentDate={currentDate}
                        simulationMode={simulationMode}
                      />
                    </div>
                </div>

                {/* Key Metrics */}
                <div className="md:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <StatCard label="Total Value" value={`$${(latestPerf?.totalValue ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
                    <StatCard label="Total Return" value={`${((latestPerf?.totalReturn ?? 0) * 100).toFixed(2)}%`} className={(latestPerf?.totalReturn ?? 0) >= 0 ? 'text-brand-positive' : 'text-brand-negative'} />
                    <StatCard label="Sharpe Ratio" value={(latestPerf?.sharpeRatio ?? 0).toFixed(2)} />
                    <StatCard label="Max Drawdown" value={`${((latestPerf?.maxDrawdown ?? 0) * 100).toFixed(2)}%`} className="text-brand-negative"/>
                </div>

                {/* Rationale */}
                <div className="md:col-span-2 bg-arena-bg p-4 rounded-lg">
                    <h3 className="text-lg font-semibold mb-2">Latest Rationale</h3>
                    <p className="text-sm text-arena-text-secondary italic">"{agent.rationale}"</p>
                </div>


                {/* Current Positions */}
                <div className="md:col-span-2">
                    <h3 className="text-lg font-semibold mb-2">Current Positions</h3>
                    <div className="bg-arena-bg rounded-lg overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-gray-900 text-arena-text-secondary">
                                <tr>
                                    <th className="p-3">Ticker</th>
                                    <th className="p-3 text-right">Quantity</th>
                                    <th className="p-3 text-right">Avg. Cost</th>
                                    <th className="p-3 text-right">Current Price</th>
                                    <th className="p-3 text-right">% of Portfolio</th>
                                    <th className="p-3 text-right">Total Gain</th>
                                    <th className="p-3">Rationale</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-arena-border">
                                {/* Cash row - always show at top */}
                                <tr className="bg-gray-800/50">
                                    <td className="p-3 font-mono font-semibold">CASH</td>
                                    <td className="p-3 font-mono text-right">-</td>
                                    <td className="p-3 font-mono text-right">-</td>
                                    <td className="p-3 font-mono text-right">-</td>
                                    <td className="p-3 font-mono text-right">{portfolioValue > 0 ? ((cashValue / portfolioValue) * 100).toFixed(2) : '0.00'}%</td>
                                    <td className="p-3 font-mono text-right">$0.00 (0.00%)</td>
                                    <td className="p-3 text-arena-text-secondary">-</td>
                                </tr>
                                {positionsWithValues.length > 0 ? positionsWithValues.map((pos: any, index: number) => (
                                    <tr key={`${pos.ticker}-${index}`}>
                                        <td className="p-3 font-mono">{pos.ticker}</td>
                                        <td className="p-3 font-mono text-right">{pos.quantity}</td>
                                        <td className="p-3 font-mono text-right">${(pos.averageCost ?? 0).toFixed(2)}</td>
                                        <td className="p-3 font-mono text-right">${(pos.currentPrice ?? 0).toFixed(2)}</td>
                                        <td className="p-3 font-mono text-right">{(pos.positionPercent ?? 0).toFixed(2)}%</td>
                                        <td className={`p-3 font-mono text-right ${(pos.totalGain ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                            ${(pos.totalGain ?? 0).toFixed(2)} ({(pos.totalGainPercent ?? 0) >= 0 ? '+' : ''}{(pos.totalGainPercent ?? 0).toFixed(2)}%)
                                        </td>
                                        <td className="p-3 text-arena-text-secondary text-xs leading-relaxed" style={{ maxWidth: '300px' }}>
                                            <div className="line-clamp-2">{pos.rationale}</div>
                                        </td>
                                    </tr>
                                )) : null}
                                {positionsWithValues.length === 0 && (
                                    <tr><td colSpan={7} className="p-4 text-center text-arena-text-secondary">No open positions.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        </div>
    </div>
  );
};
