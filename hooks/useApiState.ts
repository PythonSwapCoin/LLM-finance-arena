import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../services/apiClient';
import type { Agent, Benchmark, MarketData, MarketDataTelemetry, ChatState } from '../types';

const POLL_INTERVAL = 5000; // Poll every 5 seconds

export const useApiState = () => {
  const [simulationState, setSimulationState] = useState({
    day: 0,
    intradayHour: 0,
    isLoading: false,
    startDate: undefined as string | undefined,
    currentDate: undefined as string | undefined,
    isHistoricalSimulationComplete: false,
  });
  const [marketData, setMarketData] = useState<MarketData>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);
  const [chat, setChat] = useState<ChatState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [simulationMode, setSimulationMode] = useState<'simulated' | 'realtime' | 'historical'>('simulated');
  const [marketTelemetry, setMarketTelemetry] = useState<MarketDataTelemetry | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<{
    connected: boolean;
    lastChecked: string | null;
    backendInfo: any;
  }>({
    connected: false,
    lastChecked: null,
    backendInfo: null,
  });

  const checkConnection = useCallback(async () => {
    try {
      const status = await apiClient.getStatus();
      setConnectionStatus({
        connected: true,
        lastChecked: new Date().toISOString(),
        backendInfo: status,
      });
      return true;
    } catch (err) {
      setConnectionStatus({
        connected: false,
        lastChecked: new Date().toISOString(),
        backendInfo: null,
      });
      console.error('Connection check failed:', err);
      return false;
    }
  }, []);

  const fetchState = useCallback(async () => {
    try {
      const response = await apiClient.getSimulationState();
      const snapshot = response.snapshot;
      
      setSimulationState({
        day: snapshot.day,
        intradayHour: snapshot.intradayHour,
        isLoading: response.isLoading,
        startDate: snapshot.startDate,
        currentDate: snapshot.currentDate,
        isHistoricalSimulationComplete: response.isHistoricalSimulationComplete,
      });
      setMarketData(snapshot.marketData);
      setAgents(snapshot.agents as Agent[]);
      setBenchmarks(snapshot.benchmarks as Benchmark[]);
      setChat(snapshot.chat ?? null);
      // Use backend mode directly (already in correct format)
      const mode = snapshot.mode || 'simulated';
      setSimulationMode(mode);
      setMarketTelemetry(response.marketTelemetry);
      setError(null);
      // Update connection status on successful fetch
      setConnectionStatus(prev => ({
        ...prev,
        connected: true,
        lastChecked: new Date().toISOString(),
        backendInfo: {
          ...(prev.backendInfo || {}),
          simulation: {
            mode: snapshot.mode,
            day: snapshot.day,
            intradayHour: snapshot.intradayHour,
            agentsCount: snapshot.agents.length,
            tickersCount: Object.keys(snapshot.marketData).length,
            lastUpdated: snapshot.lastUpdated,
          },
          marketData: response.marketTelemetry,
        },
      }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch simulation state';
      setError(errorMessage);
      console.error('Error fetching simulation state:', err);
      // Update connection status on error
      setConnectionStatus(prev => ({
        ...prev,
        connected: false,
        lastChecked: new Date().toISOString(),
      }));
    }
  }, []);

  useEffect(() => {
    // Check connection status on mount
    checkConnection();
    
    // Initial fetch
    fetchState();

    // Set up polling
    const interval = setInterval(fetchState, POLL_INTERVAL);

    // Check connection status every 30 seconds
    const connectionInterval = setInterval(checkConnection, 30000);

    return () => {
      clearInterval(interval);
      clearInterval(connectionInterval);
    };
  }, [fetchState, checkConnection]);

  // Start simulation (idempotent)
  const startSimulation = useCallback(async () => {
    try {
      await apiClient.startSimulation();
      await fetchState(); // Refresh state
    } catch (err) {
      console.error('Error starting simulation:', err);
      setError(err instanceof Error ? err.message : 'Failed to start simulation');
    }
  }, [fetchState]);

  // Stop simulation
  const stopSimulation = useCallback(async () => {
    try {
      await apiClient.stopSimulation();
      await fetchState(); // Refresh state
    } catch (err) {
      console.error('Error stopping simulation:', err);
      setError(err instanceof Error ? err.message : 'Failed to stop simulation');
    }
  }, [fetchState]);

  // Advance day (no-op in API mode, handled by backend)
  const advanceDay = useCallback(async () => {
    // Backend handles day advancement automatically
    await fetchState();
  }, [fetchState]);

  // Advance intraday (no-op in API mode, handled by backend)
  const advanceIntraday = useCallback(async () => {
    // Backend handles intraday advancement automatically
    await fetchState();
  }, [fetchState]);

  // Export simulation data (client-side only, using current state)
  const exportSimulationData = useCallback(() => {
    // This would need to be implemented client-side using the current state
    // For now, just log that it's not fully implemented
    console.warn('Export simulation data not fully implemented in API mode');
  }, []);

  const sendChatMessage = useCallback(async (payload: { username: string; agentId: string; content: string }) => {
    const response = await apiClient.sendChatMessage(payload);
    setChat(response.chat);
    return response.message;
  }, []);

  return {
    agents,
    benchmarks,
    simulationState,
    marketData,
    simulationMode,
    marketTelemetry,
    chat,
    advanceDay,
    advanceIntraday,
    exportSimulationData,
    startSimulation,
    stopSimulation,
    error,
    connectionStatus,
    checkConnection,
    sendChatMessage,
  };
};

