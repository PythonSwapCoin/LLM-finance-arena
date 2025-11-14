import { useState, useEffect, useCallback, useRef } from 'react';
import type { Agent, Benchmark, MarketData, SimulationMode, ChatState } from '../types';

interface SimulationType {
  id: string;
  name: string;
  description: string;
  chatEnabled: boolean;
  showModelNames: boolean;
}

interface SimulationSnapshot {
  day: number;
  intradayHour: number;
  mode: SimulationMode;
  lastUpdated: string;
  marketData: MarketData;
  agents: Agent[];
  benchmarks: Benchmark[];
  chat: ChatState;
  startDate?: string;
  currentDate?: string;
  currentTimestamp?: number;
}

interface SimulationStateResponse {
  snapshot: SimulationSnapshot;
  simulationType: SimulationType;
  isLoading: boolean;
  marketTelemetry: {
    sources: Record<string, number>;
    rateLimits: Record<string, { limit: number; remaining: number; resetAt?: string }>;
  };
}

export interface ConnectionStatus {
  connected: boolean;
  lastChecked: string;
  backendInfo?: {
    status: string;
    backend: string;
  };
}

export interface SimulationState {
  agents: Agent[];
  benchmarks: Benchmark[];
  simulationState: {
    day: number;
    intradayHour: number;
    isLoading: boolean;
    lastUpdated: string;
    startDate?: string;
    currentDate?: string;
    currentTimestamp?: number;
  };
  marketData: MarketData;
  simulationMode: SimulationMode;
  chat: ChatState;
  connectionStatus: ConnectionStatus;
  simulationType: SimulationType | null;
  error: string | null;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';
const POLL_INTERVAL = 5000; // Poll every 5 seconds
const CONNECTION_CHECK_INTERVAL = 30000; // Check connection every 30 seconds

export const useSimulationState = (simulationTypeId: string) => {
  const [state, setState] = useState<SimulationState>({
    agents: [],
    benchmarks: [],
    simulationState: {
      day: 0,
      intradayHour: 0,
      isLoading: true,
      lastUpdated: new Date().toISOString(),
    },
    marketData: {},
    simulationMode: 'simulated',
    chat: {
      config: {
        enabled: false,
        maxMessagesPerAgent: 3,
        maxMessagesPerUser: 2,
        maxMessageLength: 140,
      },
      messages: [],
    },
    connectionStatus: {
      connected: false,
      lastChecked: new Date().toISOString(),
    },
    simulationType: null,
    error: null,
  });

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const connectionCheckRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchSimulationState = useCallback(async () => {
    try {
      abortControllerRef.current = new AbortController();
      const response = await fetch(
        `${API_BASE_URL}/api/simulations/${simulationTypeId}/state`,
        {
          signal: abortControllerRef.current.signal,
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Simulation type '${simulationTypeId}' not found`);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: SimulationStateResponse = await response.json();

      setState((prev) => ({
        ...prev,
        agents: data.snapshot.agents,
        benchmarks: data.snapshot.benchmarks,
        simulationState: {
          day: data.snapshot.day,
          intradayHour: data.snapshot.intradayHour,
          isLoading: data.isLoading,
          lastUpdated: data.snapshot.lastUpdated,
          startDate: data.snapshot.startDate,
          currentDate: data.snapshot.currentDate,
          currentTimestamp: data.snapshot.currentTimestamp,
        },
        marketData: data.snapshot.marketData,
        simulationMode: data.snapshot.mode,
        chat: data.snapshot.chat,
        simulationType: data.simulationType,
        connectionStatus: {
          connected: true,
          lastChecked: new Date().toISOString(),
          backendInfo: {
            status: 'connected',
            backend: 'online',
          },
        },
        error: null,
      }));
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return; // Ignore aborted requests
      }

      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to fetch simulation state',
        connectionStatus: {
          connected: false,
          lastChecked: new Date().toISOString(),
        },
      }));
    }
  }, [simulationTypeId]);

  const checkConnection = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/status`, {
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json();
        setState((prev) => ({
          ...prev,
          connectionStatus: {
            connected: true,
            lastChecked: new Date().toISOString(),
            backendInfo: {
              status: data.status || 'connected',
              backend: data.backend || 'online',
            },
          },
        }));
      } else {
        setState((prev) => ({
          ...prev,
          connectionStatus: {
            connected: false,
            lastChecked: new Date().toISOString(),
          },
        }));
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        connectionStatus: {
          connected: false,
          lastChecked: new Date().toISOString(),
        },
      }));
    }
  }, []);

  const sendChatMessage = useCallback(
    async (username: string, agentId: string, content: string) => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/simulations/${simulationTypeId}/chat/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              username,
              agentId,
              content,
            }),
          }
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to send message');
        }

        const data = await response.json();

        // Update local state with new chat data
        if (data.chat) {
          setState((prev) => ({
            ...prev,
            chat: data.chat,
          }));
        }

        return { success: true, data };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to send message',
        };
      }
    },
    [simulationTypeId]
  );

  // Initial fetch
  useEffect(() => {
    fetchSimulationState();
    checkConnection();
  }, [fetchSimulationState, checkConnection]);

  // Set up polling
  useEffect(() => {
    pollIntervalRef.current = setInterval(fetchSimulationState, POLL_INTERVAL);
    connectionCheckRef.current = setInterval(checkConnection, CONNECTION_CHECK_INTERVAL);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (connectionCheckRef.current) {
        clearInterval(connectionCheckRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchSimulationState, checkConnection]);

  return {
    ...state,
    sendChatMessage,
    refetch: fetchSimulationState,
  };
};
