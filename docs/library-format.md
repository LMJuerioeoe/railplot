# Track library format

A track library is one JSON file in `src/libraries/`, named after its `id` (for example `piko-a-h0.json`). Railplot loads it at build time, so a new library ships with the next release.

## The file

```json
{
  "format": 1,
  "id": "piko-a-h0",
  "name": "PIKO A-Gleis H0",
  "producer": "PIKO",
  "system": "A-Gleis",
  "scale": "H0",
  "gauge": 16.5,
  "profile": { "sleeperLength": 29, "sleeperWidth": 2.4, "sleeperSpacing": 8.2, "railHeight": 2.5, "roadbed": null },
  "sources": [
    { "title": "PIKO A-Gleis brochure (DE)", "url": "https://example.com/piko-a-gleis.pdf" }
  ],
  "parts": [ ... ]
}
```

| Field | Meaning |
| --- | --- |
| `format` | Always `1` for now. |
| `id` | Lower-case, words joined with hyphens. Must match the file name. Never change it after release: saved layouts refer to parts as `<id>/<part id>`. |
| `name` | Shown in the library menu. |
| `producer`, `system` | Shown in the parts list. |
| `scale` | Groups the library menu, for example `OO`, `H0`, `TT`, `N`. |
| `gauge` | Distance between the rails in millimetres. |
| `profile` | How the track is drawn. `roadbed` is `null` for track without moulded ballast, or `{ "top": 30, "bottom": 40, "height": 4 }`. All in millimetres. |
| `sources` | Where the dimensions come from. At least one is required. |

All lengths are millimetres and all angles are degrees.

## Parts

Every part has an `id` (the catalogue number as printed on the packet), a `name` and a `type`. An optional `note` is shown as a tooltip and in the details panel. Set `"approximate": true` when the maker doesn't publish enough to be sure of the shape; the part is then marked ≈ and the note should say what was assumed.

### Straight

```json
{ "id": "55200", "name": "G239 straight", "type": "straight", "length": 239.07 }
```

### Curve

Curves are always described turning **left**. Railplot flips them for right-hand use.

```json
{ "id": "55211", "name": "R1 curve 30°", "type": "curve", "radius": 360, "angle": 30 }
```

### Turnout (point)

A turnout is a set of routes that all start at the toe, at the origin, heading along +x. Each route is a list of segments: `{ "straight": length }` or `{ "radius": r, "angle": a }`, where a positive angle turns left and a negative angle turns right.

```json
{ "id": "55220", "name": "WL turnout left", "type": "turnout", "hand": "left",
  "routes": [
    { "segs": [ { "straight": 239.07 } ] },
    { "segs": [ { "radius": 907.97, "angle": 15 } ] }
  ] }
```

Put the straight (or main) route first. Curved points and three-way points work the same way with more segments or routes. A route may start somewhere other than the toe with `"from": [x, y, headingDegrees]`.

### Crossing and double slip

```json
{ "id": "55240", "name": "K15 crossing 15°", "type": "crossing", "length": 239.07, "angle": 15 }
{ "id": "55224", "name": "DKW double slip", "type": "crossing", "length": 239.07, "angle": 15, "slip": { "radius": 907.97 } }
```

Both legs have the given length and cross at their midpoints. A `slip` adds the two curved routes.

### Flexible track

```json
{ "id": "55209", "name": "G940 flexible track", "type": "flex", "maxLength": 940, "minRadius": 360 }
```

`maxLength` is the length of one piece, used to count pieces in the parts list. `minRadius` is the tightest curve Railplot will let you draw.

## Checking your work

```sh
bun run validate-libraries
bun test tests
```

The validator checks the fields, ids and segment values, and that slip routes meet their crossing legs. A good extra check is to add a test that a full circle of your curves closes, like the ones in `tests/model.test.ts`.
