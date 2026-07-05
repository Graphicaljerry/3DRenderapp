# 🔑 Enable “Continue with GitHub / Google” — one-time owner setup

The app already ships the buttons and handles the whole flow. What it can't do is
flip the switches in **your** Supabase/GitHub/Google accounts — that's this guide.
Total time: ~2 min for the URL fix, ~3 min for GitHub, ~10 min for Google.

Supabase project: **moldable** (`prtpakaxzdmrehpndimy`)

---

## Step 1 — REQUIRED first: fix the redirect URLs (~2 min)

This also fixes confirmation/magic-link emails currently bouncing to `localhost:3000`.

1. Open **https://supabase.com/dashboard/project/prtpakaxzdmrehpndimy/auth/url-configuration**
2. **Site URL** → `https://graphicaljerry.github.io/3DRenderapp/`
3. **Redirect URLs** → add both:
   - `https://graphicaljerry.github.io/3DRenderapp/**`
   - `http://localhost:5173/**`
4. Save. ✅ “Email me a login link” (passwordless) now works end-to-end — even
   with no social provider configured.

## Step 2 — GitHub login (~3 min)

1. Go to **https://github.com/settings/developers** → *OAuth Apps* → **New OAuth App**
   - Application name: `Moldable`
   - Homepage URL: `https://graphicaljerry.github.io/3DRenderapp/`
   - Authorization callback URL: `https://prtpakaxzdmrehpndimy.supabase.co/auth/v1/callback`
2. Register → copy the **Client ID** → **Generate a new client secret** → copy it.
3. Open **https://supabase.com/dashboard/project/prtpakaxzdmrehpndimy/auth/providers**
   → **GitHub** → enable → paste Client ID + Secret → Save.
4. Done — the “Continue with GitHub” button now works.

## Step 3 — Google login (~10 min, optional)

1. **https://console.cloud.google.com/apis/credentials** → create/select a project
2. Configure the **OAuth consent screen** (External → app name `Moldable` → your email → Save)
3. **Create credentials → OAuth client ID → Web application**
   - Authorized redirect URI: `https://prtpakaxzdmrehpndimy.supabase.co/auth/v1/callback`
4. Copy Client ID + Secret → Supabase **Auth → Providers → Google** → enable → paste → Save.

## Facebook?

Skippable: Meta requires a developer app + review process for login, and it adds
the least value for this audience. GitHub + Google + email link covers everyone.

---

### How the buttons behave before/after setup

- **Before**: clicking a social button shows a friendly in-app note pointing here.
- **After**: click → provider consent screen → straight back into Moldable, signed
  in, with a chat notice — then Settings → Sync → passphrase → **Push to cloud**.
