// Harness triage: run every *-e2e.mjs / probe in this directory once, record a verdict,
// and keep going. Resumable — each script's verdict is appended to triage-state.json, so
// a run can be stopped and restarted without repeating work.
//
// Why this exists: 55 of the 61 scripts here seed `moldable_entered`, a flag the app
// stopped reading in build 429. Whether that actually broke them depends on whether each
// script assumed it would start inside the workspace. Nobody knows, and a regression
// suite whose state is "probably fine" is not a regression suite.
//
//   node triage.mjs            # run the next batch (default 4)
//   node triage.mjs 6          # run the next 6
//   node triage.mjs --report   # print the table, run nothing
//   node triage.mjs --reset    # start over
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE = join(HERE, "triage-state.json");
const PER_SCRIPT_TIMEOUT_S = 420; // engine-audit is the long one; most finish far sooner

const scripts = readdirSync(HERE)
  .filter((f) => f.endsWith(".mjs") && f !== "triage.mjs")
  .sort();

/** Selectors that only exist once you are INSIDE the workspace. A script that dies waiting
 *  for one of these is almost certainly a build-429 casualty: it seeded `moldable_entered`
 *  to skip the Launchpad, that flag is now inert, and it never leaves the Launchpad. That
 *  is a stale probe, not an app bug — and worth separating from the real failures. */
const WORKSPACE_ONLY = /\.topbar|\.canvas-rail|\.dock-|\.statusbar|\.inspector|form\.composer|\.composer textarea/;

/** Turn a script's output into one line a person can act on. */
function describe(out, status) {
  const waitingFor = out.match(/waiting for locator\('([^']+)'\)/)?.[1];
  const failed = [...out.matchAll(/^(?:FAIL|✗ ?(?:FAIL)?)\s*(.+)$/gm)].map((m) => m[1].trim()).filter(Boolean);
  if (waitingFor) {
    const stale = WORKSPACE_ONLY.test(waitingFor) && /moldable_entered/.test(out) === false;
    return `timed out waiting for ${waitingFor}${WORKSPACE_ONLY.test(waitingFor) ? "  [workspace-only selector → starts on the Launchpad now]" : ""}${stale ? "" : ""}`;
  }
  if (failed.length) return `${failed.length} check(s) failed: ${failed.slice(0, 2).join("; ").slice(0, 140)}`;
  return `exit ${status}`;
}

const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { started: null, results: {} });
const save = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2));

const arg = process.argv[2];
if (arg === "--reset") { save({ started: null, results: {} }); console.log("state cleared"); process.exit(0); }

let state = load();

function table() {
  const r = state.results;
  const done = Object.keys(r);
  const by = (v) => done.filter((k) => r[k].verdict === v);
  console.log(`\n=== harness triage: ${done.length}/${scripts.length} scripts ===`);
  for (const v of ["pass", "fail", "timeout", "error"]) {
    const list = by(v);
    if (!list.length) continue;
    console.log(`\n${v.toUpperCase()} (${list.length})`);
    for (const k of list.sort()) {
      const e = r[k];
      console.log(`  ${k.padEnd(30)} ${String(e.seconds).padStart(4)}s  ${e.note ?? ""}`);
    }
  }
  const left = scripts.filter((s) => !r[s]);
  if (left.length) console.log(`\nNOT YET RUN (${left.length}): ${left.slice(0, 8).join(", ")}${left.length > 8 ? " …" : ""}`);
  return { done: done.length, total: scripts.length, remaining: left.length };
}

if (arg === "--report") { table(); process.exit(0); }

const batch = Number(arg) > 0 ? Number(arg) : 4;
const todo = scripts.filter((s) => !state.results[s]).slice(0, batch);
if (!todo.length) { console.log("nothing left to run."); table(); process.exit(0); }
if (!state.started) { state.started = new Date().toISOString(); save(state); }

for (const s of todo) {
  const t0 = Date.now();
  let verdict = "pass", note = "", tail = "";
  try {
    const out = execFileSync("timeout", [String(PER_SCRIPT_TIMEOUT_S), "node", join(HERE, s)],
      { cwd: HERE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
    tail = out.trim().split("\n").slice(-4).join(" | ");
    // A script that exits 0 having asserted nothing is NOT a pass — that is the exact
    // failure mode this triage is meant to surface, not reproduce.
    if (/✗|FAILED/.test(out)) { verdict = "fail"; note = "exit 0 but printed a failure"; }
    else if (!/✓|all good|PASS|ok\b/i.test(out)) { verdict = "error"; note = "exit 0 with no assertion output"; }
  } catch (e) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    tail = out.trim().split("\n").slice(-4).join(" | ");
    verdict = e.status === 124 ? "timeout" : "fail";
    note = verdict === "timeout" ? `killed at ${PER_SCRIPT_TIMEOUT_S}s` : describe(out, e.status);
  }
  const seconds = Math.round((Date.now() - t0) / 1000);
  state.results[s] = { verdict, seconds, note, tail: tail.slice(0, 400) };
  save(state);
  console.log(`${verdict === "pass" ? "✓" : "✗"} ${s.padEnd(30)} ${verdict.padEnd(8)} ${seconds}s  ${note}`);
}
const st = table();
console.log(`\n${st.remaining} scripts still to run.`);
