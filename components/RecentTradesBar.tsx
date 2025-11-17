import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Agent, Trade } from '../types';
import { getAgentDisplayName } from '../utils/modelNameFormatter';

interface TradeWithAgent extends Trade {
  agentName: string;
  agentColor: string;
}

interface RecentTradesBarProps {
  agents: Agent[];
  startDate?: string;
  currentDate?: string;
  simulationMode?: 'simulated' | 'realtime' | 'historical';
  day?: number;
  intradayHour?: number;
  simulationTypeName?: string;
}

// Calculate time ago from trade timestamp
const getTimeAgo = (
  tradeTimestamp: number,
  startDate?: string,
  currentDate?: string,
  simulationMode?: 'simulated' | 'realtime' | 'historical',
  currentDay?: number,
  currentIntradayHour?: number
): string => {
  try {
    let tradeDate: Date;
    let currentTime: Date;

    if (simulationMode === 'realtime' && tradeTimestamp > 1000000000) {
      // Unix timestamp
      tradeDate = new Date(tradeTimestamp * 1000);
      currentTime = currentDate ? new Date(currentDate) : new Date();
    } else if (startDate) {
      // Calculate trade date from startDate
      const start = new Date(startDate);
      const dayNum = Math.floor(tradeTimestamp);
      const hourDecimal = tradeTimestamp - dayNum;
      const hours = Math.floor(hourDecimal * 10);
      const minutes = Math.round((hourDecimal * 10 - hours) * 60);
      
      tradeDate = new Date(start);
      tradeDate.setDate(start.getDate() + dayNum);
      tradeDate.setHours(9 + hours, 30 + minutes, 0, 0);

      // Calculate current time
      if (currentDate && currentDay !== undefined && currentIntradayHour !== undefined) {
        currentTime = new Date(currentDate);
        const currentHours = Math.floor(currentIntradayHour);
        const currentMinutes = Math.round((currentIntradayHour - currentHours) * 60);
        currentTime.setHours(9 + currentHours, 30 + currentMinutes, 0, 0);
      } else if (currentDate) {
        currentTime = new Date(currentDate);
      } else {
        currentTime = new Date();
      }
    } else {
      // Fallback
      return 'recently';
    }

    const diffMs = currentTime.getTime() - tradeDate.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return `${Math.floor(diffDays / 7)}w ago`;
  } catch {
    return 'recently';
  }
};

const TradeItem: React.FC<{ 
  trade: TradeWithAgent;
  startDate?: string;
  currentDate?: string;
  simulationMode?: 'simulated' | 'realtime' | 'historical';
  day?: number;
  intradayHour?: number;
  isHovered: boolean;
  onHoverChange: (hovered: boolean) => void;
}> = ({ trade, startDate, currentDate, simulationMode, day, intradayHour, isHovered, onHoverChange }) => {
  const timeAgo = getTimeAgo(trade.timestamp, startDate, currentDate, simulationMode, day, intradayHour);
  const actionText = trade.action === 'buy' ? 'bought' : 'sold';
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const [tooltipPosition, setTooltipPosition] = React.useState({ top: 0, left: 0 });

  React.useEffect(() => {
    if (isHovered && buttonRef.current) {
      const updatePosition = () => {
        if (buttonRef.current) {
          const rect = buttonRef.current.getBoundingClientRect();
          setTooltipPosition({
            top: rect.bottom + 8, // Use viewport coordinates for fixed positioning
            left: rect.left + rect.width / 2,
          });
        }
      };
      updatePosition();
      // Update position on scroll/resize
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [isHovered]);

  return (
    <>
      <div
        className="inline-flex items-center"
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
        style={{ animationPlayState: isHovered ? 'paused' : 'running' }}
      >
        <button 
          ref={buttonRef}
          className="mx-2 px-3 py-1.5 rounded-md bg-arena-surface/40 border border-arena-border/50 hover:bg-arena-surface/60 transition-colors text-sm text-arena-text-primary"
        >
          <span style={{ color: trade.agentColor }}>
            {trade.agentName}
          </span>
          {' '}
          <span>{actionText}</span>
          {' '}
          <span>{trade.ticker}</span>
          {' '}
          <span>@${trade.price?.toFixed(2)}</span>
          {' '}
          <span className="text-xs text-arena-text-tertiary">{timeAgo}</span>
        </button>
      </div>

      {/* Tooltip with justification - render via portal to body to avoid overflow clipping */}
      {isHovered && trade.justification && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed z-[9999] bg-arena-surface border border-arena-border rounded-md shadow-lg p-3 text-xs text-arena-text-secondary whitespace-normal w-64 pointer-events-none"
          style={{
            top: `${tooltipPosition.top}px`,
            left: `${tooltipPosition.left}px`,
            transform: 'translate(-50%, 0)',
          }}
        >
          <div className="font-semibold text-arena-text-primary mb-1">Justification:</div>
          {trade.justification}
          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-arena-border"></div>
        </div>,
        document.body
      )}
    </>
  );
};

export const RecentTradesBar: React.FC<RecentTradesBarProps> = ({ 
  agents, 
  startDate, 
  currentDate, 
  simulationMode,
  day,
  intradayHour,
  simulationTypeName
}) => {
  const [hoveredTradeIndex, setHoveredTradeIndex] = useState<number | null>(null);
  
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
          agentName: getAgentDisplayName(agent, simulationTypeName),
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
      <div className="flex animate-marquee whitespace-nowrap" style={{ animationPlayState: hoveredTradeIndex !== null ? 'paused' : 'running' }}>
        {sortedTrades.map((trade, idx) => (
          <TradeItem 
            key={`trade-${idx}`} 
            trade={trade}
            startDate={startDate}
            currentDate={currentDate}
            simulationMode={simulationMode}
            day={day}
            intradayHour={intradayHour}
            isHovered={hoveredTradeIndex === idx}
            onHoverChange={(hovered) => setHoveredTradeIndex(hovered ? idx : null)}
          />
        ))}
      </div>
      <div className="flex animate-marquee whitespace-nowrap" style={{ animationPlayState: hoveredTradeIndex !== null ? 'paused' : 'running' }}>
        {sortedTrades.map((trade, idx) => (
          <TradeItem 
            key={`trade-${idx}-2`} 
            trade={trade}
            startDate={startDate}
            currentDate={currentDate}
            simulationMode={simulationMode}
            day={day}
            intradayHour={intradayHour}
            isHovered={hoveredTradeIndex === idx + sortedTrades.length}
            onHoverChange={(hovered) => setHoveredTradeIndex(hovered ? idx + sortedTrades.length : null)}
          />
        ))}
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
