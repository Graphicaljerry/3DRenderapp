// Harness triage: run every *-e2e.mjs / probe in this directory once, record a verdict,
// and keep going. Resumable — each script's verdict is appended to triage-state.json, so
// a run can be stopped and restarted without repeating work.
//
// Why this exists: a regression suite whose state is "probably fine" is not a regression
// suite. The first run found three independent kinds of rot, none of them app bugs:
// scripts seeding a flag the app stopped reading in build 429 (so they never left the
// Launchpad), scripts matching template tooltips whose wording had changed, and scripts
// naming templates that no longer exist. Verdicts are per-script and resumable.
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

/** Not scripts to be run by a sweep.
 *  - triage.mjs is this file; enter.mjs is a helper module that executes nothing.
 *  - gen-thumbs.mjs re-renders template thumbnails straight into
 *    `moldable-lite/src/assets/templates/`, which is TRACKED. Running it as part of a
 *    sweep silently rewrites shipped artwork — the first full run left a modified
 *    box-with-lid.webp in the working tree (3238 → 3250 bytes of pure encoder noise).
 *    It stays a maintenance tool you invoke deliberately when a template changes. */
const NOT_A_TEST = new Set(["triage.mjs", "enter.mjs", "gen-thumbs.mjs"]);

const scripts = readdirSync(HERE)
  .filter((f) => f.endsWith(".mjs") && !NOT_A_TEST.has(f))
  .sort();

/** Selectors that only exist once you are INSIDE the workspace. A script that dies waiting
 *  for one of these is almost certainly a build-429 casualty: it seeded `moldable_entered`
 *  to skip the Launchpad, that flag is now inert, and it never leaves the Launchpad. That
 *  is a stale probe, not an app bug — and worth separating from the real failures. */
const WORKSPACE_ONLY = /\.topbar|\.canvas-rail|\.dock-|\.statusbar|\.inspector|form\.composer|\.composer textarea/;

/** Turn a script's output into one line a person can act on. */
function describe(out, status) {
  // The WHOLE "waiting for" clause, not just its first locator. Capturing only
  // `locator('…')` reported a failing `locator('.overlay').getByTitle('Build the box with
  // lid template')` as "timed out waiting for .overlay" — which sent the reader after a
  // modal that was in fact opening fine, and hid a renamed template.
  const waitingFor = out.match(/waiting for (.+)$/m)?.[1]?.trim().replace(/\s+/g, " ").slice(0, 120);
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
  for (const v of ["pass", "shots", "fail", "timeout", "error"]) {
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
    else if (!/✓|all good|PASS|ok\b/i.test(out)) {
      // Some files here are screenshot/asset generators, not tests — they assert nothing
      // BY DESIGN, so silence is success for them. Tell them apart by whether the SOURCE
      // contains assertion vocabulary at all; a real test that suddenly stops asserting is
      // still the dangerous case this triage exists to catch.
      const src = readFileSync(join(HERE, s), "utf8");
      const asserts = /\bcheck\(|\bPASS\b|\bFAIL\b|✓/.test(src);
      verdict = asserts ? "error" : "shots";
      note = asserts ? "exit 0 with no assertion output" : "ran clean (generator, no assertions by design)";
    }
  } catch (e) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    tail = out.trim().split("\n").slice(-4).join(" | ");
    verdict = e.status === 124 ? "timeout" : "fail";
    note = verdict === "timeout" ? `killed at ${PER_SCRIPT_TIMEOUT_S}s` : describe(out, e.status);
  }
  const seconds = Math.round((Date.now() - t0) / 1000);
  state.results[s] = { verdict, seconds, note, tail: tail.slice(0, 400) };
  save(state);
  console.log(`${verdict === "pass" || verdict === "shots" ? "✓" : "✗"} ${s.padEnd(30)} ${verdict.padEnd(8)} ${seconds}s  ${note}`);
}
const st = table();
console.log(`\n${st.remaining} scripts still to run.`);
