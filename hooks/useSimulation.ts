import { useEffect } from 'react';
import { useApiState } from './useApiState';

declare const process: { env?: Record<string, string | undefined> } | undefined;

/**
 * @deprecated The local simulation hook has been replaced by backend-driven state.
 * Use {@link useApiState} directly for new features.
 */
export const useSimulation = () => {
  useEffect(() => {
    if (process?.env?.NODE_ENV !== 'production') {
      console.warn(
        'useSimulation is deprecated. Please migrate to useApiState for backend-driven market data and agent updates.'
      );
    }
  }, []);

  return useApiState();
};
