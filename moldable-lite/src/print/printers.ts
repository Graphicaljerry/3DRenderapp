// Curated printer build-volume presets (mm), from manufacturer spec pages.
// These are the well-established published volumes; a few flagship values can
// drift a few mm between revisions — the numbers stay editable after picking.

export interface PrinterPreset {
  brand: string;
  model: string;
  x: number;
  y: number;
  z: number;
  kind: "FDM" | "Resin";
}

export const PRINTERS: PrinterPreset[] = [
  // Bambu Lab
  { brand: "Bambu Lab", model: "A1 mini", x: 180, y: 180, z: 180, kind: "FDM" },
  { brand: "Bambu Lab", model: "A1", x: 256, y: 256, z: 256, kind: "FDM" },
  { brand: "Bambu Lab", model: "P1P", x: 256, y: 256, z: 256, kind: "FDM" },
  { brand: "Bambu Lab", model: "P1S", x: 256, y: 256, z: 256, kind: "FDM" },
  { brand: "Bambu Lab", model: "X1 Carbon", x: 256, y: 256, z: 256, kind: "FDM" },
  { brand: "Bambu Lab", model: "H2D", x: 350, y: 320, z: 325, kind: "FDM" },
  { brand: "Bambu Lab", model: "H2S", x: 340, y: 320, z: 340, kind: "FDM" },
  // Prusa
  { brand: "Prusa", model: "MINI+", x: 180, y: 180, z: 180, kind: "FDM" },
  { brand: "Prusa", model: "MK3S+", x: 250, y: 210, z: 210, kind: "FDM" },
  { brand: "Prusa", model: "MK4S", x: 250, y: 210, z: 220, kind: "FDM" },
  { brand: "Prusa", model: "CORE One", x: 250, y: 220, z: 270, kind: "FDM" },
  { brand: "Prusa", model: "XL", x: 360, y: 360, z: 360, kind: "FDM" },
  // Creality
  { brand: "Creality", model: "Ender-3 V2", x: 220, y: 220, z: 250, kind: "FDM" },
  { brand: "Creality", model: "Ender-3 S1", x: 220, y: 220, z: 270, kind: "FDM" },
  { brand: "Creality", model: "Ender-3 V3", x: 220, y: 220, z: 250, kind: "FDM" },
  { brand: "Creality", model: "Ender-3 V3 KE", x: 220, y: 220, z: 240, kind: "FDM" },
  { brand: "Creality", model: "Ender-5 S1", x: 220, y: 220, z: 280, kind: "FDM" },
  { brand: "Creality", model: "K1", x: 220, y: 220, z: 250, kind: "FDM" },
  { brand: "Creality", model: "K1C", x: 220, y: 220, z: 250, kind: "FDM" },
  { brand: "Creality", model: "K1 Max", x: 300, y: 300, z: 300, kind: "FDM" },
  { brand: "Creality", model: "K2 Plus", x: 350, y: 350, z: 350, kind: "FDM" },
  { brand: "Creality", model: "CR-10 SE", x: 220, y: 220, z: 265, kind: "FDM" },
  // Anycubic
  { brand: "Anycubic", model: "Kobra 2", x: 220, y: 220, z: 250, kind: "FDM" },
  { brand: "Anycubic", model: "Kobra 3", x: 250, y: 250, z: 260, kind: "FDM" },
  { brand: "Anycubic", model: "Kobra 2 Max", x: 420, y: 420, z: 500, kind: "FDM" },
  { brand: "Anycubic", model: "Photon Mono M5s", x: 218, y: 123, z: 200, kind: "Resin" },
  { brand: "Anycubic", model: "Photon Mono 4 Ultra", x: 153, y: 87, z: 165, kind: "Resin" },
  // Elegoo
  { brand: "Elegoo", model: "Neptune 4", x: 225, y: 225, z: 265, kind: "FDM" },
  { brand: "Elegoo", model: "Neptune 4 Pro", x: 225, y: 225, z: 265, kind: "FDM" },
  { brand: "Elegoo", model: "Neptune 4 Max", x: 420, y: 420, z: 480, kind: "FDM" },
  { brand: "Elegoo", model: "Centauri Carbon", x: 256, y: 256, z: 256, kind: "FDM" },
  { brand: "Elegoo", model: "Mars 4 Ultra", x: 153, y: 77, z: 165, kind: "Resin" },
  { brand: "Elegoo", model: "Saturn 4 Ultra", x: 219, y: 123, z: 220, kind: "Resin" },
  // Sovol
  { brand: "Sovol", model: "SV06", x: 220, y: 220, z: 250, kind: "FDM" },
  { brand: "Sovol", model: "SV06 Plus", x: 300, y: 300, z: 340, kind: "FDM" },
  { brand: "Sovol", model: "SV08", x: 350, y: 350, z: 350, kind: "FDM" },
  // Snapmaker
  { brand: "Snapmaker", model: "U1", x: 270, y: 270, z: 270, kind: "FDM" },
  // Qidi
  { brand: "Qidi", model: "X-Plus 3", x: 280, y: 280, z: 270, kind: "FDM" },
  { brand: "Qidi", model: "X-Max 3", x: 325, y: 325, z: 315, kind: "FDM" },
  // Flashforge
  { brand: "Flashforge", model: "Adventurer 5M", x: 220, y: 220, z: 220, kind: "FDM" },
  { brand: "Flashforge", model: "Adventurer 5M Pro", x: 220, y: 220, z: 220, kind: "FDM" },
  // Others
  { brand: "AnkerMake", model: "M5", x: 235, y: 235, z: 250, kind: "FDM" },
  { brand: "Ultimaker", model: "S3", x: 230, y: 190, z: 200, kind: "FDM" },
  { brand: "Ultimaker", model: "S5", x: 330, y: 240, z: 300, kind: "FDM" },
  { brand: "Raise3D", model: "Pro3", x: 300, y: 300, z: 300, kind: "FDM" },
  { brand: "Voron", model: "0.2", x: 120, y: 120, z: 120, kind: "FDM" },
  { brand: "Voron", model: "2.4 (300)", x: 300, y: 300, z: 300, kind: "FDM" },
  { brand: "Voron", model: "2.4 (350)", x: 350, y: 350, z: 350, kind: "FDM" },
  { brand: "Formlabs", model: "Form 4", x: 200, y: 125, z: 210, kind: "Resin" },
];

export const PRINTER_BRANDS = [...new Set(PRINTERS.map((p) => p.brand))];
export const printerKey = (p: PrinterPreset) => `${p.brand} ${p.model}`;
