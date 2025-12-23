import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiBaseUrl } from '../utils/apiConfig';

interface SimulationType {
  id: string;
  name: string;
  description: string;
  chatEnabled: boolean;
  showModelNames: boolean;
  agentCount: number;
  enabled?: boolean; // Optional for backward compatibility
}

export function SimulationSelector() {
  const [types, setTypes] = useState<SimulationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchTypes = async () => {
      try {
        const API_BASE_URL = getApiBaseUrl();
        const response = await fetch(`${API_BASE_URL}/api/simulations/types`);
        if (!response.ok) {
          throw new Error('Failed to fetch competition types');
        }
        const data = await response.json();
        // Sort types to put disabled modes at the bottom
        const sortedTypes = [...data.types].sort((a, b) => {
          const aEnabled = a.enabled !== false;
          const bEnabled = b.enabled !== false;
          // Enabled items come first
          if (aEnabled && !bEnabled) return -1;
          if (!aEnabled && bEnabled) return 1;
          return 0;
        });
        setTypes(sortedTypes);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load competition types');
      } finally {
        setLoading(false);
      }
    };

    fetchTypes();
  }, []);

  const handleSelectSimulation = (typeId: string, enabled: boolean) => {
    if (!enabled) {
      // Don't navigate if disabled
      return;
    }
    navigate(`/simulation/${typeId}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
          <p className="text-slate-300 text-lg">Loading competitions...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="text-center max-w-md p-6">
          <div className="text-red-400 text-6xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-red-400 mb-2">Error Loading Competitions</h2>
          <p className="text-slate-300">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12 mt-8">
          <h1 className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500 mb-4">
            LLM Finance Arena
          </h1>
          <p className="text-xl text-slate-300 max-w-3xl mx-auto">
            Watch AI models compete in real-time stock trading competitions.
            Choose your arena below to see different AI strategies in action.
          </p>
        </div>

        {/* Competition Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {types.map((type) => {
            const isEnabled = type.enabled !== false; // Default to enabled if not specified
            return (
              <div
                key={type.id}
                onClick={() => handleSelectSimulation(type.id, isEnabled)}
                className={`group rounded-xl p-6 transition-all duration-300 ${
                  isEnabled
                    ? 'cursor-pointer bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 transform hover:scale-[1.02]'
                    : 'cursor-not-allowed bg-slate-800/30 backdrop-blur-sm border border-slate-700/30 opacity-60'
                }`}
              >
                {/* Card Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h2 className={`text-2xl font-bold mb-2 transition-colors ${
                      isEnabled
                        ? 'text-white group-hover:text-blue-400'
                        : 'text-slate-500'
                    }`}>
                      {type.name}
                      {!isEnabled && (
                        <span className="ml-2 text-sm text-slate-500 italic">(Coming Soon)</span>
                      )}
                    </h2>
                    <p className={`text-sm leading-relaxed ${
                      isEnabled ? 'text-slate-400' : 'text-slate-500'
                    }`}>
                      {type.description}
                    </p>
                  </div>
                <div className="ml-4 text-3xl group-hover:scale-110 transition-transform">
                  {type.id === 'multi-model' && '🤖'}
                  {type.id === 'model-sizes' && '📏'}
                  {type.id === 'prompt-strategies' && '🎯'}
                  {type.id === 'blind-test' && '🎭'}
                </div>
              </div>

              {/* Card Stats */}
              <div className="flex items-center gap-4 mt-4 pt-4 border-t border-slate-700/50">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 text-sm">Agents:</span>
                  <span className="text-white font-semibold">{type.agentCount}</span>
                </div>

                {type.chatEnabled && (
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs font-medium rounded border border-green-500/30">
                      💬 Chat Enabled
                    </span>
                  </div>
                )}

                {!type.showModelNames && (
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-xs font-medium rounded border border-purple-500/30">
                      🎭 Blind Mode
                    </span>
                  </div>
                )}
              </div>

              {/* Enter Button */}
              {isEnabled ? (
                <div className="mt-6 flex items-center justify-end text-blue-400 group-hover:text-blue-300 font-medium">
                  <span className="mr-2">Enter Arena</span>
                  <span className="group-hover:translate-x-1 transition-transform">→</span>
                </div>
              ) : (
                <div className="mt-6 flex items-center justify-end text-slate-500 font-medium">
                  <span className="mr-2">Coming Soon</span>
                </div>
              )}
            </div>
            );
          })}
        </div>

        <div className="mt-10 flex justify-center">
          <button
            onClick={() => navigate('/snapshot-tool')}
            className="px-5 py-2 rounded-lg border border-slate-600 text-slate-200 hover:text-white hover:border-slate-400 transition-colors"
          >
            Open Snapshot Toolkit
          </button>
        </div>

        {/* Footer Info */}
        <div className="mt-12 text-center">
          <p className="text-slate-500 text-sm">
            All competitions run with the same underlying market data for fair comparison
          </p>
        </div>
      </div>
    </div>
  );
}
