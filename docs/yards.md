# Ready-made yards

Railplot can build common yards and a shunting puzzle for you, from your track system's own points and curves, with flexible track for the long roads. In the library on the left, choose **Yards and shunting puzzles**.

| Yard | What it is |
| --- | --- |
| **Fiddle yard** | A fan of 2 to 8 parallel roads off a ladder of points, all ending in a line: storage sidings or a dead-end fiddle yard. |
| **Double-ended fiddle yard** | Ladders at both ends, so trains run in one end and out of the other: for a continuous run, or a station's loops. |
| **Run-round loop** | A loop where the engine runs round its train, with a headshunt at each end. |
| **Inglenook sidings** | Alan Wright's shunting puzzle: a headshunt for the engine and three wagons, then sidings for five, three and three wagons. Make up a train of five from eight wagons, in the order the cards say. |

## Shunting sessions

Tools > **Shunting session** turns a shunting layout into a game. Pick the Inglenook (five wagons from eight) or your plan's own sidings, and Railplot deals where each wagon starts and the train to make up, from the engine back. Start the clock, count your moves, and press **Deal new cards** for another go. Each deal has a card set number: type it in again to replay the same puzzle, or **Print the cards** to play away from the screen. Name your own wagons under **Your wagons**; the list is saved with the layout.

## Example layouts on the baseboards

**File > Example shunting layouts** opens complete plans on the laser-cut baseboard modules, built with these yards. Pick the track system first: each plan is worked out for it.

| Example | Boards | What's on it |
| --- | --- | --- |
| **Inglenook on a shelf** | One 1200 × 400 | The Inglenook sidings on a single shelf board. |
| **Shunting plank with a traverser** | 900 × 400 traverser and two 1200 × 400 | Trains come off the traverser fiddle yard, the engine runs round in the loop, and wagons go into three goods sidings. |
| **L-shaped: fiddle yard to Inglenook** | Three 1200 × 600 and two 45° corners | A three-road fiddle yard, a line round the corner and the Inglenook sidings at the far end. |

Every example is checked when it is built: the track stays on the boards and at least 20 mm in from their edges, every joint lines up, and no point's motor lands on a frame member. To manage that, the points are moved a little along the line (by a short lead of flexible track, or by trimming the Inglenook headshunt by up to 60 mm). On the 600 mm boards the line runs on one of the two track positions 200 mm in from the edge, clear of the spine down the middle. PIKO A-Gleis's longer 15° points don't always fit on the boards named, so those plans get an extra 1200 mm board where needed (the Inglenook shelf takes two boards in PIKO).

The traverser's deck is left without track: lay its roads to suit your stock.

## Building one

1. Choose where it starts: click an open track end, a start point (**S**), or a track position ring on a baseboard module. Without one, the yard goes below whatever is already on the plan.
2. Pick the yard. The dialog shows a drawing of it as you change the settings:
   - **Track system**, and which side the roads go.
   - **Roads** and **overall length** for fiddle yards; the dialog says the shortest length that leaves every road at least 100 mm long.
   - **Loop length** and **headshunts** for a run-round loop.
   - **Wagon length** for the Inglenook: about 80 mm over buffers for OO four-wheel wagons, 75 mm for H0.
   - **Distance between roads**: as the points give it, or exactly a distance you choose.
3. **Build**. The new track is selected, so you can move or turn it, and undo takes it away again.

## How the roads are spaced

The yards use a ladder: the first point's straight road is road 1, its diverging road becomes the ladder, and every point along the ladder turns one road back parallel. A curve the same as the points' diverging road turns the last one.

With points laid toe to toe, the distance between roads comes from the points themselves:

| Track system | Points | Between the first two roads | Between the others |
| --- | --- | --- | --- |
| Peco Setrack | ST-241, ST-240 (22.5°, 168 mm) | 66.7 mm | 64.3 mm |
| Hornby | R8072, R8073 (22.5°, 168 mm) | 66.7 mm | 64.3 mm |
| PIKO A-Gleis | 55220 WL, 55221 WR (15°, 239 mm) | 61.88 mm | 61.88 mm |

PIKO's points are made to give its standard track spacing exactly. For wider spacing, choose **Exactly** and a distance: Railplot puts short lengths of flexible track between the points (only where they would be 5 mm or more). It can't make roads closer than the points allow.

PIKO's 15° points make longer, gentler throats than Setrack's and Hornby's 22.5° points: a five-road double-ended yard needs about 2.4 m in PIKO A-Gleis and about 1.7 m in Setrack.

## What it uses

- **Points**: the ordinary left- and right-hand points of the track system.
- **Curve**: the curve matching the points' diverging road (Setrack ST-225, Hornby R606, PIKO 55219).
- **Flexible track**: the system's own (Peco Streamline SL-100, PIKO 55209). Hornby has none, so its yards use Peco Streamline, which joins Hornby track directly.

Buffer stops aren't in Railplot's libraries yet, so dead ends are left open.
