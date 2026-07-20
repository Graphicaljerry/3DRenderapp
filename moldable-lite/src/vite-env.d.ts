/// <reference types="vite/client" />

// Injected by vite.config.ts `define`: "<short-sha> · <build date>" — changes on
// every push to main, shown in the status bar so a refresh provably updated.
declare const __BUILD_STAMP__: string;

// The OpenCascade emscripten glue ships no bundled types.
declare module "replicad-opencascadejs/src/replicad_single.js" {
  const initOpenCascade: (opts?: { locateFile?: (p: string) => string }) => Promise<any>;
  export default initOpenCascade;
}
