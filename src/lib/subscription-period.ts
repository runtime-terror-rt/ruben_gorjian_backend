export type SubscriptionPeriodSource = {
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
};

export function getSubscriptionPeriod(
  subscription?: SubscriptionPeriodSource | null,
  now = new Date()
) {
  if (subscription?.currentPeriodStart && subscription?.currentPeriodEnd) {
    return {
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
    };
  }

  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return { periodStart, periodEnd };
}
