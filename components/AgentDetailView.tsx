import React from 'react';
import type { Agent, Position } from '../types';
import { PerformanceChart } from './PerformanceChart';
import { XMarkIcon } from './icons/Icons';

interface AgentDetailViewProps {
  agent: Agent;
  onClose: () => void;
}

const StatCard: React.FC<{ label: string; value: string; className?: string }> = ({ label, value, className = '' }) => (
    <div className="bg-arena-bg p-4 rounded-lg">
        <p className="text-sm text-arena-text-secondary">{label}</p>
        <p className={`text-xl font-bold ${className}`}>{value}</p>
    </div>
);


export const AgentDetailView: React.FC<AgentDetailViewProps> = ({ agent, onClose }) => {
    const latestPerf = agent.performanceHistory[agent.performanceHistory.length - 1];
    const positions = Object.values(agent.portfolio.positions).filter((p: Position) => p.quantity > 0);
    
  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4" onClick={onClose}>
        <div className="bg-arena-surface rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto border border-arena-border" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-arena-surface p-4 border-b border-arena-border flex justify-between items-center z-10">
                <div className="flex items-center space-x-3">
                    <div className="w-4 h-4 rounded-full" style={{backgroundColor: agent.color}}></div>
                    <div>
                        <h2 className="text-xl font-bold text-arena-text-primary">{agent.name}</h2>
                        <p className="text-sm text-arena-text-secondary">{agent.model}</p>
                    </div>
                </div>
                <button onClick={onClose} className="text-arena-text-secondary hover:text-arena-text-primary">
                    <XMarkIcon className="h-6 w-6" />
                </button>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Performance Chart */}
                <div className="md:col-span-2 bg-arena-bg p-4 rounded-lg">
                    <h3 className="text-lg font-semibold mb-2">Equity Curve</h3>
                    <div className="h-64">
                      <PerformanceChart data={agent.performanceHistory} dataKey="totalValue" color={agent.color}/>
                    </div>
                </div>

                {/* Key Metrics */}
                <div className="md:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <StatCard label="Total Value" value={`$${latestPerf.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
                    <StatCard label="Total Return" value={`${(latestPerf.totalReturn * 100).toFixed(2)}%`} className={latestPerf.totalReturn >= 0 ? 'text-brand-positive' : 'text-brand-negative'} />
                    <StatCard label="Sharpe Ratio" value={latestPerf.sharpeRatio.toFixed(2)} />
                    <StatCard label="Max Drawdown" value={`${(latestPerf.maxDrawdown * 100).toFixed(2)}%`} className="text-brand-negative"/>
                </div>

                {/* Rationale */}
                <div className="md:col-span-2 bg-arena-bg p-4 rounded-lg">
                    <h3 className="text-lg font-semibold mb-2">Latest Rationale</h3>
                    <p className="text-sm text-arena-text-secondary italic">"{agent.rationale}"</p>
                </div>


                {/* Current Positions */}
                <div>
                    <h3 className="text-lg font-semibold mb-2">Current Positions (Cash: ${agent.portfolio.cash.toLocaleString(undefined, { maximumFractionDigits: 0 })})</h3>
                    <div className="bg-arena-bg rounded-lg max-h-60 overflow-y-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="sticky top-0 bg-gray-900 text-arena-text-secondary">
                                <tr>
                                    <th className="p-2">Ticker</th>
                                    <th className="p-2 text-right">Quantity</th>
                                    <th className="p-2 text-right">Avg. Cost</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-arena-border">
                                {positions.length > 0 ? positions.map((pos: Position) => (
                                    <tr key={pos.ticker}>
                                        <td className="p-2 font-mono">{pos.ticker}</td>
                                        <td className="p-2 font-mono text-right">{pos.quantity}</td>
                                        <td className="p-2 font-mono text-right">${pos.averageCost.toFixed(2)}</td>
                                    </tr>
                                )) : <tr><td colSpan={3} className="p-4 text-center text-arena-text-secondary">No open positions.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Trade History */}
                <div>
                    <h3 className="text-lg font-semibold mb-2">Recent Trades</h3>
                     <div className="bg-arena-bg rounded-lg max-h-60 overflow-y-auto">
                        <table className="w-full text-sm text-left">
                           <thead className="sticky top-0 bg-gray-900 text-arena-text-secondary">
                                <tr>
                                    <th className="p-2">Day</th>
                                    <th className="p-2">Action</th>
                                    <th className="p-2">Ticker</th>
                                    <th className="p-2 text-right">Qty</th>
                                    <th className="p-2 text-right">Price</th>
                                </tr>
                            </thead>
                             <tbody className="divide-y divide-arena-border">
                                {agent.tradeHistory.length > 0 ? [...agent.tradeHistory].reverse().slice(0, 20).map(trade => (
                                    <tr key={`${trade.timestamp}-${trade.ticker}-${trade.action}-${Math.random()}`}>
                                        <td className="p-2 font-mono text-center">{trade.timestamp}</td>
                                        <td className={`p-2 font-mono uppercase font-bold ${trade.action === 'buy' ? 'text-brand-positive' : 'text-brand-negative'}`}>{trade.action}</td>
                                        <td className="p-2 font-mono">{trade.ticker}</td>
                                        <td className="p-2 font-mono text-right">{trade.quantity}</td>
                                        <td className="p-2 font-mono text-right">${trade.price.toFixed(2)}</td>
                                    </tr>
                                )) : <tr><td colSpan={5} className="p-4 text-center text-arena-text-secondary">No trades executed yet.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        </div>
    </div>
  );
};