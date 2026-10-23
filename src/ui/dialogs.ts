// In-page dialogs and toasts (the app never uses alert/confirm/prompt).
import { h, icon } from "./dom";

export interface Action { label: string; primary?: boolean; danger?: boolean; onClick?: () => boolean | void | Promise<boolean | void> }

let open: HTMLElement | null = null;

export function closeDialog() {
  open?.remove();
  open = null;
}

export function isDialogOpen() { return !!open; }

export function dialog(title: string, body: Node, actions: Action[], opts: { wide?: boolean } = {}) {
  closeDialog();
  const btns = actions.map((a) => h("button", {
    class: `btn ${a.primary ? "btn-primary" : ""} ${a.danger ? "btn-danger" : ""}`,
    type: a.primary ? "submit" : "button",
    onclick: async (e: Event) => {
      e.preventDefault();
      const keep = a.onClick ? await a.onClick() : undefined;
      if (keep !== true) closeDialog();
    },
  }, a.label));
  const form = h("form", { class: `dialog ${opts.wide ? "dialog-wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": title },
    h("header", { class: "dialog-head" },
      h("h2", {}, title),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Close", html: icon("close"), onclick: () => closeDialog() })),
    h("div", { class: "dialog-body" }, body),
    h("footer", { class: "dialog-foot" }, ...btns));
  form.addEventListener("submit", (e) => { e.preventDefault(); (btns.find((b) => b.type === "submit") as HTMLButtonElement | undefined)?.click(); });
  const scrim = h("div", { class: "scrim", onmousedown: (e: MouseEvent) => { if (e.target === scrim) closeDialog(); } }, form);
  scrim.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeDialog(); } });
  document.body.append(scrim);
  open = scrim;
  const first = form.querySelector<HTMLElement>("input, select, textarea") ?? btns[btns.length - 1];
  setTimeout(() => first?.focus(), 0);
  // a body too long for the window scrolls: let the keyboard reach it, to scroll it with the arrow keys
  requestAnimationFrame(() => {
    const b = form.querySelector<HTMLElement>(".dialog-body");
    if (b && b.scrollHeight > b.clientHeight + 1) { b.tabIndex = 0; b.setAttribute("role", "region"); b.setAttribute("aria-label", title); }
  });
  return form;
}

export function confirmDialog(title: string, message: string, okLabel: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    dialog(title, h("p", {}, message), [
      // close before answering: the caller may open a dialog of its own straight away, which closing afterwards would shut
      { label: "Cancel", onClick: () => { done = true; closeDialog(); resolve(false); return true; } },
      { label: okLabel, primary: true, danger, onClick: () => { done = true; closeDialog(); resolve(true); return true; } },
    ]);
    const obs = new MutationObserver(() => { if (!document.body.contains(open) && !done) { done = true; resolve(false); obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
  });
}

export function field(label: string, input: HTMLElement, hint?: string) {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), input, hint ? h("span", { class: "field-hint" }, hint) : null);
}

export function numInput(id: string, value: number, attrs: Record<string, string | number> = {}) {
  return h("input", { id, type: "number", value: String(value), step: "any", inputmode: "decimal", ...attrs }) as HTMLInputElement;
}

let toastTimer = 0;
export function toast(msg: string, kind: "info" | "error" = "info") {
  let el = document.getElementById("toast");
  if (!el) { el = h("div", { id: "toast", role: "status", "aria-live": "polite" }); document.body.append(el); }
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove("show"), kind === "error" ? 6000 : 2600);
}
