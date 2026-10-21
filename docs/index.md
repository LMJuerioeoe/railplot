# Railplot

Railplot is a free, open-source track planner for OO and H0 model railways that can also run the layout you planned: analogue (DC) trains, points, signals and lights, from a laptop or any phone.

[Open Railplot in your browser](app/) · [Download for Windows and Linux](../../../releases)

## Plan

- Real sectional track from Peco Setrack, Peco Streamline, Hornby, PIKO A-Gleis, Märklin C-Gleis and Kato Unitrack, plus flexible track.
- Snap pieces together, close gaps with flex, set heights and gradients, and look round it in 3D.
- The laser-cut baseboard range: standard boards, corners, curves, traversers, turntables and canopy modules that join face to face, with a warning when a point motor would sit on a frame member.
- Ready-made fiddle yards, run-round loops and the Inglenook sidings shunting puzzle, and example shunting layouts on the baseboard modules.
- Checks that your longest train fits the loops, sidings and blocks, and that curves suit long coaches.
- A parts list with prices to shop from, and true-scale SVG drawings for templates.
- Plan with Claude from the Claude app: it reads and checks your plan and proposes changes that you accept or reject.

## Run

- Drive each train with momentum, from Railplot on a laptop or a phone browser.
- Points on servos, colour-light signals, building lights and infrared train sensors, through a small ESP32 controller.
- Split the track into blocks to run up to ten trains: power follows each train, and signals keep them apart.
- Routes, trips, shuttles and timetables run trains for you.
- With the hub on a laptop or Raspberry Pi, several phones drive at once and Engine Driver and WiThrottle apps work.
- A DCC-EX command station can drive the blocks instead of the ESP32 boards.

## Guides

| Guide | What's in it |
| --- | --- |
| [Controlling the layout](control/README.md) | Parts, wiring and setting up, from one train to ten |
| [Automation](control/automation.md) | Routes, trips, shuttles and timetables |
| [The hub](control/hub.md) | Running the layout from a laptop or Raspberry Pi |
| [Throttle apps](control/throttles.md) | Engine Driver and WiThrottle |
| [DCC-EX](control/dcc-ex.md) | A DCC-EX command station as analogue blocks |
| [Hardware testing](control/testing.md) | What has been tested, and how to help |
| [Firmware](../firmware/README.md) | The ESP32 controller's settings and interface |
| [Baseboard modules](baseboard-modules.md) | The baseboard range, track positions and the module data |
| [Claude and Railplot](claude.md) | The connector: Claude reads your plans and proposes changes |
| [Yards and example layouts](yards.md) | Fiddle yards, run-round loops, the Inglenook sidings and example layouts on the baseboards |
| [Track libraries](library-format.md) | Adding a track system |
| [The .railplot file](file-format.md) | The layout file format |

Railplot is an independent project and is not affiliated with Peco, Hornby, PIKO, DCC-EX or any other manufacturer or software.
