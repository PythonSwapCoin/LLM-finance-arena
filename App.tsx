import React, { useState } from 'react';
import { Header } from './components/Header';
import { Leaderboard } from './components/Leaderboard';
import { AgentDetailView } from './components/AgentDetailView';
import { useApiState } from './hooks/useApiState';
import type { Agent } from './types';
import { TickerBar } from './components/TickerBar';
import { MainPerformanceChart } from './components/MainPerformanceChart';
import { InfoPanel } from './components/InfoPanel';

export default function App() {
  const { agents, benchmarks, simulationState, marketData, simulationMode, marketTelemetry, connectionStatus, checkConnection } = useApiState();
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [isMobileInfoOpen, setMobileInfoOpen] = useState(false);
  const isStopped = simulationState.isHistoricalSimulationComplete;

  const handleSelectAgent = (agent: Agent) => setSelectedAgent(agent);
  const handleCloseDetail = () => setSelectedAgent(null);

  const allParticipants = [...agents, ...benchmarks];

  // Log connection status to console for debugging and expose test function
  React.useEffect(() => {
    if (connectionStatus) {
      console.log('🔌 Backend Connection Status:', {
        connected: connectionStatus.connected,
        lastChecked: connectionStatus.lastChecked,
        backendInfo: connectionStatus.backendInfo,
      });
      
      // Make checkConnection available globally for manual testing
      (window as any).testBackendConnection = async () => {
        console.log('🧪 Testing backend connection...');
        const result = await checkConnection();
        if (result) {
          console.log('✅ Backend is connected!', connectionStatus.backendInfo);
        } else {
          console.error('❌ Backend connection failed!');
        }
        return result;
      };
    }
  }, [connectionStatus, checkConnection]);

  return (
    <div className="min-h-screen bg-arena-bg font-sans text-arena-text-primary antialiased">
      <Header
        isLive={false}
        onToggleLive={() => {}}
        isStopped={isStopped}
        simulationMode={simulationMode}
        connectionStatus={connectionStatus}
        marketTelemetry={marketTelemetry}
      />
      <TickerBar marketData={marketData} />
      
      <main className="p-4 sm:p-6 lg:p-8 max-w-screen-2xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-arena-surface rounded-lg shadow-lg p-3 sm:p-4 h-[68vh] sm:h-[72vh] lg:h-[60vh] min-h-[360px] flex flex-col">
            <h2 className="text-lg font-semibold text-arena-text-primary mb-4 px-2">Total Account Value</h2>
            <div className="flex-grow min-h-0">
              <MainPerformanceChart
                participants={allParticipants}
                startDate={simulationState.startDate}
                currentDate={simulationState.currentDate}
                simulationMode={simulationMode}
                day={simulationState.day}
                intradayHour={simulationState.intradayHour}
              />
            </div>
          </div>
          <div className="hidden lg:block lg:col-span-1">
            <InfoPanel
              agents={agents}
              isLoading={simulationState.isLoading}
              isStopped={isStopped}
              day={simulationState.day}
              intradayHour={simulationState.intradayHour}
              simulationMode={simulationMode}
              isHistoricalComplete={simulationState.isHistoricalSimulationComplete}
              variant="desktop"
            />
          </div>
        </div>

        <div className="mt-6 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileInfoOpen(open => !open)}
            aria-expanded={isMobileInfoOpen}
            className="w-full flex items-center justify-between rounded-lg bg-arena-surface px-4 py-3 text-sm font-semibold text-arena-text-primary shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-arena-border"
          >
            <span>Competition insights</span>
            <svg
              className={`h-4 w-4 text-arena-text-secondary transition-transform ${isMobileInfoOpen ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          {isMobileInfoOpen && (
            <div className="mt-3">
              <InfoPanel
                agents={agents}
                isLoading={simulationState.isLoading}
                isStopped={isStopped}
                day={simulationState.day}
                intradayHour={simulationState.intradayHour}
                simulationMode={simulationMode}
                isHistoricalComplete={simulationState.isHistoricalSimulationComplete}
                variant="mobile"
              />
            </div>
          )}
        </div>

        <div id="leaderboard" className="mt-8">
          <Leaderboard agents={agents} onSelectAgent={handleSelectAgent} />
        </div>

        {selectedAgent && (
          <AgentDetailView
            agent={selectedAgent}
            onClose={handleCloseDetail}
            marketData={marketData}
            startDate={simulationState.startDate}
            currentDate={simulationState.currentDate}
            simulationMode={simulationMode}
          />
        )}
      </main>

      <footer className="text-center p-4 text-arena-text-tertiary text-xs">
        <p>LLM Trading Arena Season 1 is now live. All trades are simulated and not financial advice.</p>
      </footer>
    </div>
  );
}
