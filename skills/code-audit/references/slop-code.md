# Code-slop patterns and their fixes

Slop is code shaped like the statistical average of every tutorial the model has
seen, shipped unedited. Each pattern below names the tell, why it's actually harmful
(not just ugly), and the fix. Sweep for all of them; report the ones you can't
safely fix.

## Comments

- **Tutorial comments** — restate the line below them (`// loop over the items`).
  Harm: they train readers to skip comments, so the one comment that matters gets
  skipped too. Fix: delete. A comment earns its place only by carrying what the code
  cannot: the constraint, the real-world bug, the why.
- **Lying comments** — describe what the code did before a refactor, or name a
  library the code doesn't use. Harm: worse than no comment; a reader trusts it and
  debugs the wrong thing. Fix: correct or delete, same diff as the code they lie about.
- **Commented-out code** — version control already remembers it. Delete.

## Structure

- **One-caller helpers** — a function extracted "for reuse" with exactly one caller,
  often with a name longer than its body. Harm: every indirection is a jump the
  reader pays; premature abstraction ossifies the wrong boundary. Fix: inline until
  a third caller exists.
- **Duplicated logic** — the same validation/transform written twice in one module
  because the second author didn't search. Harm: they drift; one gets the bug fix.
  Fix: keep the better one, point both callers at it, verify both paths.
- **Complexity inflation** — options objects, layers, and config "for the future".
  Harm: the future's requirements never match the guess, and until then every reader
  pays for flexibility nobody uses. Fix: build for the current caller.
- **Generic names** — `data2`, `temp`, `handleClick2`, `utils.js` grab-bags. Harm:
  names are the index of a codebase; generic ones make grep useless. Fix: rename to
  the domain word — but as its own diff, never mixed into a bug fix.

## Safety theater

- **Swallowed errors** — `catch {}` or `catch (e) { console.log(e) }` on a path that
  should fail loudly. Harm: turns crashes into silent corruption; the #1 source of
  "it worked yesterday". Fix: catch narrowly and state in a comment which failure is
  being tolerated and why that's safe — or let it throw.
- **Defensive boilerplate at machine scale** — null-checks and try/catch around code
  that cannot fail, fallback values that mask real absence. Harm: hides genuine
  failures inside noise, and readers can't tell load-bearing checks from reflexive
  ones. Fix: validate at boundaries; trust invariants inside them.
- **Type escape hatches** — `as any`, `@ts-ignore` as habit. Harm: each one is a
  place the compiler was told to stop helping; bugs collect there. Fix: type it
  properly, or attach the justification to the escape.

## Dead weight

- **Unused dependencies** — in the manifest, never imported. Fix: remove; near-zero
  risk. `npx depcheck` / `npx knip` find candidates — verify each (both
  false-positive on dynamic import, CLI use, and type-only packages).
- **Dead files / unused exports** — nothing imports them. Verify with a real search
  (including string-built dynamic imports), then delete.
- **Debug leftovers** — `console.log`, timing statements, `debugger`. Delete unless
  they're a deliberate logging strategy (then they should use the project's logger).
- **TODO litter** — TODOs older than the file's last meaningful change. Either they
  become findings in the report, or they're deleted as done/stale.

## What is NOT slop

Don't flag: comments explaining a genuine constraint or workaround; a defensive
check at a real trust boundary; deliberately duplicated code in test fixtures;
verbose code that is verbose because the domain is (a tax table is a tax table).
Flagging these erodes the user's trust in every other finding.
