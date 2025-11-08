
import React from 'react';
import { ArrowPathIcon, PlayIcon } from './icons/Icons';

interface HeaderProps {
  day: number;
  onAdvanceDay: () => void;
  isLoading: boolean;
  sp500Return: number;
  aiIndexReturn: number;
}

const formatReturn = (ret: number) => {
    const value = ret * 100;
    const color = value >= 0 ? 'text-brand-positive' : 'text-brand-negative';
    return <span className={color}>{value.toFixed(2)}%</span>;
}

export const Header: React.FC<HeaderProps> = ({ day, onAdvanceDay, isLoading, sp500Return, aiIndexReturn }) => {
  return (
    <header className="bg-brand-surface border-b border-brand-border p-4 shadow-md">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-6">
          <h1 className="text-xl md:text-2xl font-bold text-brand-text-primary">
            LLM Portfolio Manager Benchmark
          </h1>
          <div className="flex items-center space-x-4 text-sm text-brand-text-secondary mt-2 sm:mt-0">
             <div className="flex items-center space-x-2">
                <span className="font-semibold">S&P 500:</span> {formatReturn(sp500Return)}
             </div>
             <div className="flex items-center space-x-2">
                <span className="font-semibold">AI Index:</span> {formatReturn(aiIndexReturn)}
             </div>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="text-right">
            <span className="text-sm font-medium text-brand-text-secondary">Trading Day</span>
            <p className="text-2xl font-bold text-brand-accent">{day}</p>
          </div>
          <button
            onClick={onAdvanceDay}
            disabled={isLoading}
            className="flex items-center justify-center bg-brand-accent hover:bg-blue-700 disabled:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg transition-colors duration-200"
          >
            {isLoading ? (
              <ArrowPathIcon className="animate-spin h-5 w-5 mr-2" />
            ) : (
              <PlayIcon className="h-5 w-5 mr-2" />
            )}
            {isLoading ? 'Simulating...' : 'Next Day'}
          </button>
        </div>
      </div>
    </header>
  );
};
