const http = require("node:http");
const root = require("node:path").resolve(__dirname, "../..");
const esbuild = require("esbuild"),
  { chromium } = require("playwright");
(async () => {
  const build = await esbuild.build({
    stdin: {
      contents: `import {DbClient} from ${JSON.stringify(root + "/packages/db/dist/index.js")}; window.makeDb=(appId)=>new DbClient({appId});`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
  });
  const server = http.createServer((q, r) => {
    r.setHeader("Content-Type", "text/html");
    r.end("<!doctype html><script>" + build.outputFiles[0].text + "</script>");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const first = await context.newPage(),
    second = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}`;
  await Promise.all([first.goto(url), second.goto(url)]);
  const results = [];
  try {
    for (const locks of [true, false]) {
      if (!locks)
        await Promise.all(
          [first, second].map((p) =>
            p.evaluate(() =>
              Object.defineProperty(navigator, "locks", { value: undefined, configurable: true })
            )
          )
        );
      for (let trial = 0; trial < 10; trial++) {
        const appId = `browser-${locks}-${trial}-${Date.now()}`;
        await Promise.all(
          [first, second].map((p) =>
            p.evaluate((id) => {
              window.db = window.makeDb(id);
            }, appId)
          )
        );
        await Promise.all([
          first.evaluate(() => window.db.collection("a").insert({ text: "first" })),
          second.evaluate(() => window.db.collection("b").insert({ text: "second" })),
        ]);
        const row = await first.evaluate(async () => ({
          a: await window.db.collection("a").count(),
          b: await window.db.collection("b").count(),
        }));
        if (row.a !== 1 || row.b !== 1) throw Error(JSON.stringify({ locks, trial, row }));
        const id = await first.evaluate(async () => {
          const { id } = await window.db.collection("a").insert({ x: 0, y: 0 });
          return id;
        });
        await Promise.all([
          first.evaluate(
            (id) => window.db.collection("a").update({ _id: id }, { $set: { x: 1 } }),
            id
          ),
          second.evaluate(
            (id) => window.db.collection("a").update({ _id: id }, { $set: { y: 1 } }),
            id
          ),
        ]);
        const updated = await second.evaluate((id) => window.db.collection("a").findById(id), id);
        if (updated.x !== 1 || updated.y !== 1) throw Error("lost update");
        await Promise.all([first, second].map((p) => p.evaluate(() => window.db.dispose())));
        await first.evaluate((id) => {
          window.db = window.makeDb(id);
        }, appId);
        const persisted = await first.evaluate(async () => ({
          a: await window.db.collection("a").count(),
          b: await window.db.collection("b").count(),
        }));
        if (persisted.a !== 2 || persisted.b !== 1) throw Error("reopen loss");
        await first.evaluate(() => window.db.dispose());
      }
      results.push({
        case: "cross-tab different schema + concurrent fields + reopen",
        webLocks: locks,
        trials: 10,
        passed: true,
      });
    }
    console.log(
      JSON.stringify(
        { browser: await browser.version(), source: root + "/packages/db/dist/index.js", results },
        null,
        2
      )
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
