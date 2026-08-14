export type RecommendationApprovalInput = {
  status: string;
  expiresAt: string;
  referencePrice: number;
  currentPrice: number;
  paperConfirmed: boolean;
};

export function validateRecommendationForApproval(
  input: RecommendationApprovalInput,
  now = Date.now(),
  maximumPriceChangePct = Number(
    process.env.BIG_MONEY_MAX_PRICE_CHANGE_PCT ?? 1,
  ),
) {
  if (!input.paperConfirmed) throw new Error("PAPER_CONFIRMATION_REQUIRED");
  if (input.status !== "PENDING") throw new Error("RECOMMENDATION_NOT_PENDING");
  if (
    !Number.isFinite(Date.parse(input.expiresAt)) ||
    Date.parse(input.expiresAt) <= now
  )
    throw new Error("RECOMMENDATION_EXPIRED");
  if (input.referencePrice <= 0 || input.currentPrice <= 0)
    throw new Error("INVALID_RECOMMENDATION_PRICE");
  const priceChangePct =
    Math.abs(
      (input.currentPrice - input.referencePrice) / input.referencePrice,
    ) * 100;
  if (priceChangePct > maximumPriceChangePct)
    throw new Error("MARKET_CONDITIONS_CHANGED_REFRESH_REQUIRED");
  return { priceChangePct };
}
