"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

export type AssetOption = {
  symbol: string;
  name: string;
  assetType: "STOCK" | "ETF" | "OTHER";
  exchange: string;
  region: string;
  tradable: boolean;
  marketSession: string;
  marketStatus: string;
  rank?: number;
  reason?: string;
};
type Payload = {
  assets: AssetOption[];
  topFocus: AssetOption[];
  topFocusAvailable: boolean;
  refreshedAt: string;
  market: { session: string; authoritative: boolean };
  categories: {
    mostActive: string[];
    topGainers: string[];
    topLosers: string[];
  };
};

export function useAssetDiscovery() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/assets", { cache: "no-store" });
    if (response.ok) setPayload(await response.json());
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(load, 0);
    const timer = window.setInterval(load, 180_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);
  return payload;
}

export function AssetDiscoverySelect({
  value,
  onChange,
  label = "Asset search",
  compact = false,
}: {
  value: string;
  onChange: (symbol: string, asset?: AssetOption) => void;
  label?: string;
  compact?: boolean;
}) {
  const discovery = useAssetDiscovery();
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const needle = query.trim().toUpperCase();
    return (discovery?.assets ?? [])
      .filter(
        (asset) =>
          !needle ||
          [asset.symbol, asset.name, asset.exchange, asset.assetType].some(
            (item) => item.toUpperCase().includes(needle),
          ),
      )
      .slice(0, 80);
  }, [discovery, query]);
  const selected = [
    ...(discovery?.topFocus ?? []),
    ...(discovery?.assets ?? []),
  ].find((asset) => asset.symbol === value);
  return (
    <div className={`asset-discovery ${compact ? "compact" : ""}`}>
      <input
        aria-label={label}
        placeholder="Search ticker, company, exchange, or type"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <select
        aria-label={`${label} results`}
        value={value}
        onChange={(event) =>
          onChange(
            event.target.value,
            [...(discovery?.topFocus ?? []), ...matches].find(
              (asset) => asset.symbol === event.target.value,
            ),
          )
        }
      >
        {discovery?.topFocusAvailable ? (
          <optgroup label="TOP 5 MARKET FOCUS">
            {discovery.topFocus.map((asset) => (
              <option key={`focus-${asset.symbol}`} value={asset.symbol}>
                {asset.rank}. {asset.symbol} — {asset.name} · {asset.exchange} ·{" "}
                {asset.marketStatus}
              </option>
            ))}
          </optgroup>
        ) : (
          <optgroup label="TOP 5 TEMPORARILY UNAVAILABLE" />
        )}
        <optgroup label="TRADABLE ASSETS">
          {matches
            .filter((asset) => asset.tradable)
            .map((asset) => (
              <option key={asset.symbol} value={asset.symbol}>
                {asset.symbol} — {asset.name} · {asset.assetType} ·{" "}
                {asset.exchange} · {asset.region} · {asset.marketStatus}
              </option>
            ))}
        </optgroup>
      </select>
      {selected && !compact && (
        <div className="asset-selection-meta">
          <b>
            {selected.symbol} · {selected.name}
          </b>
          <span>
            {selected.assetType} · {selected.exchange} · {selected.region}
          </span>
          <span
            className={`market-status status-${selected.marketSession.toLowerCase()}`}
          >
            {selected.marketStatus} ·{" "}
            {selected.tradable ? "TRADABLE" : "NOT TRADABLE"}
          </span>
        </div>
      )}
      {!discovery && (
        <small>
          Asset discovery is temporarily unavailable. Entered symbols are not
          treated as provider-approved.
        </small>
      )}
    </div>
  );
}

export function AssetGlossary() {
  return (
    <details className="asset-glossary">
      <summary>Symbol and market terms</summary>
      <dl>
        <dt>SYMBOL</dt>
        <dd>The ticker used to identify an asset.</dd>
        <dt>STOCK</dt>
        <dd>Shares in an individual company.</dd>
        <dt>ETF</dt>
        <dd>A fund traded like a stock.</dd>
        <dt>INDEX</dt>
        <dd>A benchmark representing a group of assets.</dd>
        <dt>EXCHANGE</dt>
        <dd>The marketplace where the asset is listed.</dd>
        <dt>COUNTRY / REGION</dt>
        <dd>The market region associated with the listing.</dd>
      </dl>
    </details>
  );
}
