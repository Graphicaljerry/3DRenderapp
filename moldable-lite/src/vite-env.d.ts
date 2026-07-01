/// <reference types="vite/client" />

// The OpenCascade emscripten glue ships no bundled types.
declare module "replicad-opencascadejs/src/replicad_single.js" {
  const initOpenCascade: (opts?: { locateFile?: (p: string) => string }) => Promise<any>;
  export default initOpenCascade;
}
