// Two copies of one project, reconciled without losing work.
//
// This exists because of a real, reported data loss. A project lived in three storage
// containers at once — Safari, the home-screen web app (iOS gives an installed web app
// its OWN IndexedDB, separate from the browser's), and a desktop browser — and the rules
// for combining them were "whichever copy has the newer updatedAt replaces the other,
// whole". Two things then conspired:
//
//   1. The chat autosave rewrites a project every few seconds with a fresh updatedAt,
//      whether or not anything was edited. A stale copy left open makes itself "newest"
//      by sitting there.
//   2. A version list that loses is DELETED, and appendVersion drops everything after
//      HEAD — so once a stale HEAD landed, the next edit destroyed the newer history
//      permanently.
//
// The rule here is different and much duller: a merge never deletes a version. The two
// lists are unioned, HEAD is decided by which version is actually newer (not by which
// device wrote most recently), and the live fields follow HEAD. Worst case after a bad
// merge you have a longer History panel than you expected — every snapshot is still
// there to jump back to.
import type { Project, Version } from "./types";
import { trimVersions } from "./versions";

/** Blobs are stripped from a project before it goes to the cloud (they live in the
 *  bucket), so a copy arriving from sync has version records with no geometry. Keep
 *  whichever side actually holds the bytes. */
function meldVersion(mine: Version, theirs: Version): Version {
  return {
    ...mine,
    glb: mine.glb ?? theirs.glb,
    importFile: mine.importFile ?? theirs.importFile,
    thumb: mine.thumb ?? theirs.thumb,
  };
}

/** Every version either side has, oldest first. Ids come from uid(), so identity is
 *  reliable and "the same version" never means "the same array index" — which matters,
 *  because two devices editing in parallel produce lists of the same length that agree
 *  on nothing. */
function unionVersions(mine: Version[], theirs: Version[], dropped: Set<string>): Version[] {
  const byId = new Map<string, Version>();
  for (const v of theirs) byId.set(v.id, v);
  for (const v of mine) {
    const t = byId.get(v.id);
    byId.set(v.id, t ? meldVersion(v, t) : v);
  }
  // The ONE exception to "a merge never deletes": a step either side deliberately
  // removed. Without it, deleting a step here and syncing would hand it straight back
  // from the account — and a superseded restore step would reappear as the clutter it
  // was removed to stop. Both sides' lists apply, so the deletion travels either way.
  const all = [...byId.values()].filter((v) => !dropped.has(v.id)).sort((a, b) => a.createdAt - b.createdAt);
  // The cap is still the cap — but it now bites a merged list, so trim from the OLD end
  // only, and never a named checkpoint (trimVersions owns both rules).
  return trimVersions(all);
}

export interface MergeOpts {
  /** Keep `mine`'s HEAD even if the other side has a newer version. For the project
   *  that is OPEN on screen: folding in a sibling device's history is welcome, having
   *  the model swapped out from under a half-finished edit is not. */
  keepHead?: boolean;
}

/** Combine two copies of the same project. `mine` is this device's; `theirs` is the one
 *  that arrived (from the cloud, or from another tab that wrote to the same database).
 *  Pure — callers decide what to do with the result. */
export function mergeProjects(mine: Project, theirs: Project, opts: MergeOpts = {}): Project {
  const dropped = [...new Set([...(mine.dropped ?? []), ...(theirs.dropped ?? [])])].slice(-200);
  const versions = unionVersions(mine.versions ?? [], theirs.versions ?? [], new Set(dropped));
  const at = (id?: string) => (id ? versions.find((v) => v.id === id) : undefined);
  const myHead = at(mine.headId);
  const theirHead = at(theirs.headId);

  // HEAD by the version's OWN age, not by who wrote last. This is the line that stops a
  // stale copy from winning: sitting in a background tab bumps updatedAt, but it cannot
  // manufacture a version that was created later than one it never saw.
  let head = myHead;
  let fromMine = true;
  if (!opts.keepHead || !myHead) {
    if (!myHead && theirHead) { head = theirHead; fromMine = false; }
    else if (myHead && theirHead && theirHead.createdAt > myHead.createdAt) { head = theirHead; fromMine = false; }
  }
  if (!head) { head = versions[versions.length - 1]; fromMine = true; }

  // The live fields are a mirror of HEAD — appendVersion and navigateHead both maintain
  // that, and a merge has to as well or the model on screen stops matching the step the
  // History panel says you are on.
  const owner = fromMine ? mine : theirs;
  const other = fromMine ? theirs : mine;
  // Metadata that isn't part of the model lineage — name, folder, chat, plates — has no
  // version to arbitrate it, so the more recently touched copy keeps it.
  const recent = (mine.updatedAt ?? 0) >= (theirs.updatedAt ?? 0) ? mine : theirs;

  return {
    ...recent,
    id: mine.id,
    createdAt: Math.min(mine.createdAt ?? Date.now(), theirs.createdAt ?? Date.now()),
    updatedAt: Math.max(mine.updatedAt ?? 0, theirs.updatedAt ?? 0),
    versions,
    dropped: dropped.length ? dropped : undefined,
    headId: head?.id,
    engine: head?.engine ?? owner.engine,
    code: head?.code ?? owner.code,
    params: head?.params ?? owner.params,
    ops: head?.ops ?? owner.ops,
    spec: head?.spec ?? owner.spec,
    genSource: head?.genSource ?? owner.genSource,
    meshXform: head?.meshXform ?? owner.meshXform,
    importKind: head?.importKind ?? owner.importKind,
    // Geometry blobs: HEAD's own bytes if this device has them, else whatever either
    // copy is holding. A cloud copy carries none, so without the fallback adopting one
    // would blank a generative model that is sitting right here on disk.
    glb: head?.glb ?? owner.glb ?? other.glb,
    importFile: head?.importFile ?? owner.importFile ?? other.importFile,
    cloudMesh: owner.cloudMesh ?? other.cloudMesh,
    // Chat photos are on-device blobs — they never ride the sync row, so a copy that
    // arrived from the cloud carries none. Keyed by message id, so the two sides can
    // simply be unioned; taking `recent`'s alone would drop every full-resolution photo
    // on this device the moment a sibling device happened to save a second later.
    photos: mine.photos || theirs.photos ? { ...theirs.photos, ...mine.photos } : undefined,
  };
}

/** Did merging actually change this device's copy? Used to keep a quiet sync quiet —
 *  writing and announcing an identical project every cycle is how a sync loop starts. */
export function mergeChanged(before: Project, after: Project): boolean {
  if (before.headId !== after.headId) return true;
  if ((before.versions?.length ?? 0) !== (after.versions?.length ?? 0)) return true;
  return before.versions.some((v, i) => v.id !== after.versions[i]?.id);
}
