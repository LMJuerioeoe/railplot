# Build log: Railplot Drive

One line per screen: id, date, done or partial, what's missing, what was harder than expected.

| ID | date | state | missing | harder than expected |
| --- | --- | --- | --- | --- |
| S01 | 2026-10-22 | done | — | The "Drive in 3D" button overflowed the Stop / Power row; it has a row of its own. |
| S02 | 2026-10-22 | done | Clicking things in 3D (points, signals, trains) comes with S10 | Moving vehicles needed the 3D view split into a static layout mesh and a per-frame vehicle pass with its own model matrix. |
| S03 | 2026-10-22 | done | Click a train to follow it | Following the loco's heading looked off the track on curves; the camera now places its eye and target along the track itself. |
| S04 | 2026-10-22 | done | — | The first cab camera sat inside the loco body; it now sits at the loco's front. |
| S05 | — | not started | Walk mode | |
| S06 | 2026-10-22 | partial | Horn; held-at-red and derailed throttle states; curve warning (comes with derailments) | **Direction.** The control engine thinks in blocks: a trip always says "forward" and expects the train to head for its next block. A train on real track faces one way. The world now steers a train on a trip towards the next block of its way (matching the blocks ahead in each direction, because both ends of a loop lead into the same block), and otherwise keeps it going the way it was until the driver reverses. |
| S07 | — | not started | Rolling stock and making up trains (each train is a loco only for now) | |
| S08 | — | not started | Placing a train on the track by clicking | |
| S09 | — | not started | Coupling and uncoupling | |
| S10 | — | not started | Points and signals in 3D | |
| S11 | — | not started | Auto drive from the HUD (trips already run, from the Auto tab) | |
| S12 | — | not started | Settings and help overlay (U and C work as keys) | |
| S13 | 2026-10-22 | done | Collisions between trains (with S09); the slide is not animated (vehicles appear tipped at rest) | **Speeds.** At the old simulated top speed (450 mm/s) no train could ever come off a Setrack curve. Real OO and H0 locos run at 0.6–1 m/s on 12 V and do fly off, so full speed is now 800 mm/s, and the default is Realistic, not Forgiving as `architecture.md` planned, so the feature is felt. The two-train demo's fast test runs with derailments off; the click-through drives the express at 60% where it checks block changes. |

## Notes

- **The simulator was replaced, not added to.** `SimLink` is now a thin adapter over `src/sim/world.ts`. Every existing control test, the click-through and the hub test pass against the new world. Two click-through steps had to change because the new simulator is truer to life: the express no longer jumps to the middle of a block, so it was in the goods shuttle's way and is put back by hand first; and a train stopped across a block joint now really draws current in both blocks, so the current-detection check picks a block with no vehicle in it.
- **Through a hub,** the hub runs the world, but the browser doesn't get vehicle positions yet, so Drive in 3D is offered only when this window runs the simulator itself.
