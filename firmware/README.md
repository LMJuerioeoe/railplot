# Railplot controller firmware

Firmware for an ESP32 board that drives an analogue layout for Railplot: six DC block drivers, servo points, LED signals and lights, and infrared train sensors. It also serves Railplot to phones on the same Wi-Fi.

See [docs/control](../docs/control/README.md) for parts, wiring and setup.

## Build and upload

1. Edit `railplot-controller/config.h`: your Wi-Fi (or leave it empty for the controller's own network), the controller's name and the PWM frequency.
2. Upload, using one of:
   - **PlatformIO**: from this folder run `pio run -t upload`, then `pio run -t uploadfs` to put Railplot on the controller. `bun run build` in the project root refreshes `data/index.html.gz`.
   - **Arduino IDE 2**: install "esp32 by Espressif", open `railplot-controller/railplot-controller.ino`, choose "ESP32 Dev Module" and upload. Then use **Install Railplot on the controller** in Railplot's Control > Set up.

It builds with Arduino core 2.x or 3.x and needs no extra libraries.

## HTTP API

Everything is a plain GET or form POST, with `Access-Control-Allow-Origin: *`.

| Request | What it does |
| --- | --- |
| `GET /api/frame?cid=ID&take=0&b=0:512,1:-300&s=0:1500&o=3:4095` | Set outputs and read inputs. `b` is block driver duty (−1023…1023, sign = direction), `s` is servo pulse in µs, `o` is LED level (0…4095). Only one client (`cid`) drives at a time; another takes over after 3 s of silence or with `take=1`. |
| `GET /api/status` | The same reply without changing anything. |
| `GET` or `POST /api/layout` | The Railplot layout stored on the controller (POST as a form file upload). |
| `GET` or `POST /api/session` | Small JSON with train positions and point settings, shared between devices. |
| `POST /api/app` | Install the Railplot app (form file upload of `index.html`). |
| `GET /api/rescan` | Look for I2C boards again. |

A frame reply looks like this:

```json
{ "fw": "railplot-controller 0.4.0", "name": "railplot", "driver": "k3j9x2", "accepted": true, "stopped": false,
  "in": [0, 0, 0, 0, 0, 0, 0, 0], "mA": [240, 0, 0, 0, 0, 0], "dmA": [0, 31, 0, 6, 0, 0], "boards": { "servo": 1, "led": 0, "sensor": 1 } }
```

`in` holds 16 sensor bits per MCP23017 board. A sensor that saw a train any time since the last frame reads 1. `mA` is the current through each block driver. `dmA` (DRV8876 drivers, firmware 0.4 and later) is the current each block with no power drew during its last detection pulse: a full-voltage pulse of `DETECT_PULSE_US` (600 µs) every `DETECT_PERIOD_MS` (100 ms), too short to move a loco. A standing loco draws tens of mA in it; a coach with a 2.2 kΩ resistor wheelset about 5 mA. Set `DETECT_PERIOD_MS` to 0 to turn the pulses off; some open-frame motors may tick quietly with them on.

If no frame arrives for `WATCHDOG_MS` (1.5 s), all blocks are switched off.
