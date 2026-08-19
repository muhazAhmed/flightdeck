/**
 * Number formatting for the usage view.
 *
 * Kept separate and pure because the failure mode is a table that reads plausibly and is wrong by a
 * factor of a thousand.
 */

/** `71264` → `71.3k`. Tokens are never interesting to the digit. */
export function tokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

/**
 * Notional cost.
 *
 * Sub-cent runs are common, so a plain 2-decimal format would render most of them as $0.00 and make a
 * busy week look free.
 */
export function money(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  if (usd < 10) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd)}`;
}

/** `9800` → `9.8s`, `310000` → `5m 10s`, `7200000` → `2h 0m`. */
export function span(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function percent(share: number): string {
  if (share <= 0) return '0%';
  if (share < 0.01) return '<1%';
  return `${Math.round(share * 100)}%`;
}
