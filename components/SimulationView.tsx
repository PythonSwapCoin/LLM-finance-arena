import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSimulationState } from '../hooks/useSimulationState';
import { Header } from './Header';
import { RecentTradesBar } from './RecentTradesBar';
import { MainPerformanceChart } from './MainPerformanceChart';
import { InfoPanel } from './InfoPanel';
import { Leaderboard } from './Leaderboard';
import { LiveChat } from './LiveChat';
import { AgentDetailView } from './AgentDetailView';
import { WelcomePopup } from './WelcomePopup';
import type { Agent } from '../types';

export function SimulationView() {
  const { simulationId } = useParams<{ simulationId: string }>();
  const navigate = useNavigate();
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [showAgentDetail, setShowAgentDetail] = useState(false);
  const [showWelcomePopup, setShowWelcomePopup] = useState(false);

  if (!simulationId) {
    return <div>Error: No competition ID provided</div>;
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
    navigate('/menu');
  };

  // Show welcome popup for Wall Street Arena on first load
  useEffect(() => {
    if (simulationType?.name === 'Wall Street Arena') {
      const hasSeenWelcome = localStorage.getItem('wall-street-arena-welcome-seen');
      if (!hasSeenWelcome) {
        setShowWelcomePopup(true);
        localStorage.setItem('wall-street-arena-welcome-seen', 'true');
      }
    }
  }, [simulationType]);

  // If simulation type is not found (404), show helpful message
  if (error && (error.includes('not available') || error.includes('not found'))) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="text-center max-w-md p-6">
          <div className="text-yellow-400 text-6xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-yellow-400 mb-2">Competition Not Available</h2>
          <p className="text-slate-300 mb-4">{error}</p>
          <p className="text-slate-400 text-sm mb-6">
            This competition may be disabled. Please select an available competition from the dropdown menu.
          </p>
          <button
            onClick={handleBackToSelector}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Back to Competition Selector
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="text-center max-w-md p-6">
          <div className="text-red-400 text-6xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-red-400 mb-2">Error Loading Competition</h2>
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
          <p className="text-slate-300 text-lg">Loading competition...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Header */}
      <Header
        simulationState={simState}
        connectionStatus={connectionStatus}
        mode={simulationMode}
        simulationTypeName={simulationType.name}
      />

      {/* Recent Trades Bar */}
      <RecentTradesBar 
        agents={agents}
        startDate={simState.startDate}
        currentDate={simState.currentDate}
        simulationMode={simulationMode}
        day={simState.day}
        intradayHour={simState.intradayHour}
        simulationTypeName={simulationType?.name}
      />

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6 mt-16">
        {/* Main Chart */}
        <div className="mb-6">
          <MainPerformanceChart
            participants={[...agents, ...benchmarks]}
            startDate={simState.startDate}
            currentDate={simState.currentDate}
            simulationMode={simulationMode}
            day={simState.day}
            intradayHour={simState.intradayHour}
            simulationTypeName={simulationType?.name}
          />
        </div>

        {/* Info Panel and Chat Layout */}
        <div className={`grid ${chat.config.enabled ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'} gap-6 mb-6`}>
          <InfoPanel
            agents={agents}
            isLoading={simState.isLoading}
            isStopped={false}
            day={simState.day}
            intradayHour={simState.intradayHour}
            simulationMode={simulationMode}
            isHistoricalComplete={false}
            simulationTypeName={simulationType?.name}
            simulationTypeDescription={simulationType?.description}
            startDate={simState.startDate}
            currentDate={simState.currentDate}
          />

          {/* Chat - disabled, showing "coming soon" message */}
          {chat.config.enabled && (
            <div className="bg-arena-surface rounded-lg shadow-lg p-6 flex flex-col items-center justify-center space-y-4 opacity-60">
              <div className="text-arena-text-secondary text-center">
                <h3 className="text-lg font-bold text-arena-text-primary mb-2">Live Chat</h3>
                <p className="text-sm">Coming Soon</p>
                <p className="text-xs mt-2 text-arena-text-tertiary">
                  Chat functionality will be available in a future update
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Leaderboard */}
        <div className="mb-6">
          <Leaderboard
            agents={agents}
            onAgentClick={handleAgentClick}
            showModelNames={simulationType.showModelNames}
            simulationTypeName={simulationType?.name}
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
          startDate={simState.startDate}
          currentDate={simState.currentDate}
          simulationMode={simulationMode}
          simulationTypeName={simulationType?.name}
        />
      )}

      {/* Welcome Popup */}
      {showWelcomePopup && simulationType && (
        <WelcomePopup
          simulationTypeName={simulationType.name}
          onClose={() => setShowWelcomePopup(false)}
        />
      )}
    </div>
  );
}
