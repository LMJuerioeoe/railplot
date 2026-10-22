# Recon map: Rolling Line (Windows PC, desktop and VR)

Scope: **driving and operating model trains in 3D on a layout**: put a train of a loco and wagons on the track, drive it with a throttle, throw points and obey signals, couple and uncouple wagons, and watch from above (tabletop), behind the train (chase), from the cab, or on foot at miniature scale. Built into Railplot's existing simulator and 3D view, on the layout you planned. Not the layout or scenery builder, VR, multiplayer or the Steam Workshop.
For: Railplot users who want to try their planned layout before building it: does the shunting work, do trains fit, how does it look from track level. It also makes the control simulator something you can watch and play with.
Date: 2026-10-22

Clean-room: Rolling Line's code, models, sounds, liveries and layouts are not used. This map records what the game does and how a player moves through it, from public sources only.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Steam store listing | https://store.steampowered.com/app/754150/rolling_line | The pitch: tabletop scale or explore on foot at miniature scale; keyboard and mouse or VR; Workshop layouts; multiplayer. |
| 2 | Store summary (Deku Deals) | https://www.dekudeals.com/items/rolling-line | Feature list mirrored from the store: official layouts from NZ, US, Brazil; magazine; weather. |
| 3 | Launch article (VR Room) | https://archive.vrroom.studio/?p=18899 | Driving at human scale with hand-held controllers. |
| 4 | Multiplayer update (racinggames.gg) | https://racinggames.gg/article/rolling-line-adds-multiplayer-in-massive-new-update | Operating trains, signals and switches together; server browser; join codes. |
| 5 | Multiplayer report (Denfaminicogamer) | https://news.denfaminicogamer.jp/news/251109j | Same update, dated around November 2025. |
| 6 | Patch notes (SteamDB) | https://steamdb.info/patchnotes/8226652 | Auto Drive (trains start and stop at signals), Auto Switch (points set to an empty road), AI trigger signs (horn, reverse, speed limit), AI debug lines; speeds in mph or km/h. |
| 7 | Patch notes (SteamDB) | https://steamdb.info/patchnotes/8562350 | Train sound mods, Doppler; track detailing; invisible track. |
| 8 | Patch notes (SteamDB) | https://steamdb.info/patchnotes/8832683 | Later fixes and modding changes. |
| 9 | PC hotkeys (Magic Game World) | https://www.magicgameworld.com/?p=125466 | Q/E or arrow keys for train speed, C cycles the camera, a key switches large and miniature mode, F3 fast scaling. Third-party: check in the game. |
| 10 | Rail Forums thread | https://www.railforums.co.uk/goto/post?id=5030247 | Trains are run with DCC-style hand-held controllers; a short user guide ships with the game. |
| 11 | Workshop item changelog | https://steamcommunity.com/sharedfiles/filedetails/changelog/3034635104 | Example of a community mod's history: how stock and layouts are shared. |

Not available: the help centre (the game has an in-game magazine instead), a pricing tier list (one-off price, about $20), public API docs (none), the user's own account (not used). No screenshots were captured: see `screens/README.md`.

## Core loop

Drive a model train round your own layout and do something with it, on a run or a shunting job, seen from as close as you like.

## Screens

Rolling Line's screens as far as public sources show them, with what Railplot's version would be (ids are Railplot's).

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Plan, Control mode | Control on the toolbar (exists) | The way in: pick the simulator, pick **Drive in 3D** | toolbar, Control panel tabs, new "Drive in 3D" button | no trains yet, trains placed, simulator not set up |
| S02 | 3D drive view, tabletop camera | Drive in 3D, or C to cycle cameras | Watch the whole layout like a real model on a table, click to interact | WebGL canvas, HUD, camera chip | loading the scene, filled, WebGL missing (error) |
| S03 | Chase camera | C, or double-click a train | Follow a train from behind and above | canvas, HUD, train name tag | following, train removed (falls back to S02) |
| S04 | Cab view | C | The driver's view down the track ahead | canvas, HUD, speed readout | moving, stopped, reversing (view flips) |
| S05 | Miniature, on foot | M (Rolling Line: large / miniature switch) | Walk round the layout at model-figure height, WASD and mouse look | canvas, crosshair, HUD | walking, blocked by board edge, inside a tunnel or under a bridge |
| S06 | Throttle (HUD) | Always on screen in S02–S05 | Drive the selected train | train picker, throttle slider (Q/E, arrows), reverser, brake, horn, speed in scale km/h or mph, "Auto drive" toggle | stopped, accelerating, braking, held at a red signal, no train selected |
| S07 | Trains and rolling stock | Trains tab in the HUD, or Set up | Make up a train: a loco and wagons from a small stock list | stock list (loco, coach, wagon types, lengths from the plan's scale), consist strip, colours | empty, filled, too long for where it's placed |
| S08 | Place a train | From S07, then click track in 2D or 3D | Put the consist on the track facing a chosen way | track highlight under the cursor, ghost train, direction arrow | valid spot, won't fit (red), on a point (refused) |
| S09 | Couple and uncouple | Click a coupler in 3D, or U with a gap selected | Split or join a train; shunting | coupler markers between vehicles, hover state | coupled, uncoupled, buffers touching (auto-couple), too fast to couple |
| S10 | Points and signals in 3D | Click a point or signal in any camera | Throw points, hold signals | point lever markers, signal heads with live aspects | set straight, set diverging, locked (train on it), signal red / yellow / green |
| S11 | Auto drive | Toggle in S06; routes and automations already in the Auto tab | Let a train run itself: obey signals, stop in a chosen block | toggle, target block picker | running, waiting at red, arrived |
| S12 | Settings and help overlay | Esc / ? in the drive view | Speed units, camera sensitivity, sound, key list | form fields, key table | — |

Rolling Line screens left out: main menu, layout browser and Workshop, build and scenery mode, magazine, multiplayer server browser, VR hands.

## Flows

```
F01 Drive a train round the layout
    S01 -> S02 -> S06 (pick train, throttle up) -> S03 (C: chase) -> S04 (C: cab)
    happy path clicks: 3 (Control, Drive in 3D, throttle) + key presses
    edge: no train on the layout yet (go to F02), simulator not chosen (quick start offers it),
          train reaches a red signal (stops, HUD says why), runs onto an open end (stops at the buffer),
          point set against it (stops; or derails? -> stops, see out of scope)

F02 Make up a train and put it on the track
    S06 -> S07 (add loco, add 4 wagons) -> S08 (click a siding, pick direction) -> S06
    happy path clicks: 6
    edge: train longer than the road (warn, offer to trim), clicked on a point (refused),
          overlaps another train (refused)

F03 Shunt a wagon into a siding and leave it
    S06 drive to the siding -> S10 throw the point -> S06 propel in -> S09 uncouple -> S06 pull away
    happy path clicks: ~6
    edge: buffers hit too fast (stops dead, no coupling), point locked under the train,
          wagon left fouling the main line (current detection flags the block, as in the real hub)

F04 Run a shunting session in 3D
    Tools > Shunting session (exists) -> "Set up in 3D" places the dealt wagons -> F03 repeated -> timer stops when the train matches the cards
    happy path clicks: 3 to start
    edge: the plan's sidings are too short for the deal (falls back to fewer wagons)

F05 Let the simulator drive while you watch
    S06 Auto drive on -> S11 pick a target block -> S03 chase or S05 walk alongside
    happy path clicks: 3
    edge: no route to the target (says so), another train holds the block (waits)

F06 Walk the layout at miniature scale
    S02 -> M -> S05 (WASD, mouse) -> M back to S02
    happy path clicks: 1 key
    edge: walking off the board (stopped at the edge), into a train (stopped)
```

Number to beat: F01 in three clicks from the plan.

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| 3D canvas | tabletop, chase, cab, miniature | loading, running, paused, WebGL missing | S02–S05 |
| HUD bar | docked bottom, compact on phones | — | S02–S06 |
| Throttle | slider + keys | stopped, forward, reverse, braking, at red | S06 |
| Speed readout | scale km/h, mph | — | S06 |
| Train picker | chip per train in its colour | selected, auto driving, stopped at signal | S06 |
| Consist strip | one tile per vehicle, coupler gaps between | coupled, uncoupled, selected | S07, S09 |
| Stock tile | loco, coach, open wagon, van, tank, brake van | — | S07 |
| Ghost train | valid (blue), invalid (red) | — | S08 |
| Coupler marker | 3D dot between vehicles | hover, coupled, open | S09 |
| Point marker | 3D lever above the toe (2D version exists) | straight, diverging, locked | S10 |
| Signal head | 3D mast with lit lamps | red, yellow, green, held | S10 |
| Camera chip | name of the camera, click to cycle | — | S02–S05 |
| Toasts, dialogs, buttons | existing Railplot components | existing | all |

## Inferred data model

What Railplot needs, inferred from how Rolling Line behaves; Railplot's existing `control` data (blocks, points, signals, trains, automations) stays as it is.

```
Vehicle     id, kind (loco | coach | wagon | van | tank | brake), length mm, colour, name
            evidence: S07 consists in the store pitch (freight trains, liveries); Workshop stock mods (#11)
            confidence: high (that vehicles have type and length); guess (the type list)

Consist     id, train id (the control TrainCfg it is driven as, or none: wagons standing on their own),
            vehicles [vehicle ids, front to back], head: TrackPos, facing (+1 | -1), speed mm/s
            evidence: F02, F03 coupling and uncoupling splits and joins these; Auto Drive drives one (#6)
            confidence: high

TrackPos    item id, route index, distance along the route mm, direction along it
            evidence: trains follow points as set (#4, #6); Railplot's geometry already has items and routes
            confidence: high

Coupling    between two adjacent vehicles: coupled (bool); joins happen when buffers touch below a speed
            evidence: shunting in multiplayer (#4); general model railway practice
            confidence: medium (the exact rule in Rolling Line isn't public)

DriveView   camera (tabletop | chase | cab | miniature), followed consist, units (km/h | mph)
            evidence: S02–S05, hotkeys (#9), units patch (#6)
            confidence: high
```

Relationships: Layout 1-n Consist; Consist 1-n Vehicle (ordered); Consist 0-1 TrainCfg (control); TrainCfg 1-1 its throttle; Consist 1 TrackPos (head; the rest follows along the track).

Saved in the `.railplot` file: the stock list and where consists stand (`control.consists`), so a session picks up where it stopped. Speeds and camera aren't saved.

## Feature matrix

See `features.csv`. Must: 13, should: 10, could: 8, skip: 9.

## Out of scope (cannot or should not be cloned)

- **Rolling Line's content:** its 3D models, liveries, sounds, official layouts and magazine. Railplot draws its own simple stock from boxes, as its 3D view does today.
- **The Steam Workshop and its community** (7,000+ layouts, 20,000+ mods): that's their network, not a feature.
- **Multiplayer servers and the server browser.** Railplot's hub already lets several people drive one layout from phones; that is the multiplayer that fits here.
- **VR.** Railplot's 3D view is plain WebGL in a browser or the desktop app.
- **The layout and scenery builder.** Railplot is the builder; the scenery builder was taken out on request.
- **Derailments and physics-engine collisions.** Trains stop at a point set against them or at another train's buffers instead.
- **Weather and day-night lighting.**

## Size

Screens 12, flows 6, entities 5. Hard parts:
1. **Trains following the real track:** walking routes through points as they're set, across flexible track and crossings, both ways, with each vehicle placed by its distance from the head.
2. **Moving models in WebGL:** today's 3D view builds one static mesh; vehicles need their own transforms each frame without rebuilding the layout.
3. **Coupling and buffers:** detecting buffers touching between consists, joining and splitting consists, and keeping the control engine's blocks, sensors and current detection true to where the vehicles really are.
4. Cameras that follow the track (chase, cab, miniature walking) without clipping through tunnels and boards.

Most of the rest exists: the 3D scene, the control engine (blocks, signals, automations, sensors, current detection), the shunting session dealer, and the 2D simulator.

Size: **M** (a few weeks).
