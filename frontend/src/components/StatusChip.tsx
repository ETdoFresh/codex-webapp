import type { HealthStatus } from '../hooks/useHealthStatus';

interface StatusChipProps {
  status: HealthStatus;
  lastUpdated: Date | null;
}

const STATUS_LABELS: Record<HealthStatus, string> = {
  healthy: 'Healthy',
  error: 'Error',
  unknown: 'Unknown'
};

export function StatusChip({ status, lastUpdated }: StatusChipProps) {
  const title =
    lastUpdated !== null
      ? `Last checked at ${lastUpdated.toLocaleTimeString()}`
      : 'Waiting for status...';

  return (
    <span className={`status-chip status-${status}`} title={title}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export default StatusChip;
