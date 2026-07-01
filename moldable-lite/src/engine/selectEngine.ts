import { ReplicadEngine } from "./replicadEngine";
import { FallbackPrimitiveEngine } from "./fallbackEngine";
import type { Engine, EngineKind } from "./types";

export interface EngineSelection {
  engine: Engine;
  kind: EngineKind;
  fellBack: boolean;
  bootError?: string;
}

// Memoized so the (11 MB WASM) kernel boots exactly once, no matter how many
// code paths ask for it (App effect + "try example" used to race a double boot).
let selection: Promise<EngineSelection> | null = null;
export function getEngineSelection(): Promise<EngineSelection> {
  if (!selection) selection = selectEngine();
  return selection;
}

/** Try replicad; on ANY OCCT boot failure, fall back to the primitive engine. */
export async function selectEngine(): Promise<EngineSelection> {
  const replicad = new ReplicadEngine();
  try {
    await replicad.boot();
    return { engine: replicad, kind: "replicad", fellBack: false };
  } catch (e: any) {
    return {
      engine: new FallbackPrimitiveEngine(),
      kind: "primitive",
      fellBack: true,
      bootError: String(e?.message ?? e),
    };
  }
}
