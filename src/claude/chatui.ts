// The Claude chat panel inside Railplot: ask about the plan, get proposals you accept or reject, and (when
// allowed) have Claude use the layout's controls.
import type { App } from "../app";
import { parseProject, serialize } from "../io";
import { getPart } from "../library";
import { getModule } from "../modules";
import type { Proposal } from "../proposals";
import { describeProposal } from "../proposals";
import { Cmd, snapshot } from "../control/remote";
import { clear, h, icon } from "../ui/dom";
import { toast } from "../ui/dialogs";
import { store } from "../platform";
import { CHAT_TOOLS, CONTROL_TOOLS, ControlAccess, PlanEnv, PlanTarget, operationsGuide, planTools } from "./plantools";
import { ToolError } from "./tooldefs";
import { AccountBackend, ApiBackend, ChatBackend, ChatError, Turn, accountBackend, defaultModel, listModels, renderMarkdown } from "./chat";

const KEY = "railplot.claude.key";
const MODEL = "railplot.claude.model";

const LABELS: Record<string, string> = {
  get_layout: "Read the plan", list_boards: "Looked at the baseboards", get_track: "Looked at the track",
  check_layout: "Checked the plan", get_parts_list: "Worked out the parts list", list_track_systems: "Looked at the track systems",
  list_parts: "Looked through the track catalogue", list_baseboard_modules: "Looked through the baseboard modules",
  list_examples: "Looked at the example layouts", list_proposals: "Looked at the proposals", withdraw_proposal: "Withdrew a proposal",
  get_control_status: "Looked at the layout's status",
};

type Entry =
  | { kind: "user"; text: string }
  | { kind: "claude"; text: string; pending?: boolean; error?: string }
  | { kind: "tool"; text: string; error?: boolean }
  | { kind: "proposal"; id: string; title: string; change: string };

export class ChatPanel {
  el: HTMLElement;
  private log!: HTMLElement;
  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private sub!: HTMLElement;
  private body!: HTMLElement;
  private entries: Entry[] = [];
  private turns: Turn[] = [];
  private busy: AbortController | null = null;
  private backend: ChatBackend | null = null;
  private account: AccountBackend | null | undefined = undefined;   // undefined: not looked yet
  private settingsOpen = false;
  private key = "";
  private model = "";
  open = false;

  constructor(private app: App) {
    this.key = store.get(KEY) ?? "";
    this.model = store.get(MODEL) ?? "";
    this.el = h("section", { class: "chat", hidden: true, "aria-label": "Claude" });
    this.build();
  }

  // ---------- the panel ----------

  private build() {
    this.sub = h("span", { class: "chat-sub" });
    const head = h("header", { class: "chat-head" },
      h("div", { class: "chat-title", html: `${icon("spark", 18)}<span>Claude</span>` }), this.sub,
      h("span", { class: "grow" }),
      h("button", { class: "icon-btn sm", type: "button", title: "New chat", "aria-label": "New chat", html: icon("file", 16), onclick: () => this.newChat() }),
      h("button", { class: "icon-btn sm", type: "button", title: "Settings", "aria-label": "Chat settings", id: "chat-settings", html: icon("details", 16), onclick: () => { this.settingsOpen = !this.settingsOpen; this.render(); } }),
      h("button", { class: "icon-btn sm", type: "button", title: "Close", "aria-label": "Close the chat", html: icon("close", 16), onclick: () => this.toggle(false) }));
    this.body = h("div", { class: "chat-body" });
    this.log = h("div", { class: "chat-log", role: "log", "aria-live": "polite" });
    this.input = h("textarea", { class: "chat-text", id: "chat-text", rows: 2, placeholder: "Ask about your layout, or ask for a change…", "aria-label": "Message to Claude" }) as HTMLTextAreaElement;
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); }
    });
    this.input.addEventListener("input", () => { this.input.style.height = "auto"; this.input.style.height = `${Math.min(160, this.input.scrollHeight)}px`; });
    this.sendBtn = h("button", { class: "btn btn-primary chat-send", type: "button", id: "chat-send", onclick: () => (this.busy ? this.stop() : this.send()) }, "Send") as HTMLButtonElement;
    const foot = h("div", { class: "chat-foot" }, this.input, this.sendBtn);
    this.el.append(head, this.body, foot);
  }

  toggle(on = !this.open) {
    this.open = on;
    this.el.hidden = !on;
    this.app.root.classList.toggle("chat-open", on);
    this.app.el.chatBtn?.classList.toggle("on", on);
    if (on) { this.prepare().then(() => this.render()); this.render(); setTimeout(() => this.input.focus(), 50); }
  }

  /** Work out how this window talks to Claude: the claude.ai account (when hosted there) or an API key. */
  private async prepare() {
    if (this.account === undefined) {
      this.account = null;
      try { this.account = await accountBackend(); } catch { this.account = null; }
    }
    this.backend = this.account ?? (this.key && this.model ? new ApiBackend(this.key, this.model) : null);
  }

  private hostedWithoutAccount() {
    return !!(window as unknown as { claude?: unknown }).claude && !this.account;
  }

  render() {
    clear(this.body);
    this.sub.textContent = this.backend ? `· ${this.backend.label}` : "";
    if (this.settingsOpen || !this.backend) { this.body.append(this.settingsView()); }
    else {
      this.body.append(this.log);
      this.renderLog();
    }
    this.sendBtn.textContent = this.busy ? "Stop" : "Send";
    this.sendBtn.classList.toggle("btn-primary", !this.busy);
    this.input.disabled = !this.backend;
  }

  private settingsView(): HTMLElement {
    if (this.account) {
      return h("div", { class: "chat-setup" },
        h("p", {}, "Railplot is using your Claude account here. The first message asks you to allow it, and each message counts towards your Claude usage."),
        h("button", { class: "btn", type: "button", onclick: () => { this.settingsOpen = false; this.render(); } }, "Back to the chat"));
    }
    if (this.hostedWithoutAccount()) {
      return h("div", { class: "chat-setup" },
        h("p", {}, "The chat can't reach Claude from this web page. Use the Railplot desktop app or the offline file with an Anthropic API key, or open this page in the Claude app."));
    }
    const keyIn = h("input", { type: "password", id: "chat-key", autocomplete: "off", spellcheck: "false", placeholder: "sk-ant-…", value: this.key }) as HTMLInputElement;
    const remember = h("input", { type: "checkbox", id: "chat-remember", checked: !!store.get(KEY) || !this.key }) as HTMLInputElement;
    const modelSel = h("select", { id: "chat-model" }, h("option", { value: this.model || "" }, this.model || "Check the key to list models")) as HTMLSelectElement;
    const status = h("p", { class: "muted small", id: "chat-key-status" });
    const check = async () => {
      const key = keyIn.value.trim();
      if (!key) { status.textContent = "Paste your API key first."; return; }
      status.textContent = "Checking…";
      try {
        const models = await listModels(key);
        clear(modelSel);
        const pick = models.some((m) => m.id === this.model) ? this.model : defaultModel(models);
        for (const m of models) modelSel.append(h("option", { value: m.id, selected: m.id === pick }, `${m.name} (${m.id})`));
        status.textContent = models.length ? "The key works. Pick a model, then Save." : "The key works, but no models are listed for it.";
      } catch (e) { status.textContent = (e as Error).message; }
    };
    const save = () => {
      const key = keyIn.value.trim(), model = modelSel.value;
      if (!key || !model) { status.textContent = "Check the key and pick a model first."; return; }
      this.key = key; this.model = model;
      if (remember.checked) { store.set(KEY, key); store.set(MODEL, model); } else { store.del(KEY); store.set(MODEL, model); }
      this.backend = new ApiBackend(key, model);
      this.settingsOpen = false;
      this.render();
      toast("Claude is ready.");
    };
    const forget = () => { store.del(KEY); this.key = ""; keyIn.value = ""; this.backend = null; status.textContent = "The key is forgotten."; this.render(); };
    return h("div", { class: "chat-setup" },
      h("p", {}, "Claude can read your plan, check it and suggest changes, which you accept or reject in the plan as usual. Here it needs an Anthropic API key."),
      h("ol", { class: "small" },
        h("li", {}, "Get a key at console.anthropic.com (Settings > API keys). Messages are billed to that account."),
        h("li", {}, "Paste it here and press Check."),
        h("li", {}, "Pick a model and Save.")),
      h("label", { class: "field" }, h("span", {}, "API key"), keyIn),
      h("div", { class: "btn-row" }, h("button", { class: "btn btn-sm", type: "button", id: "chat-check", onclick: check }, "Check")),
      h("label", { class: "field" }, h("span", {}, "Model"), modelSel),
      h("label", { class: "check" }, remember, "Remember the key on this computer"),
      status,
      h("p", { class: "muted small" }, "The key goes only to Anthropic (api.anthropic.com), straight from this window. Railplot sends nothing anywhere else."),
      h("div", { class: "btn-row" },
        h("button", { class: "btn btn-primary", type: "button", id: "chat-save", onclick: save }, "Save"),
        this.key ? h("button", { class: "btn", type: "button", onclick: forget }, "Forget the key") : null,
        this.backend ? h("button", { class: "btn", type: "button", onclick: () => { this.settingsOpen = false; this.render(); } }, "Cancel") : null));
  }

  private renderLog() {
    const log = this.log;
    clear(log);
    if (!this.entries.length) {
      const ask = (t: string) => h("button", { class: "chip-btn", type: "button", onclick: () => { this.input.value = t; this.send(); } }, t);
      log.append(h("div", { class: "chat-empty" },
        h("p", {}, "Ask about your layout, or ask for a change. Changes come as proposals: you see them on the plan and accept or reject them."),
        h("div", { class: "chip-row" },
          ask("Check my plan for problems"),
          ask("What do I need to buy?"),
          ask("Suggest a fiddle yard for this layout"))));
    }
    for (const e of this.entries) log.append(this.entryEl(e));
    log.scrollTop = log.scrollHeight;
  }

  private entryEl(e: Entry): HTMLElement {
    switch (e.kind) {
      case "user": return h("div", { class: "msg user" }, e.text);
      case "tool": return h("div", { class: `msg tool ${e.error ? "err" : ""}` }, e.text);
      case "claude": {
        const el = h("div", { class: "msg claude" });
        if (e.text) el.innerHTML = renderMarkdown(e.text);
        else if (e.pending) el.append(h("span", { class: "thinking" }, "Thinking…"));
        if (e.error) el.append(h("p", { class: "warn-note" }, e.error));
        return el;
      }
      case "proposal": {
        const pending = this.app.p.proposals?.some((x) => x.id === e.id);
        const outcome = this.app.proposalOutcome.get(e.id);
        return h("div", { class: "msg prop-card chat-prop", "data-prop": e.id },
          h("div", { class: "prop-title" }, e.title),
          h("div", { class: "muted small" }, e.change),
          pending ? h("div", { class: "btn-row" },
            h("button", { class: "btn btn-sm", type: "button", onclick: () => { if (this.app.mode !== "design") this.app.setMode("design"); this.app.showProposal(e.id); }, html: `${icon("eye", 14)}<span>${this.app.showProp === e.id ? "Hide" : "Show"}</span>` }),
            h("button", { class: "btn btn-sm btn-primary", type: "button", onclick: () => this.app.acceptProposal(e.id), html: `${icon("check", 14)}<span>Accept</span>` }),
            h("button", { class: "btn btn-sm", type: "button", onclick: () => this.app.rejectProposal(e.id), html: `${icon("close", 14)}<span>Reject</span>` }))
            : h("div", { class: "muted small" }, outcome === "accepted" ? "Accepted" : outcome === "rejected" ? "Rejected" : "No longer waiting"));
      }
    }
  }

  /** Called when the plan changes, so proposal cards show whether they're still waiting. */
  refresh() { if (this.open && !this.settingsOpen && this.backend) this.renderLog(); }

  private newChat() {
    this.stop();
    this.entries = []; this.turns = [];
    this.render();
  }

  private stop() { this.busy?.abort(); }

  // ---------- talking ----------

  async send(textIn?: string) {
    const text = (textIn ?? this.input.value).trim();
    if (!text || this.busy) return;
    await this.prepare();
    if (!this.backend) { this.settingsOpen = true; this.render(); return; }
    this.input.value = ""; this.input.style.height = "";
    this.entries.push({ kind: "user", text });
    this.turns.push({ role: "user", content: text });
    // Claude's words and what it does arrive in order: text, tool rows, more text
    let reply: Entry & { kind: "claude" } = { kind: "claude", text: "", pending: true };
    let full = "", consumed = 0;
    this.entries.push(reply);
    const ctl = new AbortController();
    this.busy = ctl;
    this.render();
    const allowed = !!this.app.p.control?.claude;
    const tools = planTools(this.env()).filter((t) => CHAT_TOOLS.includes(t.name) && (allowed || !CONTROL_TOOLS.includes(t.name)));
    // keep the conversation a reasonable size; the instructions are rebuilt each time with the plan as it is now
    while (this.turns.length > 30) this.turns.shift();
    while (this.turns[0]?.role === "assistant") this.turns.shift();
    const show = (t: string) => { full = t; reply.text = t.slice(consumed).trim(); this.renderLog(); };
    try {
      const out = await this.backend.run({
        instructions: this.instructions(allowed),
        turns: this.turns,
        tools,
        signal: ctl.signal,
        onText: show,
        onTool: (name, input, result) => {
          if (!result) return;
          // what Claude said so far stays above the tool row; anything after goes in a new bubble below
          this.entries = this.entries.filter((x) => x !== reply);
          if (reply.text) { reply.pending = false; this.entries.push(reply); consumed = full.length; reply = { kind: "claude", text: "", pending: true }; }
          this.onTool(name, input, result);
          this.entries.push(reply);
          this.renderLog();
        },
      });
      reply.pending = false;
      reply.text = out.slice(consumed).trim();
      if (!reply.text) this.entries = this.entries.filter((x) => x !== reply);
      this.turns.push({ role: "assistant", content: out });
    } catch (e) {
      const err = e instanceof ChatError ? e : new ChatError(String((e as Error)?.message ?? e), "error");
      reply.pending = false;
      const partial = err.partial || full;
      reply.text = partial.slice(consumed).trim();
      if (err.code !== "cancelled") reply.error = err.message;
      else if (!reply.text) reply.text = "(Stopped.)";
      if (partial) this.turns.push({ role: "assistant", content: partial });
      else this.turns.pop();
      if (err.code === "auth" || err.code === "model") { this.settingsOpen = true; }
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private onTool(name: string, input: any, result: { text: string; error: boolean }) {
    if (name === "propose_plan" && !result.error) {
      const m = result.text.match(/^Proposal (P\w+), “(.+?)”/);
      if (m) {
        const pr = this.app.p.proposals?.find((x) => x.id === m[1]);
        this.entries.push({ kind: "proposal", id: m[1], title: m[2], change: pr ? `Claude proposes: it ${describeProposal(pr)}.` : "" });
      } else this.entries.push({ kind: "tool", text: `Tried a change: ${String(input?.title ?? "")}` });
    } else if (CONTROL_TOOLS.includes(name) && name !== "get_control_status") {
      this.entries.push({ kind: "tool", text: result.error ? `Couldn't: ${result.text}` : result.text, error: result.error });
    } else {
      this.entries.push({ kind: "tool", text: result.error ? `${LABELS[name] ?? name}: ${result.text.split("\n")[0]}` : (LABELS[name] ?? name), error: result.error });
    }
  }

  // ---------- what Claude works on: this window's plan ----------

  private env(): PlanEnv {
    const app = this.app;
    const target: PlanTarget = {
      kind: "app", label: "the plan open in Railplot",
      load: async () => parseProject(serialize(app.p)),
      addProposal: async (pr: Proposal) => app.addProposal(pr),
      withdraw: async (id: string) => app.withdrawProposal(id),
    };
    const control: ControlAccess = {
      async state() {
        const cfg = app.p.control;
        if (!cfg || (!cfg.controllers.length && !app.ctl.hub)) throw new ToolError("This layout has no controllers set up yet (Control > Set up).");
        return { claude: !!cfg.claude, snap: snapshot(app.ctl.engine, 0, [], 0), p: parseProject(serialize(app.p)) };
      },
      async command(cmd: Cmd) {
        const cfg = app.p.control;
        if (!cfg?.claude) return "Claude isn't allowed to use the controls. Turn on \"Let Claude use the controls\" under Control > Set up.";
        if (!["throttle", "point", "signal", "light", "route", "auto"].includes(cmd.c)) return "Claude can't switch track power or use emergency stops.";
        return app.ctl.act(cmd);
      },
    };
    return { target: async () => target, control: async () => control };
  }

  private instructions(allowed: boolean): string {
    const p = this.app.p;
    const sel = [...this.app.sel].slice(0, 20).map((id) => {
      const it = p.items.find((i) => i.id === id);
      if (it) return `${id} (${getPart(it.part)?.def.id ?? it.part})`;
      const b = p.boards.find((x) => x.id === id);
      if (b) return `${b.name} (${b.id}${b.module ? `, ${getModule(b.module.preset)?.name ?? b.module.preset}` : ""})`;
      return id;
    });
    const libs = [...new Set(p.items.map((i) => getPart(i.part)?.lib.name).filter(Boolean))];
    return `You are Claude, working inside Railplot, a model railway track planner for OO and H0, with the person whose plan this is. Answer in plain English, briefly; use short lists where they help.

How to work:
- Read the plan with the tools (get_layout first; list_boards, get_track, check_layout, get_parts_list) before answering questions about it. Positions are in mm on the plan, x to the right and y up; headings are in degrees (0 = +x, 90 = +y).
- You never change the plan directly. To change it, use propose_plan: each proposal appears as a card in this chat and under "Claude's proposals" in the Details panel, where the person can Show it on the plan, Accept it or Reject it. Try with preview: true first when unsure, look at what it reports (open ends, misaligned joints, point motors over the frame, track off the boards, overlapping track) and adjust, then send it. One proposal per coherent change, with a clear title and a one-sentence reason. Steps that build on each other go in one proposal.
- Track positions on baseboard modules (list_boards) are where track should cross module joints; build from them so tracks line up. Prefer the track system the plan already uses.
- Places to start from ("at", "from", "to"): {end: "t12:1"} an open end; {port: {board, index, face}} a module track position; {start: id}; {x, y, heading}; {last: true} where the previous step's track ended; {near: {x, y}} the closest open end or free track position.
- propose_plan operations (each step is {op, ...arguments}):
${operationsGuide()}
- ${allowed ? "You may use the layout's controls (routes, points, signals, lights, trains, automations). Say what you'll do before moving trains. You can never switch track power or use emergency stops." : "The layout's controls are off for you. If asked to run trains, say the person can turn on \"Let Claude use the controls\" under Control > Set up."}

Right now: the plan is "${p.name}", with ${p.boards.length} baseboard${p.boards.length === 1 ? "" : "s"} and ${p.items.length} piece${p.items.length === 1 ? "" : "s"} of track${libs.length ? ` (${libs.join(", ")})` : ""}; ${(p.proposals ?? []).length} proposal${(p.proposals ?? []).length === 1 ? "" : "s"} waiting. ${sel.length ? `Selected on the plan: ${sel.join(", ")}.` : "Nothing is selected."} Railplot is in ${this.app.mode === "control" ? "Control" : "planning"} mode${this.app.ctl.hub ? ", connected to the Railplot hub" : ""}.`;
  }
}
