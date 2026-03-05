/**
 * Shared in-process reference to the most recently calculated time portfolio summary.
 * Populated by the rebalance pass; read by smart_meetings_status.
 */

import type { TimePortfolioSummary } from '../../types/smart-meetings';

export interface PortfolioRef {
  current: TimePortfolioSummary | null;
  lastUpdated: Date | null;
}

export function createPortfolioRef(): PortfolioRef {
  return { current: null, lastUpdated: null };
}
