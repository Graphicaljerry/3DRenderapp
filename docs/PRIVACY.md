# Moldable — Privacy Policy

**Effective date:** [[EFFECTIVE DATE]]
**Who this is from:** [[LEGAL ENTITY NAME]] ("we", "us"), the maker of Moldable.
**Contact:** [[CONTACT EMAIL]]
**The app:** [[APP URL]]

---

## The short version

Moldable runs in your browser. Your models, your chat history and your API keys are
stored **on your own device**, not on our servers.

We do not run analytics. We do not use tracking pixels. We do not set cookies. We
have no advertising, no data brokers and no third-party trackers of any kind. There
is no account required to use the app.

When you ask the AI to design something, your words and any photos you attach go
**straight from your browser to the AI provider whose key you pasted in** — Anthropic,
Google, OpenAI, Groq, OpenRouter, or whoever you chose. We are not in the middle of
that conversation, with the specific exceptions listed under
[What passes through our relay](#what-passes-through-our-relay).

Everything below is the honest detail.

---

## 1. What we collect

**We collect nothing automatically.** There is no telemetry, no crash reporting, no
usage logging, no analytics service, no session recording. We do not know how many
parts you designed, what you typed, or whether the app crashed. Errors are written to
your browser's own developer console and go nowhere else.

The only personal information we ever hold is what you deliberately hand us:

| What | When | Where it lives |
| --- | --- | --- |
| Your email address | Only if you create the optional account | Supabase (our sync provider) |
| Your encrypted settings and projects | Only if you create the optional account | Supabase |

That's it. No name, no address, no phone number, no payment details (we never take
payment — see [Payments](#8-payments)).

The web app is hosted on **GitHub Pages**. Like any website, GitHub's servers see the
usual request data (IP address, browser user-agent, which files you fetched) when the
page loads. We do not receive, request or store those logs. GitHub's handling of them
is covered by GitHub's own privacy statement.

---

## 2. What is stored on your device

Moldable is local-first. Nearly everything lives in your browser's own storage.

**IndexedDB** — a database named `moldable`, with one store called `projects`. Each
project record holds: the project name, the full chat transcript, the CAD code the AI
wrote, up to 60 versions of history, the 3D mesh, any STEP/STL/3MF file you imported,
small preview thumbnails, notes you pinned on the model, and per-part colours.
(If your browser blocks IndexedDB — some private-browsing modes do — the same data
falls back to a localStorage key called `moldable:projects`.)

**localStorage** — your settings. Every key begins with `moldable_`. The ones worth
knowing about:

- `moldable_key`, `moldable_llm_keys`, `moldable_provider_keys` — **your API keys**
- `moldable_avatar` — your profile photo, if you set one
- `moldable_printer`, `moldable_fit_cal` — your printer's bed size and fit calibration
- `moldable_spend`, `moldable_spend_v1` — a private, device-only estimate of what you
  have spent with your AI providers
- `moldable_cloud_last_email` — the email of the account last signed in on this device
- the rest are interface preferences: theme, units, panel widths, colours, toggles

**Cache Storage** — the app's own files, the ~11 MB CAD kernel (WebAssembly), and, if
you choose the on-device AI brain, roughly 0.9 GB of model weights.

**Cookies: none.** Moldable sets no cookies at all. localStorage and IndexedDB are not
cookies — they are not sent with network requests and no third party can read them
from another site. Because we set no cookies and run no trackers, there is no cookie
banner and nothing to consent to.

---

## 3. Where your API keys go, and how they are stored

Moldable is bring-your-own-key. You paste a key from Anthropic, Google, OpenAI, Groq,
OpenRouter, Hugging Face, fal, Tripo, Meshy or Replicate, and the app uses it to talk
to that company on your behalf.

**Be aware: your keys are stored in your browser's localStorage in plain text.** They
are not encrypted on your device. This is a deliberate trade-off — it is what lets the
app work with no server and no login — but you should understand what it means:

- Anyone with access to your unlocked computer and browser profile can read them.
- A malicious browser extension with permission to read this site could read them.
- If someone got a malicious script onto the page, it could read them.

Practical advice: use keys with spend limits where your provider offers them, use a
separate key for Moldable rather than your main one, and rotate the key if you think
a device has been compromised. You can clear every key at any time by clearing this
site's data in your browser.

**Where the keys travel:**

- **Anthropic** — always browser → `api.anthropic.com`, directly. Never through us.
- **Google Gemini, OpenAI, Groq, OpenRouter** — browser → the provider, directly. If
  that direct call fails (a corporate firewall, a CORS block), the app retries the
  same request through our relay, and the key rides along in that retry. See
  [What passes through our relay](#what-passes-through-our-relay).
- **fal, Tripo, Meshy, Replicate** — **always** through our relay. Browsers cannot call
  these APIs directly, so there is no other route. Your key is in the request header.
- **Hugging Face** — browser → `huggingface.co` and the model's `*.hf.space` server,
  directly.
- **Ollama and the on-device brain** — never leave your machine at all.

---

## 4. What leaves your device, and who receives it

### 4.1 Your AI provider (the "brain")

When you describe a part, the app sends to your chosen provider:

- a system prompt (the CAD instructions Moldable writes)
- your typed request and the recent conversation
- the current CAD code, when you are editing an existing part
- any photos or sketches you attached

Photos are shrunk to at most 1568 pixels on the long edge before sending, and one
message can carry at most ten of them.

That provider then handles your data under **their** privacy policy and their training
and retention rules — not ours. If it matters to you whether your prompts are used for
model training, read the policy of the provider whose key you are using. We have no
control over and no visibility into it.

Providers Moldable can be pointed at: Anthropic, Google (Gemini), OpenAI, Groq,
OpenRouter, Hugging Face, Ollama (local), a WebLLM model running in your browser, or
any custom OpenAI-compatible endpoint you type in yourself.

### 4.2 3D mesh engines

If you use the sculpted-mesh mode, your prompt and reference photos are sent to the
engine you picked: Hugging Face (free), fal, Tripo, Meshy or Replicate. Each has its
own privacy policy and its own retention of what you upload.

### 4.3 Web research (optional, on "Auto" by default)

When your request names a real product — "a case for my iPhone 17 Pro" — Moldable can
look up its real dimensions before writing the CAD. The search runs through your own
provider: Google Gemini's search grounding, Anthropic's web-search tool, or
OpenRouter's web plugin. Your request text is what gets searched.

This is a toggle in the composer with three settings: **Auto** (look up only when a
real product is named — the default), **On**, and **Off**. Set it to Off if you never
want a request to trigger a web search.

When the research goes through OpenRouter, the app identifies itself to OpenRouter
with a `HTTP-Referer: https://moldable.app` and `X-Title: Moldable` header.

### 4.4 Google — two places you might not expect

Please read this bit even if you skip the rest.

1. **Source favicons.** After a web lookup, the chat shows a little chip for each page
   the AI used, with that site's favicon. The favicon is fetched from
   `https://www.google.com/s2/favicons?domain=<the site>`. **This tells Google which
   domains your research touched, along with your IP address.** The app sends no
   referrer with the request, but the domain is in the URL itself, so Google sees it.
   If you do not want this, turn web research Off.

2. **Google Fonts, in the Text tool only.** The app's own interface fonts are bundled
   into the app and load from nowhere. But if you use the Text tool and pick a Google
   font by name, the app fetches that font from `fonts.googleapis.com` and
   `fonts.gstatic.com`, which reveals your IP address and the font you chose to Google.
   Uploading your own `.ttf`/`.otf` file instead avoids this entirely.

### 4.5 Our sync provider (only if you make an account)

See section 5.

### 4.6 Incidental network calls

- **OpenRouter model catalogue** — if OpenRouter is your brain, the app fetches the
  public model list from `openrouter.ai` (no key attached) so it can show live prices.
- **OpenRouter balance** — read with your key, so the app can show your credit.
- **Meshy / Tripo balance** — read with your key, through the relay.
- **Sign-in reachability checks** — before an OAuth sign-in, the app pings
  `github.com/favicon.ico` or `accounts.google.com/favicon.ico` to check the network
  can actually reach them, so you don't land on a dead page.
- **Desktop app only** — the Mac/Windows build checks `api.github.com` for a newer
  release.
- **On-device brain** — the first time you use it, ~0.9 GB of model weights download
  from the WebLLM/Hugging Face CDN. After that it needs no network at all, and your
  prompts never leave the machine.

---

## What passes through our relay

Browsers are not allowed to call some APIs directly. To make those work, requests are
forwarded through a small relay we run (a Supabase edge function). This is the only
part of Moldable where your data passes through infrastructure we control.

**Always relayed:**

- Every fal, Tripo, Meshy and Replicate mesh generation — including your prompt, your
  reference photos, and your API key for that provider.
- Downloads of the finished 3D file when the provider's CDN blocks direct downloads.
- Downloads of reference images the research step found.

**Relayed only as a fallback:**

- A Gemini, OpenAI, Groq or OpenRouter chat request that failed to reach the provider
  directly (corporate firewall, CORS block, ad-blocker). The retry carries the same
  prompt, photos and key.

**Never relayed:** Anthropic requests, Hugging Face requests, Ollama, and the
on-device brain.

The relay's job is to forward the request and hand back the answer. It is designed to
pass your key straight through without storing it. Be aware of two honest limits on
that promise:

1. Any relay can, in principle, see what passes through it. If you would rather no
   third party ever touched your prompts or keys, use Anthropic (never relayed), or
   Ollama / the on-device brain (never leaves your machine), or run the app locally
   where a relay on your own computer does the job. You can also point Settings →
   Proxy base URL at a relay you host yourself; a deployable Cloudflare Worker is
   included in the repository.
2. Requests through the relay necessarily expose your IP address to it, as with any
   web server.

---

## 5. The optional account (sync)

You can use Moldable forever without an account. If you make one, here is exactly what
happens.

**Provider.** Accounts and sync run on **Supabase**. Supabase acts as our data
processor and hosts the database, the file storage and the authentication.

**Sign-in methods.** Email + password, a passwordless email link, a password-reset
link, or OAuth via GitHub or Google. Confirmation and login emails are sent by
Supabase (from `mail.app.supabase.io`). If you use GitHub or Google sign-in, that
company learns you signed in to this app.

**What Supabase stores about you:** your email address and standard authentication
records (when the account was created, when you last signed in, session tokens).

**What syncs, automatically, once you are signed in:**

- **Settings** — every `moldable_` setting except a small device-local set. **This
  includes your API keys** and your profile photo. This is how a key you paste on your
  laptop appears on your phone.
- **Projects** — the full library: names, chat transcripts, CAD code, version history,
  small thumbnails, and chat image thumbnails up to 96 KB each.
- **Deletion records** — a small list of "this project was deleted", so a deletion on
  one device reaches your other devices. These expire after about 120 days.
- **Meshes** — each project's current 3D mesh, or the STEP/STL you imported, as a file
  in a private storage bucket. Older version-history meshes stay on your device.

Sync runs roughly 2.5 seconds after any change, plus a safety pass every 45 seconds.

**Encryption — read this carefully, because it is easy to oversell.** Everything above
is encrypted in your browser with AES-GCM before it is uploaded, and rows are locked to
your account by database row-level security. But the encryption key is derived from
your account's own user ID, **not from a password only you know**. That means:

- It protects you against someone who obtains a raw dump of the database table.
- It is **not** end-to-end encryption. It is not zero-knowledge. Someone with
  administrative access to both the database and the account records could decrypt it.

So: sync is a convenience with a real layer of protection, not a vault. If your CAD
work is genuinely confidential, do not sign in, and use the passphrase-protected
settings backup file instead — that one *is* encrypted with a passphrase only you know
(PBKDF2, 310,000 iterations), and it never touches any server.

**Signing out wipes this device.** When you sign out, Moldable uploads anything new,
then deletes every project from that device — so a shared or work computer doesn't
leave your library sitting there for the next person. Your models stay in your account
and come back when you sign back in. Your settings and API keys are deliberately *not*
wiped, so you don't have to re-paste keys after every sign-out.

---

## 6. Photos and images you attach

- Attached photos are resized to at most 1568 px before anything else happens.
  Up to 10 per message; a single file over 30 MB is refused.
- The resized image is sent to your chosen AI brain, or to the mesh engine (through
  the relay for the paid engines).
- **The full-resolution original is never stored.** What your chat transcript keeps is
  a small thumbnail, about 420 px, saved locally.
- If you are signed in, thumbnails up to 96 KB sync to your account (encrypted, as
  above). Larger ones are left out.
- A profile photo, if you set one, is stored as a small image in localStorage and
  syncs with your settings.
- Reference images the research step finds on the web may be fetched (sometimes via
  our relay) and shown to the AI provider so it can see the product it is measuring.

---

## 7. Legal bases for processing (UK/EU)

If you are in the UK or EEA, our legal bases are:

- **Contract** — running your account and syncing your data, when you have asked for
  an account.
- **Legitimate interests** — keeping the service working and secure, and the small
  number of technical calls described in 4.6.
- **Consent** — where you turn something on yourself, such as web research or the
  Text tool's Google font loading.

Without an account, we do not process personal data about you at all, so no legal
basis is engaged on our side.

---

## 8. Payments

There is no payment flow in Moldable. We do not take money and we hold no payment or
card details. Any money you spend is paid directly to your AI or mesh provider under
your own contract with them. The spend figures the app shows are local estimates for
your own reference — your provider's dashboard is the real invoice.

---

## 9. Sharing and selling

**We do not sell your personal information. We do not share it for cross-context
behavioural advertising. We never have and we have no plans to.**

Your data reaches third parties only in the ways described above: the AI or mesh
provider you chose, our relay, and Supabase if you made an account.

We may disclose information if we are legally required to. Given what we hold — an
email address and an encrypted blob — there is very little to disclose.

---

## 10. International transfers

The providers listed here operate globally, and most are based in the United States.
If you are in the UK or EEA, using Moldable means your prompts, images and (if you
have an account) synced data will be transferred outside your country — for AI
providers, to wherever you have chosen to send them; for sync, to the region where our
Supabase project runs.

Where we are the ones transferring data (the account and the relay), we rely on the
UK/EU Standard Contractual Clauses or an equivalent approved mechanism through our
providers. Where **you** transfer data by pointing the app at a provider of your
choosing, that transfer is under your own arrangement with that provider.

---

## 11. Retention and deletion — how to actually delete your data

**Data on your device** stays until you remove it. There is no expiry.

- **One project:** delete it in the Library. If you are signed in, that deletion
  propagates to your other devices and removes its mesh from your account's storage.
- **Version history:** capped at 60 versions per project; versions you deliberately
  name and keep are never trimmed automatically.
- **Everything on this device, including keys:** clear site data for [[APP URL]] in
  your browser settings (Chrome: Settings → Privacy → Site settings; Safari: Manage
  Website Data; Firefox: Clear cookies and site data). This wipes IndexedDB,
  localStorage and the caches. It cannot be undone.
- **On the desktop app:** the same, plus the sign-in session file in the app's data
  directory.

**Data in your account:**

- Deleting a project in the app deletes it from the account too.
- Signing out clears that device's library while leaving the account intact.
- **There is currently no in-app "delete my account" button.** To have your account
  and every row and file associated with it erased, email [[CONTACT EMAIL]] from the
  address you signed up with. We will delete it and confirm, and in any case within
  30 days.

Deletion records ("tombstones") persist for about 120 days so that a deletion reaches
every one of your devices, then disappear.

---

## 12. Your rights

### If you are in the UK or the EEA (UK GDPR / GDPR)

You have the right to: access your data; correct it; have it erased; restrict or
object to processing; receive it in a portable format; and withdraw consent at any
time. You will not be treated differently for exercising any of these.

In practice, most of these you can exercise yourself and instantly, because your data
is on your own machine: the app's Settings → Sync includes an **encrypted backup
export** that gives you a portable copy of everything, and clearing site data is
erasure. For anything held in an account, email [[CONTACT EMAIL]].

You also have the right to complain to a supervisory authority — in the UK, the
Information Commissioner's Office (ico.org.uk); in the EEA, your national data
protection authority.

### If you are in California (CCPA / CPRA)

In the twelve months before this policy's date, the only category of personal
information we have collected is **identifiers** — specifically, an email address, and
only from people who chose to create an account. We collected it to provide the sync
service. We did not collect any other category, and we did not collect any sensitive
personal information.

**We have not sold or shared personal information, and we do not use it for
cross-context behavioural advertising.** We do not knowingly sell or share the
personal information of anyone under 16.

You have the right to know what we hold, to delete it, to correct it, to opt out of
sale or sharing (there is nothing to opt out of), to limit the use of sensitive
personal information (we hold none), and not to be discriminated against for
exercising any of these. Exercise any of them by emailing [[CONTACT EMAIL]]. We will
verify your request by confirming you control the account email. You may use an
authorised agent.

### Everywhere else

Write to [[CONTACT EMAIL]] and we will honour equivalent requests as far as we
reasonably can.

---

## 13. Children

Moldable is not designed for or directed at children. You must be at least 13 to use
it, and at least 16 to create an account if you are in the EEA or UK — or older, if
your country sets a higher age.

We do not knowingly collect personal information from children. If you believe a child
has created an account, email [[CONTACT EMAIL]] and we will delete it.

3D printing involves hot surfaces, moving parts and sharp tools. Children should only
print under adult supervision.

---

## 14. Security — an honest assessment

What is genuinely good here:

- No servers of ours hold your designs by default, so there is no central database of
  user work to breach.
- No analytics or trackers, so there is no behavioural profile of you anywhere.
- Every network call goes over HTTPS.
- Account data is encrypted in your browser before upload, and rows are locked to
  their owner.
- AI-generated code runs inside a sandboxed Web Worker with a watchdog timeout.

What we will not pretend:

- **Your API keys sit in localStorage in plain text.** That is the single weakest
  point. Treat your browser profile as holding a password, because it does.
- Account sync is encrypted but **not** end-to-end — see section 5.
- Once your prompt or photo reaches an AI provider, its security is theirs, not ours.
- No system is perfectly secure, and this one is built and maintained by a very small
  team.

If you find a security problem, please email [[CONTACT EMAIL]] rather than posting it
publicly, and we will work with you on it.

---

## 15. Changes to this policy

If we change something material — a new third party receiving data, a new category
collected — we will update the effective date at the top and note the change in the
app's release notes. Because we have no analytics, we have no way to email everyone;
the current version always lives at [[APP URL]].

---

## 16. Contact

Questions, requests, corrections, or anything in here that reads as wrong:
**[[CONTACT EMAIL]]**

Data controller: [[LEGAL ENTITY NAME]], [[POSTAL ADDRESS]].
