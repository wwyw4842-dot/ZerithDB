const fs = require("node:fs"),
  http = require("node:http"),
  { createRequire } = require("node:module");
const root = require("node:path").resolve(__dirname, "../..");
const req = createRequire(root + "/package.json"),
  esbuild = req("esbuild"),
  { chromium } = req("playwright");
(async () => {
  const current = await esbuild.build({
    stdin: {
      contents: `import {DbClient} from ${JSON.stringify(process.env.ZERITH_DB_ENTRY || root + "/packages/db/dist/index.js")};window.API=DbClient;`,
      resolveDir: root,
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
  });
  const old = await esbuild.build({
    stdin: {
      contents:
        fs.readFileSync(__dirname + "/fixtures/db-client-7606b61.ts.txt", "utf8") +
        "\nwindow.API=DbClient;",
      resolveDir: root + "/packages/db/src",
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
  });
  const server = http.createServer((q, r) => {
    if (q.url.endsWith(".js")) {
      r.setHeader("Content-Type", "text/javascript");
      r.end(q.url === "/old.js" ? old.outputFiles[0].text : current.outputFiles[0].text);
    } else r.end(`<script src="${q.url === "/old" ? "/old.js" : "/new.js"}"></script>`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage();
    p.on("pageerror", (e) => console.error(e));
    const url = `http://127.0.0.1:${server.address().port}`;
    const results = [];
    for (const initialVersion of ["new", "old"]) {
      const id = "rollback-" + initialVersion + "-" + Date.now();
      await p.goto(url + "/" + initialVersion);
      await p.evaluate(async (id) => {
        const db = new window.API({ appId: id });
        await db.collection("a").insert({ text: "first 雪" });
        await db.dispose();
      }, id);
      await p.goto(url + "/new");
      await p.evaluate(async (id) => {
        const db = new window.API({ appId: id });
        await db.collection("b").insert({ text: "second" });
        await db.dispose();
      }, id);
      await p.goto(url + "/old");
      const oldRead = await p.evaluate(async (id) => {
        const db = new window.API({ appId: id });
        try {
          const collection = db.collection("a");
          const [existing] = await collection.find();
          await collection.update({ _id: existing._id }, { $set: { text: "edited by legacy 雪" } });
          await collection.insert({ text: "inserted by legacy" });
          return await collection.find();
        } finally {
          await db.dispose();
        }
      }, id);
      await p.goto(url + "/new");
      const after = await p.evaluate(async (id) => {
        const db = new window.API({ appId: id });
        try {
          return { a: await db.collection("a").find(), b: await db.collection("b").find() };
        } finally {
          await db.dispose();
        }
      }, id);
      const retained =
        after.a.length === 2 &&
        after.b.length === 1 &&
        JSON.stringify(after.a) === JSON.stringify(oldRead) &&
        after.a.some((doc) => doc.text === "edited by legacy 雪") &&
        after.a.some((doc) => doc.text === "inserted by legacy") &&
        after.b[0].text === "second";
      results.push({ initialVersion, oldRead, after, retained });
      if (!retained) process.exitCode = 1;
    }
    console.log(
      JSON.stringify({ browser: await browser.version(), oldSource: "7606b61", results }, null, 2)
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
