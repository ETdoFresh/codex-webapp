import { useEffect, useMemo, useState } from 'react';

export type HealthStatus = 'unknown' | 'healthy' | 'error';

interface UseHealthStatusOptions {
  endpoint?: string;
  intervalMs?: number;
}

interface HealthResponseBody {
  status?: string;
  service?: string;
  message?: string;
  [key: string]: unknown;
}

interface HealthState {
  status: HealthStatus;
  lastUpdated: Date | null;
  error: string | null;
  body: HealthResponseBody | null;
}

const DEFAULT_ENDPOINT = '/api/health';
const DEFAULT_INTERVAL = 5000;

export function useHealthStatus(
  options: UseHealthStatusOptions = {}
): HealthState {
  const { endpoint = DEFAULT_ENDPOINT, intervalMs = DEFAULT_INTERVAL } =
    options;

  const [state, setState] = useState<HealthState>({
    status: 'unknown',
    lastUpdated: null,
    error: null,
    body: null
  });

  useEffect(() => {
    let isMounted = true;

    const evaluateStatus = (body: HealthResponseBody): HealthStatus => {
      const normalized = body.status?.toLowerCase();
      return normalized === 'ok' || normalized === 'healthy'
        ? 'healthy'
        : 'error';
    };

    const poll = async () => {
      try {
        const response = await fetch(endpoint, {
          headers: { Accept: 'application/json' },
          cache: 'no-store'
        });

        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }

        const body = (await response.json()) as HealthResponseBody;

        if (!isMounted) {
          return;
        }

        setState({
          status: evaluateStatus(body),
          lastUpdated: new Date(),
          error: null,
          body
        });
      } catch (error) {
        if (!isMounted) {
          return;
        }

        const message =
          error instanceof Error ? error.message : 'Unknown error occurred';

        setState({
          status: 'error',
          lastUpdated: new Date(),
          error: message,
          body: null
        });
      }
    };

    poll();
    const timerId = window.setInterval(poll, intervalMs);

    return () => {
      isMounted = false;
      window.clearInterval(timerId);
    };
  }, [endpoint, intervalMs]);

  return useMemo(() => state, [state]);
}
