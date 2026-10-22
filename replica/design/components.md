# Components: Railplot Drive

Every component from the recon list, with Railplot's existing parts reused where they fit. Tokens are
the roles in `tokens.json` (light) and `tokens-dark.json` (dark); in CSS they are the custom properties
in `src/styles.css` (`--hud-bg`, `--accent`, ...). Never raw hex in components.

Nothing is taken from Rolling Line: no models, icons, sounds, fonts or copy. Icons are Railplot's own
line icons (`src/ui/dom.ts`); vehicles are Railplot's own box models.

**Tailwind:** not used. Railplot is plain CSS with custom properties, so `tokens.css` maps the roles to
custom properties and components use those, the same rule ("roles, never hex").

## Rules for the whole drive view

- The **HUD is dark in both themes** (`--hud-*`): it sits on a 3D scene, not on Railplot's panels.
  Dialogs opened from it (Trains, settings) use the normal themed panels.
- **Text on the 3D scene** always sits on a HUD surface, never straight on the scene, so contrast holds
  whatever the camera looks at.
- **Touch targets** 40 px minimum on the HUD (phones drive trains); 30 px elsewhere, as in Railplot.
- **Focus:** `:focus-visible` 2 px ring in `--hud-accent` on the HUD, `--accent` elsewhere (Railplot's rule).
- **Reduced motion:** camera moves cut instead of glide; derailment tipping still shows its end state.
- **Keyboard first:** everything the mouse does in the drive view has a key, listed in the help overlay.

## 3D canvas

```
variants  tabletop (orbit), chase, cab, miniature (walk)
states    loading the scene (spinner on the HUD, canvas dark), running, paused (dimmed 40%, "Paused" chip),
          WebGL missing (S02 error: a message panel with "Back to plan"), lost context (rebuilds, toast)
tokens    clear colour from --plot (theme), fog to --plot
a11y      role="application", aria-label "3D view of the layout: <camera>, following <train>";
          the HUD carries all state as text, so the canvas never has to be read
keys      C cycle camera, M miniature on/off, F follow the selected train, Esc pause and help
used on   S02, S03, S04, S05
```

## HUD bar

```
variants  docked bottom (desktop, max 980 px wide, centred); full width with two rows (under 720 px)
states    default, compact (no train selected: only the picker and camera chip), hidden (H toggles it)
tokens    bg --hud-bg at 92% opacity with backdrop blur where supported (solid --hud-bg otherwise),
          text --hud-text, border 1px --hud-surface, radius lg (10), shadow --hud-shadow, padding 8/10
a11y      role="toolbar", aria-label "Train controls"; arrow keys move between groups
used on   S02–S06
```

## Throttle

```
variants  slider (horizontal on desktop, large vertical lever on phones), keys
sizes     44 px tall track, thumb 28 px
states    stopped (0, thumb centred), forward, reverse (the fill runs left, in --hud-muted),
          braking (fill pulses once), held at a red signal (fill --lamp-red, label "Held at red"),
          derailed (disabled, label "Derailed"), auto drive (disabled, label "Auto"), no train (hidden)
tokens    track --hud-surface, fill --hud-accent, thumb --hud-text with a 2 px --hud-bg ring
a11y      <input type="range" min=-100 max=100> with aria-valuetext "40% forward"; Q/E or ←/→ step 5,
          Shift for 20, Space stops this train (Railplot's Space already stops all in Control mode:
          in the drive view Space stops the selected train, Shift+Space stops all)
used on   S06
```

## Speed readout

```
variants  scale km/h, scale mph (setting), mm/s when the track system has no scale
states    normal (--hud-text), near the curve limit (--hud-warn, small "Curve" tag),
          over it (--hud-danger, tag pulses), derailed ("—")
tokens    font mono, size hud-speed (28/30, 600), unit in sm --hud-muted
a11y      aria-live="off" (it changes constantly); the curve warning is announced once through
          the existing toast region when it first turns amber
used on   S06
```

## Train picker

```
variants  one chip per control train, in the train's own colour as a 10 px dot
states    selected (--hud-accent outline 2 px), auto driving ("Auto" tag), stopped at a signal (red dot),
          derailed (--hud-danger tag), hover
tokens    chip bg --hud-surface, text --hud-text, radius pill, height 32 (40 on touch)
a11y      role="radiogroup"; 1–9 select train 1–9
used on   S06
```

## Camera chip

```
variants  one button showing the current camera name and its key
states    default, hover, focus
tokens    as a HUD chip
a11y      <button> "Camera: Chase (C)"
used on   S02–S05
```

## Consist strip

```
variants  in the Trains dialog (themed panel), and a small version on the HUD for the selected train
states    empty ("No vehicles yet: add a loco"), filled, a vehicle selected, a coupler gap open,
          too long for where it's placed (whole strip outlined --danger, note under it)
tokens    tile bg --raised, border --line, gap tokens space-1 (2 px) between vehicles,
          open coupling shown as a 6 px gap with a --text-faint dashed line
a11y      a list; each vehicle a button "Box van, 4th of 6"; Delete removes, Alt+←/→ moves it
used on   S07, S09
```

## Stock tile

```
variants  loco, coach, open wagon, van, tank, brake van (Railplot's own side-on silhouettes, drawn as SVG)
states    default, hover, focus, pressed (adds to the strip)
tokens    Railplot's .part-tile (exists): --raised, --line, hover --accent border; name in base, length in mono xs --text-faint
a11y      <button> "Add a box van, 80 mm"
used on   S07
```

## Ghost train (3D)

```
variants  valid, invalid
states    following the cursor along the track, snapped to a direction (arrow at the front)
tokens    valid: vehicles drawn in --ghost-ok at 55% alpha; invalid: --ghost-bad, with the reason on the HUD
          ("Won't fit: 120 mm too long", "That's a point: pick plain track")
a11y      the HUD repeats the reason as text; Enter places, Esc cancels, R turns it round
used on   S08
```

## Coupler marker (3D)

```
variants  coupled, open
states    hidden (until the cursor is near or Shift is held), hover (grows 1.5×), pressed
tokens    coupled --hud-accent, open --hud-muted; 10 px screen-space dot, always on top
a11y      U uncouples behind the selected vehicle; the HUD consist strip does the same with buttons
used on   S09
```

## Point marker and signal head (3D)

```
variants  point lever (2D version exists in Control mode); signal mast with 2 or 3 lamps
states    point: straight, diverging, locked (a vehicle is on it: --hud-muted, refuses with a reason);
          signal: red, yellow, green, held (a "Held" plate), auto
tokens    lamps --lamp-red / --lamp-yellow / --lamp-green lit, --lamp-off unlit (same in both themes)
a11y      P throws the point nearest the selected train's front, ahead of it; the HUD names it
used on   S10
```

## Derailed vehicle (3D)

```
variants  tipped and slewed off the track, at rest
states    sliding (0.4 s, skipped with reduced motion), at rest, re-railing (lifts and drops back, 0.3 s)
tokens    its own colour darkened 15%; a --hud-danger ring on the ground under it
a11y      described by the derailment card
used on   S13
```

## Derailment card

```
variants  one train; collision (two trains)
states    shown until re-railed or dismissed (it stays as a tag on the picker chip)
tokens    bg --hud-danger-bg, text --hud-danger-text, title md 600, radius lg, sits above the HUD bar
copy      title "Derailed"; cause line, e.g. "47 km/h on a 371 mm curve: about 35 km/h is the limit",
          "Ran through point 3 the wrong way", "Hit the goods train at 22 km/h";
          buttons "Re-rail here" (primary, --hud-accent), "Re-rail where it last stood"
a11y      role="alertdialog", focus moves to "Re-rail here", announced once; R re-rails
used on   S13
```

## Curve warning

```
variants  amber (within 15% of the limit), red (over it, only when derailments are off: the train is held at the limit)
tokens    --hud-warn, --hud-danger on the speed readout (see Speed readout)
used on   S06
```

## Existing Railplot components, reused unchanged

| component | where in Railplot | used on |
| --- | --- | --- |
| Button (`.btn`, `.btn-primary`, `.btn-danger-ghost`, `.btn-sm`) | `src/styles.css` | S07, S12, S13 (themed dialogs) |
| Dialog (`dialog()`, `confirmDialog()`) | `src/ui/dialogs.ts` | S07, S12 |
| Toast | `src/ui/dialogs.ts` | all |
| Field, number input, select | `src/ui/dialogs.ts` | S07, S12 |
| Chip (`.chip-ok`, `.chip-warn`) | `src/styles.css` | S07 |
| Key table (`table.keys`) | Help > Keyboard shortcuts | S12 |

## Contrast fixes made to Railplot's palette (whole app)

The check found these existing colours under WCAG AA. They're fixed in `src/styles.css` and the tokens,
keeping each colour's hue:

| role | before | after | why |
| --- | --- | --- | --- |
| `--ink-3` faint text, light | #7f8981 | #636a64 | 3.4:1 on panels, needs 4.5 |
| `--ink-3` faint text, dark | #7c867e | #879089 | 4.1:1 on panels |
| `--accent` brass, light | #a2620c | #965b0b | 4.4:1 as text on panels (part numbers) |
| `--ok` green, light | #2c7f45 | #297841 | 4.1:1 on its pale chip |
| input borders | `--line-strong` | new `--line-input` (#888e86 light, #6b726d dark) | 1.8:1 and 1.5:1; form controls need 3:1 |
| amber warning text | `--warn` | new `--warn-ink` (#8d6300 light) | 3.4:1 as text; `--warn` stays for strokes |
