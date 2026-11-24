// Operating budget: hard cap per month (INR). Claude subscription tracked separately, never counted here.
export const THRESHOLDS = [50, 75, 90];
export function budgetStatus({ budget, spent, claudeSubscription }) {
  const remaining = budget - spent;
  const pct = budget > 0 ? Math.round((spent / budget) * 1000) / 10 : 0;
  return { budget, spent, remaining, pct, crossed: THRESHOLDS.filter((t) => pct >= t), claudeSubscription, totalCommitment: spent + claudeSubscription };
}
// Can a new purchase go ahead without breaching the cap? (Approval is still always required.)
export function purchaseCheck({ budget, spent, cost }) {
  const remaining = budget - spent;
  return { allowed: cost <= remaining, remainingAfter: remaining - cost, pctAfter: Math.round(((spent + cost) / budget) * 1000) / 10 };
}
