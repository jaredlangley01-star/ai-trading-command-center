import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Railway services select independent persistent worker commands", async () => {
  const [tradingConfig, notificationConfig, packageJson] = await Promise.all([
    readFile(new URL("railway.json", root), "utf8").then(JSON.parse),
    readFile(new URL("railway.notifications.json", root), "utf8").then(
      JSON.parse,
    ),
    readFile(new URL("package.json", root), "utf8").then(JSON.parse),
  ]);

  assert.equal(tradingConfig.deploy.startCommand, "npm run worker:start");
  assert.equal(
    notificationConfig.deploy.startCommand,
    "npm run worker:notifications",
  );
  assert.equal(tradingConfig.build.builder, "RAILPACK");
  assert.deepEqual(notificationConfig.build, tradingConfig.build);
  assert.deepEqual(
    notificationConfig.deploy.restartPolicyType,
    tradingConfig.deploy.restartPolicyType,
  );
  assert.deepEqual(
    notificationConfig.deploy.restartPolicyMaxRetries,
    tradingConfig.deploy.restartPolicyMaxRetries,
  );
  assert.match(
    packageJson.scripts["worker:start"],
    /hosted-worker\/index\.mjs/,
  );
  assert.match(
    packageJson.scripts["worker:notifications"],
    /hosted-worker\/notification-worker\.mjs/,
  );
  assert.notEqual(
    packageJson.scripts["worker:start"],
    packageJson.scripts["worker:notifications"],
  );
});

test("both Railway worker entry graphs retain explicit ESM imports", async () => {
  const [tradingWorker, notificationWorker] = await Promise.all([
    readFile(new URL("hosted-worker/index.mjs", root), "utf8"),
    readFile(new URL("hosted-worker/notification-worker.mjs", root), "utf8"),
  ]);
  for (const source of [tradingWorker, notificationWorker]) {
    const relativeImports = [
      ...source.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g),
    ];
    assert.ok(relativeImports.length > 0);
    for (const [, specifier] of relativeImports)
      assert.match(specifier, /\.(?:mjs|js|ts)$/);
  }
});
