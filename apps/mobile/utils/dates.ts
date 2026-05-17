export function formatRelativeDate(value?: string | null): string {
  if (!value) return 'unknown';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return 'unknown';
  const deltaSeconds = Math.round((time - Date.now()) / 1000);
  const abs = Math.abs(deltaSeconds);
  if (abs < 60) return 'just now';
  if (abs < 3600) return formatRelativeUnit(Math.round(deltaSeconds / 60), 'minute');
  if (abs < 86_400) return formatRelativeUnit(Math.round(deltaSeconds / 3600), 'hour');
  if (abs < 2_592_000) return formatRelativeUnit(Math.round(deltaSeconds / 86_400), 'day');
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(value)
  );
}

export function isStaleDate(value?: string | null, thresholdDays = 90): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  return Date.now() - time > thresholdDays * 86_400_000;
}

function formatRelativeUnit(value: number, unit: 'minute' | 'hour' | 'day'): string {
  if (typeof Intl.RelativeTimeFormat === 'function') {
    return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(value, unit);
  }
  const amount = Math.abs(value);
  const label = amount === 1 ? unit : `${unit}s`;
  return value < 0 ? `${amount} ${label} ago` : `in ${amount} ${label}`;
}
