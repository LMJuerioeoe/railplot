# Bugs: Railplot Drive

Found by /replica-test on 2026-10-22, build 373fcc2, headless Chromium 1440 px and 390 px. Each fix has
the test that failed before it.

### BUG-001: Taking every vehicle out of a train crashes the drive view

- Severity: S2
- Flow / case: F02 / F02-E6
- Screen: S07
- Build: 373fcc2  Browser / device: Chromium 140, 1440px

Steps
1. Drive in 3D, press T on a train.
2. Remove its only vehicle.

Expected: the train has no vehicles and is off the track; everything else keeps running.
Actual: `TypeError: undefined is not an object (evaluating 'c.vehicles[i].length')`; the drive loop stops, so no train moves or draws.
Evidence: tests/sim.test.ts "BUG-001 …"; tests/e2e/test_drive.py F02-E6
Suspected cause: laying out a consist with no vehicles still stood its "front" on the track.
Status: fixed (see the commit "test: …")

### BUG-002: Uncoupling across a block joint teleports the loco

- Severity: S2
- Flow / case: F03 / F03-E4
- Screen: S09
- Build: 373fcc2

Steps
1. A train whose wagons reach into the next block, its loco still in the block behind.
2. Uncouple the loco.

Expected: the loco stays where it is.
Actual: it jumps about 0.9 m, to the middle of the block the control engine had the train in.
Evidence: tests/sim.test.ts "BUG-002 …"
Suspected cause: the world stood any train outside its engine block back in that block, which is right when the engine moved it (placed by hand) and wrong when the world did.
Status: fixed: the world tells the engine where its train is when the world moved it

### BUG-003: A train put on the track drives off at once

- Severity: S3
- Flow / case: F02 / F02-E10
- Screen: S08

Steps
1. Drive a train, then T, Move it on the track, click somewhere.

Expected: it stands there.
Actual: it runs off at the throttle it had.
Evidence: tests/sim.test.ts "BUG-003 …"
Status: fixed: placing a train stops it

### BUG-004: An automation whose train derails waits forever

- Severity: S3
- Flow / case: F07 / F07-E5
- Screen: S13

Steps
1. Start the goods shuttle; derail its train.

Expected: the automation stops and says why.
Actual: it shows "Step 3 of 10: waiting for Goods train to reach West" for ever, and picks up again after a re-rail.
Evidence: tests/sim.test.ts "BUG-004 …"; tests/e2e/test_drive.py F07-E5
Status: fixed: "Stopped: Goods train derailed"

### BUG-005: Placing a train needs a mouse

- Severity: S3
- Flow / case: F02 / F02-E4
- Screen: S08

Steps
1. T, Place on the track, then use only the keyboard.

Expected: the keys move the ghost and Enter places it (the spec's "Enter places").
Actual: the arrows drove the selected train instead, and Enter did nothing without a pointer.
Evidence: tests/e2e/test_drive.py F02-E4
Status: fixed: ←/→ slide the ghost along the track, ↑/↓ jump to the next piece, Enter places

### BUG-006: A deleted train's rolling stock points at a train that's gone

- Severity: S3
- Flow / case: F02 / F02-E11
- Screen: S07

Steps
1. Make up a train's stock; delete the train in Control.

Expected: its vehicles stay on the layout, on their own.
Actual: they stay in the layout file still tied to the deleted train, listed nowhere in the Trains dialog.
Evidence: tests/sim.test.ts "BUG-006 …"
Status: fixed

### BUG-007: The drive view's keys aren't in Help > Keyboard shortcuts

- Severity: S4
- Flow / case: F01 / F01-E10

Expected: the drive keys are listed. Actual: only planning keys.
Evidence: tests/e2e/test_drive.py F01-E10
Status: fixed: a "Drive in 3D" table

### BUG-008: A train longer than a loop wraps round onto itself

- Severity: S3
- Flow / case: F02 / F02-E1
- Screen: S08

Steps
1. Make up 40 coaches; place them on the oval with no other train on it.

Expected: refused: too long.
Actual: placed, its front overlapping its own back.
Evidence: tests/sim.test.ts "a train longer than the loop …"; F02-E1 showed it when another train happened to be in the way
Status: fixed

## To check (not reproduced)

- A hand-edited layout file with a damaged `consists` entry (no `vehicles`): probably breaks the simulator; files are passed through unchecked.
- Through a hub the browser doesn't see vehicle positions, so the drive view isn't offered; when it is, the Trains dialog will need the hub to run `placeConsist` and friends.
- A train pushing a wagon at between 70 and 210 mm/s bumps, stops, and couples on the next gentle touch; the original pushes the wagon away instead.
- Undo is off in Control mode, so a change in the Trains dialog can be undone only from Plan mode.
