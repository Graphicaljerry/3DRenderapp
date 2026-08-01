// Card art for the SCULPT templates.
//
// These are drawings, not renders — and deliberately so. A mesh template is a prompt,
// and the engine returns something different every run, so a photo-real thumbnail would
// be a promise the card cannot keep (and capturing one would cost a real generation per
// card). Line art reads as "this is the idea", which is exactly what a prompt is.
//
// Stroke-based and currentColor throughout, so one set works in both themes.

const base = {
  viewBox: "0 0 64 64",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const SCULPT_GLYPHS: Record<string, JSX.Element> = {
  // Sitting cat: narrow haunched body, upright head, tail curled round the paws.
  "mesh-cat": (
    <svg {...base} aria-hidden>
      <path d="M24.5 27c-3.5 6-5 15-3.5 24h22c1.5-9 0-18-3.5-24" />
      <circle cx="32" cy="20" r="8.5" />
      <path d="M25.5 14.5 24 6.5l7.5 4M38.5 14.5 40 6.5l-7.5 4" />
      <path d="M43 51c6.5.5 9-5.5 4.5-9" />
      <path d="M29 19.5h.01M35 19.5h.01" strokeWidth="2.6" />
      <path d="M32 23.5v1.5M28.5 25h-6M35.5 25h6" strokeWidth="1.2" />
    </svg>
  ),
  // Dragon head in profile, facing left: muzzle, brow, swept horns, open jaw.
  "mesh-dragon": (
    <svg {...base} aria-hidden>
      <path d="M9 33.5 20 29c3-1.5 5.5-4 7.5-7 2.5-3.5 6-5 9.5-4.5 5 .5 8.5 4 9.5 9 .8 4 .5 8-1 11.5" />
      <path d="M45.5 45.5c-3 3.5-8 5-14 4.5-8-.7-15-4.5-20.5-10.5" />
      <path d="M11 39.5c4-1 8-1.5 12-1" />
      <path d="M38 18c4.5-5.5 11-8 17.5-6.5-5 1.5-8.5 4.5-10.5 8.5" />
      <path d="M33 19.5c3-4.5 7.5-7 12.5-7" strokeWidth="1.3" />
      <path d="M25.5 28.5h.01" strokeWidth="2.8" />
      <path d="M12.5 31.5h.01" strokeWidth="2.2" />
    </svg>
  ),
  // Skull: cranium, sockets, nasal notch, jaw.
  "mesh-skull-planter": (
    <svg {...base} aria-hidden>
      <path d="M14 30c0-11 8-19 18-19s18 8 18 19c0 6-2 10-5 13v7H21v-7c-3-3-7-7-7-13Z" />
      <path d="M22 29a4.5 5 0 1 0 9 0 4.5 5 0 1 0-9 0M33 29a4.5 5 0 1 0 9 0 4.5 5 0 1 0-9 0" />
      <path d="M32 36l-2.5 5h5L32 36ZM26 50v-4M32 50v-4M38 50v-4" />
    </svg>
  ),
  // Chess knight: stepped base, arched neck, muzzle, mane.
  "mesh-knight": (
    <svg {...base} aria-hidden>
      <path d="M18 56h28M21 51h22" />
      <path d="M26 51c0-7 2-10 4-14-6-2-9-8-6-14 2-5 7-8 12-10 1-2 1-4 0-6 3 2 6 5 8 9 3 7 3 15 0 22-2 5-4 8-4 13" />
      <path d="M24 25c3 0 5 1 6 3" />
      <path d="M30 17h.01" strokeWidth="2.8" />
    </svg>
  ),
  // Low-poly fox: faceted head, ears, sweeping tail — all straight segments on purpose.
  "mesh-fox": (
    <svg {...base} aria-hidden>
      <path d="M18 22 24 8l8 8 8-8 6 14-6 6 4 12-14 8-14-8 4-12Z" />
      <path d="m24 8 8 8M40 8l-8 8M18 22l14 6 14-6M32 28v12" />
      <path d="M46 42c8-2 12 6 8 12-3 4-9 4-12 0" />
    </svg>
  ),
  // Octopus: domed mantle, eyes, tentacles curling down into a base.
  "mesh-octopus": (
    <svg {...base} aria-hidden>
      <path d="M17 33c0-9 7-16 15-16s15 7 15 16c0 4-1 7-3 9H20c-2-2-3-5-3-9Z" />
      <path d="M27 29h.01M37 29h.01" strokeWidth="2.8" />
      <path d="M21 42c-4 3-8 4-11 8M27 43c-2 5-5 7-9 9M34 43c1 5 3 8 7 10M41 42c4 3 9 4 12 8" />
      <path d="M14 50c-2 2-3 4-3 6M50 50c2 2 3 4 3 6" />
    </svg>
  ),
};
