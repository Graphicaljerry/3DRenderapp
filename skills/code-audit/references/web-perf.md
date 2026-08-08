# Web performance: measure, then take the big safe wins

## Measure a first visit honestly

Static file-tree math lies (a file on disk isn't necessarily loaded eagerly). When a
browser is available, measure what a first paint actually costs:

```js
// Serve the site (python3 -m http.server, vite preview, etc.), then:
import { chromium } from "playwright";
const b = await chromium.launch(); // executablePath if the env pins one
const page = await b.newPage();
let bytes = 0, reqs = 0;
page.on("response", async (r) => { try { bytes += (await r.body()).length; reqs++; } catch {} });
await page.goto(url, { waitUntil: "load" });
console.log(`initial load: ${reqs} requests, ${(bytes / 1024).toFixed(0)} KB`);
// then exercise the core interaction and confirm it still works
```

Run it before and after. Those two numbers are the headline of the audit.

For bundler projects, also read the build output (`vite build`, `next build` print
per-chunk sizes) and, when installed, a bundle analyzer. The biggest chunk names
which dependency to attack first.

## The findings that pay, in order of payoff-per-risk

1. **A library imported for one function.** A vendored or bundled utility library
   where one `groupBy`/`debounce` is used. Fix: inline the one function (10–20
   lines) or import the single-function subpath. Often the largest single win.
2. **Eager data that's used later.** A fetch/import of big JSON at module top-level,
   consumed only after a click. Fix: move the fetch into the interaction handler
   (cache it after first load). The user notices nothing except the faster start.
3. **Render-blocking scripts.** Plain `<script src>` in `<head>` blocks parsing.
   Fix: `defer`, or `type="module"` (modules defer by default). Verify order
   dependencies before deferring several.
4. **Images**: dimensions missing (layout shift), no `loading="lazy"` below the
   fold, formats/sizes wildly larger than display size.
5. **Bundler-level**: dynamic `import()` for routes/panels the first paint doesn't
   need; check tree-shaking actually applies (namespace imports of CJS packages
   often defeat it — `import * as _ from "lodash"` ships everything).

## Runtime (after load is fixed)

- React/UI: components re-rendering on every parent update (profiler first, memo
  second — memo without a measured re-render problem is itself slop).
- Long tasks on the main thread at startup: parsing big JSON, synchronous loops.
  Defer, chunk, or move to a worker — after measuring, with the measurement kept.

## The trap to avoid

Micro-optimizations with unmeasurable wins (string concat styles, loop flavors,
"avoid spread") make diffs noisy and reports untrustworthy. If the before/after
delta wouldn't survive rounding, it's not a finding.
