import type { MarketDataService } from "../contracts.ts";
import { createPaperBroker } from "../broker/factory.ts";
import { DemoMarketDataService } from "./demo-market-data-service.ts";
import { createAlpacaMarketDataService } from "./alpaca-market-data-service.ts";

export function createPaperMarketData(): MarketDataService {
  return (
    createAlpacaMarketDataService() ??
    createPaperBroker()?.marketData ??
    new DemoMarketDataService()
  );
}
