import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { Leaderboard } from './components/Leaderboard';
import { AgentDetailView } from './components/AgentDetailView';
import { useSimulation } from './hooks/useSimulation';
import type { Agent } from './types';
import { TickerBar } from './components/TickerBar';
import { MainPerformanceChart } from './components/MainPerformanceChart';
import { InfoPanel } from './components/InfoPanel';
import { isHistoricalSimulationComplete, getSimulationMode } from './services/marketDataService';
import { logger } from './services/logger';

export default function App() {
  const { agents, benchmarks, simulationState, marketData, advanceDay, advanceIntraday, exportSimulationData } = useSimulation();
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [isStopped, setIsStopped] = useState(false);
  const liveIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    // Auto-stop if historical simulation is complete
    if (isHistoricalSimulationComplete(simulationState.day) && !isStopped) {
      setIsLive(false);
      setIsStopped(true);
      setTimeout(() => {
        exportSimulationData();
      }, 500);
    }
  }, [simulationState.day, isStopped, exportSimulationData]);

  useEffect(() => {
    if (isLive && !simulationState.isLoading && !isStopped && !isHistoricalSimulationComplete(simulationState.day)) {
      liveIntervalRef.current = window.setInterval(() => {
        // Advance intraday first (every 30 minutes: 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6)
        // After 13 intraday updates (hour 6.5), advance to next day
        // Check current hour to decide whether to advance intraday or day
        if (simulationState.intradayHour < 6) {
          advanceIntraday();
        } else {
          // At hour 6, we've completed the day, advance to next day
          advanceDay();
        }
      }, 3000); // Advance every 3 seconds
    } else if ((!isLive || isStopped || isHistoricalSimulationComplete(simulationState.day)) && liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
    }
    return () => {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
      }
    };
  }, [isLive, advanceDay, advanceIntraday, simulationState.isLoading, isStopped, simulationState.day, simulationState.intradayHour]);

  const handleSelectAgent = (agent: Agent) => setSelectedAgent(agent);
  const handleCloseDetail = () => setSelectedAgent(null);
  const toggleLiveMode = () => {
    if (isStopped) return; // Can't resume if stopped
    setIsLive(prev => !prev);
  };
  
  const handleStop = () => {
    setIsLive(false);
    setIsStopped(true);
    logger.logSimulationEvent('Simulation stopped by user', { day: simulationState.day });
    // Wait a moment for any ongoing simulation to finish, then export
    setTimeout(() => {
      exportSimulationData();
      // Also export logs when simulation stops
      logger.exportLogs();
    }, 500);
  };

  const handleExportLogs = () => {
    logger.exportLogs();
  };

  const allParticipants = [...agents, ...benchmarks];
  const simulationMode = getSimulationMode();

  return (
    <div className="min-h-screen bg-arena-bg font-sans text-arena-text-primary antialiased">
      <Header isLive={isLive} onToggleLive={toggleLiveMode} isStopped={isStopped} simulationMode={simulationMode} />
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
              onStop={handleStop}
              onExportLogs={handleExportLogs}
              isLoading={simulationState.isLoading}
              isLive={isLive}
              isStopped={isStopped}
              day={simulationState.day}
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