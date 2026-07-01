import { ReplicadEngine } from "./replicadEngine";
import { FallbackPrimitiveEngine } from "./fallbackEngine";
import type { Engine, EngineKind } from "./types";

export interface EngineSelection {
  engine: Engine;
  kind: EngineKind;
  fellBack: boolean;
  bootError?: string;
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
