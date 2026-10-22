# Architecture: Railplot Drive (a simplified rebuild of Rolling Line's driving and operating)

Built from `recon.md` and `features.csv`. This is a feature inside Railplot, not a new app, so it uses
Railplot's stack and file format. The skill's default web-SaaS stack (Next.js, Postgres, auth,
payments) doesn't apply: there are no accounts, no server database and nothing to sell.

## Stack

| layer | choice | why |
| --- | --- | --- |
| app | Railplot's TypeScript web app, bundled by Bun into one HTML file | It already runs everywhere Railplot does: desktop (Tauri), browser, offline file, hub page, ESP32 |
| 3D | Railplot's own WebGL 2 viewer (`src/view3d.ts`), extended | No engine to add; the layout scene already exists. Vehicles become a second, dynamic draw pass |
| simulation | A new `src/sim/` module: a deterministic, fixed-step world | Pure TypeScript with no DOM, so it runs in the browser, in the hub and in unit tests alike |
| control | Railplot's control engine, unchanged in role | The world sits where the layout hardware sits: the engine powers blocks; the world moves trains, trips sensors and reports currents |
| storage | The `.railplot` file (JSON), under `control` | One file per layout, like everything else; consists stand where you left them |
| multi-device | The Railplot hub (Bun) | The hub runs the world when it drives the layout; phones get positions in its snapshot |
| UI | Railplot's DOM helpers (`h`, dialogs, toasts) and CSS tokens | Matches the rest of the app |
| tests | `bun test` for the world and track; Playwright click-through for the drive view | As for every other Railplot feature |
| hosting | Unchanged: GitHub Releases, GitHub Pages | |

No new runtime dependencies.

### The one decision that shapes the rest

The world is a **pretend layout**, not a game layer on top of Railplot. Today the simulator (`SimLink`)
fakes a controller: it reads block power and pretends trains moved. The new world does the same job
with real track positions:

```
throttle ──► ControlEngine ──duty per block──► World (sim) ──► sensors tripped, currents, shorts
   ▲              ▲  (blocks, signals,                │
   │              │   automations, faults)            ▼
  HUD ◄────── snapshot ◄──────────────────── consist positions ──► 3D view
```

- A loco moves when **the block under it** is powered, the same as on a real DC layout.
- Sensors trip when a vehicle passes the sensor's position on the track.
- Current detection reads which blocks have vehicles in them.
- A derailment is reported as a **short** in its block (2 A), so the engine's existing fault handling
  cuts the block, stops the train and tells the driver.

So everything the control engine does (blocks, signals, routes, trips, automations, current detection,
the hub, Engine Driver throttles) works with the 3D trains on day one, and nothing in the engine needs
to know it isn't a real layout.

## Schema

There's no database. The persisted data is three optional fields added to the `.railplot` file's
`control` object, as TypeScript types in `src/control/types.ts`. Older Railplot versions ignore them.

Stored entities: 2 (Consist, with its Vehicles inside it). Runtime only: TrackPos, Derailment, DriveView.
Access rules: none; it's the owner's file. Through a hub, the same rule as today: any connected device
may drive (driving was never restricted on the hub), and Claude only with "Let Claude use the controls",
never re-railing or derailment settings (they change the world, not the controls).

```ts
/** A place on the track: a piece, one of its routes, a distance along that route, and which way along it. */
export interface TrackPos {
  item: string;            // track piece id
  route: number;           // index into the piece's routes (0 = straight road of a point)
  s: number;               // mm from the route's start
  dir: 1 | -1;             // +1: facing the route's end
}

export type VehicleKind = "loco" | "coach" | "wagon" | "van" | "tank" | "brake";

export interface VehicleCfg {
  id: string;
  kind: VehicleKind;
  name?: string;
  length: number;          // mm over buffers
  color: string;
  /** Draws current in a detection pulse (a loco, or a wagon with a resistor wheelset). */
  detectable?: boolean;
}

export interface ConsistCfg {
  id: string;
  /** The control train that drives it (has the loco); none for wagons standing on their own. */
  train?: string;
  vehicles: VehicleCfg[];  // front to back
  /** Where the front vehicle's centre is; the rest follow along the track behind it. */
  at: TrackPos;
  /** Derailed vehicles keep their free pose until re-railed. */
  derailed?: { vehicle: string; x: number; y: number; z: number; h: number; tilt: number }[];
}

export interface ControlConfig {
  // ...existing fields
  consists?: ConsistCfg[];
  /** How forgiving derailments are; default "forgiving". */
  derailments?: "off" | "forgiving" | "realistic";
}
```

Rules the types don't carry, enforced in `src/sim/world.ts`, and checked when a file is read
(`io.ts`, which today checks the track parts but not `control`; these are its first `control` checks):

- **One consist per control train.** `consists.filter(c => c.train === t.id).length <= 1`.
- **A consist's `at` must point at an existing piece and route**; otherwise it's dropped on load
  (like scenery and proposals pointing at deleted track).
- **No two consists overlap** when placed. The world refuses the placement (F02 edge).
- **Units:** lengths in mm, speeds in mm/s of real model speed. Scale speed (km/h, mph) is only for
  display, from the track library's scale (OO 1:76.2, H0 1:87).
- **Deleting track** under a consist: the consist is moved to the nearest remaining track if one is
  within 50 mm, otherwise taken off the layout with a toast. Never left pointing at nothing.

Prefs (per device, `localStorage`, not the file): speed units, camera, mouse sensitivity, sound.

## API

Railplot has no HTTP API of its own for this. There are two interfaces: the module boundaries inside
the app, and the hub's command protocol (`src/control/remote.ts`), which phones and the browser use
to drive through a hub. New commands extend the existing `Cmd` union. All go through `applyCommand`,
so they work locally and on the hub the same way.

### Module interfaces

| module | does | used by | flow |
| --- | --- | --- | --- |
| `sim/track.ts` `TrackGraph.from(p, points)` | Builds the graph of pieces, routes and joints from the plan and how the points are set | world, tests | all |
| `TrackGraph.advance(pos, ds)` | Moves a TrackPos `ds` mm along the track, across joints and through points; returns the new pos or why it stopped (`open-end`, `trailing-against`) | world | F01, F07 |
| `TrackGraph.pose(pos)` | World x, y, z, heading and curvature at a pos | world, view | F01 |
| `sim/stock.ts` `STOCK[scale]` | The vehicle types with lengths for OO and H0 | Trains panel | F02 |
| `sim/world.ts` `World.step(dt, dutyByBlock)` | Fixed 1/120 s steps: speed from block power and inertia, move every vehicle, couple, collide, derail, cross sensors | SimLink, hub | F01, F03, F07 |
| `World.place(consist, pos)` / `couple` / `uncouple(consist, after)` / `rerail(consist, how)` | The operations behind the commands below | applyCommand | F02, F03, F07 |
| `World.readings(controller)` | Sensor bits, `mA` and idle `dmA` per channel, like a real controller's reply | SimLink | all |
| `sim/derail.ts` `check(...)` | The derailment rules from the recon map, per cause and per setting | world | F07 |
| `view3d.ts` `View3D.setDynamic(vehicles)` / `setCamera(mode, target)` | Draws vehicles each frame over the static layout; tabletop, chase, cab and walk cameras | drive UI | F01, F06 |
| `sim/driveui.ts` `DriveView` | The HUD, keyboard and touch controls, train picker, cards | app | all |

### Commands (`Cmd`), through `applyCommand`, locally and on the hub

| command | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| `throttle` (exists) | Sets a train's throttle | any driver; Claude if allowed | train, v | ok / error | F01 |
| `point` (exists) | Throws a point; refused when a vehicle stands on it | any driver; Claude if allowed | item, state | ok / "a train is on it" | F03 |
| `consist` (new) | Creates or replaces a consist: vehicles and where it stands | any driver | consist (without id to create) | its id / "won't fit there" | F02 |
| `couple` (new) | Joins two consists whose ends touch | any driver | a, b | ok / "not touching" | F03 |
| `uncouple` (new) | Splits a consist after a vehicle; the back part becomes a consist without a train | any driver | consist, after vehicle | new consist id | F03 |
| `rerail` (new) | Puts a derailed consist back: where it came off, or where it last stood | any driver | consist, "here" or "last-stop" | ok | F07 |
| `derailMode` (new) | off, forgiving or realistic | the layout's owner (the device that sent the layout); not Claude | mode | ok | F07 |
| `removeConsist` (new) | Takes a consist off the layout | any driver | consist | ok | F02 |

Snapshot (hub → phones, the existing message, sent on each 10 Hz hub tick when something changed) gets one new field:
`consists: [id, item, route, s, dir, speed, derailed][]`. Phones interpolate between snapshots for
smooth 3D. Full consist contents go in the layout, which phones already fetch.

Webhooks: none. Jobs: none. The world steps in the existing control loop (browser: animation frame;
hub: its 10 Hz tick, sub-stepped to 1/120 s).

Third-party APIs: none. Nothing of Rolling Line's is used: no code, assets or endpoints.

## The parts that bite

- **Floating-point drift.** Positions are stored as (piece, route, s), never as x, y, so a train going
  round an oval for an hour ends up exactly on the track. Each vehicle keeps its own TrackPos and all
  vehicles of a consist advance by the same `ds`, so spacing never drifts and each vehicle follows
  the track under it, not the head's path.
- **Points under trains.** A point thrown with a vehicle on it would teleport the train. The world
  locks points that have a vehicle on them (the command is refused, as the engine already does for
  moving trains), and a point set against a train coming the trailing way is a derailment, not a jump.
- **Determinism.** Fixed 1/120 s steps with a step cap (a hidden browser tab must not fling trains
  through the layout when it comes back); an injectable clock for tests, as `SimLink` has today.
- **Two places stepping the world.** With a hub connected, only the hub steps the world; the browser
  shows the hub's positions. Without one, the browser steps it. Never both (the existing `suspended`
  rule for links already covers this).
- **Joints between pieces.** Ends join within 0.5 mm (`analyze`). Advancing across a joint carries the
  remainder into the next piece; a misaligned joint (`an.bad`) counts as an open end, so a badly laid
  plan stops trains rather than letting them jump gaps.
- **Crossings and slips** have routes that cross; the graph treats each route as its own path, and
  collisions are checked in space, not by piece, so two trains on a diamond can still meet.
- **Collisions.** Checked between the end vehicles of consists that share a piece or neighbouring
  pieces (graph distance), not all pairs, so 20 trains stay cheap.
- **Rendering speed.** The static layout mesh is built once (as today); vehicles are a handful of
  shared box meshes drawn with a per-vehicle model matrix, so 100 vehicles cost 100 draw calls of a
  few dozen triangles. Phones run at 30 fps.
- **Cameras.** Chase and cab follow the track pose with smoothing; walk mode keeps the eye at model
  figure height (about 23 mm in OO) and stops at board edges. The near plane drops to 1 mm in cab and
  walk modes.
- **Scale speed.** Displayed speed is real mm/s × scale ratio; a library without a scale shows mm/s.
- **Engine compatibility.** Trains without a consist still need to move in the existing two-train demo
  and tests. The world gives each control train without a consist a loco-only consist in the middle of
  its block when the simulator starts, and the old `progressOf` stays as a derived value for the 2D overlay.
- **File compatibility.** New fields are optional, so older Railplot versions open the file; consists
  pointing at deleted track are dropped on load.
- **Offline and privacy.** Nothing leaves the device except through the user's own hub.

## Build order

1. **Vertical slice: a train you can drive round the layout in 3D.**
   Screens: S01 (Drive in 3D button), S02 (tabletop), S03 (chase), S06 (throttle).
   Data: `TrackPos`, a loco-only consist per control train (not saved yet).
   Code: `sim/track.ts` (graph, advance, pose), `sim/world.ts` (one loco per train, moved by block
   power, sensors tripped at their real positions), `SimLink` as a thin adapter over the world,
   `View3D` dynamic pass and chase camera, a minimal HUD.
   Commands: existing `throttle`, `point`.
   Done when: the two-train demo runs in 3D on the sample oval, through the loop as the points are set,
   with the existing control tests and e2e demo still passing.
2. **Must-haves.**
   - Rolling stock and placing trains: S07, S08; `consist`, `removeConsist`; `consists` saved in the file.
   - Coupling and shunting: S09; `couple`, `uncouple`.
   - Points and signals in 3D: S10 (click the point lever and signal heads).
   - Cab camera: S04. Scale km/h and mph on the HUD.
   - Curve derailments and re-railing: S13; `sim/derail.ts` curve rule; `rerail`.
3. **Should-haves.** Collisions (bounce or derail), trailing-point and open-end derailments, the block
   fault on derailment, `derailMode` and the curve warning; Auto drive from the HUD (S11, existing trips);
   walk mode (S05); current detection and sensors from real vehicle positions (wagons with resistor
   wheelsets); shunting session laid out in 3D (F04); click a train to follow; pause and key overlay
   (S12); phone touch controls; horn. Then the could-haves: sounds, smoke, auto switch, trigger
   markers, speed limits, debug lines, photo mode, lighting, buffer-locking.
4. **Fixes from replica-entrepreneur:** not run yet.
