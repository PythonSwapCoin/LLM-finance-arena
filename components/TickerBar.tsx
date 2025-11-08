import React from 'react';
import type { MarketData, TickerData } from '../types';
import { S_P500_TICKERS } from '../constants';

const Ticker: React.FC<{ data: TickerData }> = ({ data }) => {
  if (!data) return null;
  const isPositive = data.dailyChangePercent >= 0;
  const colorClass = isPositive ? 'text-brand-positive' : 'text-brand-negative';

  return (
    <div className="flex items-center space-x-4 text-sm px-4">
      <span className="font-bold text-arena-text-secondary">{data.ticker}</span>
      <span className="font-mono text-arena-text-primary">{data.price.toFixed(2)}</span>
      <span className={`font-mono ${colorClass}`}>
        {isPositive ? '+' : ''}{(data.dailyChangePercent * 100).toFixed(2)}%
      </span>
    </div>
  );
};

export const TickerBar: React.FC<{ marketData: MarketData }> = ({ marketData }) => {
  const tickersToShow = S_P500_TICKERS.slice(0, 10);

  if (Object.keys(marketData).length === 0) {
    return <div className="h-10 bg-arena-bg border-b border-arena-border" />;
  }

  return (
    <div className="bg-arena-bg border-b border-arena-border h-10 flex items-center overflow-hidden">
      <div className="flex animate-marquee whitespace-nowrap">
         {tickersToShow.map(ticker => <Ticker key={ticker} data={marketData[ticker]} />)}
      </div>
       <div className="flex animate-marquee whitespace-nowrap">
         {tickersToShow.map(ticker => <Ticker key={`${ticker}-2`} data={marketData[ticker]} />)}
      </div>
       <style>{`
        @keyframes marquee {
            0% { transform: translateX(0%); }
            100% { transform: translateX(-100%); }
        }
        .animate-marquee {
            animation: marquee 40s linear infinite;
        }
    `}</style>
    </div>
  );
};