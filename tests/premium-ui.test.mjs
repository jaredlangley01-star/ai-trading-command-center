import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL(
  "../components/trading-command-center.tsx",
  import.meta.url,
);
const cssUrl = new URL("../app/globals.css", import.meta.url);

test("premium dashboard renders responsive financial modules", async () => {
  const [source, css] = await Promise.all([
    readFile(componentUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);
  for (const componentName of [
    "PortfolioChart",
    "AutoTrader",
    "RecommendationCard",
    "PositionTable",
    "RiskCard",
    "SystemHealth",
    "MarketOverview",
  ]) {
    assert.match(source, new RegExp(`function ${componentName}`));
  }
  assert.match(css, /@media\s*\(max-width:\s*700px\)/);
  assert.match(source, /Mobile navigation/);
});

test("recommendation analysis and modification remain paper-only", async () => {
  const source = await readFile(componentUrl, "utf8");
  assert.match(source, /RESEARCH BREAKDOWN/);
  assert.match(source, /RECOMMENDED INVESTMENT/);
  assert.match(source, /Conservative/);
  assert.match(source, /Aggressive/);
  assert.match(source, /NO BROKER OR EXECUTION ENGINE IS CONNECTED/);
  assert.doesNotMatch(source, /submitOrder\s*\(|executeOrder\s*\(/);
  assert.match(source, /fetch\("\/api\/state"/);
});

test("risk, progress, and system-health states are explicit", async () => {
  const source = await readFile(componentUrl, "utf8");
  assert.match(source, /Daily profit target/);
  assert.match(source, /Daily loss limit/);
  assert.match(source, /EMERGENCY STOP/);
  assert.match(source, /NOT CONNECTED/);
  assert.match(source, /LOCAL \/ DEMO/);
  assert.match(source, /Trading Mode/);
});
