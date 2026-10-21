# The .railplot file

A layout is saved as UTF-8 JSON. Numbers are millimetres and radians unless noted.

```json
{
  "format": "railplot",
  "version": 1,
  "name": "Sample OO oval with passing loop",
  "units": "mm",
  "gridStep": 50,
  "layers": [ { "id": "L1", "name": "Main line", "visible": true } ],
  "activeLayer": "L1",
  "boards": [ { "id": "b2", "name": "Baseboard", "pts": [ { "x": 0, "y": 0 }, { "x": 2050, "y": 0 }, { "x": 2050, "y": 1150 }, { "x": 0, "y": 1150 } ] } ],
  "starts": [],
  "items": [
    { "id": "t3", "layer": "L1", "part": "peco-setrack-oo/ST-241", "x": 520, "y": 150, "rot": 0, "mirror": false, "z": [0, 0, 0] },
    { "id": "t40", "layer": "L1", "part": "peco-setrack-oo/SL-100", "x": 855.2, "y": 216.6, "rot": 0, "mirror": false, "z": [0, 0],
      "segs": [ { "kind": "s", "len": 335.6 } ] }
  ],
  "nextId": 41
}
```

| Field | Meaning |
| --- | --- |
| `format`, `version` | Always `"railplot"` and `1`. Railplot refuses files from a newer version instead of guessing. |
| `units` | How lengths are shown (`"mm"` or `"in"`). Values in the file are always millimetres. |
| `boards[].pts` | Corners of each baseboard, in order. y points away from the front of the layout. |
| `starts` | Start points not yet built on: position and heading `h`. |
| `items[].part` | `<library id>/<part id>`. |
| `items[].x, y, rot` | Where the part's origin (the toe of a point, the first end of a straight or curve) sits, and its heading. |
| `items[].mirror` | Flipped left-to-right in the part's own frame. A mirrored curve turns right. |
| `items[].z` | Height above the baseboard of each end of the part. |
| `items[].segs` | Flexible track only: its shape as straights (`"s"`, `len`) and arcs (`"a"`, radius `r`, signed angle `deg` in degrees). |

A baseboard module is a board with a `module` field: `{ "preset": "std-1200x600", "cx": 600, "cy": 300, "rot": 0, "tracks": 2, "spacing": 67 }`: its preset's id, the centre of its footprint, its rotation, `"mirror": true` if it is a mirror image, how many tracks cross its faces (default 1) at what spacing (default 67 mm), and `edge`, how far the outermost tracks sit from the ends of each face when they are spread out (0 keeps them together; unset means 200 mm on 600 mm faces and together elsewhere). Its `pts` hold the footprint for programs that don't know the preset.

Track joins are not stored. Ends that touch (within 0.5 mm) and face each other are joined whenever the file is opened.

## Prices

Prices typed into the parts list are kept in `prices` (optional): `{ "currency": "£", "each": { "hornby-oo/R600": 2.5, "board|std-1200x600": 45 } }`. `each` is keyed by the part (`<library id>/<part id>`, one whole piece for flexible track), `board|<module>` for a baseboard module, `hwm|<module>` for a module's extra hardware and `hw|<item>` for joint hardware.

## Layout control

A layout set up for [control](control/README.md) has a `control` object. Everything in it is optional to a reader that only wants the track plan.

| Field | Meaning |
| --- | --- |
| `controllers[]` | `id`, `name`, `kind` (`"esp32"`, `"dccex"` or `"sim"`) and `host`. DCC-EX controllers also have `conn` (`"usb"` or `"net"`) and `cabBase`, the cab number for track A. |
| `blocks[]` | `id`, `name`, `color`, the track pieces in it (`items`), and the `controller` and driver `channel` that feed it. On DCC-EX, channel 0 is track A. |
| `points[]` | One per point on the plan: its track piece (`item`), `controller`, `servo` (on DCC-EX, the turnout id), the servo pulse for each route in microseconds (`us`), and the route it is set to (`state`, 0 is straight). |
| `sensors[]` | `id`, `name`, position, the two `blocks` it sits between, and its `controller` and `input`. |
| `signals[]` | `id`, `name`, position and heading `h`, the blocks it guards (`from`, `to`), LED outputs `red`, `yellow`, `green`, and `mode` (`"auto"` or `"stop"`). |
| `lights[]` | `id`, `name`, `controller`, `output`, `on` and brightness `level` (1–100). |
| `trains[]` | `id`, `name`, `color`, the `block` it is in, and `minSpeed`, `maxSpeed` (% of track voltage) and `momentum` (seconds from stop to full speed). |
| `routes[]` | `id`, `name` and `points`: the `item` and `state` for each point the route sets. |
| `automations[]` | `id`, `name`, `train`, `loop` and `steps`. Each step has `do` (`"drive"`, `"waitBlock"`, `"arrive"`, `"stop"`, `"wait"`, `"waitFree"`, `"route"`, `"point"`, `"signal"` or `"light"`) and that step's settings, as in [Automation](control/automation.md). |
| `claude` | `true` when the owner lets Claude use the controls through the hub (see [Claude and Railplot](claude.md)). |
| `nextId` | The next number used for a new id. |

Where trains are and how points are set are saved with the layout, so the hub and the controllers can pick up where you left off.

## Proposals

Changes Claude has proposed through the [connector](claude.md) and that are still waiting are kept in `proposals[]`. A reader that only wants the plan can ignore them: they aren't part of it until they are accepted.

| Field | What it is |
| --- | --- |
| `id`, `title`, `why`, `by`, `at` | The proposal, its title, the reason given, who made it and when (ISO time). |
| `add` | New `boards`, `items`, `starts` and `layers`, as in the plan. |
| `change` | The new versions of `boards`, `items` and `starts` it changes (same ids). |
| `remove` | Ids of the objects it removes. |
| `before` | How the changed and removed objects looked when it was made. If the plan no longer matches, the proposal is out of date. |
| `rename` | A new name for the plan (optional). |
| `v` | On a hub: the hub's layout version when it arrived. |
