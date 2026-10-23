# Getting started

This guide takes you from an empty plan to trains running on it, first on screen and then for real. Each step links to the full guide for that part.

## 1. Plan the track

Railplot opens with a sample: an OO oval with a passing loop. A short tour in the corner shows you round the first time (**Help > Show the tour** brings it back).

1. **File > New layout** starts your own. Pick the track system you'll use (Peco Setrack, Streamline, Hornby, PIKO, Märklin C, Kato Unitrack).
2. Draw a baseboard: **Baseboard** (<kbd>B</kbd>) and click its corners, or **Tools > Rectangular baseboard**. The laser-cut [baseboard modules](baseboard-modules.md) are under **Tools > Baseboard modules**.
3. Press <kbd>S</kbd> and click to put down a start point, then pick track from the list on the left. Each piece joins at the arrow. Click any open end to build from there, and drag pieces about: they snap together.
4. **Flex track** (<kbd>G</kbd>) closes a gap between two ends with one smooth curve.
5. The **Layout** panel on the right shows open ends, joints that don't line up, the steepest gradient and the tightest curve. Give the length of your longest train under **Your trains** to check that loops and sidings take it.
6. Press <kbd>3</kbd> to look round it in 3D.

## 2. Keep it and print it

- **File > Save** (<kbd>Ctrl</kbd>+<kbd>S</kbd>) writes a `.railplot` file. Railplot also keeps your plan as you go, so it's there next time even if you didn't save, and if your computer stops mid-way it opens the last good copy.
- **File > Print** (<kbd>Ctrl</kbd>+<kbd>P</kbd>) prints the plan on one page, the track at 1:1 on A4 pages to lay it from, the parts list, a cutting list for the baseboards and the wiring list. Print the 1:1 pages at 100% ("actual size") and check the 50 mm bar on each with a ruler. **Save as PDF** in the print dialog makes a PDF.
- **Parts list** shows every piece to buy, with prices if you enter them.

## 3. Run it on screen

You don't need any hardware to try running trains.

1. Press **Control** (top right, or <kbd>C</kbd>), then **Try it with the simulator**. The whole layout becomes one block with one train.
2. Drive with the slider, or press **Drive in 3D** (<kbd>D</kbd>): <kbd>E</kbd> and <kbd>Q</kbd> (or <kbd>→</kbd> and <kbd>←</kbd>) open and close the throttle, <kbd>C</kbd> changes the camera, <kbd>P</kbd> throws the point ahead, <kbd>T</kbd> makes up the train from the catalogue of locos, coaches and wagons.
3. For a second train, press **Add a second train** on the Drive tab (or **Set up > Divide into blocks for** 2 to 6 trains). Railplot cuts the layout into blocks at the points and along long runs, and each train only gets power where no other train is. A train that has to wait shows **Waiting** and who for.
4. **Set up > Signals > Signals at every block joint** puts up signals that show red when the block beyond isn't free. Simulated trains stop at them.
5. If you'd rather simulated trains stopped at a point set against them than came off, tick **Set up > Simulator > Trains stop short of a point set against them**.

See [Controlling the layout](control/README.md) for everything the drive view does.

## 4. Let it run itself

On the **Auto** tab:

- **Routes** set several points with one tap.
- **New trip** sends a train to another block by the shortest way, setting the points.
- **New timetable** sends a train from stop to stop at set times on the layout's own **clock**, which can run up to 12 times faster than real time.

See [Automation](control/automation.md).

## 5. Run the real layout

1. Build the controller: an ESP32 board, a DRV8876 driver per block, servos for the points. [Controlling the layout](control/README.md) lists the parts (about €50 to start) and shows the wiring.
2. **Set up > Install Railplot on the controller**, then **Send layout to controller**.
3. Drive from Railplot, or from any phone on the same Wi-Fi at `http://railplot.local`.
4. For several phones at once, throttle apps such as Engine Driver, and automations that keep running with the screens closed, run the [hub](control/hub.md) on a laptop or Raspberry Pi. Every phone and laptop connected to it can drive in 3D too.
5. Already have a DCC-EX command station? Railplot can use its outputs as blocks: see [DCC-EX](control/dcc-ex.md).

## 6. Plan with Claude

With the Railplot connector, Claude can read your plan, check it, and propose changes that you accept or reject on the plan. See [Claude and Railplot](claude.md).
