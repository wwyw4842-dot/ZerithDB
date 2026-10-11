import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const require = createRequire(
  new URL("../../tests/recovery-harness/package.json", import.meta.url)
);
const { chromium } = require("@playwright/test");

const root = fileURLToPath(new URL("../../", import.meta.url));
const reservation = createServer();
await new Promise((resolve, reject) => {
  reservation.once("error", reject);
  reservation.listen(0, "127.0.0.1", resolve);
});
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    join(dirname(require.resolve("vite/package.json")), "bin/vite.js"),
    "--config",
    "tests/recovery.browser.config.mjs",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" }
);
let serverOutput = "",
  browser;
server.stdout.on("data", (data) => {
  serverOutput = (serverOutput + data).slice(-16000);
});
server.stderr.on("data", (data) => {
  serverOutput = (serverOutput + data).slice(-16000);
});
let spawnError;
server.on("error", (error) => {
  spawnError = error;
});
try {
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null) throw Error(`Fixture server exited: ${serverOutput}`);
    try {
      ready = (await fetch(`${origin}/tests/recovery.html`, { signal: AbortSignal.timeout(1000) }))
        .ok;
    } catch {}
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, `Fixture server did not become ready: ${serverOutput}`);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort()
  );
  await page.goto(`${origin}/tests/recovery.html`, { timeout: 30000 });
  await page.waitForFunction(() => window.zd06Result || window.zd06Failure, null, {
    timeout: 30000,
  });
  const result = await page.evaluate(() => ({
    result: window.zd06Result,
    failure: window.zd06Failure,
  }));
  assert.equal(result.failure, undefined);
  assert.deepEqual(result.result, {
    rejected: [true, true],
    sameIdentity: true,
    sameStorage: true,
    sameSignature: true,
    signatureVerifies: true,
    changes: 0,
    recoveredCallback: 0,
  });
  await page
    .getByText("Social recovery is currently unavailable.", { exact: false })
    .first()
    .waitFor();
  assert.equal(await page.getByRole("status").count(), 2);
  assert.equal(await page.locator("input,button,textarea").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        browser: await browser.version(),
        mode: "isolated Chromium; actual components and AuthManager; loopback fixture only",
        result: result.result,
        notices: 2,
        interactiveRecoveryControls: 0,
        pageErrors: errors,
      },
      null,
      2
    )
  );
} finally {
  if (browser) await browser.close();
  if (server.pid) {
    const signal = (name) => {
      try {
        if (process.platform === "win32") server.kill(name);
        else process.kill(-server.pid, name);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    signal("SIGTERM");
    await delay(250);
    signal("SIGKILL");
  }
}
