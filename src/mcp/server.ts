// A small Model Context Protocol server over stdio: newline-delimited JSON-RPC 2.0.
// Only what Railplot needs: initialize, ping and tools.

export interface ToolDef {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run(args: any): Promise<string> | string;
}

export class ToolError extends Error {}

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export interface ServerInfo { name: string; title: string; version: string; instructions: string }

type Msg = { jsonrpc: "2.0"; id?: number | string | null; method?: string; params?: any; result?: unknown; error?: unknown };

export class McpServer {
  private tools = new Map<string, ToolDef>();
  constructor(public info: ServerInfo, tools: ToolDef[], private write: (line: string) => void = (l) => process.stdout.write(l)) {
    for (const t of tools) this.tools.set(t.name, t);
  }

  get toolList() { return [...this.tools.values()]; }

  /** Handle one message; returns the reply, or null for notifications. */
  async handle(msg: Msg): Promise<Msg | null> {
    const id = msg.id;
    const isRequest = id !== undefined && id !== null && typeof msg.method === "string";
    const reply = (result: unknown): Msg => ({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string): Msg => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
    if (typeof msg.method !== "string") return null;   // a response to something we never send
    try {
      switch (msg.method) {
        case "initialize": {
          const asked = msg.params?.protocolVersion;
          return reply({
            protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: this.info.name, title: this.info.title, version: this.info.version },
            instructions: this.info.instructions,
          });
        }
        case "ping": return isRequest ? reply({}) : null;
        case "tools/list":
          return reply({
            tools: this.toolList.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })),
          });
        case "tools/call": {
          const t = this.tools.get(msg.params?.name);
          if (!t) return fail(-32602, `Unknown tool: ${msg.params?.name}`);
          try {
            const text = await t.run(msg.params?.arguments ?? {});
            return reply({ content: [{ type: "text", text }], isError: false });
          } catch (e) {
            // problems the model can fix (a wrong id, a yard that doesn't fit) come back as tool errors
            return reply({ content: [{ type: "text", text: (e as Error).message || String(e) }], isError: true });
          }
        }
        default:
          if (msg.method.startsWith("notifications/")) return null;
          return isRequest ? fail(-32601, `Method not found: ${msg.method}`) : null;
      }
    } catch (e) {
      return isRequest ? fail(-32603, (e as Error).message) : null;
    }
  }

  /** Read messages from stdin until it closes. */
  serve(input: StdStream = process.stdin): Promise<void> {
    return new Promise((resolve) => {
      let buf = "";
      let chain = Promise.resolve();
      const dec = new TextDecoder();
      input.setEncoding?.("utf8");
      input.on("data", (chunk: string | Uint8Array) => {
        buf += typeof chunk === "string" ? chunk : dec.decode(chunk, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          // handle one at a time, in order
          chain = chain.then(() => this.line(line));
        }
      });
      input.on("end", () => { chain.then(() => resolve()); });
    });
  }

  private async line(line: string) {
    let msg: Msg;
    try { msg = JSON.parse(line); }
    catch { this.send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); return; }
    if (Array.isArray(msg)) {
      const out = (await Promise.all(msg.map((m) => this.handle(m)))).filter(Boolean);
      if (out.length) this.send(out);
      return;
    }
    const r = await this.handle(msg);
    if (r) this.send(r);
  }

  private send(m: unknown) { this.write(JSON.stringify(m) + "\n"); }
}
