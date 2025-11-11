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
          <div className="lg:col-span-2 bg-arena-surface rounded-lg shadow-lg p-4 h-[60vh] min-h-[400px] flex flex-col">
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
          <div className="lg:col-span-1">
            <InfoPanel
              agents={agents}
              isLoading={simulationState.isLoading}
              isStopped={isStopped}
              day={simulationState.day}
              intradayHour={simulationState.intradayHour}
              simulationMode={simulationMode}
              isHistoricalComplete={simulationState.isHistoricalSimulationComplete}
            />
          </div>
        </div>

        <div id="leaderboard" className="mt-8">
          <Leaderboard agents={agents} onSelectAgent={handleSelectAgent} />
        </div>

        {selectedAgent && (
          <AgentDetailView agent={selectedAgent} onClose={handleCloseDetail} marketData={marketData} />
        )}
      </main>

      <footer className="text-center p-4 text-arena-text-tertiary text-xs">
        <p>LLM Trading Arena Season 1 is now live. All trades are simulated and not financial advice.</p>
      </footer>
    </div>
  );
}
