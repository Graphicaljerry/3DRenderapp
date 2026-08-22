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
  /** The decoration state — REQUIRED KEYS, `undefined` allowed as a value.
   *
   *  A version records the WHOLE model, and these four ride on every model no matter
   *  which edit triggered the save. "A snapshot writer forgot a field" has shipped as a
   *  fix seven separate times — each time as one more patched call site — because these
   *  were optional: an omission compiled clean and silently erased the user's logos or
   *  colours from the version AND (via the project-root spread) from the live project.
   *  Required keys turn the eighth occurrence into a compile error: a writer must now
   *  SAY `logos: undefined` to drop them, and can no longer simply forget. App.tsx's
   *  decorSnap() is the way to say "whatever is live on the model right now". */
  surfFx: { pattern: SurfFxSnap | null; texture: SurfFxSnap | null } | undefined;
  texts: TextLayerSnap[] | undefined;
  logos: LogoLayerSnap[] | undefined;
  partColors: Record<string, string> | undefined;
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
    // The content is being replaced, so a `restoredFrom` inherited from the step this is
    // overwriting would point at a snapshot this version no longer holds — and would keep
    // the origin row un-clickable for a model that has since been edited away from it.
    restoredFrom: undefined,
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

/** The snapshot a row really stands for. A restore step is a copy of an older version,
 *  so for every question that matters — "is the model already here?", "is this the same
 *  place I just came from?" — it counts as that older version, not as itself. */
export function originOf(v: Version): string {
  return v.restoredFrom ?? v.id;
}

/** Is the model already showing what this row holds? True for the row itself AND for
 *  the restore step that put it on screen — without the second case, clicking the row
 *  you just restored looked like a fresh restore and recorded another one. */
export function alreadyAt(project: Project, versionId: string): boolean {
  const head = project.versions.find((v) => v.id === project.headId);
  const t = project.versions.find((v) => v.id === versionId);
  return !!head && !!t && originOf(head) === originOf(t);
}

/** Remember an id as deliberately gone, so no merge can bring it back. Bounded: the
 *  list rides the sync row, and only recent deletions can still be resurrected by a
 *  device that has been offline. */
function withDropped(project: Project, ids: string[]): string[] {
  return [...(project.dropped ?? []), ...ids].slice(-200);
}

/** Set a past snapshot as HEAD; records the restore as a new append-only version. Pure.
 *
 *  Appending — rather than just moving HEAD, as undo does — is what makes a restore
 *  TRAVEL: mergeProjects picks HEAD by which version was created last, so a restore that
 *  wrote no version would lose to any newer step on another device.
 *
 *  But a plain append per click is what filled the panel with near-identical rows: every
 *  visit to an old step left a permanent copy behind, and browsing five steps back left
 *  five. So when the step at the tip is ITSELF a restore that nothing has been built on
 *  since, this rewrites that one instead of stacking another beside it. Browsing history
 *  now leaves exactly one row — which is the truth about where the model is. */
export function restoreVersion(project: Project, versionId: string): Project {
  const t = project.versions.find((v) => v.id === versionId);
  if (!t) throw new Error("Version not found.");
  // A restore of a restore points at the ORIGINAL, so the chain never nests.
  const from = originOf(t);
  const tip = project.versions[project.versions.length - 1];
  // Superseding is only safe at the very tip: anything appended after this step (a real
  // edit) makes it part of the lineage, and an undo that walked HEAD off it means the
  // user is somewhere else entirely. A named checkpoint is never superseded.
  // And only when the snapshot the tip stands for is STILL in the list. Past 60 steps the
  // original can age out through trimVersions, at which point the restore step is the only
  // copy of that geometry left anywhere — dropping it would destroy it for good, on every
  // device, because `dropped` is a tombstone no merge can undo.
  const tipOriginLives = !!tip?.restoredFrom && project.versions.some((x) => x.id === tip.restoredFrom);
  const supersede = !!tip && tip.id === project.headId && !!tip.restoredFrom && !tip.keep && tipOriginLives
    ? tip.id
    : null;
  const v: Version = {
    id: uid(),
    createdAt: Date.now(),
    // The original wording, unchanged. Rewriting it to `Restored “…”` and then restoring
    // that produced `Restored “Restored “…””`; the tag below carries the fact instead.
    summary: t.summary,
    restoredFrom: from,
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
  const kept = supersede ? project.versions.filter((x) => x.id !== supersede) : project.versions;
  return {
    ...project,
    dropped: supersede ? withDropped(project, [supersede]) : project.dropped,
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
    versions: trimVersions([...kept, v]),
    headId: v.id,
  };
}

/** Why a version can't be removed, or null if it can.
 *
 *  The one place the rule lives. The History panel calls it to decide whether to offer a
 *  ✕ at all, and `deleteVersion` calls it again to enforce — so the control and the guard
 *  can never disagree about what is removable.
 *
 *  The sentences are real user-facing copy, not decoration: they surface when the two
 *  disagree in TIME rather than in logic — a press that lands just after an undo made
 *  that row the current one, say — and App reports whichever rule bit rather than
 *  failing silently. */
export function whyNotDeletable(project: Pick<Project, "versions" | "headId">, versionId: string): string | null {
  const v = project.versions.find((x) => x.id === versionId);
  if (!v) return "That step is no longer in this project.";
  // `originOf`, not the raw id: after a restore, TWO rows describe where the model is —
  // the step you went back to and the copy of it at the tip. Both read as Current, and
  // offering a remove control on one of them would both contradict that label and leave
  // the restore step pointing at a snapshot that no longer exists.
  const head = project.versions.find((x) => x.id === project.headId);
  if (head && originOf(head) === originOf(v)) return "This is the step you're on — go to another one first.";
  if (v.keep) return "This is a version you saved by name — History keeps those on purpose.";
  if (project.versions.length <= 1) return "A project keeps at least one step.";
  return null;
}

/** Remove one recorded step for good. Pure.
 *
 *  The blobs a version holds (its mesh, its imported file, its thumbnail) live inside the
 *  project record, so dropping it from the array is what frees them — the next putProject
 *  writes the smaller record. The tombstone is the part that makes it stick: see
 *  Project.dropped. */
export function deleteVersion(project: Project, versionId: string): Project {
  const why = whyNotDeletable(project, versionId);
  if (why) throw new Error(why);
  return {
    ...project,
    updatedAt: Date.now(),
    versions: project.versions.filter((v) => v.id !== versionId),
    dropped: withDropped(project, [versionId]),
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
  // `restoredFrom: undefined` explicitly. The spread copies HEAD, and if HEAD happens to
  // be a restore step the checkpoint would inherit its origin — which would tag a version
  // you named as "restored", and make `alreadyAt` treat the checkpoint as standing for
  // that older snapshot, so the older row could never be restored again.
  const v: Version = { ...t, id: uid(), createdAt: Date.now(), summary: name, keep: true, restoredFrom: undefined };
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
