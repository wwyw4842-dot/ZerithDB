import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Consume the real build in a fresh directory, without installing a template.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidence = path.resolve(process.argv[2] ?? "cli-evidence");
fs.mkdirSync(evidence, { recursive: true });
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "zerith-cli-consumer-"));
const workspace = path.join(sandbox, "workspace");
const home = path.join(sandbox, "home");
const temporary = path.join(sandbox, "tmp");
for (const directory of [workspace, home, temporary]) fs.mkdirSync(directory);
const userConfig = path.join(sandbox, "npmrc");
fs.writeFileSync(userConfig, "registry=https://registry.npmjs.org/\n");
const environment = {
  HOME: home,
  USERPROFILE: home,
  TMPDIR: temporary,
  TMP: temporary,
  TEMP: temporary,
  PATH: path.dirname(process.execPath),
  NPM_CONFIG_USERCONFIG: userConfig,
  npm_config_userconfig: userConfig,
  CI: "true",
  NO_COLOR: "1",
};
const bundle = path.join(root, "packages/cli/dist/cli.js");
const appName = "zerith-cli-consumer-check";
const app = path.join(workspace, appName);
const expectedChecks = [
  "built-entry", "help", "init-blank", "four-files", "package-json",
  "blank-page", "layout", "gitignore", "no-install",
];
const checks = [];
const commands = [];
const files = [];
let activeCheck;

function check(name, body) {
  activeCheck = name;
  body();
  checks.push({ name, status: "passed" });
}

function execute(name, args) {
  const started = performance.now();
  const result = spawnSync(process.execPath, [bundle, ...args], {
    cwd: workspace,
    env: environment,
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  fs.writeFileSync(path.join(evidence, `${name}.stdout.log`), result.stdout ?? "");
  fs.writeFileSync(path.join(evidence, `${name}.stderr.log`), result.stderr ?? "");
  commands.push({ name, args, status: result.status, signal: result.signal,
    error: result.error?.code ?? null, elapsedMs: Math.round(performance.now() - started) });
  assert.equal(result.error, undefined, `${name} must finish before the timeout`);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, `${name} must exit successfully`);
  return result.stdout;
}

function fileNames(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    assert.ok(entry.isFile() || entry.isDirectory(), "no symlinks or special files");
    return entry.isDirectory()
      ? fileNames(absolute).map(child => `${entry.name}/${child}`)
      : [entry.name];
  }).sort();
}

let failure;
try {
  check("built-entry", () => {
    assert.ok(fs.statSync(bundle).isFile());
    assert.ok(fs.statSync(bundle).size > 0);
  });
  check("help", () => {
    const output = execute("help", ["--help"]);
    assert.match(output, /Usage: zerithdb/);
    assert.match(output, /init \[.*app-name.*\]/);
  });
  check("init-blank", () => {
    assert.deepEqual(fs.readdirSync(workspace), []);
    execute("init", ["init", appName, "--template", "blank", "--no-install"]);
    assert.deepEqual(fs.readdirSync(workspace), [appName]);
  });
  check("four-files", () => assert.deepEqual(fileNames(app), [
    ".gitignore", "package.json", "src/app/layout.tsx", "src/app/page.tsx",
  ]));
  check("package-json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(app, "package.json"), "utf8"));
    assert.equal(pkg.name, appName);
    assert.equal(pkg.private, true);
    assert.deepEqual(pkg.scripts, { dev: "next dev", build: "next build", start: "next start" });
    assert.equal(pkg.dependencies["zerithdb-sdk"], "latest");
    assert.equal(pkg.dependencies.next, "^14.2.0");
  });
  check("blank-page", () => {
    const page = fs.readFileSync(path.join(app, "src/app/page.tsx"), "utf8");
    assert.ok(page.includes('import { createApp } from "zerithdb-sdk";'));
    assert.ok(page.includes(`createApp({ appId: "${appName}" })`));
    assert.ok(page.includes("Hello ZerithDB!"));
    assert.ok(!page.includes("app.sync.enable()"));
  });
  check("layout", () => {
    const layout = fs.readFileSync(path.join(app, "src/app/layout.tsx"), "utf8");
    assert.ok(layout.includes("export default function RootLayout"));
    assert.ok(layout.includes('<html lang="en">'));
    assert.ok(layout.includes("<body>{children}</body>"));
  });
  check("gitignore", () => assert.equal(
    fs.readFileSync(path.join(app, ".gitignore"), "utf8"), "node_modules\n.next\ndist\n.env\n"));
  check("no-install", () => {
    for (const name of ["node_modules", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"])
      assert.ok(!fs.existsSync(path.join(app, name)), `${name} must not be created`);
  });
  for (const relative of fileNames(app)) {
    const bytes = fs.readFileSync(path.join(app, relative));
    const destination = path.join(evidence, "generated", relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
    files.push({ path: relative, size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  assert.deepEqual(checks.map(item => item.name), expectedChecks);
  assert.equal(commands.length, 2);
} catch (error) {
  failure = String(error);
  if (!checks.some(item => item.name === activeCheck))
    checks.push({ name: activeCheck, status: "failed", error: failure });
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
  const report = {
    status: failure ? "FAIL" : "PASS", node: process.version,
    bundleSha256: fs.existsSync(bundle)
      ? createHash("sha256").update(fs.readFileSync(bundle)).digest("hex") : null,
    checks, notExecuted: expectedChecks.filter(name => !checks.some(item => item.name === name)),
    commands, files, sandboxRemoved: !fs.existsSync(sandbox), failure: failure ?? null,
    scope: "Built CLI help and blank scaffold only; template dependencies are not installed or built.",
  };
  fs.writeFileSync(path.join(evidence, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
if (failure) process.exitCode = 1;
