import type { Project, Version, StoredEngineKind, GenSource, SurfFxSnap, TextLayerSnap, LogoLayerSnap } from "./types";
import type { CadOp } from "../engine/types";
import { uid } from "../lib/id";

export interface Snapshot {
  engine: StoredEngineKind;
  splitPieces?: Version["splitPieces"];
  summary: string;
  code?: string;
  params?: Record<string, number>;
  ops?: CadOp[];
  importFile?: Blob;
  importKind?: "step" | "stl";
  spec?: unknown;
  dims?: { x: number; y: number; z: number };
  glb?: Blob;
  meshXform?: number[];
  genSource?: GenSource;
  surfFx?: { pattern: SurfFxSnap | null; texture: SurfFxSnap | null };
  texts?: TextLayerSnap[];
  logos?: LogoLayerSnap[];
  partColors?: Record<string, string>;
}

/** Append a version capturing the new state AND advance HEAD to match. Pure.
 *  If HEAD isn't the newest version (i.e. the user undid and is now making a NEW edit),
 *  the "redo" branch after HEAD is discarded — the new edit becomes the fresh tip, so a
 *  later undo steps straight back to it instead of walking through stale future states. */
export function appendVersion(project: Project, snap: Snapshot): Project {
  const v: Version = {
    id: uid(),
    createdAt: Date.now(),
    summary: snap.summary,
    engine: snap.engine,
    code: snap.code,
    params: snap.params,
    ops: snap.ops,
    importFile: snap.importFile,
    importKind: snap.importKind,
    spec: snap.spec,
    dims: snap.dims,
    glb: snap.glb,
    meshXform: snap.meshXform,
    genSource: snap.genSource,
    splitPieces: snap.splitPieces,
    surfFx: snap.surfFx,
    texts: snap.texts,
    logos: snap.logos,
    partColors: snap.partColors,
  };
  const kept = project.versions.slice(0, headIndex(project) + 1); // drop any redo branch past HEAD
  return {
    ...project,
    versions: trimVersions([...kept, v]),
    engine: snap.engine,
    code: snap.code,
    params: snap.params,
    ops: snap.ops,
    importFile: snap.importFile,
    importKind: snap.importKind,
    spec: snap.spec,
    glb: snap.glb,
    meshXform: snap.meshXform,
    genSource: snap.genSource,
    updatedAt: Date.now(),
    headId: v.id,
  };
}

/** How many steps back History keeps. Each version carries a whole snapshot —
 *  code, ops, and for imported or generated parts the source STEP/mesh blob — so
 *  an unbounded list is what turns a long session's project into tens of MB and
 *  makes the panel crawl. The oldest steps fall off the end. */
export const MAX_VERSIONS = 60;

/** Age out the oldest steps, but never a named checkpoint. Trimming one would silently
 *  delete the exact thing the user asked the app to hold on to — and on a busy project
 *  sixty steps go by in an afternoon. */
export function trimVersions(list: Version[]): Version[] {
  if (list.length <= MAX_VERSIONS) return list;
  const kept = list.filter((v) => v.keep);
  const rest = list.filter((v) => !v.keep);
  const room = Math.max(0, MAX_VERSIONS - kept.length);
  const survivors = new Set([...kept, ...rest.slice(rest.length - room)].map((v) => v.id));
  return list.filter((v) => survivors.has(v.id));
}

/** Rewrite the HEAD version in place, keeping its id (so redo branches stay valid).
 *  For edits that arrive as a stream — a parameter drag lands dozens of commits —
 *  where one undo step should cover the whole gesture rather than each tick of it. */
export function replaceHeadVersion(project: Project, snap: Snapshot): Project {
  const i = headIndex(project);
  if (i < 0) return appendVersion(project, snap);
  const prev = project.versions[i];
  const v: Version = {
    ...prev,
    summary: snap.summary,
    engine: snap.engine,
    code: snap.code,
    params: snap.params,
    ops: snap.ops,
    importFile: snap.importFile,
    importKind: snap.importKind,
    spec: snap.spec,
    dims: snap.dims,
    glb: snap.glb,
    meshXform: snap.meshXform,
    genSource: snap.genSource,
    splitPieces: snap.splitPieces,
    surfFx: snap.surfFx,
    texts: snap.texts,
    logos: snap.logos,
    partColors: snap.partColors,
  };
  const versions = [...project.versions];
  versions[i] = v;
  return {
    ...project,
    engine: snap.engine,
    code: snap.code,
    params: snap.params,
    ops: snap.ops,
    importFile: snap.importFile,
    importKind: snap.importKind,
    spec: snap.spec,
    glb: snap.glb,
    meshXform: snap.meshXform,
    genSource: snap.genSource,
    updatedAt: Date.now(),
    versions,
    headId: v.id,
  };
}

/** Set a past snapshot as HEAD; records the restore as a new append-only version. Pure. */
export function restoreVersion(project: Project, versionId: string): Project {
  const t = project.versions.find((v) => v.id === versionId);
  if (!t) throw new Error("Version not found.");
  const v: Version = {
    id: uid(),
    createdAt: Date.now(),
    summary: `Restored “${t.summary}”`,
    engine: t.engine,
    code: t.code,
    params: t.params,
    ops: t.ops,
    importFile: t.importFile,
    importKind: t.importKind,
    spec: t.spec,
    dims: t.dims,
    glb: t.glb,
    meshXform: t.meshXform,
    genSource: t.genSource,
    splitPieces: t.splitPieces,
    // The layers travel too. Without these a restore came back as the right SOLID with
    // its text, logos, surface treatment and colours stripped off — a version that had
    // never existed. Every other writer here carries them; this one didn't.
    surfFx: t.surfFx,
    texts: t.texts,
    logos: t.logos,
    partColors: t.partColors,
    thumb: t.thumb,
  };
  return {
    ...project,
    engine: t.engine,
    code: t.code,
    params: t.params,
    ops: t.ops,
    importFile: t.importFile,
    importKind: t.importKind,
    spec: t.spec,
    glb: t.glb,
    meshXform: t.meshXform,
    genSource: t.genSource,
    updatedAt: Date.now(),
    versions: trimVersions([...project.versions, v]),
    headId: v.id,
  };
}

/** Index of the live HEAD within `versions` (defaults to the newest). */
export function headIndex(project: Project): number {
  if (project.headId) {
    const i = project.versions.findIndex((v) => v.id === project.headId);
    if (i >= 0) return i;
  }
  return project.versions.length - 1;
}

/** Move HEAD to an existing version WITHOUT appending (undo/redo). The live
 *  fields mirror that version; `versions` is untouched so redo stays available. Pure. */
export function navigateHead(project: Project, versionId: string): Project {
  const t = project.versions.find((v) => v.id === versionId);
  if (!t) throw new Error("Version not found.");
  return {
    ...project,
    engine: t.engine,
    code: t.code,
    params: t.params,
    ops: t.ops,
    importFile: t.importFile,
    importKind: t.importKind,
    spec: t.spec,
    glb: t.glb,
    meshXform: t.meshXform,
    genSource: t.genSource,
    updatedAt: Date.now(),
    headId: t.id,
  };
}

/** Save what is on screen as a named checkpoint.
 *
 *  It copies HEAD rather than re-deriving a snapshot, because HEAD already IS what is on
 *  screen — every editor here commits through appendVersion/replaceHeadVersion first —
 *  so a checkpoint can never disagree with the model the user was looking at when they
 *  pressed the button.
 *
 *  And it APPENDS rather than flagging the current version, on purpose: a checkpoint has
 *  to be the newest version in the project by createdAt, because that is the one thing
 *  every device agrees on. Merge picks HEAD by the version's own age, so a freshly
 *  appended checkpoint wins on the work laptop, the Mac app and the iPad alike, with no
 *  device needing to be told which copy is right. Restoring one is the same move again,
 *  which is why restoring also lands everywhere. */
export function saveCheckpoint(project: Project, name: string): Project {
  const i = headIndex(project);
  const t = project.versions[i];
  if (!t) throw new Error("Nothing to save yet — build something first.");
  const v: Version = { ...t, id: uid(), createdAt: Date.now(), summary: name, keep: true };
  return {
    ...project,
    updatedAt: Date.now(),
    versions: trimVersions([...project.versions, v]),
    headId: v.id,
  };
}

/** Restoring a checkpoint is restoreVersion — it appends, so the restored state becomes
 *  the newest version and reaches every device by the same rule. Named separately only
 *  so callers read as what they mean. */
export const restoreCheckpoint = restoreVersion;

// ---------------------------------------------------------------------------
// The build log: this history, written so a language model can read it.
//
// Every edit in this app already records a version with a human summary ("Added a
// ⌀4 mm screw hole", "Adjusted wall thickness — 60 × 40 × 24 mm"). The model never
// saw any of it: it got the CURRENT code and the last few chat bubbles, so it knew
// what the part is but not how it got there — and "put it back to before the screw
// hole" referred to something outside its world entirely.
//
// One formatter, used for BOTH jobs — the log pasted into the CAD system prompt, and
// the log the revert resolver picks a step from. Sharing it is the point: the step
// numbers the model answers with are the step numbers it was shown.

export interface LogEntry {
  /** 1-based position in the WINDOW shown — what the model cites. */
  n: number;
  id: string;
  summary: string;
  /** The version the model on screen is at right now. */
  current: boolean;
  /** A version the user named and saved (History marks these too). */
  keep?: boolean;
  /** Recorded after the current one: a redo branch the user has stepped back past. */
  ahead: boolean;
}

/** How many steps the model is shown. Enough to cover a working session's worth of
 *  edits without spending a thousand tokens on a log every single turn. */
export const LOG_WINDOW = 14;

/** The recent history as numbered entries, oldest first. Pure. */
export function buildLog(project: Project, max = LOG_WINDOW): LogEntry[] {
  const head = headIndex(project);
  const all = project.versions;
  const from = Math.max(0, all.length - max);
  return all.slice(from).map((v, i) => ({
    n: i + 1,
    id: v.id,
    summary: v.summary,
    current: from + i === head,
    keep: v.keep,
    ahead: from + i > head,
  }));
}

/** Render entries as the plain text a model reads. `truncated` adds the one line that
 *  stops it assuming step 1 is the beginning of the part's life. */
export function formatBuildLog(entries: LogEntry[], truncated = false): string {
  const lines = entries.map((e) => {
    const marks = [
      e.current ? "← ON SCREEN NOW" : "",
      e.ahead ? "(undone — still redoable)" : "",
      e.keep ? "(saved version)" : "",
    ].filter(Boolean).join(" ");
    return `${e.n}. ${e.summary}${marks ? `  ${marks}` : ""}`;
  });
  return (truncated ? "(earlier steps not shown)\n" : "") + lines.join("\n");
}

/** The log for a project, formatted, or "" when there is nothing worth showing.
 *  One version is just "the part exists" — no history to reason about yet. */
export function buildLogText(project: Project | null | undefined, max = LOG_WINDOW): string {
  if (!project || project.versions.length < 2) return "";
  return formatBuildLog(buildLog(project, max), project.versions.length > max);
}
