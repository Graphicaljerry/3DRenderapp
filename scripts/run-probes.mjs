#!/usr/bin/env node
// `npm run probes` — the feature probes, in one command.
//
// These probes drive the REAL UI in a real browser, which is the only evidence this
// project accepts that a feature works. They need two servers up (vite + a stub LLM),
// which used to be tribal knowledge; this starts them, runs the probes, and reports.
//
//   npm run probes              every probe found
//   npm run probes text pattern only ones whose name matches
//
// Probes live in PROBE_DIR (override with MOLDABLE_PROBES=/path). Each is a standalone
// node script that exits non-zero on failure — that exit code is the whole contract.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "moldable-lite");
const PROBE_DIR = process.env.MOLDABLE_PROBES ?? join(ROOT, "probes");
const filters = process.argv.slice(2);

if (!existsSync(PROBE_DIR)) {
  console.error(`No probe directory at ${PROBE_DIR}.`);
  console.error("Probes are kept per-session in the scratchpad; point MOLDABLE_PROBES at it:");
  console.error("  MOLDABLE_PROBES=/path/to/scratchpad npm run probes");
  process.exit(2);
}
const probes = readdirSync(PROBE_DIR)
  .filter((f) => f.endsWith(".mjs") && !f.startsWith("stub-"))
  .filter((f) => !filters.length || filters.some((q) => f.includes(q)))
  .sort();
if (!probes.length) {
  console.error(`No probes matched ${filters.join(", ") || "*"} in ${PROBE_DIR}`);
  process.exit(2);
}

const up = async (url, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};
const children = [];
const start = (cmd, args, cwd) => {
  const c = spawn(cmd, args, { cwd, stdio: "ignore", detached: true });
  children.push(c);
  return c;
};
const stopAll = () => children.forEach((c) => { try { process.kill(-c.pid); } catch { /* already gone */ } });

// Reuse servers that are already up — a dev session usually has vite running, and
// killing someone's dev server to run a test would be rude.
const viteWasUp = await up("http://localhost:5173/", 1);
if (!viteWasUp) { start("npm", ["run", "dev"], APP); if (!(await up("http://localhost:5173/"))) { console.error("vite never came up"); stopAll(); process.exit(2); } }
const stub = join(PROBE_DIR, "stub-llm.mjs");
const stubWasUp = await up("http://localhost:8899/v1/models", 1);
if (!stubWasUp) {
  if (!existsSync(stub)) { console.error(`Need a stub LLM at ${stub} (probes point their model config at :8899).`); stopAll(); process.exit(2); }
  start("node", [stub], PROBE_DIR);
  if (!(await up("http://localhost:8899/v1/models"))) { console.error("stub LLM never came up"); stopAll(); process.exit(2); }
}

console.log(`Running ${probes.length} probe(s) against localhost:5173\n`);
const failed = [];
for (const p of probes) {
  process.stdout.write(`— ${p.padEnd(24)}`);
  const t0 = Date.now();
  const r = spawnSync("node", [join(PROBE_DIR, p)], { cwd: PROBE_DIR, encoding: "utf8", timeout: 15 * 60 * 1000 });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (r.status === 0) console.log(`ok    ${secs}s`);
  else {
    console.log(`FAIL  ${secs}s`);
    failed.push(p);
    const lines = `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").filter((l) => /FAIL|Error|✗/.test(l)).slice(0, 6);
    lines.forEach((l) => console.log(`    ${l.trim()}`));
  }
}
stopAll();
console.log(failed.length ? `\n${failed.length} failed: ${failed.join(", ")}` : `\nall ${probes.length} probes green`);
process.exit(failed.length ? 1 : 0);
