# Launch checklist — playbook moves 7 and 8

_Written 2026-08-21, from the Moldable Playbook (round-two research). These two moves
are business moves: most steps below need Jerry's identity, accounts or judgement, so
this file is the prepared plan, not finished work. Where the playbook's corrected plan
disagrees with the older staged plan in `COMMERCIALIZATION.md`, this file wins._

---

## Move 7 — Desktop licence, $29–49 one time

**Why this first:** the users we chose (people who already own API keys) don't buy
key management — they buy one-time licences. The build pipeline already produces the
apps and currently gives them away:

- `Moldable_aarch64.dmg` (macOS, Apple Silicon) and `Moldable_x64-setup.exe`
  (Windows 10/11) — built by `.github/workflows/build-desktop.yml`, published on the
  `desktop-latest` release tag.
- The web app stays free for good. The licence buys the native app: slicer hand-off,
  offline everything, auto-update.

**Pick a checkout (Jerry's call):**

| Option | Cut | Why pick it |
|---|---|---|
| Lemon Squeezy | ~5% + 50¢ | Merchant of record (they handle VAT/sales tax), built-in licence keys + API. The default choice. |
| Gumroad | ~10%+ | Simplest possible start; also merchant of record; licence keys are basic. |
| Paddle | ~5% + 50¢ | Also merchant of record; stronger for later subscriptions; heavier setup. |

**Steps only Jerry can do**
1. Create the seller account (identity + payout details + tax form). ~30 min.
2. Create one product: "Moldable Desktop" at $39 (test the 29/49 ends later), with
   licence keys turned on.
3. Paste the product/checkout link into the app when the licence gate ships (below).

**Steps the code side can do once a checkout exists** (not built yet — next session):
- A licence field in the desktop app's Settings (validate the key against the
  vendor's licence API once, store locally, never phone home again).
- A gentle gate: unlicensed desktop = trial banner, not a lockout.
- A `/buy` link on the site + README.

**Hold until then:** nothing blocks selling a "supporter licence" even before the
gate exists — the buy link can go up first if Jerry prefers money-before-code.

---

## Move 8 — Free distribution (costs time, not money)

Rule from the research, worth repeating: **lead with "parametric CAD you can talk
to" and the measured part — not with "AI".** Several maker channels have public
no-AI policies, and that audience caliper-tests claims. The verification receipt
(shipped, build 492) is what makes these channels safe to enter.

**Ready now — order of effort:**
1. **Awesome-list pull requests** (~2 hours, permanent links): awesome-cad,
   awesome-3d-printing and similar lists on GitHub. The PR text is one line and a
   link; Jerry's GitHub account must open them.
2. **MakerWorld customisable-model profile** (~an evening): publish two or three
   parametric models (the tolerance coupon, a bracket, the phone stand) with
   "customise this in Moldable" links. Needs a MakerWorld account.
3. **r/functionalprint residency** (ongoing, ~30 min/week): answer-first posts —
   photo of a fitted part, the measurements, how it was made. No launch post;
   reputation first. ~600k members.
4. **Gridfinity + repair communities** (same posture as 3).

**Now unlocked (receipt is live), but do them deliberately:**
5. **Show HN / Hackaday** — one post, when Jerry has a spare morning to answer
   comments. Lead with the receipt and a measured part.
6. **YouTuber accuracy kit** — a one-page "test us" sheet for measurement-driven
   channels: the tolerance coupon STL, the receipt, the calibration flow. Prepare on
   request.

**What was already prepared this session:** privacy + terms pages, API-abuse guards
on the proxy, the verification receipt, printer calibration, and the Steps panel —
the parts of the story those channels will poke at.
