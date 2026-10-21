// Just enough of Bun's and Node's types for the hub, so it type-checks without extra packages.
// (The hub runs on Bun, which provides all of these.)
declare module "*.html" { const text: string; export default text; }

type Buffer = Uint8Array & {
  readUInt16BE(o: number): number; writeUInt16BE(v: number, o: number): number; writeUInt32BE(v: number, o: number): number;
  toString(enc?: string, start?: number, end?: number): string; length: number;
};
declare const Buffer: {
  from(x: string | number[] | ArrayLike<number>, enc?: string): Buffer;
  alloc(n: number): Buffer;
  concat(list: Uint8Array[]): Buffer;
};
interface StdStream {
  on(ev: string, fn: (...a: any[]) => void): this; setEncoding?(enc: string): void; write(s: string): boolean;
}
declare const process: {
  platform: string; argv: string[]; env: Record<string, string | undefined>;
  exit(code?: number): never; on(ev: string, fn: (...a: any[]) => void): void;
  stdin: StdStream; stdout: StdStream; stderr: StdStream; cwd(): string;
};

declare module "node:fs" {
  const fs: {
    existsSync(p: string): boolean; readFileSync(p: string, enc: "utf8"): string; writeFileSync(p: string, d: string): void;
    renameSync(a: string, b: string): void; mkdirSync(p: string, o?: { recursive?: boolean }): void;
    openSync(p: string, flags: string): number; closeSync(fd: number): void; writeSync(fd: number, d: string): number;
    createReadStream(p: string, o?: { fd?: number; autoClose?: boolean; highWaterMark?: number }): ReadStream;
    statSync(p: string): { isDirectory(): boolean; isFile(): boolean; size: number; mtimeMs: number };
    readdirSync(p: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean; isFile(): boolean }[];
    realpathSync(p: string): string; unlinkSync(p: string): void;
  };
  export interface ReadStream { on(ev: string, fn: (...a: any[]) => void): this; destroy(): void }
  namespace fs { type ReadStream = import("node:fs").ReadStream; }
  export default fs;
}
declare module "node:path" {
  const path: {
    join(...p: string[]): string; resolve(...p: string[]): string; dirname(p: string): string; basename(p: string, ext?: string): string;
    extname(p: string): string; relative(a: string, b: string): string; isAbsolute(p: string): boolean; sep: string;
  };
  export default path;
}
declare module "node:os" {
  const os: { homedir(): string; networkInterfaces(): Record<string, { family: string | number; internal: boolean; address: string }[] | undefined> };
  export default os;
}
declare module "node:child_process" {
  export function spawnSync(cmd: string, args: string[], o?: { shell?: boolean }): { status: number | null; error?: Error; stderr?: { toString(): string } };
}
declare module "node:dgram" {
  export interface Socket {
    on(ev: "error", fn: (e: Error) => void): this; on(ev: "message", fn: (msg: Buffer) => void): this;
    bind(port: number, cb?: () => void): void; addMembership(g: string): void; setMulticastTTL(n: number): void;
    send(b: Uint8Array, port: number, addr: string): void; close(): void;
  }
  const dgram: { createSocket(o: { type: "udp4"; reuseAddr?: boolean }): Socket };
  namespace dgram { type Socket = import("node:dgram").Socket; }
  export default dgram;
}
declare module "bun" {
  export interface ServerWebSocket<T> { data: T; send(s: string): void; close(): void }
}
interface BunSocket<T> { data: T; write(d: string | Uint8Array): number; end(): void }
declare const Bun: {
  listen<T>(o: { hostname: string; port: number; socket: {
    open?(s: BunSocket<T>): void; data?(s: BunSocket<T>, chunk: Uint8Array): void; close?(s: BunSocket<T>): void; error?(s: BunSocket<T>, e: Error): void;
  } }): { stop(): void; port: number };
  connect(o: { hostname: string; port: number; socket: {
    open?(s: BunSocket<undefined>): void; data?(s: BunSocket<undefined>, chunk: Uint8Array): void; close?(s: BunSocket<undefined>): void;
    error?(s: BunSocket<undefined>, e: Error): void; connectError?(s: BunSocket<undefined>, e: Error): void;
  } }): Promise<BunSocket<undefined>>;
  serve<T, R = {}>(o: {
    hostname?: string; port: number;
    fetch(req: Request, server: { upgrade(r: Request, o: { data: T }): boolean }): Response | undefined | Promise<Response | undefined>;
    websocket?: { open?(ws: import("bun").ServerWebSocket<T>): void; close?(ws: import("bun").ServerWebSocket<T>): void; message?(ws: import("bun").ServerWebSocket<T>, data: string | Uint8Array): void };
  }): { stop(force?: boolean): void; port: number };
  gzipSync(d: Uint8Array, o?: object): Uint8Array;
};
