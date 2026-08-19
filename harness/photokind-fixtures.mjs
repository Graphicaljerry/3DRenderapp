// Fixture pictures for the sketch-vs-photo classifier, drawn in the page so the test set
// is reproducible from source rather than a folder of binaries nobody can regenerate.
//
// Each entry names what a person would call the picture, so a disagreement between `want`
// and what photoKind() says is a real disagreement about the world, not about a threshold.
// The hard ones are deliberate: a grey part photographed on white paper is the picture the
// app's own advice asks for and must never read as a drawing, and a pencil sketch that has
// been SHADED must still read as one.

export const FIXTURES = `
// Every function paints into a 2D context sized w x h.
const noise = (ctx, w, h, amt) => {
  const d = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) {
    const n = (Math.random() - 0.5) * amt;
    d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n;
  }
  ctx.putImageData(d, 0, 0);
};
const paper = (ctx, w, h, tint) => {
  ctx.fillStyle = tint; ctx.fillRect(0, 0, w, h);
  // Photographed paper is never evenly lit.
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.10)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
};
const dimLine = (ctx, x1, y1, x2, y2, label) => {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  for (const [x, y, s] of [[x1, y1, 1], [x2, y2, -1]]) {
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x + s * 9, y - 4); ctx.lineTo(x + s * 9, y + 4); ctx.closePath(); ctx.fill();
  }
  ctx.save(); ctx.font = "22px sans-serif";
  ctx.fillText(label, (x1 + x2) / 2 - 26, y1 - 8); ctx.restore();
};

globalThis.FIXTURES = {
  // ---- drawings ----------------------------------------------------------------
  "pen on white": (ctx, w, h) => {
    paper(ctx, w, h, "#fdfdfb");
    ctx.strokeStyle = "#1b1b22"; ctx.fillStyle = "#1b1b22"; ctx.lineWidth = 3;
    ctx.strokeRect(160, 150, 420, 260);
    ctx.beginPath(); ctx.arc(250, 240, 34, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(490, 240, 34, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(160, 330); ctx.lineTo(580, 330); ctx.stroke();
    dimLine(ctx, 160, 470, 580, 470, "84 mm");
    dimLine(ctx, 640, 150, 640, 410, "52 mm");
    noise(ctx, w, h, 6);
  },
  "pencil sketch, shaded": (ctx, w, h) => {
    paper(ctx, w, h, "#f7f5ef");
    ctx.strokeStyle = "#4a4a52"; ctx.fillStyle = "#4a4a52"; ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(180, 420); ctx.lineTo(200, 170); ctx.lineTo(520, 150); ctx.lineTo(560, 400);
    ctx.closePath(); ctx.stroke();
    // Hatching — the shading that makes a drawing look tonal without becoming an object.
    ctx.lineWidth = 1.3;
    for (let x = 210; x < 520; x += 9) {
      ctx.beginPath(); ctx.moveTo(x, 400); ctx.lineTo(x + 40, 300); ctx.stroke();
    }
    dimLine(ctx, 180, 480, 560, 480, "70");
    noise(ctx, w, h, 10);
  },
  "graph paper": (ctx, w, h) => {
    paper(ctx, w, h, "#fbfcf8");
    ctx.strokeStyle = "#c8d8c8"; ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = "#20304a"; ctx.fillStyle = "#20304a"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(200, 400); ctx.lineTo(200, 200); ctx.lineTo(500, 200);
    ctx.lineTo(500, 260); ctx.lineTo(260, 260); ctx.lineTo(260, 400); ctx.closePath(); ctx.stroke();
    dimLine(ctx, 200, 460, 500, 460, "32 mm");
    noise(ctx, w, h, 5);
  },
  "whiteboard marker": (ctx, w, h) => {
    paper(ctx, w, h, "#f2f4f6");
    ctx.strokeStyle = "#123", ctx.fillStyle = "#123"; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(370, 280, 130, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(240, 280); ctx.lineTo(500, 280); ctx.stroke();
    ctx.font = "30px sans-serif"; ctx.fillText("M4 x2", 300, 210);
    noise(ctx, w, h, 12);
  },

  // ---- photographs -------------------------------------------------------------
  // The one the app's own advice asks for, and the classifier's hardest case: no colour,
  // a bright background, and only the shaded body of the part to say it is not a drawing.
  "grey part on white paper": (ctx, w, h) => {
    paper(ctx, w, h, "#f4f3f0");
    const g = ctx.createLinearGradient(180, 140, 560, 420);
    g.addColorStop(0, "#d2d2d4"); g.addColorStop(0.55, "#98989c"); g.addColorStop(1, "#5e5e64");
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.beginPath(); ctx.ellipse(390, 430, 220, 40, 0, 0, 7); ctx.fill();
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(180, 140, 380, 280, 26); ctx.fill();
    ctx.fillStyle = "#3a3a40";
    ctx.beginPath(); ctx.arc(280, 250, 30, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(460, 250, 30, 0, 7); ctx.fill();
    noise(ctx, w, h, 14);
  },
  "part in a workshop": (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#6b5f4e"); g.addColorStop(1, "#2e2a24");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#8a5a2b";
    ctx.beginPath(); ctx.roundRect(150, 200, 420, 240, 18); ctx.fill();
    ctx.fillStyle = "#c8b487";
    ctx.beginPath(); ctx.arc(300, 320, 46, 0, 7); ctx.fill();
    noise(ctx, w, h, 22);
  },
  "bright product shot": (ctx, w, h) => {
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(360, 260, 20, 360, 260, 260);
    g.addColorStop(0, "#4f8fd0"); g.addColorStop(1, "#123a63");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(360, 280, 230, 170, 0, 0, 7); ctx.fill();
    noise(ctx, w, h, 10);
  },
  "dark object on a light table": (ctx, w, h) => {
    paper(ctx, w, h, "#eeeeea");
    ctx.fillStyle = "#26262a";
    ctx.beginPath(); ctx.roundRect(160, 120, 440, 320, 30); ctx.fill();
    ctx.fillStyle = "#3d3d44";
    ctx.beginPath(); ctx.arc(380, 280, 90, 0, 7); ctx.fill();
    noise(ctx, w, h, 12);
  },
  // No ink at all: a pale part on pale paper. Nothing crosses into the dark band, so the
  // stroke-thinness test has nothing to answer and the tonal body has to carry the verdict.
  "white part on white paper": (ctx, w, h) => {
    paper(ctx, w, h, "#f6f5f2");
    const g = ctx.createLinearGradient(180, 140, 560, 420);
    g.addColorStop(0, "#efeeea"); g.addColorStop(0.6, "#cfcec9"); g.addColorStop(1, "#b4b3ae");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(180, 140, 380, 280, 26); ctx.fill();
    noise(ctx, w, h, 10);
  },
  "close-up of a rough surface": (ctx, w, h) => {
    ctx.fillStyle = "#7d7468"; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = "rgba(" + (90 + Math.random() * 90) + "," + (80 + Math.random() * 80) + "," + (70 + Math.random() * 70) + ",0.6)";
      ctx.beginPath(); ctx.arc(Math.random() * w, Math.random() * h, 4 + Math.random() * 22, 0, 7); ctx.fill();
    }
    noise(ctx, w, h, 26);
  },
  // A drawing that arrived through a camera rather than a scanner: warm page, vignette,
  // softened strokes. Still a drawing.
  "printed drawing, photographed": (ctx, w, h) => {
    paper(ctx, w, h, "#efe9dc");
    ctx.strokeStyle = "#2a2b31"; ctx.fillStyle = "#2a2b31"; ctx.lineWidth = 2.2;
    ctx.strokeRect(200, 170, 360, 210);
    ctx.beginPath(); ctx.moveTo(200, 275); ctx.lineTo(560, 275); ctx.stroke();
    ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(380, 170); ctx.lineTo(380, 380); ctx.stroke();
    ctx.setLineDash([]);
    dimLine(ctx, 200, 440, 560, 440, "112");
    const v = ctx.createRadialGradient(w / 2, h / 2, h / 3, w / 2, h / 2, h);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 16);
  },
  // A night photograph: almost all ink, with bright specular highlights scattered through
  // it. Every dark pixel next to a highlight looks like a stroke edge, so this is what
  // keeps the thinness test from calling any high-contrast photograph a drawing.
  "night photo with highlights": (ctx, w, h) => {
    ctx.fillStyle = "#101014"; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      const r = 1 + Math.random() * 3;
      ctx.fillStyle = "rgba(250,250,245," + (0.5 + Math.random() * 0.5) + ")";
      ctx.beginPath(); ctx.arc(Math.random() * w, Math.random() * h, r, 0, 7); ctx.fill();
    }
    noise(ctx, w, h, 14);
  },
  // Faint 2H pencil: the strokes survive as grey rather than black once the picture is
  // downsampled, which is the reason the mark band reaches well above true black.
  "faint pencil on paper": (ctx, w, h) => {
    paper(ctx, w, h, "#faf8f2");
    ctx.strokeStyle = "#8d8b86"; ctx.lineWidth = 2;
    ctx.strokeRect(190, 160, 380, 240);
    ctx.beginPath(); ctx.arc(290, 250, 40, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(470, 250, 40, 0, 7); ctx.stroke();
    ctx.strokeStyle = "#7c7a76"; ctx.fillStyle = "#7c7a76";
    dimLine(ctx, 190, 450, 570, 450, "60");
    noise(ctx, w, h, 8);
  },
};
`;

/** name → what a person would call it. */
export const WANT = {
  "pen on white": "sketch",
  "pencil sketch, shaded": "sketch",
  "graph paper": "sketch",
  "whiteboard marker": "sketch",
  "grey part on white paper": "photo",
  "part in a workshop": "photo",
  "bright product shot": "photo",
  "dark object on a light table": "photo",
  "white part on white paper": "photo",
  "close-up of a rough surface": "photo",
  "printed drawing, photographed": "sketch",
  "night photo with highlights": "photo",
  "faint pencil on paper": "sketch",
};
