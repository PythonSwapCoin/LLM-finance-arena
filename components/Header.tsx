import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { MarketDataTelemetry } from '../types';

interface HeaderProps {
  simulationState?: any;
  connectionStatus?: {
    connected: boolean;
    lastChecked: string | null;
    backendInfo: any;
  };
  mode?: 'simulated' | 'realtime' | 'historical' | 'hybrid';
  simulationTypeName?: string;
  marketTelemetry?: MarketDataTelemetry | null;
}

interface CompetitionType {
  id: string;
  name: string;
  description: string;
  chatEnabled: boolean;
  showModelNames: boolean;
  agentCount: number;
  enabled?: boolean; // Optional for backward compatibility
}

export const Header: React.FC<HeaderProps> = ({ simulationState, connectionStatus, mode, simulationTypeName, marketTelemetry }) => {
  const navigate = useNavigate();
  const { simulationId } = useParams<{ simulationId: string }>();
  const [competitions, setCompetitions] = useState<CompetitionType[]>([]);
  const [loadingCompetitions, setLoadingCompetitions] = useState(true);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const simulationMode = mode || 'simulated';

  // Get market status from backend info
  // isMarketOpen will be:
  // - true: for historical/simulated/hybrid (before transition) - always show "LIVE"
  // - boolean (true/false): for realtime/hybrid (after transition) - show actual market status
  // - null/undefined: fallback case (show "LIVE" as default until status is fetched)
  const isMarketOpen = connectionStatus?.backendInfo?.simulation?.isMarketOpen;
  
  // Always show market status indicator when we have a simulation mode
  // Show "MARKET CLOSED" only when explicitly false, otherwise show "LIVE"
  const shouldShowMarketStatus = simulationMode !== undefined;
  const showMarketClosed = isMarketOpen === false; // Explicitly check for false

  useEffect(() => {
    const fetchCompetitions = async () => {
      try {
        const { getApiBaseUrl } = await import('../utils/apiConfig');
        const API_BASE_URL = getApiBaseUrl();
        const response = await fetch(`${API_BASE_URL}/api/simulations/types`);
        if (response.ok) {
          const data = await response.json();
          // Sort competitions: enabled first, then disabled (coming soon) at the end
          const sortedCompetitions = [...(data.types || [])].sort((a, b) => {
            const aEnabled = a.enabled !== false;
            const bEnabled = b.enabled !== false;
            // Enabled items come first
            if (aEnabled && !bEnabled) return -1;
            if (!aEnabled && bEnabled) return 1;
            return 0;
          });
          setCompetitions(sortedCompetitions);
        }
      } catch (err) {
        console.error('Failed to fetch competitions:', err);
      } finally {
        setLoadingCompetitions(false);
      }
    };

    fetchCompetitions();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isDropdownOpen]);

  const getModeLabel = () => {
    switch (simulationMode) {
      case 'historical':
        return { label: 'HISTORICAL SIMULATION', color: 'bg-blue-500', textColor: 'text-blue-400' };
      case 'realtime':
        return { label: 'REAL-TIME DATA', color: 'bg-green-500', textColor: 'text-green-400' };
      default:
        return { label: 'SIMULATED DATA', color: 'bg-yellow-500', textColor: 'text-yellow-400' };
    }
  };

  const modeInfo = getModeLabel();

  const isConnected = connectionStatus?.connected ?? false;
  const backendInfo = connectionStatus?.backendInfo;
  const yahooRateLimit = backendInfo?.marketData?.rateLimits?.yahoo || marketTelemetry?.rateLimits?.yahoo;
  const hasRateLimitPressure = Boolean(yahooRateLimit?.isThrottled || (yahooRateLimit?.blockedRequests ?? 0) > 0);
  const rateLimitTitle = yahooRateLimit
    ? `Yahoo Finance: ${yahooRateLimit.currentCount}/${yahooRateLimit.maxRequestsPerWindow} in ${yahooRateLimit.windowMs}ms window. Blocked ${yahooRateLimit.blockedRequests} requests${yahooRateLimit.lastThrottledAt ? `, last throttled at ${yahooRateLimit.lastThrottledAt}` : ''}.`
    : 'Rate-limit status unavailable';

  const currentCompetition = competitions.find(c => c.id === simulationId);
  const displayName = simulationTypeName || currentCompetition?.name || 'Select Competition';

  const handleCompetitionSelect = (competitionId: string, enabled: boolean) => {
    if (!enabled) {
      // Don't navigate if disabled
      return;
    }
    if (competitionId !== simulationId) {
      navigate(`/simulation/${competitionId}`);
    }
    setIsDropdownOpen(false);
  };

  return (
    <header className="bg-arena-bg border-b border-arena-border p-4 sticky top-0 z-20">
      <div className="max-w-screen-2xl mx-auto flex justify-between items-center gap-4">
        {/* Competition Dropdown - Left side */}
        {!loadingCompetitions && competitions.length > 0 && (
          <div ref={dropdownRef} className="relative flex-shrink-0">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-arena-text-primary hover:text-arena-text-primary bg-arena-surface/50 hover:bg-arena-surface rounded-lg border border-arena-border transition-colors"
            >
              <span>{displayName}</span>
              <svg
                className={`w-4 h-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Dropdown Menu */}
            {isDropdownOpen && (
              <div className="absolute top-full left-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-arena-surface border border-arena-border rounded-lg shadow-xl z-50 overflow-hidden">
                <div className="py-2">
                  {competitions.map((competition) => {
                    const isCurrent = competition.id === simulationId;
                    const isEnabled = competition.enabled !== false; // Default to enabled if not specified
                    return (
                      <button
                        key={competition.id}
                        onClick={() => handleCompetitionSelect(competition.id, isEnabled)}
                        disabled={!isEnabled}
                        className={`w-full text-left px-4 py-3 transition-colors ${
                          !isEnabled
                            ? 'opacity-50 cursor-not-allowed'
                            : isCurrent
                            ? 'bg-blue-500/10 border-l-2 border-blue-500 hover:bg-arena-bg'
                            : 'hover:bg-arena-bg'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className={`font-medium ${
                              !isEnabled
                                ? 'text-arena-text-tertiary'
                                : isCurrent
                                ? 'text-blue-400'
                                : 'text-arena-text-primary'
                            }`}>
                              {competition.name}
                              {isCurrent && (
                                <span className="ml-2 text-xs text-blue-400">(Current)</span>
                              )}
                              {!isEnabled && (
                                <span className="ml-2 text-xs text-arena-text-tertiary italic">(Coming Soon)</span>
                              )}
                            </div>
                            <div className={`text-xs mt-1 line-clamp-2 ${
                              !isEnabled ? 'text-arena-text-tertiary' : 'text-arena-text-secondary'
                            }`}>
                              {competition.description}
                            </div>
                          </div>
                          {isCurrent && (
                            <svg
                              className="w-5 h-5 text-blue-400 flex-shrink-0 ml-2"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Status badges - Right side (hidden on mobile, visible on md+) */}
        <div className="hidden md:flex items-center space-x-2 lg:space-x-4 flex-shrink-0">
          {/* Live indicator with market status */}
          {shouldShowMarketStatus && (
            <div className="text-arena-text-primary flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${showMarketClosed ? 'bg-yellow-500' : 'bg-red-500 animate-pulse'}`}></div>
              <span className="text-sm font-medium">
                {showMarketClosed ? 'MARKET CLOSED' : 'LIVE'}
              </span>
            </div>
          )}
          {/* Hidden: Simulation mode badge (SIMULATED DATA, REAL-TIME DATA, etc.) */}
          {/* <div className={`flex items-center space-x-2 px-2 lg:px-3 py-1 rounded-full ${modeInfo.color} bg-opacity-20 border border-current ${modeInfo.textColor}`}>
            <div className={`w-2 h-2 rounded-full ${modeInfo.color}`}></div>
            <span className="text-xs font-semibold">{modeInfo.label}</span>
          </div> */}
          {/* Hidden: Backend status indicator */}
          {/* <div className={`flex items-center space-x-2 px-2 py-1 rounded text-xs ${isConnected ? 'bg-green-500 bg-opacity-20 text-green-400' : 'bg-red-500 bg-opacity-20 text-red-400'}`} title={isConnected ? `Backend connected${backendInfo ? ` - Day ${backendInfo.simulation?.day || 0}, ${backendInfo.simulation?.agentsCount || 0} agents` : ''}` : 'Backend disconnected'}>
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span className="font-semibold">{isConnected ? 'BACKEND' : 'OFFLINE'}</span>
          </div> */}
          {hasRateLimitPressure && (
            <div
              className="flex items-center space-x-2 px-2 py-1 rounded text-xs bg-orange-500 bg-opacity-20 text-orange-400"
              title={rateLimitTitle}
            >
              <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></div>
              <span className="font-semibold">RATE-LIMITED</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
