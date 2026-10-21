// What a Railplot tool is: used by the Claude connector (MCP over stdio).

export interface ToolDef {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run(args: any): Promise<string> | string;
}

/** A problem the model can fix (a wrong id, a yard that doesn't fit): reported back to it, not a crash. */
export class ToolError extends Error {}
