// Tiny DOM helpers and the icon set.
type Attrs = Record<string, string | number | boolean | ((e: any) => void) | undefined | null>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, val] of Object.entries(attrs)) {
    if (val === undefined || val === null || val === false) continue;
    if (k.startsWith("on") && typeof val === "function") el.addEventListener(k.slice(2).toLowerCase(), val as EventListener);
    else if (k === "html") el.innerHTML = String(val);
    else if (k === "class") el.className = String(val);
    else if (val === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(val));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function clear(el: Element) { while (el.firstChild) el.removeChild(el.firstChild); }

const P: Record<string, string> = {
  select: '<path d="M6 3.5l12 7.2-5.2 1.3-2.4 5.3z"/>',
  start: '<circle cx="5.5" cy="12" r="2.2" fill="currentColor"/><path d="M8 12h12M16 8l4 4-4 4"/>',
  flex: '<path d="M3 19c7 0 5-14 12-14h6"/><path d="M5.5 15.5l2 1.6M9 9.5l2.2.9M14.4 4.4l.6 2.3"/>',
  board: '<rect x="3" y="6" width="18" height="9" rx="1"/><path d="M6 15v4M18 15v4"/>',
  measure: '<path d="M3.5 15.5l12-12 5 5-12 12z"/><path d="M7 12l2 2M10 9l1.5 1.5M13 6l2 2"/>',
  heights: '<path d="M3 19h18"/><path d="M4 15l6-5 4 3 6-6"/><path d="M17 7h3v3"/>',
  labels: '<path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8.5" cy="8.5" r="1.4" fill="currentColor"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>',
  file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
  open: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v1H3z"/><path d="M3 10h18l-2 9H5z"/>',
  save: '<path d="M5 3h11l4 4v14H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
  fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  flip: '<path d="M12 3v18"/><path d="M8.5 7L4 12l4.5 5M15.5 7L20 12l-4.5 5"/>',
  rotate: '<path d="M20 12a8 8 0 11-2.6-5.9"/><path d="M20 4v4.5h-4.5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/>',
  layers: '<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  zoomIn: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M10.5 7.5v6M7.5 10.5h6"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M7.5 10.5h6"/>',
  camera: '<path d="M4 8h3.5L9 5.5h6L16.5 8H20v11H4z"/><circle cx="12" cy="13.2" r="3.4"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M9 4v16"/>',
  details: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M15 4v16"/>',
  repeat: '<path d="M4 12a7 7 0 0112-5l3 3"/><path d="M19 4v6h-6"/><path d="M20 12a7 7 0 01-12 5l-3-3"/>',
  swap: '<path d="M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  spark: '<path d="M12 3.5v4.5M12 16v4.5M3.5 12H8M16 12h4.5M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  control: '<path d="M5 4v16M12 4v16M19 4v16"/><rect x="3" y="13" width="4" height="3" rx="1" fill="currentColor"/><rect x="10" y="7" width="4" height="3" rx="1" fill="currentColor"/><rect x="17" y="11" width="4" height="3" rx="1" fill="currentColor"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M4 19h16"/>',
};

export function icon(name: keyof typeof P | string, size = 18): string {
  return `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ""}</svg>`;
}

export function iconEl(name: string, size = 18): HTMLElement {
  const s = document.createElement("span");
  s.className = "ic-wrap";
  s.innerHTML = icon(name, size);
  return s;
}
