# Moldable — session orientation

Moldable is a local-first, bring-your-own-key web app: describe a part →
AI writes replicad (OpenCascade WASM) CAD code → live three.js viewer →
export STL/3MF/STEP/OBJ, with optional paid mesh engines for sculpted models.
The app lives in `moldable-lite/`; it deploys to GitHub Pages from `main`.

**Read first, in order:**
1. `docs/BUILDING.md` — the concise build/run/deploy + API-keys survival sheet
2. `docs/HANDOFF.md` — current state and roadmap from previous sessions
3. `moldable-lite/README.md` — full architecture when you need depth

## Working conventions (Jerry's standing rules)

- Develop on the designated `claude/...` session branch; when a change is
  verified, push it, then fast-forward `main` and push (that deploys), and
  report the new build number (`git rev-list --count HEAD`).
- **Verify before you ship**: drive the real UI with Playwright against the
  local vite dev server and a stub LLM server — never claim a feature works
  from code reading alone. Then run the production build.
- Keep chat replies concise and plain-language; Jerry is a designer-developer
  who wants outcomes and honest caveats, not walls of process.
- Never put AI model identifiers in commits, code comments, or anything pushed.
- **Anti-slop guardrail**: before designing/restyling UI, writing microcopy, or
  reviewing code, apply `skills/no-ai-slop/SKILL.md` — and run its review pass
  on every feature's diff before shipping.

## Documentation upkeep (standing instruction)

After each shipped feature, if it changed the stack, setup, keys, backend, or
how the app is built/deployed: update `docs/BUILDING.md` (key points only —
it must stay short) and note the state change in `docs/HANDOFF.md`.
