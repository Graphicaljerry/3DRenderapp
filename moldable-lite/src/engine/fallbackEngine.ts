import type { Engine, EngineResult, BuildInput, ExportFormat } from "./types";
import { buildGeometry } from "../cad/build";
import type { ModelSpec } from "../cad/spec";
import { geometryToSTL, geometryToOBJ, geometryTo3MF } from "../print/exportClient";

// Wraps the primitive + CSG engine behind the common Engine interface.
export class FallbackPrimitiveEngine implements Engine {
  readonly kind = "primitive" as const;
  readonly ready = true;

  async build(input: BuildInput): Promise<EngineResult> {
    if (input.kind !== "spec") throw new Error("The primitive engine expects a JSON spec.");
    const { geometry, dims } = buildGeometry(input.spec as ModelSpec);
    return { kind: "primitive", geometry, dims, source: input, supportsStep: false };
  }

  canExport(format: ExportFormat): boolean {
    return format === "stl" || format === "obj" || format === "3mf";
  }

  async export(result: EngineResult, format: ExportFormat): Promise<Blob> {
    if (format === "stl") return geometryToSTL(result.geometry);
    if (format === "obj") return geometryToOBJ(result.geometry);
    if (format === "3mf") return geometryTo3MF(result.geometry);
    throw new Error("STEP export requires the replicad engine (unavailable).");
  }
}
