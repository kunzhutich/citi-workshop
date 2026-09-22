import { useQuery } from '@tanstack/react-query';

import { fetchHealth, type HealthReport } from '../../api/health';
import { queryKeys } from '../../api/queryKeys';

/** Poll the API health endpoint, refreshing every 30 seconds. */
export function useHealth() {
  return useQuery<HealthReport>({
    queryKey: queryKeys.health,
    queryFn: fetchHealth,
    refetchInterval: 30_000,
  });
}
