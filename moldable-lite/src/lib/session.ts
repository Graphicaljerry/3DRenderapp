/** Whether a reload should drop you back into the part you had open, or take you home.
 *
 *  Two behaviours people expect from the same gesture, and the difference is only time:
 *  hitting refresh while working should keep the part on screen the way every other
 *  engineering tool does; opening the app after lunch, or the next morning, should land
 *  on the Launchpad rather than in whatever was open last. So this is not a flag — it is
 *  a freshness window over the last time the app was actually TOUCHED.
 *
 *  Stamped on real interaction rather than on save: rotating and inspecting a model for
 *  ten minutes without editing it is still using it, and a save-based stamp would call
 *  that session stale. */
const KEY = "moldable_last_active";

/** Anything longer than a meeting or a lunch break counts as a new sitting. Overnight and
 *  next-day always land on the Launchpad, which is the case that prompted this. */
export const RESUME_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Writes are throttled — this is called from pointer and key handlers, and localStorage
 *  is synchronous, so stamping every event would put a disk write in the input path. */
let lastWrite = 0;
const THROTTLE_MS = 30_000;

export function markActive(force = false): void {
  const now = Date.now();
  if (!force && now - lastWrite < THROTTLE_MS) return;
  lastWrite = now;
  try { localStorage.setItem(KEY, String(now)); } catch { /* private mode — resume just won't offer */ }
}

/** Leaving for the Launchpad, or signing out, ends the sitting deliberately: the next
 *  load must not undo that decision by resuming. */
export function clearActive(): void {
  lastWrite = 0;
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

/** Is the last sitting recent enough to walk straight back into? */
export function sessionIsFresh(now = Date.now()): boolean {
  try {
    const t = Number(localStorage.getItem(KEY));
    return Number.isFinite(t) && t > 0 && now - t < RESUME_WINDOW_MS;
  } catch { return false; }
}

/** How long ago, in whole minutes — for explaining the decision, not for making it. */
export function minutesSinceActive(now = Date.now()): number | null {
  try {
    const t = Number(localStorage.getItem(KEY));
    if (!Number.isFinite(t) || t <= 0) return null;
    return Math.floor((now - t) / 60000);
  } catch { return null; }
}
