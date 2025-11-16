import React from 'react';
import type { Agent, Position } from '../types';
import { PerformanceChart } from './PerformanceChart';
import { XMarkIcon } from './icons/Icons';
import { formatTradeTimestamp } from '../utils/timeFormatting';

interface AgentDetailViewProps {
  agent: Agent;
  onClose: () => void;
  marketData?: { [ticker: string]: { price: number } }; // Optional market data for current prices
  startDate?: string;
  currentDate?: string;
  simulationMode?: 'simulated' | 'realtime' | 'historical';
  showModelName?: boolean;
}

const StatCard: React.FC<{ label: string; value: string; className?: string }> = ({ label, value, className = '' }) => (
    <div className="bg-arena-bg p-4 rounded-lg">
        <p className="text-sm text-arena-text-secondary">{label}</p>
        <p className={`text-xl font-bold ${className}`}>{value}</p>
    </div>
);
export const AgentDetailView: React.FC<AgentDetailViewProps> = ({ agent, onClose, marketData = {}, startDate, currentDate, simulationMode, showModelName = true }) => {
    const latestPerf = agent.performanceHistory[agent.performanceHistory.length - 1];
    const positions = Object.values(agent.portfolio.positions).filter((p: Position) => p.quantity > 0);
    
    // Calculate portfolio value for percentage calculations
    const portfolioValue = latestPerf?.totalValue ?? agent.portfolio.cash;
    const cashValue = agent.portfolio.cash;
    
    // Calculate position values with current market prices if available
    const positionsWithValues = positions.map((pos: Position) => {
      const avgCost = pos.averageCost ?? 0;
      const currentPrice = marketData[pos.ticker]?.price ?? avgCost; // Fallback to avg cost if no market data
      const positionValue = pos.quantity * currentPrice;
      const positionPercent = portfolioValue > 0 ? (positionValue / portfolioValue) * 100 : 0;
      const totalGain = (currentPrice - avgCost) * pos.quantity;
      const totalGainPercent = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;
      return {
        ...pos,
        currentPrice,
        positionValue,
        positionPercent,
        totalGain,
        totalGainPercent,
        averageCost: avgCost,
      };
    });
    
  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4" onClick={onClose}>
        <div className="bg-arena-surface rounded-lg shadow-2xl w-full max-w-6xl max-h-[95vh] overflow-y-auto border border-arena-border" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-arena-surface p-4 border-b border-arena-border flex justify-between items-center z-10">
                <div className="flex items-center space-x-3">
                    {agent.image ? (
                      <img 
                        src={agent.image} 
                        alt={agent.name}
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
                        <h2 className="text-xl font-bold text-arena-text-primary">{agent.name}</h2>
                        {showModelName && <p className="text-sm text-arena-text-secondary">{agent.model}</p>}
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
                <div>
                    <h3 className="text-lg font-semibold mb-2">Current Positions</h3>
                    <div className="bg-arena-bg rounded-lg max-h-60 overflow-y-auto overflow-x-auto">
                        <table className="w-full text-sm text-left min-w-[600px]">
                            <thead className="sticky top-0 bg-gray-900 text-arena-text-secondary">
                                <tr>
                                    <th className="p-2">Ticker</th>
                                    <th className="p-2 text-right">Quantity</th>
                                    <th className="p-2 text-right">Avg. Cost</th>
                                    <th className="p-2 text-right">Current Price</th>
                                    <th className="p-2 text-right">% of Portfolio</th>
                                    <th className="p-2 text-right">Total Gain</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-arena-border">
                                {/* Cash row */}
                                <tr className="bg-gray-800/50">
                                    <td className="p-2 font-mono font-semibold">CASH</td>
                                    <td className="p-2 font-mono text-right">-</td>
                                    <td className="p-2 font-mono text-right">-</td>
                                    <td className="p-2 font-mono text-right">-</td>
                                    <td className="p-2 font-mono text-right">{portfolioValue > 0 ? ((cashValue / portfolioValue) * 100).toFixed(2) : '0.00'}%</td>
                                    <td className="p-2 font-mono text-right">${cashValue.toFixed(2)}</td>
                                </tr>
                                {positionsWithValues.length > 0 ? positionsWithValues.map((pos: any) => (
                                    <tr key={pos.ticker}>
                                        <td className="p-2 font-mono">{pos.ticker}</td>
                                        <td className="p-2 font-mono text-right">{pos.quantity}</td>
                                        <td className="p-2 font-mono text-right">${(pos.averageCost ?? 0).toFixed(2)}</td>
                                        <td className="p-2 font-mono text-right">${(pos.currentPrice ?? 0).toFixed(2)}</td>
                                        <td className="p-2 font-mono text-right">{(pos.positionPercent ?? 0).toFixed(2)}%</td>
                                        <td className={`p-2 font-mono text-right ${(pos.totalGain ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                            ${(pos.totalGain ?? 0).toFixed(2)} ({(pos.totalGainPercent ?? 0) >= 0 ? '+' : ''}{(pos.totalGainPercent ?? 0).toFixed(2)}%)
                                        </td>
                                    </tr>
                                )) : null}
                                {positionsWithValues.length === 0 && (
                                    <tr><td colSpan={6} className="p-4 text-center text-arena-text-secondary">No open positions.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Trade History */}
                <div>
                    <h3 className="text-lg font-semibold mb-2">Recent Trades</h3>
                     <div className="bg-arena-bg rounded-lg max-h-60 overflow-y-auto overflow-x-auto">
                        <table className="w-full text-sm text-left min-w-[500px]">
                           <thead className="sticky top-0 bg-gray-900 text-arena-text-secondary">
                                <tr>
                                    <th className="p-2">When</th>
                                    <th className="p-2">Action</th>
                                    <th className="p-2">Ticker</th>
                                    <th className="p-2 text-right">Qty</th>
                                    <th className="p-2 text-right">Price</th>
                                    <th className="p-2 text-right">Fees</th>
                                </tr>
                            </thead>
                             <tbody className="divide-y divide-arena-border">
                                {agent.tradeHistory.length > 0 ? [...agent.tradeHistory].reverse().slice(0, 20).map(trade => (
                                    <tr key={`${trade.timestamp}-${trade.ticker}-${trade.action}-${Math.random()}`}>
                                        <td className="p-2 font-mono text-center">{formatTradeTimestamp(trade.timestamp, startDate, currentDate, simulationMode)}</td>
                                        <td className={`p-2 font-mono uppercase font-bold ${trade.action === 'buy' ? 'text-brand-positive' : 'text-brand-negative'}`}>{trade.action}</td>
                                        <td className="p-2 font-mono">{trade.ticker}</td>
                                        <td className="p-2 font-mono text-right">{trade.quantity}</td>
                                        <td className="p-2 font-mono text-right">${(trade.price ?? 0).toFixed(2)}</td>
                                        <td className="p-2 font-mono text-right">{trade.fees !== undefined ? `$${trade.fees.toFixed(2)}` : '-'}</td>
                                    </tr>
                                )) : <tr><td colSpan={6} className="p-4 text-center text-arena-text-secondary">No trades executed yet.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Valuation Analysis */}
                {(() => {
                  // Get currently owned tickers
                  const ownedTickers = new Set(positions.map((p: Position) => p.ticker));
                  
                  // Find the most recent trade with valuation data for each owned ticker
                  const valuationData = new Map<string, typeof agent.tradeHistory[0]>();
                  
                  // Sort trades by timestamp descending to get most recent first
                  const sortedTrades = [...agent.tradeHistory].sort((a, b) => b.timestamp - a.timestamp);
                  
                  for (const trade of sortedTrades) {
                    if (ownedTickers.has(trade.ticker) && 
                        (trade.fairValue !== undefined || trade.topOfBox !== undefined || trade.bottomOfBox !== undefined || trade.justification)) {
                      if (!valuationData.has(trade.ticker)) {
                        valuationData.set(trade.ticker, trade);
                      }
                    }
                  }
                  
                  const valuationEntries = Array.from(valuationData.values());
                  
                  return valuationEntries.length > 0 && (
                    <div className="md:col-span-2">
                      <h3 className="text-lg font-semibold mb-2">Valuation Analysis</h3>
                      <div className="bg-arena-bg rounded-lg overflow-x-auto">
                        <table className="w-full text-sm text-left min-w-[800px]">
                          <thead className="bg-gray-900 text-arena-text-secondary">
                            <tr>
                              <th className="p-2">When</th>
                              <th className="p-2">Ticker</th>
                              <th className="p-2 text-right">Price</th>
                              <th className="p-2 text-right">Fair Value</th>
                              <th className="p-2 text-right">Top of Box</th>
                              <th className="p-2 text-right">Bottom of Box</th>
                              <th className="p-2">Justification</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-arena-border">
                            {valuationEntries.map(trade => (
                              <tr key={`valuation-${trade.timestamp}-${trade.ticker}-${Math.random()}`}>
                                <td className="p-2 font-mono text-center">{formatTradeTimestamp(trade.timestamp, startDate, currentDate, simulationMode)}</td>
                                <td className="p-2 font-mono">{trade.ticker}</td>
                                <td className="p-2 font-mono text-right">${(trade.price ?? 0).toFixed(2)}</td>
                                <td className="p-2 font-mono text-right">{trade.fairValue != null ? `$${(trade.fairValue ?? 0).toFixed(2)}` : '-'}</td>
                                <td className="p-2 font-mono text-right">{trade.topOfBox != null ? `$${(trade.topOfBox ?? 0).toFixed(2)}` : '-'}</td>
                                <td className="p-2 font-mono text-right">{trade.bottomOfBox != null ? `$${(trade.bottomOfBox ?? 0).toFixed(2)}` : '-'}</td>
                                <td className="p-2 text-arena-text-secondary text-xs">{trade.justification || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

            </div>
        </div>
    </div>
  );
};