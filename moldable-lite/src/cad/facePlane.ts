// The bit of geometry the hole tool and the viewer have to agree on: which axes a face
// lets you slide along, and how to stay ON the face once you have.

/** The axis the normal points most strongly along (0=x, 1=y, 2=z). */
export function faceAxis(n: readonly [number, number, number]): 0 | 1 | 2 {
  const a = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
  return a.indexOf(Math.max(a[0], a[1], a[2])) as 0 | 1 | 2;
}

/** The two axes you can move along without leaving the face. */
export function inPlaneAxes(n: readonly [number, number, number]): [number, number] {
  const k = faceAxis(n);
  return k === 0 ? [1, 2] : k === 1 ? [0, 2] : [0, 1];
}

/** Put `at` back on the plane through `anchor` with normal `n`, by moving the dominant
 *  axis and nothing else.
 *
 *  Every way of positioning a hole edits the two in-plane axes and leaves the third alone
 *  — a click on the face, a typed offset, an alignment onto another hole. On an
 *  axis-aligned face that is exactly right: the third coordinate is the same everywhere on
 *  the plane. On a TILTED face it varies with position, so leaving it behind pushes the
 *  point off the surface by (how far you moved × the tilt).
 *
 *  That is not cosmetic. The placed point becomes the draft's new anchor, and hover
 *  placement rejects any hit more than 0.8 mm off the draft's own plane — so on a face
 *  tilted ~28° the second or third click along it is silently ignored, and the tool looks
 *  dead. Measured on the phone stand's support before this existed: 1 of 4 clicks landed.
 *
 *  The dominant component is at least 1/√3, so this never divides by anything small.
 *  Corrections under a micron are left alone rather than written back: on a flat face that
 *  is floating-point dust from the tessellated normal, and applying it would nudge a
 *  coordinate that is currently exact. */
export function onFacePlane(
  at: readonly [number, number, number],
  anchor: readonly [number, number, number],
  n: readonly [number, number, number],
): [number, number, number] {
  const out: [number, number, number] = [at[0], at[1], at[2]];
  const k = faceAxis(n);
  let drift = 0;
  for (const a of inPlaneAxes(n)) drift += n[a] * (out[a] - anchor[a]);
  const corr = drift / n[k];
  if (Math.abs(corr) > 1e-6) out[k] = anchor[k] - corr;
  return out;
}
