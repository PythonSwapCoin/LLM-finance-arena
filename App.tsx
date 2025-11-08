
import React, { useState } from 'react';
import { Header } from './components/Header';
import { Leaderboard } from './components/Leaderboard';
import { AgentDetailView } from './components/AgentDetailView';
import { useSimulation } from './hooks/useSimulation';
import type { Agent } from './types';
// FIX: Corrected import name for S_P500_BENCHMARK_ID.
import { S_P500_BENCHMARK_ID, AI_MANAGERS_INDEX_ID } from './constants';

export default function App() {
  const { agents, benchmarks, simulationState, advanceDay } = useSimulation();
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  const handleSelectAgent = (agent: Agent) => {
    setSelectedAgent(agent);
  };

  const handleCloseDetail = () => {
    setSelectedAgent(null);
  };
  
  const sp500Benchmark = benchmarks.find(b => b.id === S_P500_BENCHMARK_ID);
  const aiIndexBenchmark = benchmarks.find(b => b.id === AI_MANAGERS_INDEX_ID);

  return (
    <div className="min-h-screen bg-brand-bg font-sans text-brand-text-primary">
      <Header
        day={simulationState.day}
        onAdvanceDay={advanceDay}
        isLoading={simulationState.isLoading}
        sp500Return={sp500Benchmark?.performanceHistory.slice(-1)[0]?.totalReturn ?? 0}
        aiIndexReturn={aiIndexBenchmark?.performanceHistory.slice(-1)[0]?.totalReturn ?? 0}
      />
      <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
        <Leaderboard agents={agents} onSelectAgent={handleSelectAgent} />
        {selectedAgent && (
          <AgentDetailView agent={selectedAgent} onClose={handleCloseDetail} />
        )}
      </main>
      <footer className="text-center p-4 text-brand-text-secondary text-sm">
          <p>This is a simulation. All trades are paper trades and do not represent real financial advice.</p>
      </footer>
    </div>
  );
}
