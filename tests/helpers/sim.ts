// Run an engine against the simulator with a fake clock.
import { ControlEngine } from "../../src/control/engine";
import { SimLink } from "../../src/control/link";
import { Project } from "../../src/model";

export async function runSim(p: Project, seconds: number, e = new ControlEngine(p, p.control!), each?: (e: ControlEngine) => void) {
  const cfg = p.control!;
  const sims = cfg.controllers.filter((c) => c.kind === "sim").map((c) => new SimLink(c, () => e));
  let t = 0;
  for (const s of sims) s.clock = () => t;
  for (let i = 0; i < seconds * 10; i++) {
    t += 100;
    e.step(0.1);
    const frames = e.frames();
    for (const s of sims) {
      const st = await s.exchange(frames.get(s.controller.id)!);
      e.updateSensors(s.controller.id, st!.inputs);
    }
    each?.(e);
  }
  return e;
}
