type StripeLikePeriod = {
  current_period_start?: number | null;
  current_period_end?: number | null;
  currentPeriodStart?: number | null;
  currentPeriodEnd?: number | null;
  trial_start?: number | null;
  trial_end?: number | null;
  items?: {
    data?: Array<{
      current_period_start?: number | null;
      current_period_end?: number | null;
      currentPeriodStart?: number | null;
      currentPeriodEnd?: number | null;
    }>;
  };
};

export function extractStripePeriodBounds(value: unknown): {
  startUnix?: number;
  endUnix?: number;
} {
  const sub = (value ?? {}) as StripeLikePeriod;

  const topStart =
    sub.current_period_start ??
    sub.currentPeriodStart ??
    sub.trial_start ??
    undefined;
  const topEnd =
    sub.current_period_end ??
    sub.currentPeriodEnd ??
    sub.trial_end ??
    undefined;

  if (topStart || topEnd) {
    return {
      startUnix: topStart ? Number(topStart) : undefined,
      endUnix: topEnd ? Number(topEnd) : undefined,
    };
  }

  const itemPeriods = (sub.items?.data ?? [])
    .map((item) => ({
      start:
        item.current_period_start ??
        item.currentPeriodStart ??
        undefined,
      end:
        item.current_period_end ??
        item.currentPeriodEnd ??
        undefined,
    }))
    .filter((p) => Boolean(p.start) || Boolean(p.end));

  if (!itemPeriods.length) {
    return {};
  }

  const starts = itemPeriods.map((p) => Number(p.start)).filter((n) => Number.isFinite(n) && n > 0);
  const ends = itemPeriods.map((p) => Number(p.end)).filter((n) => Number.isFinite(n) && n > 0);

  return {
    startUnix: starts.length ? Math.min(...starts) : undefined,
    endUnix: ends.length ? Math.max(...ends) : undefined,
  };
}
