// Talking to Claude from inside Railplot. Two ways in:
// - your own Anthropic API key (the desktop app, the offline file, the page the hub serves): the Messages API,
//   called straight from this window, with Railplot's tools run here;
// - your Claude account, when Railplot runs as a page on claude.ai: the page's `sample` capability.
// Either way Claude only reads the plan and sends proposals (and, if allowed, uses the controls).
import { ToolDef, ToolError } from "./tooldefs";

export interface Turn { role: "user" | "assistant"; content: string }

export interface RunOptions {
  instructions: string;
  turns: Turn[];
  tools: ToolDef[];
  signal: AbortSignal;
  /** The reply so far (all rounds), as it grows. */
  onText(text: string): void;
  /** A tool is about to run / has run. */
  onTool(name: string, input: any, result?: { text: string; error: boolean }): void;
}

export interface ChatBackend {
  kind: "api" | "account";
  label: string;
  run(o: RunOptions): Promise<string>;
}

export class ChatError extends Error {
  constructor(message: string, public code: string, public partial = "") { super(message); }
}

const MAX_RESULT = 30000;
const clip = (s: string) => (s.length > MAX_RESULT ? `${s.slice(0, MAX_RESULT)}\n… (cut short: ask for less, e.g. one board at a time)` : s);

async function runTool(tools: ToolDef[], name: string, input: any, o: RunOptions): Promise<{ text: string; error: boolean }> {
  const t = tools.find((x) => x.name === name);
  o.onTool(name, input);
  let r: { text: string; error: boolean };
  if (!t) r = { text: `There is no tool called ${name}.`, error: true };
  else {
    try { r = { text: clip(String(await t.run(input ?? {}))), error: false }; }
    catch (e) { r = { text: e instanceof ToolError ? e.message : `That didn't work: ${(e as Error).message ?? e}`, error: true }; }
  }
  o.onTool(name, input, r);
  return r;
}

// ---------- your own API key ----------

export const API_URL = "https://api.anthropic.com/v1";
const headers = (key: string) => ({
  "content-type": "application/json",
  "x-api-key": key,
  "anthropic-version": "2023-06-01",
  // the key is the user's own, typed into this window; the request goes straight to Anthropic
  "anthropic-dangerous-direct-browser-access": "true",
});

export interface ModelInfo { id: string; name: string }

/** The models this key can use, newest first. */
export async function listModels(key: string): Promise<ModelInfo[]> {
  let r: Response;
  try { r = await fetch(`${API_URL}/models?limit=100`, { headers: headers(key) }); }
  catch { throw new ChatError("Can't reach Anthropic's API from here. Check the internet connection.", "network"); }
  if (r.status === 401) throw new ChatError("Anthropic didn't accept that API key.", "auth");
  if (!r.ok) throw new ChatError(`Anthropic's API answered ${r.status}.`, "api");
  const j = await r.json();
  return (j.data ?? []).map((m: any) => ({ id: String(m.id), name: String(m.display_name ?? m.id) }));
}

/** A sensible default: the newest Sonnet, else the newest model. */
export function defaultModel(models: ModelInfo[]): string {
  return (models.find((m) => /sonnet/i.test(m.id)) ?? models[0])?.id ?? "";
}

export class ApiBackend implements ChatBackend {
  kind = "api" as const;
  constructor(public key: string, public model: string) {}
  get label() { return `${this.model} with your API key`; }

  async run(o: RunOptions): Promise<string> {
    const messages: any[] = o.turns.map((t) => ({ role: t.role, content: t.content }));
    const tools = o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
    let reply = "";
    for (let round = 0; round < 16; round++) {
      let r: Response;
      try {
        r = await fetch(`${API_URL}/messages`, {
          method: "POST", signal: o.signal, headers: headers(this.key),
          body: JSON.stringify({ model: this.model, max_tokens: 4096, system: o.instructions, messages, tools }),
        });
      } catch (e) {
        if (o.signal.aborted) throw new ChatError("Stopped.", "cancelled", reply);
        throw new ChatError("Can't reach Anthropic's API from here. Check the internet connection.", "network", reply);
      }
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        const msg = body?.error?.message ?? `HTTP ${r.status}`;
        if (r.status === 401) throw new ChatError("Anthropic didn't accept the API key. Check it under Settings.", "auth", reply);
        if (r.status === 404 || /model/i.test(msg) && r.status === 400) throw new ChatError(`The model ${this.model} isn't available: ${msg}`, "model", reply);
        if (r.status === 429 || r.status === 529) throw new ChatError("Claude is busy or the key has hit its limit. Try again in a minute.", "busy", reply);
        throw new ChatError(`Anthropic's API answered: ${msg}`, "api", reply);
      }
      const res = await r.json();
      const text = (res.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      if (text.trim()) { reply = reply ? `${reply}\n\n${text}` : text; o.onText(reply); }
      const uses = (res.content ?? []).filter((b: any) => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !uses.length) return reply;
      messages.push({ role: "assistant", content: res.content });
      const results = [];
      for (const u of uses) {
        if (o.signal.aborted) throw new ChatError("Stopped.", "cancelled", reply);
        const out = await runTool(o.tools, u.name, u.input, o);
        results.push({ type: "tool_result", tool_use_id: u.id, content: out.text, is_error: out.error });
      }
      messages.push({ role: "user", content: results });
    }
    return reply || "I used all my steps without finishing. Ask me to carry on.";
  }
}

// ---------- your Claude account (Railplot running on claude.ai) ----------

type SampleFn = ((input: any, opts?: any) => Promise<{ text: string; truncated: boolean }>) & { limits?: () => Promise<any> };

/** The `sample` capability, when this page runs on claude.ai and may use it; null otherwise. */
export async function accountBackend(): Promise<AccountBackend | null> {
  const c = (window as unknown as { claude?: { use?: (n: string) => Promise<any> } }).claude;
  if (!c?.use) return null;
  const sample: SampleFn | null = await c.use("sample").catch(() => null);
  if (!sample) return null;
  const limits = await sample.limits?.().catch(() => null);
  if (limits && !limits.tools) return null;
  return new AccountBackend(sample, limits?.tools?.maxCount ?? 20);
}

export class AccountBackend implements ChatBackend {
  kind = "account" as const;
  label = "your Claude account";
  constructor(private sample: SampleFn, public maxTools: number) {}

  async run(o: RunOptions): Promise<string> {
    // no system prompt here: the instructions are a leading user turn
    const input = [{ role: "user", content: o.instructions }, ...o.turns];
    const tools = o.tools.slice(0, this.maxTools).map((t) => ({
      name: t.name, description: t.description.slice(0, 1000), inputSchema: t.inputSchema,
      execute: async (args: any) => {
        const r = await runTool(o.tools, t.name, args, o);
        if (r.error) throw new Error(r.text);
        return r.text;
      },
    }));
    let reply = "";
    try {
      const r = await this.sample(input, { tools, signal: o.signal, cache: false, onText: ({ text }: { text: string }) => { reply = text; o.onText(text); } });
      return r.truncated ? `${r.text}\n\n(Cut short. Ask me to carry on.)` : r.text;
    } catch (e: any) {
      const code = String(e?.code ?? "upstream_error");
      const msg: Record<string, string> = {
        cancelled: "Stopped.",
        not_granted: "Claude isn't allowed on this page. Allow it when the page asks, or use the desktop app with an API key.",
        sampling_disabled: "Claude isn't available for this account.",
        rate_limited: "That's a lot of messages for now. Try again in a little while.",
        session_expired: "Sign in to Claude again, then try once more.",
        refused: "Claude declined that one. Try asking differently.",
        prompt_too_large: "The conversation got too long. Start a new chat.",
        tools_unavailable: "Claude can't use Railplot's tools in this view.",
      };
      throw new ChatError(msg[code] ?? "Something went wrong talking to Claude. Try again.", code, code === "refused" ? "" : e?.text ?? reply);
    }
  }
}

// ---------- a little Markdown for the replies ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function inline(s: string) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
}

/** Paragraphs, bullet and numbered lists, headings as bold lines, `code`, **bold**, *italic*. Everything else is text. */
export function renderMarkdown(md: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*[-*•]\s+(.*)$/), ol = line.match(/^\s*\d+[.)]\s+(.*)$/), hd = line.match(/^#{1,6}\s+(.*)$/);
    if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      if (list !== kind) { close(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
    } else if (!line.trim()) close();
    else if (hd) { close(); out.push(`<p><strong>${inline(hd[1])}</strong></p>`); }
    else { close(); out.push(`<p>${inline(line)}</p>`); }
  }
  close();
  return out.join("");
}
