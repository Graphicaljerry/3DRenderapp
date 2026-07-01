# Relay ("backend") for the generative 3D engines

The image/text→3D providers (Meshy, Tripo, Replicate, fal) **refuse direct calls from a web page**
(CORS) and use secret keys. So the app never calls them from the browser directly — it calls a small
**relay** that forwards the request. Your API key travels from your browser → the relay → the
provider, and is never stored anywhere.

## Local (default — nothing to do)

When you run `npm run dev`, the Vite dev server **is** the relay (see `relayPlugin` in
`vite.config.ts`). It forwards `/prox/<provider>/…` to the real API. Leave **Settings → Proxy base
URL** blank. Hugging Face (the free engine) is called directly by the browser and needs no relay.

## Hosted (only when you put the app online)

A static build has no dev server, so deploy the tiny Cloudflare Worker:

```bash
npm i -g wrangler
wrangler deploy proxy/cloudflare-worker.js --name moldable-relay
```

Then in the app's **Settings → Proxy base URL**, paste the Worker URL, e.g.
`https://moldable-relay.<you>.workers.dev`. (Vercel/Netlify Edge Functions work the same way — the
Worker is ~40 lines you can port.)

Security notes:
- The Worker forwards the key from the browser per request; it does **not** hold your key. For a
  multi-user site you'd instead store one key as a Worker secret and meter usage.
- In production, change `ALLOW_ORIGIN = "*"` in the Worker to your site's origin.
