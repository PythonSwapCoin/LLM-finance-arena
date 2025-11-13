import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSimulationState } from '../hooks/useSimulationState';
import { Header } from './Header';
import { TickerBar } from './TickerBar';
import { MainPerformanceChart } from './MainPerformanceChart';
import { InfoPanel } from './InfoPanel';
import { Leaderboard } from './Leaderboard';
import { LiveChat } from './LiveChat';
import { AgentDetailView } from './AgentDetailView';
import type { Agent } from '../types';

export function SimulationView() {
  const { simulationId } = useParams<{ simulationId: string }>();
  const navigate = useNavigate();
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [showAgentDetail, setShowAgentDetail] = useState(false);

  if (!simulationId) {
    return <div>Error: No simulation ID provided</div>;
  }

  const {
    agents,
    benchmarks,
    simulationState: simState,
    marketData,
    simulationMode,
    chat,
    connectionStatus,
    simulationType,
    error,
    sendChatMessage,
  } = useSimulationState(simulationId);

  const handleAgentClick = (agent: Agent) => {
    setSelectedAgent(agent);
    setShowAgentDetail(true);
  };

  const handleCloseAgentDetail = () => {
    setShowAgentDetail(false);
    setSelectedAgent(null);
  };

  const handleBackToSelector = () => {
    navigate('/');
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="text-center max-w-md p-6">
          <div className="text-red-400 text-6xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-red-400 mb-2">Error Loading Simulation</h2>
          <p className="text-slate-300 mb-4">{error}</p>
          <div className="flex gap-4 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              Retry
            </button>
            <button
              onClick={handleBackToSelector}
              className="px-6 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg transition-colors"
            >
              Back to Selector
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!simulationType) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
          <p className="text-slate-300 text-lg">Loading simulation...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Back Button */}
      <div className="fixed top-4 left-4 z-50">
        <button
          onClick={handleBackToSelector}
          className="px-4 py-2 bg-slate-700/80 hover:bg-slate-600/80 backdrop-blur-sm text-white rounded-lg transition-colors flex items-center gap-2 border border-slate-600/50"
        >
          <span>←</span>
          <span>Back to Simulations</span>
        </button>
      </div>

      {/* Simulation Type Badge */}
      <div className="fixed top-4 right-4 z-50">
        <div className="px-4 py-2 bg-blue-500/20 backdrop-blur-sm text-blue-300 rounded-lg border border-blue-500/30 font-medium">
          {simulationType.name}
        </div>
      </div>

      {/* Header */}
      <Header
        simulationState={simState}
        connectionStatus={connectionStatus}
        mode={simulationMode}
      />

      {/* Ticker Bar */}
      <TickerBar marketData={marketData} />

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6 mt-16">
        {/* Main Chart */}
        <div className="mb-6">
          <MainPerformanceChart
            agents={agents}
            benchmarks={benchmarks}
            day={simState.day}
          />
        </div>

        {/* Info Panel and Chat Layout */}
        <div className={`grid ${chat.config.enabled ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'} gap-6 mb-6`}>
          <InfoPanel
            agents={agents}
            benchmarks={benchmarks}
            day={simState.day}
            marketData={marketData}
          />

          {/* Chat - only show if enabled for this simulation */}
          {chat.config.enabled && (
            <LiveChat
              chat={chat}
              agents={agents}
              currentDay={simState.day}
              currentIntradayHour={simState.intradayHour}
              onSendMessage={sendChatMessage}
            />
          )}
        </div>

        {/* Leaderboard */}
        <div className="mb-6">
          <Leaderboard
            agents={agents}
            onAgentClick={handleAgentClick}
            showModelNames={simulationType.showModelNames}
          />
        </div>
      </div>

      {/* Agent Detail Modal */}
      {showAgentDetail && selectedAgent && (
        <AgentDetailView
          agent={selectedAgent}
          onClose={handleCloseAgentDetail}
          marketData={marketData}
          showModelName={simulationType.showModelNames}
        />
      )}
    </div>
  );
}
