import React, { useState } from 'react';
import type { Agent, Trade } from '../types';

interface TradeWithAgent extends Trade {
  agentName: string;
  agentColor: string;
}

const TradeItem: React.FC<{ trade: TradeWithAgent }> = ({ trade }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const isPositive = trade.action === 'buy';
  const actionClass = isPositive ? 'text-brand-positive' : 'text-brand-negative';

  return (
    <div
      className="relative flex items-center space-x-4 text-sm px-4"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span className="font-bold" style={{ color: trade.agentColor }}>
        {trade.agentName}
      </span>
      <span className={`font-mono uppercase font-semibold ${actionClass}`}>
        {trade.action}
      </span>
      <span className="font-mono text-arena-text-secondary">{trade.ticker}</span>
      <span className="font-mono text-arena-text-primary">×{trade.quantity}</span>
      <span className="font-mono text-arena-text-primary">@${trade.price?.toFixed(2)}</span>

      {/* Tooltip with justification */}
      {showTooltip && trade.justification && (
        <div className="absolute bottom-full mb-2 left-0 z-50 bg-arena-surface border border-arena-border rounded-md shadow-lg p-3 text-xs text-arena-text-secondary whitespace-normal w-64">
          <div className="font-semibold text-arena-text-primary mb-1">Justification:</div>
          {trade.justification}
          <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-arena-border"></div>
        </div>
      )}
    </div>
  );
};

export const RecentTradesBar: React.FC<{ agents: Agent[] }> = ({ agents }) => {
  // Collect all trades from all agents with agent info
  const recentTrades: TradeWithAgent[] = [];

  agents.forEach(agent => {
    if (agent.tradeHistory && agent.tradeHistory.length > 0) {
      // Get the last 3 trades from each agent
      const agentRecentTrades = [...agent.tradeHistory]
        .reverse()
        .slice(0, 3)
        .map(trade => ({
          ...trade,
          agentName: agent.name,
          agentColor: agent.color,
        }));
      recentTrades.push(...agentRecentTrades);
    }
  });

  // Sort by timestamp (most recent first) and take top 15
  const sortedTrades = recentTrades
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 15);

  if (sortedTrades.length === 0) {
    return <div className="h-10 bg-arena-bg border-b border-arena-border" />;
  }

  return (
    <div className="bg-arena-bg border-b border-arena-border h-10 flex items-center overflow-hidden">
      <div className="flex animate-marquee whitespace-nowrap">
        {sortedTrades.map((trade, idx) => <TradeItem key={`trade-${idx}`} trade={trade} />)}
      </div>
      <div className="flex animate-marquee whitespace-nowrap">
        {sortedTrades.map((trade, idx) => <TradeItem key={`trade-${idx}-2`} trade={trade} />)}
      </div>
      <style>{`
        @keyframes marquee {
            0% { transform: translateX(0%); }
            100% { transform: translateX(-100%); }
        }
        .animate-marquee {
            animation: marquee 60s linear infinite;
        }
    `}</style>
    </div>
  );
};
