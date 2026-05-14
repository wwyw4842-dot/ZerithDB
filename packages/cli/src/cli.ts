#!/usr/bin/env node
import { createRequire } from "module";
import { program } from "commander";
import chalk from "chalk";
import { initCommand } from "./commands/init.js";
import { signalCommand } from "./commands/signal.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };
const VERSION = pkg.version;

console.log(
  chalk.cyan(`
  ██████╗ ███████╗███████╗██████╗ ██████╗  █████╗ ███████╗███████╗
  ██╔══██╗██╔════╝██╔════╝██╔══██╗██╔══██╗██╔══██╗██╔════╝██╔════╝
  ██████╔╝█████╗  █████╗  ██████╔╝██████╔╝███████║███████╗█████╗
  ██╔═══╝ ██╔══╝  ██╔══╝  ██╔══██╗██╔══██╗██╔══██║╚════██║██╔══╝
  ██║     ███████╗███████╗██║  ██║██████╔╝██║  ██║███████║███████╗
  ╚═╝     ╚══════╝╚══════╝╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝
  `)
);
console.log(chalk.gray(`  Build full-stack apps with ZERO backend. v${VERSION}\n`));

program
  .name("zerithdb")
  .description("ZerithDB CLI — scaffold and manage local-first P2P apps")
  .version(VERSION);

program
  .command("init [app-name]")
  .description("Scaffold a new ZerithDB application")
  .option("-t, --template <template>", "Starter template", "todo")
  .option("--no-install", "Skip dependency installation")
  .action(initCommand);

program
  .command("signal")
  .description("Start a local WebSocket signaling server for development")
  .option("-p, --port <port>", "Port to listen on", "4000")
  .action(signalCommand);

program.parse(process.argv);
