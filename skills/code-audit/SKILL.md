---
name: code-audit
description: Full codebase audit — debug what's broken, measure performance with real numbers, run the tests, strip out AI-slop and dead code, optimize websites and apps, and check deploy readiness. Use this whenever the user asks to audit, review, clean up, optimize, speed up, or "make good" a codebase or site; when they complain something is slow, bloated, janky, or "feels off"; when they ask "is this code any good?", "what's wrong with this?", or want AI-generated code checked before shipping; and when they want a project made deploy-ready. Trigger even if they don't say "audit" — "clean this mess up", "why is my site slow", "my friend vibe-coded this" all count.
---

# Code Audit

An audit is a diagnosis backed by evidence, then repairs in a safe order, each one
verified. The value is honesty: real numbers before and after, proof for every claim,
and a clear list of what was NOT done. An audit that "cleaned up the code" without
numbers or verification is itself slop.

## First: which mode?

Read the user's words. **Report-only** ("audit this", "how bad is it?", "don't touch
anything") means investigate and deliver the report — change nothing. **Fix mode**
("clean it up", "make it fast", "fix what's broken") means repair too, in the safe
order below. When genuinely ambiguous, audit first, apply only the safest fixes
(dead code, failing-test bugs), and list the rest as recommendations. Say which mode
you ran in at the top of the report.

## Stage 0 — Map the target

Find out what this thing is and how to exercise it before judging it: read the
manifest (package.json / pyproject / Cargo.toml), the README, CI config. Identify how
to **build**, **run**, and **test** it. If the build is broken, that is finding #1 —
in fix mode repair it first (nothing else can be verified until it builds); in
report-only mode, lead the report with it.

## Stage 1 — Baseline numbers, before touching anything

Run `scripts/snapshot.sh <dir> > /tmp/audit-before.txt` (works on any project,
richer on Node ones). It captures LOC, dependency counts, type/lint error counts,
slop markers (console.log, `as any`, empty catches, TODO litter), and build output
size. Add anything the project makes measurable: test pass count, build time, bundle
chunk sizes, a timing of the operation the user called slow.

The reason this stage exists: every claim in the final report needs a before number.
An optimization without one is a story, not a result. Re-run the same snapshot at
the end — the diff of the two files is the audit's honesty check.

For a website, measure what a first visit actually costs: total bytes of
render-blocking scripts and eagerly-fetched data, image weight, request count. A
headless browser measurement (count response bytes up to the load event) beats
guessing from the file tree. See `references/web-perf.md`.

## Stage 2 — Correctness: tests, then the running thing

Run the test suite. For each failure, read the code and decide with evidence whether
the **code** is wrong or the **test** is stale — never silence a test to get to
green; a red test is frequently a real bug someone shipped past.

If there are no tests, drive the real application: start it, exercise the core flow,
watch the console/stderr. Runtime errors and warnings are findings even when nothing
visibly breaks. High-yield places to read closely: error handling that swallows
(`catch {}`), boundaries where user input enters, off-by-ones at pagination/slicing,
async code that ignores ordering.

## Stage 3 — Slop and dead weight

Read `references/slop-code.md` and sweep for its patterns: tutorial comments,
comments that lie about the code below them, one-caller "helpers", duplicated logic,
type escape hatches (`as any`, `@ts-ignore`), defensive boilerplate around code that
cannot fail, generic names, config-for-a-future-that-never-came, dead files, unused
exports and dependencies (`npx knip` or `npx depcheck` when available — verify their
claims before acting; both false-positive on dynamic imports).

Deletion discipline: remove in small batches and re-run build + tests after each
batch. A deletion that can't be verified green doesn't ship — it goes in the report
as a recommendation instead. Deleting an unused dependency from the manifest is
near-free; deleting "unused-looking" runtime code is where audits break things.

## Stage 4 — Performance, measured

Only optimize what you measured, and re-measure after — both numbers go in the
report. The highest-yield findings, in rough order of payoff-per-risk:

- **Web payload**: a whole library imported for one function; data fetched eagerly
  that's only used after an interaction; render-blocking scripts that could defer;
  unoptimized images. These are big, safe wins. Details: `references/web-perf.md`.
- **Algorithmic**: an O(n²) on a hot path (nested loops with `includes`/`indexOf`,
  JSON.stringify as a comparator). Benchmark before fixing — write a 10-line timing
  script if none exists — because "looks quadratic" sometimes measures fine at real
  n, and then it isn't a finding.
- **Repeated work**: recomputation inside loops/renders that a variable or memo
  hoists out. Verify with the benchmark, not by eye.

Do not restyle code while optimizing it; keep the diff about the measurement.

## Stage 5 — Research when the answer might have moved

When something looks improvable but the right answer depends on the current state of
the ecosystem (a bundler flag, a framework's new API, whether a dependency is
deprecated), search the web for the specific stack and current year rather than
trusting memory. Prefer official docs and changelogs. Every researched claim in the
report carries its source as a markdown link — an uncited "best practice" is just an
opinion.

## Stage 6 — Deploy readiness

Check, and report each as pass/fail: production build completes clean; tests green;
no secrets committed (grep for key-shaped strings, .env in .gitignore); lockfile
committed and consistent; environment variables documented; CI present and passing
if there is CI. **Deploy only if the user explicitly asked for a deploy** — "make it
deployable" means make it ready and show the checklist, not push it live.

## The report

Deliver `AUDIT.md` in the project root. Use exactly this shape — the user reads the
verdict and the numbers; everything else is supporting depth:

```markdown
# Audit: <project>
Mode: <report-only | fixes applied> · <date>

## Verdict
One honest paragraph. Overall health, the single biggest problem, whether it's safe
to ship. No grades like "7/10" — say what a knowledgeable friend would say.

## Numbers
| Metric | Before | After |
(only rows you actually measured; report-only audits fill just "Before")

## Fixed
Each: what was wrong → evidence (file:line, failing test name, measured ms/KB) →
the change → proof it's verified (test run, benchmark, page exercised).

## Found, not touched
Each: the finding, why it was left (risky without tests / needs a decision /
out of scope), and what deciding it would take.

## Recommended next
Prioritized, effort-tagged (quick / afternoon / project). The top item should be
the thing you'd do first if this were yours.

## Sources
Markdown links for any researched claims. Omit the section if none.
```

## Rules that keep an audit trustworthy

- **Verify, then claim.** Every "fixed" needs proof a reader can re-run. If tests
  fail after a change, that goes in the report as a failure — reverting is better
  than reporting fiction.
- **Before/after or it didn't happen.** No performance claim with one number.
- **Small diffs, one concern each.** A bug fix does not also rename variables.
- **Behavior is sacred in cleanup.** Slop removal must be provably behavior-neutral
  (build + tests + a run). When provability runs out, stop deleting and recommend.
- **Honest scope.** The report says what was NOT examined. "Audited" implies
  everything; if you only had time for the hot paths, the report says so.
