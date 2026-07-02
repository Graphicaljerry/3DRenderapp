# 🔌 Deploy the relay in ~10 minutes (free) — unlock the reliable 3D engines

**Why:** the hosted Moldable site is a static page, and every high-quality mesh API
(Tripo, Meshy, fal, Replicate) refuses direct browser calls — they require the
request to come from a server. This tiny relay *is* that server: it forwards your
request (your key rides along, never stored) and returns the result. Cloudflare's
free plan runs it at no cost — 100,000 requests/day free.

**What you get:** the **Tripo** engine working on the live site — **200 free
credits every month** (a generation costs ~10–25 credits), dramatically more
reliable and higher quality than the free Hugging Face GPUs.

---

## Path A — no terminal, all in the browser (recommended)

1. Go to **[dash.cloudflare.com](https://dash.cloudflare.com)** → sign up (free, no card).
2. In the left sidebar: **Workers & Pages** → **Create** → **Create Worker**.
3. Give it a name like `moldable-relay` → **Deploy** (it deploys a hello-world first).
4. Click **Edit code**, select everything in the editor, delete it, and **paste the
   entire contents of [`cloudflare-worker.js`](./cloudflare-worker.js)** from this folder.
5. Click **Deploy** (top right). Done — copy your Worker URL, it looks like:
   `https://moldable-relay.<your-account>.workers.dev`
6. In **Moldable** → **Settings → 3D engine → Advanced** → paste that URL into
   **Proxy base URL** → **Save all**.

## Path B — terminal (if you have Node)

```bash
npm i -g wrangler
wrangler login
wrangler deploy proxy/cloudflare-worker.js --name moldable-relay
```
Copy the printed URL into **Settings → 3D engine → Advanced → Proxy base URL**.

---

## Then: get your free Tripo key (2 minutes)

1. **[platform.tripo3d.ai](https://platform.tripo3d.ai)** → sign up (free tier
   includes monthly credits) → **API Keys** → create one (`tsk_…`).
2. Moldable → **Settings → 3D engine** → Engine: **Tripo** → paste the key → **Save all**.
3. Generate: attach a photo → send. Tripo returns clean, watertight, textured meshes.

## Notes

- Your API keys are typed into *your* browser and forwarded through *your* Worker
  straight to the provider — they are never stored on the Worker or anywhere else.
- Optional hardening: in `cloudflare-worker.js`, change `ALLOW_ORIGIN = "*"` to your
  site origin (e.g. `"https://<you>.github.io"`) so only your app can use the relay.
- The same relay also unlocks **Meshy**, **fal (Rodin, Hunyuan 3D Pro)** and
  **Replicate**, plus acts as a CORS fallback for the Precise-mode AI providers.
- Running locally? You don't need any of this — `npm run dev` has the relay built in.
