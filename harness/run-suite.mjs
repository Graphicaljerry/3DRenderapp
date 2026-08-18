#!/usr/bin/env node
// One command that runs the probe suite and tells the truth about it.
//
// Why this exists: 45 of the 61 probes print "FAIL <name>" and then exit 0. Their
// `process.exit(1)` calls are all inside catch blocks — they fire when the SCRIPT breaks,
// never when a CHECK fails. So anything that judged this suite by exit status (CI, a
// pre-push hook, me in a hurry) would have read a wall of FAIL lines as green. This
// runner judges by what the probes actually print, and exits non-zero if anything failed.
//
// It also owns the two things that produced false failures by hand:
//   - servers that die under you. Started detached, health-checked before the run and
//     again after every probe; a probe that ran across a dead server is re-run, not
//     reported.
//   - port collisions. Probes read their base URL from PORT (see the sweep in the commit
//     that added it), so each lane gets its own vite. The stub LLM is the exception —
//     13 probes bake localhost:8899 into addInitScript callbacks, which run in the
//     browser where process.env does not exist — so those share one lane and one stub.
//     Eight more stand up their own mock on a fixed 8787/8788 for the same reason; they
//     share a lane too, which is enough, because a lane runs one probe at a time.
//
// Usage:
//   node run-suite.mjs                 # everything
//   node run-suite.mjs --lane stub     # one lane
//   node run-suite.mjs plates-e2e fit-e2e   # named probes, in the lane that owns them
//   node run-suite.mjs --list          # what would run, and where
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..", "moldable-lite");

// The 13 that need the stub. Kept as an explicit list rather than grepped at runtime:
// this is a routing decision, and it should change deliberately, with a diff.
const STUB_PROBES = [
  "assist-visibility-e2e", "audit-fixes-e2e", "buildfail-e2e", "change-strip-e2e",
  "delete-model-e2e", "launchpad-widths-e2e", "newpart-e2e", "photo-front-e2e",
  "plan-default-e2e", "plan-payload-e2e", "plan-persist-e2e", "retry-photos-e2e",
  "stop-e2e", "regress-465-e2e",
];

// Scripts in here that are tools, not tests — they generate screenshots, icons and
// thumbnails, or are libraries the probes import. They print no verdict, so running them
// as tests would be noise.
const NOT_TESTS = new Set([
  "app-shots", "canvas-clean", "canvas-shot", "canvas-shots", "dims-probe2", "enter",
  "gen-icons", "gen-thumbs", "ipad-audit", "lib", "load-perf", "local-debug", "probe",
  // stamp-probe was RETIRED, not moved: it asserted `v <sha> · <date>`, a build stamp the
  // app deliberately replaced with a numeric build number. pwa-e2e asserts the current
  // /^v\d+$/ and passes, so the suite was contradicting itself and stamp-probe was the
  // half that was wrong. Deleted rather than rewritten — version-visible-e2e already
  // covers the stamp being present and readable.
  "run-suite", "selbox-probe", "shots2", "stub-llm", "templates", "triage",
  "ui-overlap-sweep", "viewer-frames",
]);

// Probes that stand up their own mock server on a FIXED port (8787 or 8788) and hand the
// URL to the page through addInitScript — browser context, where process.env does not
// exist, so PORT cannot reach them. Two of these in different lanes race for the socket
// and the loser dies with EADDRINUSE, which reads as a broken app. They all go in one
// lane instead: a lane runs its probes one at a time, so same-lane means no contention.
const FIXED_MOCK_PORT = [
  "context-e2e", "double-send-e2e", "house-e2e", "local-e2e",
  "precision-e2e", "preview-e2e", "printpack2-e2e", "routing-e2e",
];

// Probes that must run ALONE. hmr-boundary-e2e tests Fast Refresh by touching App.tsx,
// Workspace.tsx and Viewer.tsx — vite then pushes those edits into every other lane's
// browser mid-probe, which is a great way to manufacture failures that mean nothing. It
// is a real test and it passes; it just cannot share a machine with the others.
// Run it on its own:  node run-suite.mjs hmr-boundary-e2e
const SOLO = ["hmr-boundary-e2e"];

const allProbes = readdirSync(HERE)
  .filter((f) => f.endsWith(".mjs"))
  .map((f) => f.replace(/\.mjs$/, ""))
  .filter((n) => !NOT_TESTS.has(n))
  .sort();

// SOLO probes are excluded from a full run but still runnable by name.
const named0 = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const runnable = named0.length ? allProbes : allProbes.filter((n) => !SOLO.includes(n));

const stub = runnable.filter((n) => STUB_PROBES.includes(n));
const mock = runnable.filter((n) => !STUB_PROBES.includes(n) && FIXED_MOCK_PORT.includes(n));
const rest = runnable.filter((n) => !STUB_PROBES.includes(n) && !FIXED_MOCK_PORT.includes(n));
// Lane a carries the mock-port set plus enough of the remainder to stay level with b.
const spare = Math.max(0, Math.ceil((rest.length - mock.length) / 2));
const plain = [...mock, ...rest.slice(0, spare)];

// Three lanes, because this machine has four cores. A fourth concurrent browser starves
// the other three and turns slow probes into "failures" that are really timeouts.
const LANES = [
  { name: "stub", port: 5173, stub: true, probes: stub },
  { name: "a", port: 5211, stub: false, probes: plain },
  { name: "b", port: 5212, stub: false, probes: rest.slice(spare) },
];

const args = process.argv.slice(2);
const laneArg = args.includes("--lane") ? args[args.indexOf("--lane") + 1] : null;
const named = args.filter((a) => !a.startsWith("--") && a !== laneArg);

let lanes = laneArg ? LANES.filter((l) => l.name === laneArg) : LANES;
if (named.length) {
  const want = new Set(named.map((n) => n.replace(/\.mjs$/, "")));
  const unknown = [...want].filter((n) => !allProbes.includes(n));
  if (unknown.length) {
    console.error(`unknown probe(s): ${unknown.join(", ")}`);
    process.exit(2);
  }
  lanes = lanes.map((l) => ({ ...l, probes: l.probes.filter((p) => want.has(p)) }));
}
lanes = lanes.filter((l) => l.probes.length);

if (args.includes("--list")) {
  for (const l of lanes) console.log(`lane ${l.name} (port ${l.port}${l.stub ? " + stub 8899" : ""}): ${l.probes.join(" ")}`);
  console.log(`\n${lanes.reduce((n, l) => n + l.probes.length, 0)} probes`);
  process.exit(0);
}

const sh = (cmd, opts = {}) => new Promise((res) => {
  const p = spawn("bash", ["-lc", cmd], { ...opts, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (d) => { out += d; });
  p.stderr.on("data", (d) => { out += d; });
  p.on("close", (code) => res({ code, out }));
});

const up = async (url) => (await sh(`curl -s -o /dev/null -w '%{http_code}' ${url}`)).out.trim() === "200";

// `nohup setsid ... & disown` is not decoration. Plain background servers in this
// environment die with exit 144 partway through a run, and every probe still in flight
// fails for a reason that has nothing to do with the app.
async function ensureServers(lane) {
  if (!(await up(`http://localhost:${lane.port}/`))) {
    await sh(`cd ${APP} && nohup setsid npx vite --port ${lane.port} --strictPort > /tmp/suite-vite-${lane.port}.log 2>&1 & disown`);
    for (let i = 0; i < 40 && !(await up(`http://localhost:${lane.port}/`)); i++) await new Promise((r) => setTimeout(r, 500));
  }
  if (lane.stub && !(await up("http://localhost:8899/_stats"))) {
    await sh(`cd ${HERE} && nohup setsid node stub-llm.mjs > /tmp/suite-stub.log 2>&1 & disown`);
    for (let i = 0; i < 20 && !(await up("http://localhost:8899/_stats")); i++) await new Promise((r) => setTimeout(r, 500));
  }
  const ok = (await up(`http://localhost:${lane.port}/`)) && (!lane.stub || (await up("http://localhost:8899/_stats")));
  if (!ok) throw new Error(`lane ${lane.name}: servers would not come up on ${lane.port}${lane.stub ? " / 8899" : ""}`);
}

/** What a probe's output actually says. A probe can fail three ways and only one of them
 *  is a printed FAIL: it can also crash before printing anything, or hang until the
 *  timeout kills it. Treating "no FAIL lines" as success would score all three green. */
function readVerdict({ code, out }) {
  const failLines = out.split("\n").filter((l) => /^FAIL /.test(l.trim()));
  const passCount = out.split("\n").filter((l) => /^PASS /.test(l.trim())).length;
  if (code === 124) return { ok: false, why: "timed out", failLines, passCount };
  if (failLines.length) return { ok: false, why: `${failLines.length} check(s) failed`, failLines, passCount };
  // Crash detection cannot key off the exit code: three probes end with an unconditional
  // process.exit(0), so one that printed a few PASSes and then threw would score green.
  // It cannot key off "Error:" either — probes print their evidence, and that evidence is
  // often an error message they were asserting the ABSENCE of. A stack frame is the one
  // marker only a real unhandled throw produces.
  // (No `$` anchor: Playwright prints its frames as `    at …/probe.mjs:87:14 {`, with the
  // error's property bag opening on the same line, so an end-anchored pattern matches
  // nothing and every crash scores green. That is exactly the bug this runner exists to
  // stop, so it is worth the ugly regex.)
  if (/^\s+at .+:\d+:\d+/m.test(out)) return { ok: false, why: `crashed after ${passCount} checks (exit ${code})`, failLines, passCount };
  if (!passCount) return { ok: false, why: "printed no verdict at all", failLines, passCount };
  return { ok: true, why: `${passCount} checks`, failLines, passCount };
}

const results = [];
const TIMEOUT = Number(process.env.PROBE_TIMEOUT ?? 420);

await Promise.all(lanes.map(async (lane) => {
  await ensureServers(lane);
  for (const probe of lane.probes) {
    const t0 = Date.now();
    let r = await sh(`cd ${HERE} && PORT=${lane.port} timeout ${TIMEOUT} node ${probe}.mjs 2>&1`);
    // A probe that ran across a dead server proved nothing. Bring it back and try once
    // more; only the second result counts.
    if (!(await up(`http://localhost:${lane.port}/`))) {
      await ensureServers(lane);
      r = await sh(`cd ${HERE} && PORT=${lane.port} timeout ${TIMEOUT} node ${probe}.mjs 2>&1`);
    }
    const v = readVerdict(r);
    const secs = Math.round((Date.now() - t0) / 1000);
    results.push({ probe, lane: lane.name, secs, ...v });
    console.log(`${v.ok ? "ok  " : "FAIL"}  ${probe.padEnd(24)} ${String(secs).padStart(4)}s  ${v.why}`);
    for (const l of v.failLines) console.log(`        ${l.trim()}`);
  }
}));

const bad = results.filter((r) => !r.ok);
results.sort((a, b) => b.secs - a.secs);
console.log(`\n${results.length - bad.length}/${results.length} probes passed`);
const slow = results.filter((r) => r.secs > 180);
if (slow.length) console.log(`slow (>3 min): ${slow.map((r) => `${r.probe} ${r.secs}s`).join(", ")}`);
if (bad.length) {
  console.log(`\nfailed:`);
  for (const r of bad) console.log(`  ${r.probe} — ${r.why}`);
}
process.exit(bad.length ? 1 : 0);
