const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const esbuild = require("esbuild");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../..");
const consumer = process.env.ZERITH_CONSUMER_ROOT;
const reactEntry = consumer ? "zerithdb-react" : path.join(root, "packages/react/dist/index.js");

(async () => {
  const build = await esbuild.build({
    stdin: {
      contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {ZerithProvider, useQuery, useZerith} from ${JSON.stringify(reactEntry)};
        const root = createRoot(document.getElementById('app'));
        let config = {appId:'react-consumer-'+Date.now()};
        let collection = 'todos';
        let strict = true;
        window.disposed = 0;
        function Probe() {
          const app = useZerith();
          const query = useQuery(collection);
          window.app = app; window.query = query;
          if (!app.tracked) {
            app.tracked=true;
            const dispose = app.dispose.bind(app);
            app.dispose = async () => {window.disposed++; await dispose();};
          }
          return React.createElement('pre',{id:'state'},JSON.stringify({data:query.data,loading:query.loading,error:query.error?.message}));
        }
        function render() {
          const view=React.createElement(ZerithProvider,{config},React.createElement(Probe));
          root.render(strict ? React.createElement(React.StrictMode,null,view) : view);
        }
        window.changeCollection=(name)=>{collection=name;render();};
        window.changeApp=(appId)=>{config={appId};render();};
        window.unmount=()=>root.unmount();
        render();
      `,
      resolveDir: consumer ?? root,
      loader: "tsx",
    },
    nodePaths: [
      consumer
        ? path.join(consumer, "node_modules")
        : path.join(root, "packages/react/node_modules"),
    ],
    // Use simple-peer's published browser bundle, including its Node shims.
    alias: {
      "simple-peer": require.resolve("simple-peer/simplepeer.min.js", {
        paths: [consumer ?? path.join(root, "packages/network")],
      }),
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
  });
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><div id="app"></div><script>' + build.outputFiles[0].text + "</script>"
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  const errors = [];
  const cases = [];
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.query && !window.query.loading, null, {
      timeout: 5000,
    });
    const readFailure = await page.evaluate(() => {
      const error = window.query.error;
      return error
        ? {
            name: error.name,
            message: error.message,
            cause: error.cause?.message,
            details: error.details,
          }
        : null;
    });
    assert.equal(readFailure, null, JSON.stringify(readFailure));
    const inserted = await page.evaluate(() =>
      window.query.insert({ text: "persisted via React" })
    );
    await page.waitForFunction(() => window.query.data.length === 1);
    assert.equal(await page.evaluate(() => window.query.data[0]._id), inserted.id);
    await page.evaluate((id) => window.query.remove(id), inserted.id);
    await page.waitForFunction(() => window.query.data.length === 0);
    cases.push("public hook insert/remove and reactive subscription under StrictMode");
    await page.evaluate(() => window.query.insert({ text: "reopen" }));
    await page.waitForFunction(() => window.query.data.length === 1);
    const appId = await page.evaluate(() => window.app.config.appId);
    await page.evaluate(() => window.changeCollection("other"));
    await page.waitForFunction(() => !window.query.loading && window.query.data.length === 0);
    await page.evaluate(() => window.query.insert({ text: "other collection" }));
    await page.waitForFunction(() => window.query.data[0]?.text === "other collection");
    await page.evaluate(() => window.changeCollection("todos"));
    await page.waitForFunction(() => window.query.data[0]?.text === "reopen");
    cases.push("collection switching keeps ownership and original content");
    await page.evaluate((id) => window.changeApp(id + "-replacement"), appId);
    await page.waitForFunction(
      () => !window.query.loading && window.query.data.length === 0 && window.disposed === 1
    );
    await page.evaluate((id) => window.changeApp(id), appId);
    await page.waitForFunction(
      () => window.query.data[0]?.text === "reopen" && window.disposed === 2
    );
    cases.push("config replacement disposes prior client and reopens persisted data");
    await page.evaluate(() => window.unmount());
    await page.waitForFunction(() => window.disposed === 3);
    await page.waitForTimeout(100);
    assert.deepEqual(errors, []);
    cases.push("unmount drains SDK with no late browser errors");
    console.log(
      JSON.stringify(
        {
          browser: await browser.version(),
          cases,
          passed: cases.length,
          source: reactEntry,
          transport: "local IndexedDB; no cross-device claim",
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(JSON.stringify({ browserErrors: errors, casesCompleted: cases }));
    throw error;
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
