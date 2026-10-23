// File access: Tauri desktop app when available, otherwise the browser.
declare global {
  interface Window {
    __TAURI__?: {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<any> };
      dialog: {
        save: (o: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
        open: (o: { multiple?: boolean; filters?: { name: string; extensions: string[] }[] }) => Promise<string | string[] | null>;
      };
      window?: { getCurrentWindow: () => { setTitle: (t: string) => Promise<void> } };
      event?: { listen: <T>(name: string, cb: (e: { payload: T }) => void) => Promise<() => void> };
    };
    showSaveFilePicker?: (o: any) => Promise<any>;
  }
}

export const isDesktop = () => typeof window !== "undefined" && !!window.__TAURI__;
/** True when running inside a hosted web page that cannot download files. */
export const isHosted = () => typeof window !== "undefined" && !!(window as unknown as { RAILPLOT_HOSTED?: boolean }).RAILPLOT_HOSTED;

export interface Filter { name: string; extensions: string[]; mime: string }
export const LAYOUT_FILTER: Filter = { name: "Railplot layout", extensions: ["railplot", "json"], mime: "application/json" };

/**
 * Save through the hosting page's download capability (when Railplot runs inside a hosted page).
 * Returns "unavailable" when the host offers no way to save files.
 */
export async function hostedSave(name: string, data: Blob | string): Promise<Saved | null | "unavailable"> {
  const c = (window as unknown as { claude?: { use?: (n: string) => Promise<any> } }).claude;
  const dl = c?.use ? await c.use("downloads").catch(() => null) : null;
  if (!dl) return "unavailable";
  try {
    await dl.save({ filename: name, data });
    return { name };
  } catch (e: any) {
    if (e?.code === "declined") return null;
    if (e?.code === "rate_limited") throw new Error("Another save is still waiting for your answer.");
    if (["unavailable", "not_granted", "capability_disabled", "capability_removed"].includes(e?.code)) return "unavailable";
    throw new Error(e?.message ?? "The file couldn't be saved.");
  }
}

export interface Saved { path?: string; name: string }

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

async function browserSave(name: string, blob: Blob, filter: Filter): Promise<Saved | null> {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name, types: [{ description: filter.name, accept: { [filter.mime]: filter.extensions.map((e) => `.${e}`) } }],
      });
      const w = await handle.createWritable();
      await w.write(blob); await w.close();
      return { name: handle.name };
    } catch (e: any) {
      if (e?.name === "AbortError") return null;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return { name };
}

/** Save text. With a known desktop path and `ask` false, writes straight to it. */
export async function saveText(name: string, text: string, filter: Filter, path?: string, ask = true): Promise<Saved | null> {
  const T = window.__TAURI__;
  if (T) {
    let target = path;
    if (!target || ask) target = (await T.dialog.save({ defaultPath: path ?? name, filters: [{ name: filter.name, extensions: filter.extensions }] })) ?? undefined;
    if (!target) return null;
    await T.core.invoke("write_text_file", { path: target, contents: text });
    return { path: target, name: baseName(target) };
  }
  return browserSave(name, new Blob([text], { type: filter.mime }), filter);
}

export async function saveBlob(name: string, blob: Blob, filter: Filter): Promise<Saved | null> {
  const T = window.__TAURI__;
  if (T) {
    const target = await T.dialog.save({ defaultPath: name, filters: [{ name: filter.name, extensions: filter.extensions }] });
    if (!target) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await T.core.invoke("write_binary_file", { path: target, contents: Array.from(bytes) });
    return { path: target, name: baseName(target) };
  }
  return browserSave(name, blob, filter);
}

export async function openText(filter: Filter): Promise<{ name: string; text: string; path?: string } | null> {
  const T = window.__TAURI__;
  if (T) {
    const picked = await T.dialog.open({ multiple: false, filters: [{ name: filter.name, extensions: filter.extensions }] });
    const path = Array.isArray(picked) ? picked[0] : picked;
    if (!path) return null;
    const text: string = await T.core.invoke("read_text_file", { path });
    return { name: baseName(path), text, path };
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = filter.extensions.map((e) => `.${e}`).join(",") + ",application/json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      resolve({ name: f.name, text: await f.text() });
    };
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

export function setWindowTitle(t: string) {
  document.title = t;
  try { window.__TAURI__?.window?.getCurrentWindow().setTitle(t); } catch { /* not available */ }
}

export const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};
