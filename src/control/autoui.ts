// The Auto tab: routes (several points at once) and automations (little programs for a train),
// with a trip builder that works out the way and the points from the plan.
import type { ControlUI } from "./ui";
import { clear, h, icon } from "../ui/dom";
import { dialog, field, numInput, toast } from "../ui/dialogs";
import { addAutomation, addRoute, clockOf, clockText, parseClock, pointLabel } from "./engine";
import { TripPath, describeStep, tripPaths, tripSteps } from "./auto";
import { AutomationCfg, RouteCfg, Step } from "./types";
import { partOf } from "../model";

const pointStates = (n: number) => (n === 3 ? ["Straight", "Left", "Right"] : ["Straight", "Turn"]);

export function renderAuto(ui: ControlUI, el: HTMLElement) {
  const cfg = ui.cfg, e = ui.engine;
  const routes = (cfg.routes ??= []);
  const autos = (cfg.automations ??= []);
  const sec = (title: string, ...kids: (Node | null)[]) => h("section", { class: "setup-sec" }, h("h3", {}, title), ...kids.filter(Boolean) as Node[]);
  const del = (label: string, fn: () => void) => h("button", { class: "icon-btn sm", type: "button", "aria-label": label, title: label, html: icon("trash", 14), onclick: () => { fn(); ui.commitSetup(); ui.render(); } });

  if (!cfg.blocks.length || !cfg.trains.length) {
    el.append(h("p", { class: "muted" }, "Set up blocks and a train first (in Set up), then come back to make routes and automations."));
    return;
  }

  el.append(sec("Routes",
    h("p", { class: "muted small" }, "A route sets several points with one tap, such as \"Into the loop\". Routes show on the Drive tab and in WiThrottle apps."),
    ...routes.map((r) => {
      const set = h("button", { class: "btn btn-sm", type: "button", onclick: () => ui.act({ c: "route", id: r.id }).then((err) => { if (!err) toast(`${r.name} set.`); ui.app.render(); }) }, "Set");
      ui.addLive(set, () => set.classList.toggle("btn-primary", e.routeSet(r.id)));
      return h("div", { class: "setup-row" },
        h("span", { class: "small grow" }, h("strong", {}, r.name), " ", h("span", { class: "muted" }, routeSummary(ui, r))),
        set,
        h("button", { class: "btn btn-sm", type: "button", onclick: () => editRoute(ui, r) }, "Edit"),
        del("Delete route", () => {
          cfg.routes = routes.filter((x) => x !== r);
          for (const a of autos) a.steps = a.steps.filter((s) => !(s.do === "route" && s.route === r.id));
        }));
    }),
    cfg.points.length
      ? h("div", { class: "btn-row" }, h("button", { class: "btn btn-sm", type: "button", onclick: () => editRoute(ui) }, "New route"))
      : h("p", { class: "muted small" }, "There are no points on the plan.")));

  // the layout clock, for timetables
  const ck = clockOf(cfg);
  const start = h("input", { type: "time", id: "clock-start", value: clockText(ck.start * 60), "aria-label": "Clock starts at" }) as HTMLInputElement;
  start.addEventListener("change", () => { const m = parseClock(start.value); if (m !== null) { ui.act({ c: "clock", at: m }); cfg.clock = { ...clockOf(cfg), start: m }; ui.commitSetup(); } });
  const ratio = h("select", { id: "clock-ratio", "aria-label": "Clock speed" },
    ...[1, 2, 3, 4, 6, 12].map((n) => h("option", { value: String(n), selected: ck.ratio === n }, n === 1 ? "Real time" : `${n} × real time`))) as HTMLSelectElement;
  ratio.addEventListener("change", () => { ui.act({ c: "clock", ratio: +ratio.value }); cfg.clock = { ...clockOf(cfg), ratio: +ratio.value }; ui.commitSetup(); });
  el.append(sec("Clock",
    h("p", { class: "muted small" }, "The layout's own clock, for timetables. A fast clock fits a day's trains into an evening: at 4 × real time, an hour goes by in 15 minutes."),
    h("div", { class: "setup-row" }, ui.liveText(() => clockText(e.time || ck.start * 60), "layout-clock mono"), h("span", { class: "grow" }), ratio),
    h("div", { class: "setup-row" }, h("span", { class: "small grow" }, "Starts at"), start,
      h("button", { class: "btn btn-sm", type: "button", id: "clock-reset", onclick: () => ui.act({ c: "clock", at: clockOf(cfg).start }) }, "Back to the start"))));

  el.append(sec("Automations",
    h("p", { class: "muted small" }, "An automation drives a train for you: from the station to the loop, back and forth on a branch line, or round with a stop at every station. Signals and blocks still keep trains apart. Moving a train's throttle yourself stops its automation."),
    ...autos.map((a) => {
      const t = a.train ? e.train(a.train) : undefined;
      const btn = h("button", { class: "btn btn-sm", type: "button", onclick: () => ui.act({ c: "auto", id: a.id, run: !e.autoRuns.get(a.id)?.running }) });
      ui.addLive(btn, () => {
        const running = !!e.autoRuns.get(a.id)?.running;
        const label = running ? "Stop" : "Start";
        if (btn.textContent !== label) btn.textContent = label;
        btn.classList.toggle("btn-primary", running);
      });
      return h("div", { class: "auto-row" },
        h("div", { class: "setup-row" },
          h("span", { class: "small grow" }, h("strong", {}, a.name), " ", h("span", { class: "muted" }, `${t ? t.name : "no train"} · ${a.steps.length} step${a.steps.length === 1 ? "" : "s"}${a.loop ? " · repeats" : ""}`)),
          btn,
          h("button", { class: "btn btn-sm", type: "button", onclick: () => editAutomation(ui, a) }, "Edit"),
          del("Delete automation", () => { ui.act({ c: "auto", id: a.id, run: false }); cfg.automations = autos.filter((x) => x !== a); })),
        ui.liveText(() => e.autoRuns.get(a.id)?.status ?? "", "muted small auto-status"));
    }),
    h("div", { class: "btn-row" },
      cfg.blocks.length > 1 ? h("button", { class: "btn btn-sm btn-primary", type: "button", onclick: () => tripDialog(ui) }, "New trip") : null,
      cfg.blocks.length > 1 ? h("button", { class: "btn btn-sm", type: "button", id: "new-timetable", onclick: () => timetableDialog(ui) }, "New timetable") : null,
      h("button", { class: "btn btn-sm", type: "button", onclick: () => editAutomation(ui) }, "New automation")),
    cfg.blocks.length > 1 ? null : h("p", { class: "muted small" }, "Trips need the layout split into two or more blocks, with sensors at the joints.")));
}

function routeSummary(ui: ControlUI, r: RouteCfg) {
  const p = ui.app.p, cfg = ui.cfg;
  if (!r.points.length) return "no points";
  return r.points.map((q) => {
    const pc = cfg.points.find((x) => x.item === q.item);
    return `${pointLabel(p, cfg, q.item)} ${(pointStates(pc?.us.length ?? 2)[q.state] ?? q.state).toLowerCase()}`;
  }).join(", ");
}

function pointName(ui: ControlUI, item: string) {
  const it = ui.app.p.items.find((i) => i.id === item);
  return `${pointLabel(ui.app.p, ui.cfg, item)}${it ? ` (${partOf(it).def.id})` : ""}`;
}

// ---------- routes ----------

function editRoute(ui: ControlUI, existing?: RouteCfg) {
  const cfg = ui.cfg;
  const name = h("input", { type: "text", id: "route-name", value: existing?.name ?? `Route ${(cfg.routes?.length ?? 0) + 1}` }) as HTMLInputElement;
  const selects = new Map<string, HTMLSelectElement>();
  const rows = cfg.points.map((pc) => {
    const want = existing?.points.find((q) => q.item === pc.item)?.state;
    const s = h("select", { id: `rp-${pc.item}`, "aria-label": pointName(ui, pc.item) },
      h("option", { value: "", selected: want === undefined }, "Leave as it is"),
      ...pointStates(pc.us.length).map((n, i) => h("option", { value: String(i), selected: want === i }, n))) as HTMLSelectElement;
    selects.set(pc.item, s);
    return h("div", { class: "setup-row" }, h("span", { class: "small grow" }, pointName(ui, pc.item)), s);
  });
  const body = h("div", {},
    field("Name", name),
    h("div", { class: "btn-row" }, h("button", { class: "btn btn-sm", type: "button", onclick: () => { for (const pc of cfg.points) selects.get(pc.item)!.value = String(pc.state); } }, "Use how the points are set now")),
    ...rows);
  dialog(existing ? "Edit route" : "New route", body, [
    { label: "Cancel" },
    { label: "Save", primary: true, onClick: () => {
      const points = cfg.points.filter((pc) => selects.get(pc.item)!.value !== "").map((pc) => ({ item: pc.item, state: +selects.get(pc.item)!.value }));
      if (!points.length) { toast("Choose a position for at least one point.", "error"); return true; }
      const n = name.value.trim() || "Route";
      if (existing) { existing.name = n; existing.points = points; } else addRoute(cfg, n, points);
      ui.commitSetup(); ui.render();
    } },
  ]);
}

// ---------- automations ----------

const STEP_KINDS: [Step["do"], string][] = [
  ["drive", "Drive"], ["waitBlock", "Wait until it reaches"], ["arrive", "Slow down and stop"], ["stop", "Stop"],
  ["wait", "Wait"], ["waitFree", "Wait until a block is free"], ["route", "Set a route"], ["point", "Set a point"],
  ["signal", "Signal"], ["light", "Light"], ["waitTime", "Wait until the clock says"],
];

function defaultStep(ui: ControlUI, kind: Step["do"]): Step {
  const cfg = ui.cfg;
  switch (kind) {
    case "drive": return { do: "drive", speed: 50 };
    case "waitBlock": return { do: "waitBlock", block: cfg.blocks[0]?.id ?? "" };
    case "arrive": return { do: "arrive", speed: 30, after: 2 };
    case "stop": return { do: "stop" };
    case "wait": return { do: "wait", sec: 10 };
    case "waitFree": return { do: "waitFree", block: cfg.blocks[0]?.id ?? "" };
    case "route": return { do: "route", route: cfg.routes?.[0]?.id ?? "" };
    case "point": return { do: "point", item: cfg.points[0]?.item ?? "", state: 0 };
    case "signal": return { do: "signal", signal: cfg.signals[0]?.id ?? "", mode: "stop" };
    case "light": return { do: "light", light: cfg.lights[0]?.id ?? "", on: true };
    case "waitTime": return { do: "waitTime", at: clockText(Math.ceil((ui.engine.time || clockOf(cfg).start * 60) / 3600) * 3600) };
  }
}

function editAutomation(ui: ControlUI, existing?: AutomationCfg) {
  const cfg = ui.cfg;
  const steps: Step[] = JSON.parse(JSON.stringify(existing?.steps ?? []));
  const name = h("input", { type: "text", id: "auto-name", value: existing?.name ?? `Automation ${(cfg.automations?.length ?? 0) + 1}` }) as HTMLInputElement;
  const train = h("select", { id: "auto-train" }, h("option", { value: "" }, "No train"),
    ...cfg.trains.map((t) => h("option", { value: t.id, selected: (existing?.train ?? cfg.trains[0]?.id) === t.id }, t.name))) as HTMLSelectElement;
  const loop = h("input", { type: "checkbox", id: "auto-loop", checked: !!existing?.loop }) as HTMLInputElement;
  const list = h("ol", { class: "step-list" });

  const sel = <T extends string>(id: string, label: string, options: [string, string][], value: T, set: (v: T) => void) => {
    const s = h("select", { id, "aria-label": label }, ...options.map(([v, l]) => h("option", { value: v, selected: v === value }, l))) as HTMLSelectElement;
    s.addEventListener("change", () => set(s.value as T));
    return s;
  };
  const num = (id: string, label: string, value: number, set: (v: number) => void, attrs: Record<string, string | number> = {}) => {
    const n = numInput(id, value, { "aria-label": label, title: label, ...attrs });
    n.addEventListener("change", () => set(+n.value || 0));
    return n;
  };
  const blocks: [string, string][] = cfg.blocks.map((b) => [b.id, b.name]);

  const params = (s: Step, i: number): (Node | null)[] => {
    switch (s.do) {
      case "drive": return [
        sel(`sd-${i}`, "Direction", [["1", "forward"], ["-1", "back"]], s.speed < 0 ? "-1" : "1", (v) => { s.speed = Math.abs(s.speed) * +v; }),
        num(`ss-${i}`, "Speed %", Math.abs(s.speed), (v) => { s.speed = Math.sign(s.speed || 1) * Math.max(0, Math.min(100, v)); }, { min: 0, max: 100 }), h("span", { class: "small" }, "%")];
      case "waitBlock": case "waitFree": return [sel(`sb-${i}`, "Block", blocks, s.block, (v) => { s.block = v; })];
      case "arrive": return [
        num(`as-${i}`, "Slow speed %", Math.abs(s.speed), (v) => { s.speed = Math.max(1, Math.min(100, v)); }, { min: 1, max: 100 }), h("span", { class: "small" }, "% for"),
        num(`aa-${i}`, "Seconds", s.after, (v) => { s.after = Math.max(0, v); }, { min: 0, max: 60, step: 0.5 }), h("span", { class: "small" }, "s")];
      case "wait": return [num(`ws-${i}`, "Seconds", s.sec, (v) => { s.sec = Math.max(0, v); }, { min: 0, max: 3600 }), h("span", { class: "small" }, "s")];
      case "route": return cfg.routes?.length ? [sel(`sr-${i}`, "Route", cfg.routes.map((r) => [r.id, r.name]), s.route, (v) => { s.route = v; })] : [h("span", { class: "muted small" }, "Make a route first")];
      case "point": {
        if (!cfg.points.length) return [h("span", { class: "muted small" }, "No points")];
        const states = () => pointStates(cfg.points.find((q) => q.item === s.item)?.us.length ?? 2).map((n, k): [string, string] => [String(k), n]);
        const st = sel(`spp-${i}`, "Position", states(), String(s.state), (v) => { s.state = +v; });
        return [sel(`sp-${i}`, "Point", cfg.points.map((q) => [q.item, pointName(ui, q.item)]), s.item, (v) => { s.item = v; s.state = 0; draw(); }), st];
      }
      case "signal": return cfg.signals.length ? [
        sel(`sg-${i}`, "Signal", cfg.signals.map((g) => [g.id, g.name]), s.signal, (v) => { s.signal = v; }),
        sel(`sgm-${i}`, "Mode", [["stop", "hold at red"], ["auto", "automatic"]], s.mode, (v) => { s.mode = v; })] : [h("span", { class: "muted small" }, "No signals")];
      case "light": return cfg.lights.length ? [
        sel(`sl-${i}`, "Light", cfg.lights.map((l) => [l.id, l.name]), s.light, (v) => { s.light = v; }),
        sel(`slo-${i}`, "On or off", [["1", "on"], ["0", "off"]], s.on ? "1" : "0", (v) => { s.on = v === "1"; })] : [h("span", { class: "muted small" }, "No lights")];
      case "stop": return [];
      case "waitTime": {
        const t = h("input", { type: "time", id: `wt-${i}`, value: s.at, "aria-label": "Time" }) as HTMLInputElement;
        t.addEventListener("change", () => { if (parseClock(t.value) !== null) s.at = t.value; });
        return [t];
      }
    }
  };

  const draw = () => {
    clear(list);
    steps.forEach((s, i) => {
      const kind = sel(`sk-${i}`, `Step ${i + 1}`, STEP_KINDS, s.do, (v) => { steps[i] = defaultStep(ui, v); draw(); });
      const move = (d: number) => { const j = i + d; if (j < 0 || j >= steps.length) return; [steps[i], steps[j]] = [steps[j], steps[i]]; draw(); };
      list.append(h("li", { class: "step-row" },
        kind, ...params(s, i).filter(Boolean) as Node[],
        h("span", { class: "grow" }),
        h("button", { class: "icon-btn sm", type: "button", "aria-label": "Move up", title: "Move up", html: icon("up", 14), disabled: i === 0, onclick: () => move(-1) }),
        h("button", { class: "icon-btn sm", type: "button", "aria-label": "Move down", title: "Move down", html: icon("down", 14), disabled: i === steps.length - 1, onclick: () => move(1) }),
        h("button", { class: "icon-btn sm", type: "button", "aria-label": "Delete step", title: "Delete step", html: icon("trash", 14), onclick: () => { steps.splice(i, 1); draw(); } })));
    });
    if (!steps.length) list.append(h("li", { class: "muted small" }, "No steps yet."));
  };
  draw();

  const body = h("div", {},
    h("div", { class: "row2" }, field("Name", name), field("Train", train)),
    h("div", { class: "sub-head" }, "Steps, in order"),
    list,
    h("div", { class: "btn-row" },
      h("button", { class: "btn btn-sm", type: "button", onclick: () => { steps.push(defaultStep(ui, steps.length ? "wait" : "drive")); draw(); } }, "Add step")),
    h("label", { class: "check" }, loop, "Start again from the first step when it finishes"));
  dialog(existing ? "Edit automation" : "New automation", body, [
    { label: "Cancel" },
    { label: "Save", primary: true, onClick: () => {
      const n = name.value.trim() || "Automation";
      if (existing) {
        if (ui.engine.autoRuns.get(existing.id)?.running) ui.act({ c: "auto", id: existing.id, run: false });
        Object.assign(existing, { name: n, train: train.value || undefined, steps, loop: loop.checked });
      } else addAutomation(cfg, n, train.value || undefined, steps, loop.checked);
      ui.commitSetup(); ui.render();
    } },
  ], { wide: true });
}

// ---------- the trip builder ----------

/**
 * A timetable for one train: at each time on the layout clock it sets off for the next stop, by the
 * shortest way, setting the points as it goes. Made into an ordinary automation, so it can be edited.
 */
function timetableDialog(ui: ControlUI) {
  const cfg = ui.cfg, e = ui.engine, p = ui.app.p;
  const placed = cfg.trains.filter((t) => t.block);
  if (!placed.length) { toast("Place a train on the plan first (Drive or Set up).", "error"); return; }
  const train = h("select", { id: "tt-train" }, ...placed.map((t) => h("option", { value: t.id }, `${t.name} (in ${e.blockName(t.block!)})`))) as HTMLSelectElement;
  const speed = numInput("tt-speed", 50, { min: 5, max: 100, step: 5 });
  const repeat = h("input", { type: "checkbox", id: "tt-repeat" }) as HTMLInputElement;
  const rows: { at: string; to: string }[] = [];
  const list = h("ol", { class: "step-list", id: "tt-rows" });
  const from = () => cfg.trains.find((t) => t.id === train.value)?.block ?? "";
  const next = (at: string, mins: number) => clockText(((parseClock(at) ?? clockOf(cfg).start) + mins) * 60);
  const addRow = () => {
    const last = rows[rows.length - 1];
    const to = cfg.blocks.find((b) => b.id !== (last?.to ?? from()))?.id ?? "";
    rows.push({ at: last ? next(last.at, 30) : clockText(clockOf(cfg).start * 60 + 600), to });
    draw();
  };
  const draw = () => {
    clear(list);
    rows.forEach((r, i) => {
      const t = h("input", { type: "time", id: `tt-at-${i}`, value: r.at, "aria-label": `Departure ${i + 1} time` }) as HTMLInputElement;
      t.addEventListener("change", () => { if (parseClock(t.value) !== null) r.at = t.value; });
      const d = h("select", { id: `tt-to-${i}`, "aria-label": `Departure ${i + 1} to` }, ...cfg.blocks.map((b) => h("option", { value: b.id, selected: b.id === r.to }, b.name))) as HTMLSelectElement;
      d.addEventListener("change", () => { r.to = d.value; });
      list.append(h("li", { class: "step-row" }, h("span", { class: "small" }, "At"), t, h("span", { class: "small" }, "go to"), d, h("span", { class: "grow" }),
        h("button", { class: "icon-btn sm", type: "button", "aria-label": "Delete departure", title: "Delete departure", html: icon("trash", 14), onclick: () => { rows.splice(i, 1); draw(); } })));
    });
    if (!rows.length) list.append(h("li", { class: "muted small" }, "No departures yet."));
  };
  addRow(); addRow();
  const build = () => {
    const t = cfg.trains.find((x) => x.id === train.value)!;
    if (!rows.length) { toast("Add a departure.", "error"); return true; }
    const sp = Math.max(5, Math.min(100, +speed.value || 50));
    const steps: Step[] = [];
    let here = from();
    for (const r of rows) {
      if (r.to === here) { toast(`${t.name} is already in ${e.blockName(here)} at ${r.at}: pick somewhere else to go.`, "error"); return true; }
      const way = tripPaths(p, cfg, e.topo, here, r.to, 1)[0];
      if (!way) { toast(`Railplot can't find a way from ${e.blockName(here)} to ${e.blockName(r.to)}.`, "error"); return true; }
      steps.push({ do: "waitTime", at: r.at }, ...tripSteps(way, { speed: sp, slow: 30, after: 1.5 }));
      here = r.to;
    }
    if (repeat.checked && here !== from()) { toast(`To run every day, the last departure has to take ${t.name} back to ${e.blockName(from())}.`, "error"); return true; }
    const a = addAutomation(cfg, `${t.name} timetable`, t.id, steps, repeat.checked);
    ui.commitSetup(); ui.render();
    toast(`${a.name} saved. Press Start: ${t.name} leaves at ${rows[0].at} on the layout clock.`);
  };
  const body = h("div", { class: "trip-dlg" },
    field("Train", train),
    h("div", { class: "sub-head" }, "Departures"),
    list,
    h("div", { class: "btn-row" }, h("button", { class: "btn btn-sm", type: "button", id: "tt-add", onclick: () => addRow() }, "Add a departure")),
    h("div", { class: "row3" }, field("Speed (%)", speed)),
    h("label", { class: "check" }, repeat, "Run it again every day (the last stop is where it starts)"),
    h("p", { class: "muted small" }, "Times are on the layout clock (Auto tab). At each time the train sets off for its next stop by the shortest way, setting the points, and stops there. If it's held up, it leaves as soon as it can."));
  dialog("New timetable", body, [{ label: "Cancel" }, { label: "Save", primary: true, onClick: build }]);
}

function tripDialog(ui: ControlUI) {
  const cfg = ui.cfg, e = ui.engine, p = ui.app.p;
  const placed = cfg.trains.filter((t) => t.block);
  if (!placed.length) { toast("Place a train on the plan first (Drive or Set up).", "error"); return; }
  const train = h("select", { id: "trip-train" }, ...placed.map((t) => h("option", { value: t.id }, `${t.name} (in ${e.blockName(t.block!)})`))) as HTMLSelectElement;
  const dest = h("select", { id: "trip-dest" }) as HTMLSelectElement;
  const dir = h("select", { id: "trip-dir" }, h("option", { value: "1" }, "Forward"), h("option", { value: "-1" }, "Back")) as HTMLSelectElement;
  const speed = numInput("trip-speed", 50, { min: 5, max: 100, step: 5 });
  const slow = numInput("trip-slow", 30, { min: 5, max: 100, step: 5 });
  const after = numInput("trip-after", 2, { min: 0, max: 30, step: 0.5 });
  const then = h("select", { id: "trip-then" },
    h("option", { value: "stay" }, "Stay there"),
    h("option", { value: "back" }, "Wait, then come back"),
    h("option", { value: "shuttle" }, "Shuttle back and forth until stopped")) as HTMLSelectElement;
  const wait = numInput("trip-wait", 20, { min: 0, max: 600, step: 5 });
  const ways = h("div", { class: "trip-ways", role: "radiogroup", "aria-label": "Which way" });
  let paths: TripPath[] = [];
  let chosen = 0;

  const fromBlock = () => cfg.trains.find((t) => t.id === train.value)?.block ?? "";
  const fillDest = () => {
    const from = fromBlock();
    const keep = dest.value;
    clear(dest);
    for (const b of cfg.blocks) if (b.id !== from) dest.append(h("option", { value: b.id, selected: b.id === keep }, b.name));
  };
  const describe = (pt: TripPath) => {
    const via = pt.blocks.slice(1, -1).map((b) => e.blockName(b));
    const pts = pt.points.map((q) => `${pointLabel(p, cfg, q.item)} ${(pointStates(cfg.points.find((x) => x.item === q.item)?.us.length ?? 2)[q.state] ?? "").toLowerCase()}`);
    const len = pt.length > 100 ? ` (about ${(pt.length / 1000).toFixed(1)} m)` : "";
    return `${via.length ? `Via ${via.join(", ")}` : "Straight there"}${pts.length ? `, setting ${pts.join(", ")}` : ""}${len}`;
  };
  const findWays = () => {
    paths = tripPaths(p, cfg, e.topo, fromBlock(), dest.value, 3);
    chosen = 0;
    clear(ways);
    if (!paths.length) { ways.append(h("p", { class: "warn-note" }, "Railplot can't find a way there along the track. Check the blocks join up, and that no joint is between DCC-EX and another controller.")); return; }
    paths.forEach((pt, i) => {
      const r = h("input", { type: "radio", name: "trip-way", id: `trip-way-${i}`, checked: i === 0, onchange: () => { chosen = i; } });
      ways.append(h("label", { class: "check" }, r, describe(pt)));
    });
  };
  train.addEventListener("change", () => { fillDest(); findWays(); });
  dest.addEventListener("change", findWays);
  fillDest(); findWays();

  const body = h("div", {},
    h("div", { class: "row2" }, field("Train", train), field("To", dest)),
    h("div", { class: "sub-head" }, "Which way"),
    ways,
    h("div", { class: "row3" }, field("Set off", dir, "As on its throttle"), field("Speed (%)", speed), field("Then", then)),
    h("div", { class: "row3" }, field("Slow to (%)", slow, "On arriving"), field("Stop after (s)", after, "At the slow speed"), field("Wait at each end (s)", wait)),
    h("p", { class: "muted small" }, "On arrival the train slows down and stops inside the block: Railplot doesn't power the block beyond it until the next trip sets off. If a train sets off the wrong way, change \"Set off\"."));

  const build = (start: boolean) => {
    const pt = paths[chosen];
    if (!pt) { toast("There's no way to get there.", "error"); return true; }
    const t = cfg.trains.find((x) => x.id === train.value)!;
    const from = fromBlock(), to = dest.value;
    const d = +dir.value, sp = Math.max(5, Math.min(100, +speed.value || 50));
    const opt = { slow: Math.max(5, Math.min(100, +slow.value || 30)), after: Math.max(0, +after.value || 0) };
    const steps: Step[] = tripSteps(pt, { speed: d * sp, ...opt });
    let name = `${t.name}: ${e.blockName(from)} to ${e.blockName(to)}`;
    if (then.value !== "stay") {
      const back = tripPaths(p, cfg, e.topo, to, from, 3);
      // prefer the way back over the same track (a shuttle reverses)
      const sameWay = back.find((b) => b.blocks.join() === [...pt.blocks].reverse().join()) ?? back[0];
      if (!sameWay) { toast(`Railplot can't find a way back from ${e.blockName(to)}.`, "error"); return true; }
      steps.push({ do: "wait", sec: Math.max(0, +wait.value || 0) }, ...tripSteps(sameWay, { speed: -d * sp, ...opt }));
      if (then.value === "shuttle") steps.push({ do: "wait", sec: Math.max(0, +wait.value || 0) });
      name += then.value === "shuttle" ? " shuttle" : " and back";
    }
    const a = addAutomation(cfg, name, t.id, steps, then.value === "shuttle");
    ui.commitSetup(); ui.render();
    if (start) setTimeout(() => ui.act({ c: "auto", id: a.id, run: true }), 300);
    else toast(`${name} saved. Press Start to run it.`);
  };
  dialog("New trip", body, [
    { label: "Cancel" },
    { label: "Save", onClick: () => build(false) },
    { label: "Save and start", primary: true, onClick: () => build(true) },
  ], { wide: true });
}

export { describeStep };
