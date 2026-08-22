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

_Rules below were read from the primary sources on 2026-08-22, not from memory.
They correct the playbook, which said several maker channels carry "no-AI
policies" — only one of the three does, and the others would block a launch post
for reasons that have nothing to do with AI._

### r/3Dprinting — genuinely restricted. Do not launch here.

- **Rule 7, "Other content restrictions"** names the restricted categories
  verbatim: "Anything regarding cryptocurrency / NFT · **AI generated content or
  models** · Reddit ToS restricted content".
- **Rule 3, Self-Promotion**: one self-promotion post per **14 days** (free
  models) or **30 days** (paid), with further limits in the full wiki rules.
- **Rule 9** bans linking to sites on their restricted-sites list. Check that
  list before linking anywhere, your own domain included.
- Verdict: an "I built an AI CAD tool" post sits squarely inside Rule 7. Framing
  will not save it — the rule names the category. Skip it, or ask the mods first
  via modmail. Source: https://old.reddit.com/r/3Dprinting/about/rules/

### r/functionalprint — no AI rule at all, but two harder walls.

- There is **no rule mentioning AI**. The playbook was wrong about this one.
- **Rule 6**: "Tips/News/Questions/**Announcements** will be removed and expected
  to be posted in /r/3Dprinting." A launch or tool-announcement post is removable
  on its face — and its designated destination is the sub that restricts AI content.
- **Rule 7, "Participate beyond your own posts"**: "This community is not a
  personal showcase feed or distribution channel… **As a rule of thumb, 10% or
  less of your activity should be your own content.**"
- Rules 1-5 additionally require a genuinely functional object: no dust
  collectors, toys, decorative containers, jewellery/ornaments/signs, novelty items.
- Verdict: usable, but only as a real member. Post *parts you actually printed and
  use*, with measurements, and let the tool come up in comments when someone asks
  how you made it. Budget nine other people's threads for every one of your own.
  Source: https://old.reddit.com/r/functionalprint/about/rules/

### MakerWorld — open to this, with quality rules that bite parametric uploads.

- The **Community Guidelines** contain no AI ban.
  (https://makerworld.com/en/community-guidelines)
- **Model Upload Guidelines** are the ones to design around:
  - "Model gallery images must include at least one **clear photo of the actual
    printed object**." Renders alone are not enough — so every model you publish
    has to be printed first.
  - "Printability is the fundamental standard… prioritize uploading model files
    that have been **successfully print-tested**."
  - Prohibited: "**advertising or marketing content**". The model page is not an
    ad for Moldable — a plain "made with" line in the description, not a pitch.
  - **"Homogeneous Uploads"** is a listed violation: "Uploading multiple models
    based on the same core design, differing only in patterns, text, size, or
    minor optimizations." This is the trap for a parametric tool — publish two or
    three genuinely different parts, not ten variants of one bracket.
  Source: https://wiki.bambulab.com/en/makerworld/tutorials/model-upload-guidelines
- **Crowdfunding AI Policy** (applies only if you ever run a MakerWorld
  crowdfunding campaign, not to ordinary uploads): AI-assisted work "must include
  significant human creative input", you must disclose which AI tools were used,
  and campaigns "that rely primarily on AI-generated models… will not be approved".
  Source: https://makerworld.com/en/crowdfunding-ai-policy
- Reported but **not verified**: secondary coverage says MakerWorld asks creators
  to tag substantially AI-generated models "AIGC", and that the real-printed-photo
  requirement took effect 2026-02-05. The wiki's dedicated AI-policy page now
  returns 404, so treat the AIGC label as likely-but-unconfirmed and check the
  upload form when you get there.

### Still safe, and worth doing first

- **Awesome-list pull requests** (~2 hours): the best value per minute, and no
  content policy to navigate — it is a link in a list, judged on whether the tool
  is real.
- **Gridfinity / repair communities**: read each one's rules the same way before
  posting. They vary, and only the three above were verified.
- **Show HN / Hackaday**: no AI restriction, but the audience will caliper-test
  the claims. The export receipt is what makes that survivable.

### What this means for the framing question

Leading with the outcome rather than "AI" is good positioning everywhere — but it
is **not** a way through r/3Dprinting's Rule 7. Where a rule names the category,
the answer is to not post there, or to ask the moderators first. Disclose plainly
wherever you do post: looking evasive costs more than any single thread earns.
