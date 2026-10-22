// Updating Railplot. The desktop app updates itself from the GitHub release page (signed installers,
// through the Tauri updater); the offline file downloads the new file; the web version is always new.
export const REPO = "LMJuerioeoe/railplot";
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

/** How this copy of Railplot is running, which decides how it updates. */
export type Install = "desktop" | "web" | "offline" | "served";

export function installKind(): Install {
  if (typeof window === "undefined") return "offline";
  if (window.__TAURI__) return "desktop";
  if (location.protocol === "file:") return "offline";
  if (location.hostname.endsWith("github.io")) return "web";
  // the hub, an ESP32 controller, or a page on claude.ai: someone else serves this copy
  return "served";
}

/** "v0.12.1" → [0, 12, 1]. */
export function parseVersion(v: string): number[] {
  return v.replace(/^v/i, "").split(/[.+-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
}

/** Is version `a` newer than `b`? */
export function newer(a: string, b: string): boolean {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

export interface Release { version: string; notes: string; url: string; offlineUrl?: string; date?: string }

/** The newest published release on GitHub (drafts aren't visible to anyone else, so they don't count). */
export async function latestRelease(fetchFn: typeof fetch = fetch): Promise<Release> {
  const r = await fetchFn(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
  if (r.status === 404) throw new Error("There's no published release yet.");
  if (r.status === 403) throw new Error("GitHub is busy (too many checks from this network). Try again in an hour.");
  if (!r.ok) throw new Error(`GitHub answered ${r.status}.`);
  const j = await r.json();
  const offline = (j.assets ?? []).find((a: { name: string }) => a.name === "railplot-offline.html");
  return { version: String(j.tag_name ?? "").replace(/^v/i, ""), notes: String(j.body ?? ""), url: j.html_url ?? RELEASES_URL, offlineUrl: offline?.browser_download_url, date: j.published_at };
}

// ---------- the desktop app ----------

const invoke = (cmd: string, args?: Record<string, unknown>) => window.__TAURI__!.core.invoke(cmd, args);

/** Can this desktop build update itself (was it built with the update signing key)? */
export async function desktopCanUpdate(): Promise<boolean> {
  try { return !!(await invoke("can_update")); } catch { return false; }
}

/** The newer version the desktop updater found, or null when this is the newest. */
export async function desktopCheck(): Promise<{ version: string; notes?: string } | null> {
  return (await invoke("check_update")) ?? null;
}

/** Download, verify and install the update, then restart. `onProgress` gets a fraction, or null when the size isn't known. */
export async function desktopInstall(onProgress: (f: number | null, bytes: number) => void): Promise<void> {
  const ev = (window.__TAURI__ as unknown as { event?: { listen: (n: string, f: (e: { payload: [number, number | null] }) => void) => Promise<() => void> } }).event;
  const stop = ev ? await ev.listen("update-progress", (e) => { const [done, total] = e.payload; onProgress(total ? done / total : null, done); }) : null;
  try { await invoke("install_update"); } finally { stop?.(); }
}
