import type { HistoricalCandle } from "../../domain/models.ts";

export const validCandles = (candles: HistoricalCandle[], minimum = 20) =>
  candles.length >= minimum &&
  candles.every(
    (candle) =>
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close) &&
      candle.high >= candle.low &&
      candle.close > 0,
  );

export const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

export const standardDeviation = (values: number[]) => {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};

export const averageTrueRange = (candles: HistoricalCandle[], periods = 14) => {
  const sample = candles.slice(-(periods + 1));
  const ranges = sample.slice(1).map((candle, index) => {
    const previousClose = sample[index].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
  return ranges.length ? mean(ranges) : 0;
};

export const percentageMomentum = (
  candles: HistoricalCandle[],
  periods = 10,
) => {
  const current = candles.at(-1)?.close ?? 0;
  const previous = candles.at(-(periods + 1))?.close ?? 0;
  return previous > 0 ? ((current - previous) / previous) * 100 : 0;
};

export const realizedVolatility = (candles: HistoricalCandle[]) => {
  const returns = candles.slice(1).map((candle, index) => {
    const previous = candles[index].close;
    return previous > 0 ? (candle.close - previous) / previous : 0;
  });
  return standardDeviation(returns) * Math.sqrt(252) * 100;
};
