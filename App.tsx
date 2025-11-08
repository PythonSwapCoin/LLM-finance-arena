import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { Leaderboard } from './components/Leaderboard';
import { AgentDetailView } from './components/AgentDetailView';
import { useSimulation } from './hooks/useSimulation';
import type { Agent } from './types';
import { TickerBar } from './components/TickerBar';
import { MainPerformanceChart } from './components/MainPerformanceChart';
import { InfoPanel } from './components/InfoPanel';

export default function App() {
  const { agents, benchmarks, simulationState, marketData, advanceDay } = useSimulation();
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [isLive, setIsLive] = useState(false);
  const liveIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (isLive && !simulationState.isLoading) {
      liveIntervalRef.current = window.setInterval(() => {
        advanceDay();
      }, 3000); // Advance every 3 seconds
    } else if (!isLive && liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
    }
    return () => {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
      }
    };
  }, [isLive, advanceDay, simulationState.isLoading]);

  const handleSelectAgent = (agent: Agent) => setSelectedAgent(agent);
  const handleCloseDetail = () => setSelectedAgent(null);
  const toggleLiveMode = () => setIsLive(prev => !prev);

  const allParticipants = [...agents, ...benchmarks];

  return (
    <div className="min-h-screen bg-arena-bg font-sans text-arena-text-primary antialiased">
      <Header isLive={isLive} onToggleLive={toggleLiveMode} />
      <TickerBar marketData={marketData} />
      
      <main className="p-4 sm:p-6 lg:p-8 max-w-screen-2xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-arena-surface rounded-lg shadow-lg p-4 h-[60vh] flex flex-col">
            <h2 className="text-lg font-semibold text-arena-text-primary mb-4 px-2">Total Account Value</h2>
            <div className="flex-grow">
              <MainPerformanceChart participants={allParticipants} />
            </div>
          </div>
          <div className="lg:col-span-1">
            <InfoPanel 
              agents={agents}
              onAdvanceDay={advanceDay}
              isLoading={simulationState.isLoading}
              isLive={isLive}
              day={simulationState.day}
            />
          </div>
        </div>

        <div id="leaderboard" className="mt-8">
          <Leaderboard agents={agents} onSelectAgent={handleSelectAgent} />
        </div>
        
        {selectedAgent && (
          <AgentDetailView agent={selectedAgent} onClose={handleCloseDetail} />
        )}
      </main>

      <footer className="text-center p-4 text-arena-text-tertiary text-xs">
          <p>LLM Trading Arena Season 1 is now live. All trades are simulated and not financial advice.</p>
      </footer>
    </div>
  );
}