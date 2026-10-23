# DCC-EX: a command station as analogue blocks

[DCC-EX](https://dcc-ex.com) is an open-source DCC command station. Its TrackManager can switch each of its track outputs (A to H) to DC, so an EX-CommandStation can also run analogue trains. Railplot can drive one: each DC output is a Railplot block, and Railplot does the block following, signals, points and automations on top.

This suits you if you already have an EX-CommandStation, or want ready-made hardware with a motor shield instead of wiring DRV8876 boards.

## What you need

- An EX-CommandStation running version 5 or newer (TrackManager came in version 5), on an Arduino Mega with a motor shield, an EX-CSB1, or similar. The motor driver must be one DCC-EX supports for DC.
- How many blocks you get depends on the motor drivers: two outputs per motor shield, up to eight on a Mega and four on an EX-CSB1, according to DCC-EX's documentation.
- **USB**: a computer running the Railplot desktop app, or Railplot in Chrome or Edge (the offline file, or the page from a hub), or the [hub](hub.md) with the command station plugged into it.
- **Network**: a command station with Wi-Fi or Ethernet, and the [hub](hub.md). Browsers can't open the plain network connection DCC-EX uses (port 2560), so network connections go through the hub.

## Set it up

1. In **Control > Set up > Controllers**, press **Add DCC-EX**.
2. Choose **USB** or **Network**.
   - USB, without a hub: press **Connect USB** and choose the command station's port. In the desktop app, with only one USB port plugged in it connects straight away, and either way it opens the same port again by itself next time; Chrome and Edge remember it too.
   - USB, through the hub: type the serial port, for example `/dev/ttyACM0` on a Raspberry Pi or Linux, `/dev/cu.usbmodem1101` on a Mac, or `COM3` on Windows.
   - Network: type its address, for example `192.168.4.1` (port 2560 is assumed) or `192.168.4.1:2560`.
3. In **Blocks**, give each block the DCC-EX controller and a track letter.
4. Leave **Cab for track A** at 9001 unless you use those cab numbers for DCC locos. Track B gets 9002, and so on.

When it connects, Railplot sets each track that has a block to DC mode with its cab number and turns its power on. Tracks with no Railplot block are left alone, so you can keep, say, track A as DCC main and use B as an analogue block, though see the warning below.

## What Railplot sends

| Railplot | DCC-EX command |
| --- | --- |
| Block on track B, set up | `<= B DC 9002>` then `<1 B>` |
| Block power and direction | `<t 9002 speed direction>`, speed 0–126 |
| Point (2 routes) | `<T id 0>` closed (straight) or `<T id 1>` thrown, for a turnout you defined on the command station |
| Three-way point | two turnouts: `id` for left and `id + 1` for right |
| Signal LED or light | `<z vpin>` on, `<z -vpin>` off |
| Reading current | `<JI>`, every second |
| Stop on closing | `<!>` |

Train sensors are the command station's own sensors: give each Railplot sensor the DCC-EX sensor id, and Railplot follows the `<Q id>` and `<q id>` messages the command station sends as a sensor turns on and off. Define turnouts, sensors and outputs on the command station first (in its `myAutomation.h`, or with `<T …>`, `<S …>` and `<Z …>` commands); the DCC-EX documentation explains how.

Lights on DCC-EX are on or off; brightness isn't sent.

## Important

- **Never bridge DCC-EX to another system.** DCC-EX's documentation is clear that a loco must never run from a DCC-EX track onto track fed by any other DC or DCC system, including another output that isn't DCC-EX. Railplot won't power a train across a joint between a DCC-EX block and a block on any other controller, marks those joints with a red cross on the plan, and warns in Set up. Keep both rails insulated there, and don't run trains across.
- **The same goes for DCC and DC on one command station.** Don't let a loco run between a DCC track and a DC track.
- **No watchdog.** An ESP32 controller cuts the power by itself if it loses contact. A DCC-EX command station keeps the last speed it was given. Railplot sends an emergency stop when it closes properly, but if the computer or the connection fails, trains keep running until you press the command station's own stop, or use a throttle connected straight to it. Keep a way to stop it close by.
- **Current trips.** DCC-EX protects its outputs itself. Railplot also reads the current per track and flags a block over 1.25 A as a fault.
- **PWM frequency.** DCC-EX drives DC tracks at a low PWM frequency by default (about 120–130 Hz). Some locos run more smoothly at a higher one; DCC-EX's documentation explains how to change it.

## Not tested yet

Railplot's DCC-EX link is written from DCC-EX's published command reference and tested against a pretend command station, over TCP and over a serial port. It hasn't been tried with a real EX-CommandStation yet. If you try it, [Hardware testing](testing.md) says what to check and how to report back.
