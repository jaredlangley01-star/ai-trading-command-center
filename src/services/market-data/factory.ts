import type { MarketDataService } from "../contracts";
import { createPaperBroker } from "../broker/factory";
import { DemoMarketDataService } from "./demo-market-data-service";
import { createAlpacaMarketDataService } from "./alpaca-market-data-service";

export function createPaperMarketData(): MarketDataService {
  return (
    createAlpacaMarketDataService() ??
    createPaperBroker()?.marketData ??
    new DemoMarketDataService()
  );
}
