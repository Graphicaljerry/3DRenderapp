import { wrap, type Remote } from "comlink";
import type { CadWorkerApi, WorkerBuildResult } from "../worker/workerMessages";
import type { Engine, EngineResult, BuildInput, ExportFormat } from "./types";
import { facesToGeometry } from "./mesh";
import { geometryToOBJ, geometryTo3MF } from "../print/exportClient";

const BUILD_TIMEOUT_MS = 25_000;

export class ReplicadEngine implements Engine {
  readonly kind = "replicad" as const;
  ready = false;
  private worker!: Worker;
  private api!: Remote<CadWorkerApi>;
  private importBlob: Blob | null = null;

  private spawn() {
    this.worker = new Worker(new URL("../worker/cad.worker.ts", import.meta.url), { type: "module" });
    this.api = wrap<CadWorkerApi>(this.worker);
  }

  /** Load (or clear) a STEP file as the live `imported` solid main() receives. */
  async setImport(file: Blob | null): Promise<void> {
    this.importBlob = file;
    if (!file) {
      await this.api.clearImport();
      return;
    }
    const r = await this.withWatchdog(this.api.importShape(file), 45_000);
    if (!r.ok) throw new Error(r.error || "Couldn't read that STEP file.");
  }

  /** Boots OCCT; REJECTS if init fails so the selector can fall back. */
  async boot(): Promise<void> {
    this.spawn();
    await this.withWatchdog(this.api.init(), 60_000);
    this.ready = true;
  }

  private async withWatchdog<T>(op: Promise<T>, ms = BUILD_TIMEOUT_MS): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error("Build timed out (possible infinite loop in the code).")), ms);
    });
    try {
      return (await Promise.race([op, timeout])) as T;
    } finally {
      clearTimeout(timer!);
    }
  }

  private respawn() {
    try {
      this.worker.terminate();
    } catch {
      /* ignore */
    }
    this.spawn();
    // the fresh worker lost the imported solid — restore it in the background
    if (this.importBlob) void this.api.importShape(this.importBlob);
  }

  async build(input: BuildInput): Promise<EngineResult> {
    if (input.kind !== "code") throw new Error("The replicad engine expects code input.");
    let res: WorkerBuildResult;
    try {
      res = await this.withWatchdog<WorkerBuildResult>(this.api.build(input.code, input.params, input.ops) as unknown as Promise<WorkerBuildResult>);
    } catch (timeoutErr) {
      this.respawn();
      throw timeoutErr;
    }
    if (!res.ok) {
      const err = new Error(res.error.message);
      err.name = res.error.name;
      (err as any).stack = res.error.stack;
      throw err;
    }
    const geometry = facesToGeometry(res.faces);
    return {
      kind: "replicad",
      geometry,
      dims: res.dims,
      source: input,
      supportsStep: true,
      recenter: (geometry.userData.recenter as [number, number, number]) ?? [0, 0, 0],
    };
  }

  canExport(): boolean {
    return true; // stl, step, obj, 3mf
  }

  async export(result: EngineResult, format: ExportFormat): Promise<Blob> {
    const code = result.source.kind === "code" ? result.source.code : "";
    const params = result.source.kind === "code" ? result.source.params : undefined;
    const ops = result.source.kind === "code" ? result.source.ops : undefined;
    if (format === "stl") return this.withWatchdog(this.api.exportBlob(code, "stl", params, ops));
    if (format === "step") return this.withWatchdog(this.api.exportBlob(code, "step", params, ops));
    if (format === "obj") return geometryToOBJ(result.geometry);
    return geometryTo3MF(result.geometry);
  }
}
