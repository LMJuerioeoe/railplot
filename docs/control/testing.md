# Hardware testing

Railplot's control side is new. This page says honestly what has been checked, and how you can help check the rest.

## What is tested

| Part | How it is tested | On real hardware? |
| --- | --- | --- |
| Blocks, sensors, signals, point locking | Automated tests, and the simulator in the app | Not yet |
| Automations, routes, trips | Automated tests, including a full shuttle run on the simulator | Not yet |
| ESP32 firmware | Compiles for the Arduino ESP32 core 2 and 3, with both driver types | Not yet |
| Railplot hub | Automated tests: two browsers, a scripted WiThrottle client, layout changes | Runs on Linux; not yet tried on a Raspberry Pi |
| WiThrottle | Automated tests against the published protocol, and a scripted client | Not yet tried with Engine Driver or WiThrottle on a phone |
| DCC-EX | Automated tests against a pretend command station, over TCP and a serial port | Not yet tried with a real EX-CommandStation |
| mDNS announcement | Automated tests of the packets | Not yet tried on a real network |

## Trying it on your layout

Start small, with one train and one block, and a hand near the power switch.

1. **Bench first.** Wire one DRV8876 to a short length of track on the bench, with one loco. Check the loco creeps at the bottom of the slider and that **Stop all trains** stops it at once.
2. **Watchdog.** With the loco running slowly, turn the phone's Wi-Fi off. The track power should cut within 2 seconds.
3. **Servos.** Set each point's pulses so the blades just close, and check they don't buzz once in place.
4. **Sensors.** Push a wagon past each sensor by hand and check its diamond lights on the plan.
5. **Two blocks.** Run a loco slowly across the joint between two blocks in both directions. Watch for sparks or a stutter at the joint.
6. **Automations.** Run a trip and watch the first run all the way: that it sets off the right way, follows the right route and stops before the end of the block.
7. **Throttle apps** (with the hub): connect, drive, throw a point from the app, then put the phone to sleep and check its train stops.
8. **DCC-EX**: check the command station's outputs switch to DC (its `<=>` command lists them), speeds and direction, turnouts, sensors, and that closing Railplot stops the trains.

## Reporting back

Open an issue on the project's GitHub page with:

- what you tried and what happened (a short video helps a lot),
- your hardware: the ESP32 board, the driver boards, the command station and its version, the phone and app,
- Railplot's version (Help > About Railplot) and the hub's or firmware's version,
- for the hub, what it printed in its window or `journalctl -u railplot-hub`.

Working setups are worth reporting too: this page will list them.
