// A small WebGL2 viewer for the layout: baseboards, track, elevated decks and supports.
import { Pose, Prim, primAt, triangulate } from "./geom";
import { Item, Project, geom, isVisible, projectBounds } from "./model";
import { getModule, moduleToWorld, overallDepth } from "./modules";

type V3 = [number, number, number];

class MeshBuilder {
  pos: number[] = []; nrm: number[] = []; col: number[] = []; idx: number[] = [];
  vert(p: V3, n: V3, c: V3) {
    this.pos.push(...p); this.nrm.push(...n); this.col.push(...c);
    return this.pos.length / 3 - 1;
  }
  quad(a: V3, b: V3, c: V3, d: V3, n: V3, col: V3) {
    const i = this.vert(a, n, col), j = this.vert(b, n, col), k = this.vert(c, n, col), l = this.vert(d, n, col);
    this.idx.push(i, j, k, i, k, l);
  }
}

// world (x, y, z-up mm) -> GL (x, up, -y)
const W = (x: number, y: number, z: number): V3 => [x, z, -y];

const C = {
  rail: [0.62, 0.64, 0.66] as V3, sleeper: [0.27, 0.22, 0.19] as V3, sleeperFlex: [0.33, 0.27, 0.22] as V3,
  boardTop: [0.80, 0.71, 0.55] as V3, boardSide: [0.62, 0.53, 0.39] as V3, backscene: [0.62, 0.76, 0.86] as V3, deck: [0.45, 0.43, 0.40] as V3,
  support: [0.56, 0.55, 0.52] as V3, ballast: [0.52, 0.50, 0.46] as V3,
};

function box(m: MeshBuilder, cx: number, cy: number, h: number, L: number, Wd: number, z0: number, z1: number, col: V3) {
  const dx = Math.cos(h), dy = Math.sin(h), nx = -dy, ny = dx;
  const p = (a: number, b: number, z: number) => W(cx + dx * a + nx * b, cy + dy * a + ny * b, z);
  const l = L / 2, w = Wd / 2;
  const c00 = (z: number) => p(-l, -w, z), c10 = (z: number) => p(l, -w, z), c11 = (z: number) => p(l, w, z), c01 = (z: number) => p(-l, w, z);
  m.quad(c00(z1), c10(z1), c11(z1), c01(z1), [0, 1, 0], col);
  const side = (a: V3, b: V3, nxv: number, nyv: number, shade: number) =>
    m.quad(a, b, [b[0], z0, b[2]], [a[0], z0, a[2]], [nxv, 0, -nyv], col.map((c) => c * shade) as V3);
  side(c10(z1), c00(z1), -nx, -ny, 0.85);
  side(c01(z1), c11(z1), nx, ny, 0.85);
  side(c00(z1), c01(z1), -dx, -dy, 0.75);
  side(c11(z1), c10(z1), dx, dy, 0.75);
}

/** A strip with rectangular cross-section following sampled poses. */
function ribbon(m: MeshBuilder, poses: (Pose & { z: number })[], offset: number, width: number, z0: number, z1: number, col: V3) {
  const ring = poses.map((p) => {
    const nx = -Math.sin(p.h), ny = Math.cos(p.h);
    const cx = p.x + nx * offset, cy = p.y + ny * offset;
    return {
      l0: W(cx + nx * width / 2, cy + ny * width / 2, p.z + z0), l1: W(cx + nx * width / 2, cy + ny * width / 2, p.z + z1),
      r0: W(cx - nx * width / 2, cy - ny * width / 2, p.z + z0), r1: W(cx - nx * width / 2, cy - ny * width / 2, p.z + z1),
      n: [nx, 0, -ny] as V3,
    };
  });
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = ring[i], b = ring[i + 1];
    m.quad(a.l1, b.l1, b.r1, a.r1, [0, 1, 0], col);
    m.quad(a.l0, b.l0, b.l1, a.l1, a.n, col.map((c) => c * 0.8) as V3);
    m.quad(a.r1, b.r1, b.r0, a.r0, [-a.n[0], 0, -a.n[2]], col.map((c) => c * 0.8) as V3);
  }
}

function sampleRoute(prims: Prim[], step: number, z0: number, z1: number): (Pose & { z: number })[] {
  const total = prims.reduce((a, p) => a + p.len, 0) || 1;
  const out: (Pose & { z: number })[] = [];
  let acc = 0;
  prims.forEach((pr, k) => {
    const n = Math.max(1, Math.ceil(pr.len / step));
    for (let i = k === 0 ? 0 : 1; i <= n; i++) {
      const t = (pr.len * i) / n;
      const p = primAt(pr, t);
      out.push({ ...p, z: z0 + (z1 - z0) * ((acc + t) / total) });
    }
    acc += pr.len;
  });
  return out;
}

function routeHeights(it: Item, routeIndex: number): [number, number] {
  const g = geom(it);
  if (g.part.rigid) return [it.z[0] ?? 0, it.z[0] ?? 0];
  void routeIndex;
  return [it.z[0] ?? 0, it.z[1] ?? 0];
}

export interface Options3D { supports: boolean; sleepers: boolean }

export function buildScene(p: Project, opt: Options3D): MeshBuilder {
  const m = new MeshBuilder();
  for (const b of p.boards) {
    const mod = b.module && getModule(b.module.preset);
    const T = mod ? overallDepth(mod) : 18; // module depth, or a plain 18 mm board
    const tri = triangulate(b.pts);
    const top = b.pts.map((q) => m.vert(W(q.x, q.y, 0), [0, 1, 0], C.boardTop));
    for (let i = 0; i < tri.length; i += 3) m.idx.push(top[tri[i]], top[tri[i + 1]], top[tri[i + 2]]);
    for (let i = 0; i < b.pts.length; i++) {
      const a = b.pts[i], c = b.pts[(i + 1) % b.pts.length];
      const ex = c.x - a.x, ey = c.y - a.y, l = Math.hypot(ex, ey) || 1;
      let n: V3 = [ey / l, 0, ex / l];
      const area = b.pts.reduce((s, q, k) => { const r = b.pts[(k + 1) % b.pts.length]; return s + q.x * r.y - r.x * q.y; }, 0);
      if (area < 0) n = [-n[0], 0, -n[2]];
      m.quad(W(a.x, a.y, 0), W(a.x, a.y, -T), W(c.x, c.y, -T), W(c.x, c.y, 0), n, C.boardSide);
    }
    // canopy modules: the lighting pelmet above the track and the backscene behind it
    if (mod?.canopyHeight) {
      const H = mod.canopyHeight;
      for (const f of mod.features) {
        if (f.kind === "canopy" && f.outline) slab(m, f.outline.map((q) => moduleToWorld(mod, b.module!, q)), H, H + 88, C.boardSide);
        if (f.kind === "backscene" && f.line) {
          const [a, c] = f.line.map((q) => moduleToWorld(mod, b.module!, q));
          const ex = c.x - a.x, ey = c.y - a.y, l = Math.hypot(ex, ey) || 1;
          for (const s of [1, -1]) m.quad(W(a.x, a.y, 0), W(c.x, c.y, 0), W(c.x, c.y, H), W(a.x, a.y, H), [(s * -ey) / l, 0, (s * -ex) / l], C.backscene);
        }
      }
    }
  }
  for (const it of p.items) {
    if (!isVisible(p, it)) continue;
    const g = geom(it);
    const prof = g.part.lib.profile;
    const isFlex = g.part.def.type === "flex";
    g.routes.forEach((r, ri) => {
      const [z0, z1] = routeHeights(it, ri);
      const poses = sampleRoute(r.prims, 6, z0, z1);
      const elevated = Math.max(z0, z1) > 0.5;
      if (elevated) {
        ribbon(m, poses, 0, prof.sleeperLength + 8, -5, -0.01, C.deck);
        if (opt.supports && ri === 0) {
          const total = r.length;
          const n = Math.max(1, Math.round(total / 140));
          for (let i = 0; i <= n; i++) {
            const t = (total * i) / n;
            let acc = 0, pose: Pose = r.prims[0] ? primAt(r.prims[0], 0) : { x: 0, y: 0, h: 0 };
            for (const pr of r.prims) { if (t <= acc + pr.len + 1e-6) { pose = primAt(pr, t - acc); break; } acc += pr.len; }
            const z = z0 + (z1 - z0) * (t / (total || 1));
            if (z > 6) box(m, pose.x, pose.y, pose.h, 7, 7, 0, z - 5, C.support);
          }
        }
      }
      if (prof.roadbed) ribbon(m, poses, 0, prof.roadbed.top, 0, prof.roadbed.height, C.ballast);
      const sleeperTop = (prof.roadbed?.height ?? 0) + 1.6;
      if (opt.sleepers) {
        const step = prof.sleeperSpacing;
        const total = r.length;
        const n = Math.max(1, Math.floor(total / step));
        let acc = 0, k = 0;
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) * (total / n);
          while (k < r.prims.length - 1 && t > acc + r.prims[k].len) { acc += r.prims[k].len; k++; }
          const pose = primAt(r.prims[k], Math.min(t - acc, r.prims[k].len));
          const z = z0 + (z1 - z0) * (t / (total || 1));
          box(m, pose.x, pose.y, pose.h, prof.sleeperWidth, prof.sleeperLength, z + sleeperTop - 1.6, z + sleeperTop, isFlex ? C.sleeperFlex : C.sleeper);
        }
      } else {
        ribbon(m, poses, 0, prof.sleeperLength, sleeperTop - 1.6, sleeperTop, C.sleeper);
      }
      const half = g.part.lib.gauge / 2;
      for (const off of [half, -half]) ribbon(m, poses, off, 0.9, sleeperTop, sleeperTop + prof.railHeight, C.rail);
    });
  }
  return m;
}

// ---------- matrices ----------
type M4 = Float32Array;
function persp(fovy: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function lookAt(e: V3, c: V3, up: V3): M4 {
  let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
  let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
}
function mul(a: M4, b: M4): M4 {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
    o[i * 4 + j] = s;
  }
  return o;
}

const VS = `#version 300 es
in vec3 aPos; in vec3 aNrm; in vec3 aCol;
uniform mat4 uMvp; uniform mat4 uModel; uniform vec3 uEye; uniform vec3 uTint;
out vec3 vN; out vec3 vC; out float vD;
void main(){ vec4 w=uModel*vec4(aPos,1.0); vN=mat3(uModel)*aNrm; vC=aCol*uTint; vD=distance(w.xyz,uEye); gl_Position=uMvp*w; }`;
const FS = `#version 300 es
precision highp float;
in vec3 vN; in vec3 vC; in float vD;
uniform vec3 uBg; uniform float uFog;
out vec4 o;
void main(){
  vec3 n=normalize(vN);
  vec3 L=normalize(vec3(-0.45,0.85,0.35));
  float d=max(dot(n,L),0.0);
  float hemi=0.5+0.5*n.y;
  vec3 c=vC*(0.38+0.22*hemi+0.55*d);
  float f=clamp((vD-uFog)/(uFog*3.0),0.0,0.6);
  o=vec4(mix(c,uBg,f),1.0);
}`;

/** A vehicle to draw this frame: its kind and size, colour, and where it stands. */
export interface DynamicVehicle { kind: string; length: number; width: number; height: number; color: V3; x: number; y: number; z: number; h: number; tilt?: number }

/**
 * Vehicle shapes, one unit long (x from -0.5 to 0.5) so a model matrix stretches them to each vehicle's
 * length; widths and heights are in units of the vehicle's width and height. White parts take the
 * vehicle's colour; grey parts stay dark.
 */
function vehicleMesh(kind: string): MeshBuilder {
  const m = new MeshBuilder();
  const body: V3 = [1, 1, 1], dark: V3 = [0.16, 0.16, 0.17], roof: V3 = [0.45, 0.45, 0.47];
  const part = (x0: number, x1: number, w: number, z0: number, z1: number, col: V3) => box(m, (x0 + x1) / 2, 0, 0, x1 - x0, w, z0, z1, col);
  part(-0.5, 0.5, 0.86, 0.0, 0.16, dark);                    // underframe and wheels
  part(-0.5, 0.5, 0.6, 0.0, 0.05, dark);
  if (kind === "loco") {
    part(-0.46, 0.2, 0.86, 0.16, 0.78, body);                // long bonnet or boiler
    part(0.2, 0.46, 1.0, 0.16, 1.0, body);                   // cab
    part(0.18, 0.48, 1.04, 0.98, 1.04, roof);                // cab roof
    part(-0.36, -0.3, 0.2, 0.78, 0.98, dark);                // chimney or exhaust
  } else if (kind === "coach") {
    part(-0.49, 0.49, 1.0, 0.16, 0.86, body);
    part(-0.49, 0.49, 0.9, 0.86, 1.0, roof);
  } else if (kind === "tank") {
    part(-0.42, 0.42, 0.84, 0.18, 0.84, body);
  } else if (kind === "van" || kind === "brake") {
    part(-0.47, 0.47, 1.0, 0.16, 0.86, body);
    part(-0.47, 0.47, 1.02, 0.86, 0.92, roof);
  } else {
    // open wagon: four sides, no top
    part(-0.47, 0.47, 1.0, 0.16, 0.24, body);
    box(m, 0, 0.46, 0, 0.94, 0.08, 0.16, 0.62, body); box(m, 0, -0.46, 0, 0.94, 0.08, 0.16, 0.62, body);
    box(m, 0.45, 0, 0, 0.04, 1.0, 0.16, 0.62, body); box(m, -0.45, 0, 0, 0.04, 1.0, 0.16, 0.62, body);
  }
  part(-0.52, -0.48, 0.7, 0.08, 0.14, dark); part(0.48, 0.52, 0.7, 0.08, 0.14, dark);   // buffer beams
  return m;
}

/** A matrix placing a unit vehicle mesh: stretched to its size, turned to its heading (and tilted), stood at its place. */
function vehicleMatrix(v: DynamicVehicle): M4 {
  const c = Math.cos(v.h), s = Math.sin(v.h), tc = Math.cos(v.tilt ?? 0), ts = Math.sin(v.tilt ?? 0);
  // the mesh's GL axes are along (x), up (y) and right (z); in the world they become the vehicle's
  // forward [c, 0, -s], up, and right [s, 0, c], with up and right rolled by the tilt
  const X: V3 = [c * v.length, 0, -s * v.length];
  const Y: V3 = [s * ts * v.height, tc * v.height, c * ts * v.height];
  const Z: V3 = [s * tc * v.width, -ts * v.width, c * tc * v.width];
  const [px, py, pz] = W(v.x, v.y, v.z);
  return new Float32Array([X[0], X[1], X[2], 0, Y[0], Y[1], Y[2], 0, Z[0], Z[1], Z[2], 0, px, py, pz, 1]);
}

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export class View3D {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject | null = null;
  private count = 0;
  private bufs: WebGLBuffer[] = [];
  private target: V3 = [0, 0, 0];
  private distance = 3000;
  private yaw = -0.6;
  private pitch = 0.75;
  private extent = 3000;
  private raf = 0;
  private bg: V3 = [0.93, 0.94, 0.92];
  private cleanup: (() => void)[] = [];
  opts: Options3D = { supports: true, sleepers: true };
  private project: Project | null = null;
  /** Vehicles drawn over the layout this frame. */
  private dynamic: DynamicVehicle[] = [];
  private vehicleVaos = new Map<string, { vao: WebGLVertexArrayObject; count: number }>();
  /** A camera following something (chase, cab): eye and target in plan mm (x, y, z up). Null: orbit. */
  follow: { eye: [number, number, number]; target: [number, number, number] } | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error("3D view needs WebGL 2, which this system doesn't provide.");
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    this.prog = p;
    this.bindControls();
  }

  setBackground(css: string) {
    const m = css.match(/#([0-9a-f]{6})/i);
    if (m) { const n = parseInt(m[1], 16); this.bg = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
    this.draw();
  }

  /** Put a mesh on the GPU. `keep` collects its buffers so they can be freed later. */
  private upload(m: MeshBuilder, keep: WebGLBuffer[]): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const attr = (name: string, data: number[]) => {
      const b = gl.createBuffer()!; keep.push(b);
      gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(this.prog, name);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    };
    attr("aPos", m.pos); attr("aNrm", m.nrm); attr("aCol", m.col);
    const ib = gl.createBuffer()!; keep.push(ib);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(m.idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return vao;
  }

  setProject(p: Project, resetCamera = true) {
    this.project = p;
    const gl = this.gl;
    const m = buildScene(p, this.opts);
    for (const b of this.bufs) gl.deleteBuffer(b);
    this.bufs = [];
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.vao = this.upload(m, this.bufs);
    this.count = m.idx.length;
    if (resetCamera) this.resetCamera();
    this.draw();
  }

  /** The vehicles to draw from now on (the layout's mesh stays as it is). */
  setDynamic(v: DynamicVehicle[]) { this.dynamic = v; this.draw(); }

  private vehicleVao(kind: string) {
    let x = this.vehicleVaos.get(kind);
    if (!x) { const m = vehicleMesh(kind); x = { vao: this.upload(m, this.vehicleBufs), count: m.idx.length }; this.vehicleVaos.set(kind, x); }
    return x;
  }
  private vehicleBufs: WebGLBuffer[] = [];

  rebuild() { if (this.project) this.setProject(this.project, false); }

  resetCamera() {
    const b = this.project ? projectBounds(this.project) : null;
    if (b) {
      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
      this.target = W(cx, cy, 0);
      this.extent = Math.max(b.maxX - b.minX, b.maxY - b.minY, 300);
    } else { this.target = [0, 0, 0]; this.extent = 2000; }
    this.distance = this.extent * 1.5;
    this.yaw = -0.6; this.pitch = 0.72;
    this.draw();
  }

  private eye(): V3 {
    const [tx, ty, tz] = this.target;
    const cp = Math.cos(this.pitch);
    return [tx + this.distance * cp * Math.sin(this.yaw), ty + this.distance * Math.sin(this.pitch), tz + this.distance * cp * Math.cos(this.yaw)];
  }

  draw() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.render());
  }

  render() {
    const gl = this.gl, c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(this.bg[0], this.bg[1], this.bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.vao) return;
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.prog);
    const f = this.follow;
    const eye = f ? W(...f.eye) : this.eye();
    const target = f ? W(...f.target) : this.target;
    // following a train the eye is close to the track: a near plane of a few mm keeps the rails in view
    const proj = f ? persp(0.95, w / h, 2, this.extent * 4) : persp(0.75, w / h, Math.max(1, this.distance / 200), this.distance * 20 + this.extent * 4);
    const view = lookAt(eye, target, [0, 1, 0]);
    const loc = (n: string) => gl.getUniformLocation(this.prog, n);
    gl.uniformMatrix4fv(loc("uMvp"), false, mul(proj, view));
    gl.uniformMatrix4fv(loc("uModel"), false, IDENTITY);
    gl.uniform3fv(loc("uTint"), [1, 1, 1]);
    gl.uniform3fv(loc("uEye"), eye);
    gl.uniform3fv(loc("uBg"), this.bg);
    gl.uniform1f(loc("uFog"), f ? this.extent * 1.2 : this.distance * 1.4);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    for (const v of this.dynamic) {
      const mesh = this.vehicleVao(v.kind);
      gl.uniformMatrix4fv(loc("uModel"), false, vehicleMatrix(v));
      gl.uniform3fv(loc("uTint"), v.color);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  private bindControls() {
    const c = this.canvas;
    let drag: { x: number; y: number; mode: "orbit" | "pan" } | null = null;
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, mode: e.button === 2 || e.button === 1 || e.shiftKey ? "pan" : "orbit" };
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.mode === "orbit") {
        this.yaw -= dx * 0.006;
        this.pitch = Math.max(0.05, Math.min(1.5, this.pitch + dy * 0.005));
      } else {
        const k = this.distance / Math.max(300, c.clientHeight);
        const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
        // right = (cos, 0, -sin), forward along the ground = (-sin, 0, -cos)
        this.target = [
          this.target[0] - cy * dx * k - sy * dy * k,
          this.target[1],
          this.target[2] + sy * dx * k - cy * dy * k,
        ];
      }
      this.draw();
    };
    const up = () => { drag = null; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.distance = Math.max(60, Math.min(this.extent * 8, this.distance * Math.exp(e.deltaY * 0.0012)));
      this.draw();
    };
    const ctx = (e: Event) => e.preventDefault();
    const dbl = () => this.resetCamera();
    c.addEventListener("pointerdown", down); c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up); c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", wheel, { passive: false }); c.addEventListener("contextmenu", ctx);
    c.addEventListener("dblclick", dbl);
    const ro = new ResizeObserver(() => this.draw()); ro.observe(c);
    this.cleanup.push(() => {
      c.removeEventListener("pointerdown", down); c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up); c.removeEventListener("pointercancel", up);
      c.removeEventListener("wheel", wheel); c.removeEventListener("contextmenu", ctx); c.removeEventListener("dblclick", dbl);
      ro.disconnect();
    });
  }

  orbitBy(dyaw: number, dpitch: number) { this.yaw += dyaw; this.pitch = Math.max(0.05, Math.min(1.5, this.pitch + dpitch)); this.draw(); }
  zoomBy(f: number) { this.distance = Math.max(60, Math.min(this.extent * 8, this.distance * f)); this.draw(); }

  snapshot(): Promise<Blob | null> {
    this.render();
    return new Promise((res) => this.canvas.toBlob((b) => res(b), "image/png"));
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const f of this.cleanup) f();
    const gl = this.gl;
    for (const b of [...this.bufs, ...this.vehicleBufs]) gl.deleteBuffer(b);
    if (this.vao) gl.deleteVertexArray(this.vao);
    for (const x of this.vehicleVaos.values()) gl.deleteVertexArray(x.vao);
    gl.deleteProgram(this.prog);
  }
}

/** A flat slab with a polygon outline between two heights (top, bottom and sides). */
function slab(m: MeshBuilder, pts: { x: number; y: number }[], z0: number, z1: number, col: V3) {
  const tri = triangulate(pts);
  const top = pts.map((q) => m.vert(W(q.x, q.y, z1), [0, 1, 0], col));
  const bot = pts.map((q) => m.vert(W(q.x, q.y, z0), [0, -1, 0], col));
  for (let i = 0; i < tri.length; i += 3) { m.idx.push(top[tri[i]], top[tri[i + 1]], top[tri[i + 2]]); m.idx.push(bot[tri[i]], bot[tri[i + 2]], bot[tri[i + 1]]); }
  const area = pts.reduce((s, q, k) => { const r = pts[(k + 1) % pts.length]; return s + q.x * r.y - r.x * q.y; }, 0);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length];
    const ex = c.x - a.x, ey = c.y - a.y, l = Math.hypot(ex, ey) || 1;
    let n: V3 = [ey / l, 0, ex / l];
    if (area < 0) n = [-n[0], 0, -n[2]];
    m.quad(W(a.x, a.y, z1), W(a.x, a.y, z0), W(c.x, c.y, z0), W(c.x, c.y, z1), n, col);
  }
}
