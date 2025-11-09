import React from 'react';
import { PlayIcon, PauseIcon } from './icons/Icons';

interface HeaderProps {
  isLive: boolean;
  onToggleLive: () => void;
  isStopped: boolean;
  simulationMode: 'simulated' | 'real-time' | 'historical';
}

export const Header: React.FC<HeaderProps> = ({ isLive, onToggleLive, isStopped, simulationMode }) => {
  const getModeLabel = () => {
    switch (simulationMode) {
      case 'historical':
        return { label: 'HISTORICAL SIMULATION', color: 'bg-blue-500', textColor: 'text-blue-400' };
      case 'real-time':
        return { label: 'REAL-TIME DATA', color: 'bg-green-500', textColor: 'text-green-400' };
      default:
        return { label: 'SIMULATED DATA', color: 'bg-yellow-500', textColor: 'text-yellow-400' };
    }
  };

  const modeInfo = getModeLabel();

  return (
    <header className="bg-arena-bg border-b border-arena-border p-4 sticky top-0 z-20">
      <div className="max-w-screen-2xl mx-auto flex justify-between items-center">
        <div className="flex items-center space-x-8">
          <h1 className="text-2xl font-bold text-arena-text-primary tracking-tighter">
            LLM TRADING ARENA
          </h1>
          <nav className="hidden md:flex items-center space-x-6 text-sm font-medium">
            <a href="#" className="text-arena-text-primary flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${isLive ? 'bg-red-500 animate-pulse' : 'bg-gray-500'}`}></div>
              <span>LIVE</span>
            </a>
            <div className={`flex items-center space-x-2 px-3 py-1 rounded-full ${modeInfo.color} bg-opacity-20 border border-current ${modeInfo.textColor}`}>
              <div className={`w-2 h-2 rounded-full ${modeInfo.color}`}></div>
              <span className="text-xs font-semibold">{modeInfo.label}</span>
            </div>
            <a href="#leaderboard" className="text-arena-text-secondary hover:text-arena-text-primary transition-colors">LEADERBOARD</a>
            <a href="#" className="text-arena-text-secondary hover:text-arena-text-primary transition-colors">BLOG</a>
            <a href="#" className="text-arena-text-secondary hover:text-arena-text-primary transition-colors">MODELS</a>
          </nav>
        </div>

        <div className="flex items-center space-x-4">
           <button
            onClick={onToggleLive}
            disabled={isStopped}
            className="flex items-center justify-center bg-arena-surface hover:bg-arena-border disabled:opacity-50 disabled:cursor-not-allowed border border-arena-border text-arena-text-primary font-bold w-10 h-10 rounded-full transition-colors duration-200"
            aria-label={isLive ? 'Pause simulation' : 'Play simulation'}
          >
            {isLive ? (
              <PauseIcon className="h-5 w-5" />
            ) : (
              <PlayIcon className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};