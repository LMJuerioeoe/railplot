// Decals: lettering, numbers, plates and emblems painted onto a model's sides. Models describe them
// (what, where, how big); the 3D view paints them into a texture with Canvas 2D and lays them on.

export type Logo =
  | "gwr-roundel" | "br-crest-early" | "br-crest-late" | "br-arrow" | "csd" | "obb" | "db" | "sbb" | "sncf"
  | "red-star" | "lightning" | "lner";

export interface Label {
  /** Text to paint (numbers, names, lettering). */
  text?: string;
  /** Or an emblem. */
  logo?: Logo;
  /** Ink and background (CSS colours); no background leaves the body showing round the letters. */
  color?: string;
  bg?: string;
  /** A rim round a plate. */
  border?: string;
  /** The lettering's style: the railway's own typefaces stand in for by similar system fonts. */
  font?: "sans" | "serif" | "condensed" | "plate";
  bold?: boolean;
  /** Round the plate's corners (in mm). */
  radius?: number;
  /** Shadowed (blocked) letters, as the GWR and LMS painted them. */
  shadow?: string;
}

const FONTS: Record<NonNullable<Label["font"]>, string> = {
  sans: '"Gill Sans", "Gill Sans MT", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  condensed: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif',
  plate: '"DIN Alternate", "DIN 1451", "Bahnschrift", "Arial Narrow", Arial, sans-serif',
};

/** Paint a label into a w × h pixel box at (x, y) of a 2D canvas context. */
export function paintLabel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, l: Label, pxPerMm: number) {
  g.save();
  g.translate(x, y);
  const r = (l.radius ?? 0) * pxPerMm;
  const box = () => { g.beginPath(); if (r > 0 && g.roundRect) g.roundRect(0, 0, w, h, r); else g.rect(0, 0, w, h); };
  if (l.bg) { box(); g.fillStyle = l.bg; g.fill(); }
  if (l.border) { box(); g.lineWidth = Math.max(1, h * 0.08); g.strokeStyle = l.border; g.stroke(); }
  if (l.logo) paintLogo(g, w, h, l);
  else if (l.text) {
    const pad = l.bg || l.border ? h * 0.14 : 0;
    let size = (h - 2 * pad) * 0.92;
    g.font = `${l.bold === false ? "500" : "700"} ${size}px ${FONTS[l.font ?? "sans"]}`;
    const tw = g.measureText(l.text).width;
    if (tw > w - 2 * pad) { size *= (w - 2 * pad) / tw; g.font = `${l.bold === false ? "500" : "700"} ${size}px ${FONTS[l.font ?? "sans"]}`; }
    g.textAlign = "center"; g.textBaseline = "middle";
    if (l.shadow) { g.fillStyle = l.shadow; g.fillText(l.text, w / 2 + size * 0.06, h / 2 + size * 0.07); }
    g.fillStyle = l.color ?? "#fff";
    g.fillText(l.text, w / 2, h / 2 + size * 0.04);
  }
  g.restore();
}

function star(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r : R; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  g.closePath();
}

function paintLogo(g: CanvasRenderingContext2D, w: number, h: number, l: Label) {
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2, ink = l.color ?? "#fff";
  const text = (t: string, size: number, col: string, y = cy, font = FONTS.sans, weight = "700") => {
    g.font = `${weight} ${size}px ${font}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = col; g.fillText(t, cx, y);
  };
  switch (l.logo) {
    case "gwr-roundel": {
      // the 1934 "shirt button": a gold ring round the interlaced G W R
      g.beginPath(); g.arc(cx, cy, R * 0.96, 0, Math.PI * 2); g.lineWidth = R * 0.12; g.strokeStyle = "#d9b45a"; g.stroke();
      g.beginPath(); g.arc(cx, cy, R * 0.8, 0, Math.PI * 2); g.lineWidth = R * 0.05; g.stroke();
      text("G", R * 0.62, "#d9b45a", cy - R * 0.02, FONTS.serif);
      text("W", R * 0.56, "#d9b45a", cy - R * 0.36, FONTS.serif); text("R", R * 0.56, "#d9b45a", cy + R * 0.36, FONTS.serif);
      break;
    }
    case "br-crest-early": {
      // the 1949 "cycling lion": a lion standing over a wheel
      g.strokeStyle = "#e8d9a8"; g.fillStyle = "#e8d9a8";
      g.beginPath(); g.arc(cx, cy + R * 0.25, R * 0.55, 0, Math.PI * 2); g.lineWidth = R * 0.1; g.stroke();
      for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; g.beginPath(); g.moveTo(cx, cy + R * 0.25); g.lineTo(cx + Math.cos(a) * R * 0.5, cy + R * 0.25 + Math.sin(a) * R * 0.5); g.lineWidth = R * 0.05; g.stroke(); }
      g.beginPath();   // the lion, side on, over the wheel
      g.moveTo(cx - R * 0.75, cy - R * 0.1); g.quadraticCurveTo(cx - R * 0.4, cy - R * 0.45, cx + R * 0.2, cy - R * 0.4);
      g.lineTo(cx + R * 0.45, cy - R * 0.85); g.lineTo(cx + R * 0.75, cy - R * 0.55); g.lineTo(cx + R * 0.55, cy - R * 0.3);
      g.lineTo(cx + R * 0.6, cy + R * 0.05); g.lineTo(cx - R * 0.65, cy + R * 0.05); g.closePath(); g.fill();
      break;
    }
    case "br-crest-late": {
      // the 1956 crest: a lion holding a wheel, rising from a crown, in a circle
      g.beginPath(); g.arc(cx, cy, R * 0.95, 0, Math.PI * 2); g.fillStyle = "#7a1a1a"; g.fill();
      g.lineWidth = R * 0.08; g.strokeStyle = "#e8c66a"; g.stroke();
      g.fillStyle = "#e8c66a";
      g.beginPath(); g.moveTo(cx - R * 0.5, cy + R * 0.45); g.lineTo(cx - R * 0.5, cy + R * 0.1); g.lineTo(cx - R * 0.25, cy + R * 0.3); g.lineTo(cx, cy + R * 0.05);
      g.lineTo(cx + R * 0.25, cy + R * 0.3); g.lineTo(cx + R * 0.5, cy + R * 0.1); g.lineTo(cx + R * 0.5, cy + R * 0.45); g.closePath(); g.fill();   // crown
      g.beginPath(); g.arc(cx, cy - R * 0.25, R * 0.3, 0, Math.PI * 2); g.lineWidth = R * 0.08; g.stroke();                                    // the wheel the lion holds
      break;
    }
    case "br-arrow": {
      // the 1965 double arrow: two arrows passing, joined by a diagonal
      const u = Math.min(w / 2.1, h) / 1;
      g.fillStyle = ink; g.save(); g.translate(cx, cy); g.scale(u / 100, u / 100);
      g.beginPath();
      g.moveTo(-100, -25); g.lineTo(45, -25); g.lineTo(5, -55); g.lineTo(35, -55); g.lineTo(85, -12); g.lineTo(-100, -12); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(100, 25); g.lineTo(-45, 25); g.lineTo(-5, 55); g.lineTo(-35, 55); g.lineTo(-85, 12); g.lineTo(100, 12); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-30, -12); g.lineTo(-5, -12); g.lineTo(30, 12); g.lineTo(5, 12); g.closePath(); g.fill();
      g.restore();
      break;
    }
    case "csd": {
      // ČSD: the letters in a circle
      g.beginPath(); g.arc(cx, cy, R * 0.94, 0, Math.PI * 2); g.fillStyle = l.bg ?? "#f2efe6"; g.fill();
      g.lineWidth = R * 0.12; g.strokeStyle = ink; g.stroke();
      text("ČSD", R * 0.62, ink, cy + R * 0.03, FONTS.serif);
      break;
    }
    case "obb": text("ÖBB", h * 0.9, ink, cy + h * 0.04, FONTS.sans, "800"); break;
    case "db": {
      g.lineWidth = h * 0.09; g.strokeStyle = ink;
      g.beginPath(); if (g.roundRect) g.roundRect(h * 0.06, h * 0.06, w - h * 0.12, h * 0.88, h * 0.18); else g.rect(h * 0.06, h * 0.06, w - h * 0.12, h * 0.88); g.stroke();
      text("DB", h * 0.62, ink, cy + h * 0.03);
      break;
    }
    case "sbb": {
      g.fillStyle = "#d52b1e"; g.fillRect(0, 0, h, h);
      g.fillStyle = "#fff"; g.fillRect(h * 0.4, h * 0.2, h * 0.2, h * 0.6); g.fillRect(h * 0.2, h * 0.4, h * 0.6, h * 0.2);
      g.font = `700 ${h * 0.55}px ${FONTS.sans}`; g.textAlign = "left"; g.textBaseline = "middle"; g.fillStyle = ink; g.fillText("SBB CFF FFS", h * 1.25, cy);
      break;
    }
    case "sncf": text("SNCF", h * 0.8, ink, cy, FONTS.sans, "800"); break;
    case "lner": text("L N E R", h * 0.85, ink, cy, FONTS.sans, "600"); break;
    case "red-star": star(g, cx, cy, R * 0.95, R * 0.4); g.fillStyle = "#d4161c"; g.fill(); g.lineWidth = R * 0.06; g.strokeStyle = "#f2c230"; g.stroke(); break;
    case "lightning": {
      // a yellow warning triangle with a black bolt
      g.beginPath(); g.moveTo(cx, h * 0.04); g.lineTo(w * 0.97, h * 0.94); g.lineTo(w * 0.03, h * 0.94); g.closePath();
      g.fillStyle = "#f6c700"; g.fill(); g.lineWidth = h * 0.07; g.strokeStyle = "#111"; g.stroke();
      g.beginPath(); g.moveTo(cx + w * 0.06, h * 0.32); g.lineTo(cx - w * 0.1, h * 0.62); g.lineTo(cx + w * 0.02, h * 0.62); g.lineTo(cx - w * 0.06, h * 0.86);
      g.lineTo(cx + w * 0.12, h * 0.54); g.lineTo(cx, h * 0.54); g.closePath(); g.fillStyle = "#111"; g.fill();
      break;
    }
  }
}
