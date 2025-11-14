import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface SimulationType {
  id: string;
  name: string;
  description: string;
  chatEnabled: boolean;
  showModelNames: boolean;
  agentCount: number;
}

export function SimulationSelector() {
  const [types, setTypes] = useState<SimulationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchTypes = async () => {
      try {
        const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';
        const response = await fetch(`${API_BASE_URL}/api/simulations/types`);
        if (!response.ok) {
          throw new Error('Failed to fetch competition types');
        }
        const data = await response.json();
        setTypes(data.types);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load competition types');
      } finally {
        setLoading(false);
      }
    };

    fetchTypes();
  }, []);

  const handleSelectSimulation = (typeId: string) => {
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
          {types.map((type) => (
            <div
              key={type.id}
              onClick={() => handleSelectSimulation(type.id)}
              className="group cursor-pointer bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl p-6 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 transition-all duration-300 transform hover:scale-[1.02]"
            >
              {/* Card Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h2 className="text-2xl font-bold text-white mb-2 group-hover:text-blue-400 transition-colors">
                    {type.name}
                  </h2>
                  <p className="text-slate-400 text-sm leading-relaxed">
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
              <div className="mt-6 flex items-center justify-end text-blue-400 group-hover:text-blue-300 font-medium">
                <span className="mr-2">Enter Arena</span>
                <span className="group-hover:translate-x-1 transition-transform">→</span>
              </div>
            </div>
          ))}
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
