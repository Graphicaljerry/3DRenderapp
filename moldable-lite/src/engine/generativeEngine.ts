import type { Engine, EngineResult, BuildInput, ExportFormat } from "./types";
import type { GenProgress } from "../gen/types";
import { getProvider } from "../gen/registry";
import { relayAvailable } from "../gen/util";
import { glbToGeometry } from "../gen/loadMesh";
import { geometryToSTL, geometryToOBJ, geometryTo3MF } from "../print/exportClient";

// Engine B: photo/text -> mesh via a chosen provider. Implements the same Engine
// interface as the CAD engines so the viewer / printability / export / history all reuse it.
export class GenerativeEngine implements Engine {
  readonly kind = "generative" as const;
  readonly ready = true;

  // set by App before each build:
  config: { keyFor: (providerId: string) => string | undefined; proxyBase?: string } = { keyFor: () => undefined };
  onProgress: (p: GenProgress) => void = () => {};

  async build(input: BuildInput): Promise<EngineResult> {
    if (input.kind !== "gen") throw new Error("The generative engine expects an image or text request.");
    const prov = getProvider(input.provider);
    if (!prov) throw new Error(`Unknown 3D provider: ${input.provider}`);
    if (prov.needsKey && !this.config.keyFor(prov.id)) {
      throw new Error(`Add your ${prov.label} API key in Settings to use it.`);
    }
    // Proxied providers need a relay. The dev server has one built in; a static
    // host (e.g. GitHub Pages) does not — fail fast with the fix, not a 404 soup.
    if (prov.viaProxy && !relayAvailable(this.config.proxyBase || "")) {
      throw new Error(
        `${prov.label} needs a small relay server, which this hosted site doesn't have yet. The 10-minute, free fix: deploy the included Cloudflare Worker — step-by-step guide in proxy/DEPLOY.md on GitHub — then paste its URL in Settings → 3D engine → Advanced. (Running locally with npm run dev needs no setup.)`,
      );
    }
    const { glb } = await prov.generate(
      {
        image: input.image,
        views: input.views,
        prompt: input.prompt,
        model: input.model,
        apiKey: this.config.keyFor(prov.id),
        proxyBase: this.config.proxyBase || "",
        texture: input.texture,
      },
      this.onProgress,
    );
    const { geometry, dims, texture } = await glbToGeometry(glb);
    return {
      kind: "generative",
      geometry,
      dims,
      // keep the persisted source lean + key-free (drop the image blob)
      source: { kind: "gen", prompt: input.prompt, provider: input.provider, model: input.model },
      supportsStep: false,
      glb,
      texture,
    };
  }

  canExport(f: ExportFormat): boolean {
    return f === "stl" || f === "obj" || f === "3mf";
  }

  async export(result: EngineResult, f: ExportFormat): Promise<Blob> {
    if (f === "stl") return geometryToSTL(result.geometry);
    if (f === "obj") return geometryToOBJ(result.geometry);
    if (f === "3mf") return geometryTo3MF(result.geometry);
    throw new Error("STEP export needs the Precise (replicad) engine.");
  }
}
