# Test plan: Railplot Drive

Build: 373fcc2 plus the fixes below  Date: 2026-10-22  Env: local build (`dist/index.html`), the two-train control demo as seed data, headless Chromium 1440 px and 390 px

Automated cases live in `tests/e2e/test_drive.py` (drive view, axe scans, fails on any page or console error),
`tests/e2e/test_flows.py` (the whole app, including F17b–F17c) and `tests/sim.test.ts` (the simulated world).
"not built" means the screen behind the case isn't built yet (see build-log.md); those cases weren't run.

| case | flow | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- | --- |
| F01-H1 | drive a train | happy | Control, D, 2, E ×6 | the HUD shows a chip per train; the express runs and its speed shows | e2e drive | pass |
| F01-H2 | | happy | Space | the train stops | e2e drive | pass |
| F01-H3 | | happy | C ×3 | chase, cab, tabletop in turn | e2e flows F17b | pass |
| F01-E1 | | edge: no track | empty plan, D | "Lay some track first", the view doesn't open | e2e drive | pass |
| F01-E2 | | edge: simulator not chosen | layout with no controllers, D | offers to set up the simulator | e2e flows F17 | pass |
| F01-E3 | | edge: red signal ahead | signal held at red | the train is not sent into the block | unit (control tests) | pass |
| F01-E4 | | edge: open end | drive into the end of the line slowly / fast | stops at the end / tips off | unit | pass |
| F01-E5 | | edge: facing point | point set to the loop | the train takes the loop | unit | pass |
| F01-E6 | | edge: curve too fast | full throttle on second radius | amber warning, then derails | e2e flows F17b | pass |
| F01-E7 | | edge: mobile width | 390 px | HUD fits, no sideways scroll | e2e drive | pass |
| F01-E8 | | edge: keyboard only | D, 1–9, E/Q, Space, C, Esc | all reachable without a mouse | e2e drive + flows | pass |
| F01-E9 | | edge: screen reader labels | axe on the HUD | no WCAG 2.1 AA violations | e2e drive | pass |
| F01-E10 | | edge: discoverability | Help > Keyboard shortcuts | lists the drive view's keys | e2e drive | fail → fixed (BUG-007) |
| F01-E11 | | edge: two tabs, refresh | | n/a: one window runs the simulator; refresh covered in F02-E9 | — | — |
| F02-H1 | make up and place | happy | T, New rake, Add a box van ×3, Place on the track, click free track | rake on the track where clicked | e2e drive | pass |
| F02-H2 | | happy | R while placing | the ghost turns round | e2e drive | pass |
| F02-H3 | | happy | add a loco to a train with none, place it | the train can be driven again | e2e drive | pass |
| F02-E1 | | edge: too long | a 31-vehicle rake over plain track | refused, with its length | e2e drive + unit | pass (after BUG-008) |
| F02-E2 | | negative: on a point | ghost over a point | refused: "That's a point" | e2e drive | pass |
| F02-E3 | | negative: overlaps another train | ghost on the first rake | refused: "in the way" | e2e drive | pass |
| F02-E4 | | edge: keyboard only | arrows move the ghost, Enter places | placed without a mouse | e2e drive | fail → fixed (BUG-005) |
| F02-E5 | | edge: Delete in the strip | focus a vehicle, Delete | it goes | e2e drive | pass |
| F02-E6 | | edge: empty input | take every vehicle out of a train | "No vehicles yet", nothing breaks | e2e drive + unit | fail → fixed (BUG-001) |
| F02-E7 | | edge: screen reader labels | axe on the Trains dialog and place card | no violations | e2e drive | pass |
| F02-E8 | | edge: very long input | 31 vehicles | strip scrolls, dialog keeps its width | e2e drive | pass |
| F02-E9 | | edge: refresh mid-flow | reload after placing | every train and rake where it stood | e2e drive | pass |
| F02-E10 | | edge: train moving when placed | place a train with its throttle open | it stands still | unit | fail → fixed (BUG-003) |
| F02-E11 | | edge: deleted record | delete a train that has stock | its stock stays, as vehicles on their own | unit | fail → fixed (BUG-006) |
| F03-H1 | shunt | happy | drive gently onto vans, U, pull away | couples; uncouples; vans stay put | e2e drive + unit | pass |
| F03-E1 | | edge: too fast | 120 mm/s / 480 mm/s onto a wagon | both stop / both derail | unit | pass |
| F03-E2 | | edge: point locked | throw a point with a vehicle on it | refused | e2e drive | pass |
| F03-E3 | | edge: wagon left fouling | vans with resistor wheelsets left in a block | current detection flags the block | e2e drive | pass |
| F03-E4 | | edge: uncouple across a block joint | loco in one block, wagons in the next | the loco stays where it stands | unit | fail → fixed (BUG-002) |
| F04 | shunting session in 3D | — | | | | not built |
| F05 | auto drive from the HUD | — | | (trips run from the Auto tab: e2e flows F18) | | not built |
| F06 | walk mode | — | | | | not built |
| F07-H1 | derail and re-rail | happy | derail, R | card shows; R re-rails and clears the fault | e2e drive + flows | pass |
| F07-E1 | | edge: trailing a point | out of the loop against the point | derails (realistic), not (forgiving) | unit | pass |
| F07-E2 | | edge: derailments off | Set up > Simulator > Off | held at the curve limit | unit | pass |
| F07-E5 | | edge: automation running | derail the shuttle's train | the automation stops and says why | e2e drive + unit | fail → fixed (BUG-004) |
| F07-E9 | | edge: screen reader labels | axe on the derailment card | no violations | e2e drive | pass |
