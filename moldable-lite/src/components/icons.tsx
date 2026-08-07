// Central minimal line-icon set — the app's entire iconography (no emojis).
// 24px grid, 1.8px stroke, currentColor.

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const IconPaperclip = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...base} strokeWidth={2}>
    <path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);
export const IconArrowUp = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} strokeWidth={2.2}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
/* Export: an arrow leaving an open tray. */
export const IconExport = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    <path d="M12 15V4M8 8l4-4 4 4" />
  </svg>
);
export const IconUser = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" {...base}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="10" r="3" />
    <path d="M6.2 19a6.5 6.5 0 0 1 11.6 0" />
  </svg>
);
export const IconMoon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" {...base}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
);
export const IconSun = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" {...base}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
export const IconFolder = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" {...base}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.4h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
);
export const IconX = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2.2}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
export const IconCheck = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2.4}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
export const IconChevron = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
/** Improve-this-description. A four-point star with a smaller companion — the
 *  established "let the model rewrite this" mark, drawn on the set's own grid rather
 *  than borrowed as an emoji. */
export const IconSparkle = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M12 3.5c.9 3.6 1.9 4.6 5.5 5.5-3.6.9-4.6 1.9-5.5 5.5-.9-3.6-1.9-4.6-5.5-5.5 3.6-.9 4.6-1.9 5.5-5.5Z" />
    <path d="M17.5 15c.4 1.7.9 2.2 2.6 2.6-1.7.4-2.2.9-2.6 2.6-.4-1.7-.9-2.2-2.6-2.6 1.7-.4 2.2-.9 2.6-2.6Z" />
  </svg>
);
export const IconGlobe = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
  </svg>
);
export const IconReset = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" {...base} strokeWidth={2}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);
// ---- Viewer-toolbar icons (15px in `sm` buttons; labels collapse at narrow widths) ----

export const IconUndo = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);
export const IconRedo = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </svg>
);
/** Classic selection-tool cursor arrow. */
export const IconPointer = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M5 3l7.4 17.5 2.2-7.2 7.2-2.4Z" />
  </svg>
);
/** Shape tool: a cube with a cylinder and ball beside it. */
export const IconShapes = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.7}>
    <path d="M3.2 8.6 8 6.2l4.8 2.4v5.2L8 16.2l-4.8-2.4Z" />
    <path d="M8 11.4v4.8M3.2 8.6 8 11.4l4.8-2.8" />
    <circle cx="18.2" cy="6.6" r="3.1" />
    <path d="M15.3 15.1c0-1 1.3-1.8 2.9-1.8s2.9.8 2.9 1.8v4.2c0 1-1.3 1.8-2.9 1.8s-2.9-.8-2.9-1.8Z" />
  </svg>
);
/* The three primitives the Shape tool drops. Drawn as SOLIDS in the same isometric
   projection, not as flat squares and circles: the panel is asking "which lump", and a
   plain circle beside a plain square reads as a 2D sketch palette. */
export const IconPrimBox = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.7}>
    <path d="M12 2.8 20.6 7.4v9.2L12 21.2 3.4 16.6V7.4Z" />
    <path d="M12 21.2V12M3.4 7.4 12 12l8.6-4.6" />
  </svg>
);
export const IconPrimCylinder = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.7}>
    <ellipse cx="12" cy="6.3" rx="8.3" ry="3.5" />
    <path d="M3.7 6.3v11.4c0 1.93 3.72 3.5 8.3 3.5s8.3-1.57 8.3-3.5V6.3" />
  </svg>
);
export const IconPrimBall = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.7}>
    {/* A hair smaller than the cube's 17.2 span: at equal measured width a circle reads
        bigger than a square, and the three tiles have to look the same size. */}
    <circle cx="12" cy="12" r="8.6" />
    {/* Near half of the equator only — a full ellipse makes it a globe. */}
    <path d="M3.4 12a8.6 3.2 0 0 1 17.2 0" />
  </svg>
);
/** Modify tool: a face pulled up out of a slab. */
export const IconModify = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M4 15.5h16v5H4Z" />
    <path d="M8.5 15.5v-4.5h7v4.5" />
    <path d="M12 8V2.5M9.3 5.2 12 2.5l2.7 2.7" />
  </svg>
);
/** Four-way move arrows — the transform tool. */
export const IconTransform = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M12 2v20M2 12h20" />
    <path d="m8.5 5.5 3.5-3.5 3.5 3.5M8.5 18.5 12 22l3.5-3.5M5.5 8.5 2 12l3.5 3.5M18.5 8.5 22 12l-3.5 3.5" />
  </svg>
);
/** Mark tool: a pen circling a region. */
export const IconMarker = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M4.5 14.5a7.5 5.5 0 0 1 10-5" strokeDasharray="2.6 2.6" />
    <path d="M4.5 14.5a7.5 5.5 0 0 0 9.5 5.3" strokeDasharray="2.6 2.6" />
    <path d="M17.5 5.5a1.9 1.9 0 0 1 2.7 2.7L12 16.4l-3.6.9.9-3.6Z" />
  </svg>
);
/** A screw seen from the side: slotted head, tapering threaded shank. */
export const IconScrew = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M8 3h8l-1 4H9L8 3ZM12 2v2" />
    <path d="M9.5 7h5L13 21h-2L9.5 7Z" />
    <path d="M10 10.5h4M10.5 13.5h3M11 16.5h2" />
  </svg>
);
/** A ribbon badge — the logo layer. */
export const IconBadge = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <circle cx="12" cy="9" r="6" />
    <path d="M8.5 14 7 22l5-3 5 3-1.5-8" />
  </svg>
);
/** Two anchor points joined by a distance line — what the tool actually does
 *  (tap two points, read the span). The old diagonal ruler's tick marks turned
 *  to mush at rail size. */
export const IconRuler = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <circle cx="5.6" cy="18.4" r="2.5" />
    <circle cx="18.4" cy="5.6" r="2.5" />
    <path d="M7.6 16.4 16.4 7.6" />
    <path d="m10.2 10.8 1.5 1.5M12.8 8.2l1.5 1.5" opacity=".55" />
  </svg>
);
/** A dimension line with end ticks. */
export const IconDims = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M3 5v14M21 5v14M3 12h18" />
    <path d="m7 9-4 3 4 3M17 9l4 3-4 3" />
  </svg>
);
/** Isometric wire cube. */
export const IconWireframe = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.6}>
    <path d="M12 3 4 7.5v9L12 21l8-4.5v-9Z" />
    <path d="M4 7.5 12 12l8-4.5M12 12v9" />
  </svg>
);
export const IconStats = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2}>
    <path d="M5 20v-6M11 20V6M17 20v-9M3 20h18" />
  </svg>
);
/** Frame-with-dot — re-frame / reset the view. */
export const IconFrame = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3" />
    <circle cx="12" cy="12" r="2.2" />
  </svg>
);

/** Select-mode glyphs: a face (surface), an edge, a corner, a point on the model. */
export const IconFaceSel = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5Z" />
    <path d="M4 8.5 12 13l8-4.5M12 13v7" opacity=".35" />
  </svg>
);
export const IconEdgeSel = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5Z" opacity=".35" />
    <path d="M12 13v7" strokeWidth={2.6} />
    <path d="M4 8.5 12 13l8-4.5" opacity=".35" />
  </svg>
);
export const IconCornerSel = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5ZM4 8.5 12 13l8-4.5M12 13v7" opacity=".35" />
    <circle cx="12" cy="13" r="2.6" fill="currentColor" stroke="none" />
  </svg>
);
export const IconPointSel = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
  </svg>
);
export const IconRotate = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2}>
    <path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <path d="M20 2.5V7h-4.5" />
  </svg>
);
export const IconScale = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M14 3h7v7M10 21H3v-7M21 3l-8 8M3 21l8-8" />
  </svg>
);

// Viewer-tab icons — shown beside the tab label; the label collapses on narrow
// viewer columns (iPad) so these must read alone. Same 24px/1.8 line style.
export const IconCube = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5Z" />
    <path d="M4 8.5 12 13l8-4.5M12 13v7" />
  </svg>
);
export const IconCode = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16" />
  </svg>
);
export const IconSliders = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M3 6h18M3 12h18M3 18h18" opacity=".35" />
    <circle cx="9" cy="6" r="2.4" fill="var(--bg, #fff)" />
    <circle cx="15" cy="12" r="2.4" fill="var(--bg, #fff)" />
    <circle cx="7" cy="18" r="2.4" fill="var(--bg, #fff)" />
  </svg>
);
export const IconPrinter = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M7 8V3h10v5M7 16H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-3" />
    <path d="M7 13h10v8H7Z" />
  </svg>
);
export const IconHistory = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" />
    <path d="M3.5 3.5v5h5" />
    <path d="M12 8v4.5l3 2" />
  </svg>
);

/** Paint tool: a tilted paint bucket pouring a drop. */
export const IconPaint = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M11.5 3.5 4 11l6.5 6.5a2 2 0 0 0 2.8 0L19 12 11.5 3.5Z" />
    <path d="M4 11l7-1.5" opacity=".5" />
    <path d="M20.5 15.5c0 1.1-.9 2-2 2s-2-.9-2-2 2-3 2-3 2 1.9 2 3Z" fill="currentColor" stroke="none" />
  </svg>
);

/** A checkerboard swatch — the 3D convention for "texture". The old zigzag lines
 *  read as a broken image icon. */
export const IconTexturize = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <path d="M12 3.5v17M3.5 12h17" opacity=".6" />
    <path d="M4.5 4.5h7v7h-7zM12.5 12.5h7v7h-7z" fill="currentColor" fillOpacity=".22" stroke="none" />
  </svg>
);

export const IconPlay = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <circle cx="12" cy="12" r="9.2" />
    <path d="M10 8.6v6.8l5.6-3.4Z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconMagnet = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M5 4v7a7 7 0 0 0 14 0V4" />
    <path d="M5 4h5v5H5zM14 4h5v5h-5z" fill="currentColor" fillOpacity=".18" />
  </svg>
);

/** A hex nut — the umbrella glyph for the Fasteners tool (magnets AND screws).
 *  The horseshoe stays on Snap and the Magnet sub-tool; alone on the rail it
 *  promised only magnets. */
export const IconFastener = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M12 2.8l7.6 4.4v9.6L12 21.2 4.4 16.8V7.2Z" />
    <circle cx="12" cy="12" r="3.4" />
  </svg>
);

export const IconLayers = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <path d="M12 3 3 8l9 5 9-5-9-5Z" />
    <path d="m3 12.5 9 5 9-5M3 17l9 5 9-5" opacity=".45" />
  </svg>
);

export const IconMic = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
  </svg>
);

export const IconHelp = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8}>
    <circle cx="12" cy="12" r="9.2" />
    <path d="M9.3 9.2a2.8 2.8 0 1 1 4 3.6c-.8.6-1.3 1-1.3 2" />
    <circle cx="12" cy="17.6" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

export const IconGitHub = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
);
export const IconGoogle = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81Z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.29v3.1A12 12 0 0 0 12 24Z" />
    <path fill="#FBBC05" d="M5.29 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.29a12 12 0 0 0 0 10.78l4-3.1Z" />
    <path fill="#EA4335" d="M12 4.76c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.61l4 3.1C6.23 6.87 8.88 4.76 12 4.76Z" />
  </svg>
);
/** Pen cut — a blade drawing its own line across the part. */
/** Scissors — "cut" at a glance. The old pen nib + dashed curve read as a second
 *  marker tool next to Mark. */
export const IconCut = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" {...base}>
    <circle cx="6" cy="6.2" r="2.7" />
    <circle cx="6" cy="17.8" r="2.7" />
    <path d="M8.4 7.6 20.5 16M8.4 16.4 20.5 8" />
    <circle cx="12.6" cy="12" r=".9" fill="currentColor" stroke="none" />
  </svg>
);
/** Plan mode — a short checked list. */
export const IconChecklist = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2}>
    <path d="M4 6.5 6 8.5 9.5 5M4 17.5 6 19.5 9.5 16" />
    <path d="M13 7h7M13 18h7" />
  </svg>
);
