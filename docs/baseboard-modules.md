# Baseboard modules

Railplot includes the laser-cut baseboard range designed in the OO/H0 layout project: 25 boards cut from 4 mm birch plywood, each closed into a torsion box 100 mm tall. They are listed under **Baseboards and modules** in the library, grouped like the range itself.

| Family | Modules |
| --- | --- |
| Standard modules | 1200 × 900, 1200 × 750, 1200 × 600, 1200 × 400, 900 × 600, 900 × 400, 400 × 400, 400 × 200, and 1200 × 600 with its top in three pieces for carrying |
| Corners and curves | 90° corners 600 and 400 wide; faceted 45° corners 600 and 400 wide; a 60° curve from R600 to R1000 (six make a circle) |
| Fiddle yard | Sliding traversers 1200 × 600, 900 × 600, 900 × 400 and 600 × 400; a 400 × 400 headshunt turntable with three faces; 900 × 400 and 1200 × 400 train turntables |
| Canopy modules | 1200 × 600, 900 × 600, 1200 × 400 and 900 × 400 boards with a lighting pelmet 400 mm above the track and a backscene |

## On the plan

- **Joining faces** join face to face, and only to a face of the same width, so the two 10 mm dowels and two M8 bolts line up. Every face of a given width has the same symmetric holes, so any face meets any other.
- A new module is added after the selected module, or after the last one. After the same kind of module it carries on the same way, so a run of curves keeps turning; **Join by its other face** turns a corner or curve the other way.
- Dragged modules snap onto a free face nearby. **Flip** makes a mirror image, which for these symmetric boards is the same board turned over the joint.
- The plan shows the frame under the top, the openings in the bottom skin (where point motors and wiring go), the dowel and bolt holes, the guide lines engraved on the top, traverser decks and turntable discs, and the canopy's pelmet as a dashed outline. The 3D view shows the pelmet and backscene too.
- Railplot warns when a point's motor would sit over a frame member.
- The parts list counts the modules, the joint hardware (2 bolts and 2 dowels per joint), and the extra hardware some modules need: drawer slides for traversers, a lazy-susan bearing for turntables, bolts and LED strip for canopies.

## Track positions

Each module can have 0 to 4 tracks crossing its joining faces. They sit at the same positions on every face, centred and symmetric about the middle of the face, so tracks line up from one module to the next. Choose the number and the spacing in the module's panel; **Use on every module** sets the whole layout the same, and a new module carries on with the tracks of the one it is added to.

- **On 600 mm boards the tracks are spread out**: the outermost tracks sit 200 mm in from each edge, so two tracks run a third of the way across from each side, 200 mm apart, and three go at 200, 300 and 400 mm. You can change the distance, or choose **Together at the spacing** to run them side by side like double track. One track always goes down the middle.
- **Spacing** is how close tracks may be: the track system's own track centres, 67 mm for Peco Setrack and Hornby and 61.88 mm for PIKO A-Gleis. Together at the spacing, up to four tracks fit across a 600 mm face and two across a 200 mm face, keeping each centre line at least 40 mm from the edge; spread 200 mm from the edges of a 600 mm face, three fit. Other widths put tracks together at the spacing unless you choose to spread them. Traversers and turntables take one track, on the centre line where their decks line up.
- **On the plan** each track position is a ring on the face with a short tick showing which way the track goes into the board, filled in once track ends there. Dashed guides join them across the board: straight across a straight board, concentric arcs round a corner or curve. A guide drawn red is a tighter curve than the flexible track allows. **View > Track positions on modules** hides them.
- **Click a ring** to build from it, with sectional track or the flexible track tool. Track ends you drag near a ring snap onto it, and flexible track snaps to a ring as it does to an open track end.
- **Lay flexible track on the guides** lays one length of flexible track along each guide that has no track yet: the track system's own flexible track, or Peco Streamline for Hornby, which has none. Curves too tight for it are left out.

## Where the presets come from

The presets in `src/boards/` are generated from the range's design data, so they match the cut files exactly. The design data is exported from the baseboard generator (`make_baseboards.py`) and kept as `data/baseboard-range.json`: every part's flat cutting outline, its holes and engravings, and where it sits in the assembled board.

To update the presets after the range changes (for example after regenerating for measured plywood with `--T 3.8`), export the data again and run:

```sh
bun scripts/import-baseboards.ts data/baseboard-range.json
```

The import keeps what a track planner needs from each module:

| Field | Meaning |
| --- | --- |
| `outline` | The footprint (the bottom skin, with its tab notches smoothed off). |
| `faces` | Each joining face as a line from `a` to `b`, with the outside of the board on the left, and its `width`. |
| `fixings` | Dowel (10 mm) and bolt (8.5 mm) holes, marked in the middle of the 12 mm laminated face. |
| `members` | Centre lines of the faces, walls, ribs and spine under the top, with their thickness. |
| `openings` | The large openings in the bottom skin. |
| `features` | Traverser and turntable decks, turntable discs, openings in the top, the canopy pelmet and the backscene. |
| `marks` | Guide lines engraved on the top: centre lines, centre arcs, traverser roads and 100 mm ticks. |
| `depth`, `weightKg`, `pieces`, `sheets`, `cutLengthM` | Height, weight and what it takes to cut. |
| `hardware`, `hardwarePerJoint` | Extra hardware per module, and per joint between modules. |

Positions are millimetres in the module's own frame; a layout stores each module's centre, rotation and whether it is mirrored.

Layouts saved with Railplot 0.4 and earlier used the id `laser-torsion-1200x600` for the one module there was then; it opens as the 1200 × 600 standard module.

The range's own viewer and build guide, with the cut drawings and build sequence for each module, is in the layout project.
