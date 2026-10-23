# The Railplot hub

The hub is a small program that runs your layout on a laptop or a Raspberry Pi, with no screen needed. Without it, the phone or laptop you drive from runs the layout, and only one device drives at a time. With it:

- **Any number of phones and laptops** drive at once, each its own trains, and all of them see the same layout.
- **WiThrottle and Engine Driver apps** work (see [Throttle apps](throttles.md)).
- **Automations keep running** with every screen closed.
- **DCC-EX over the network**, or plugged into the hub's USB port, works (see [DCC-EX](dcc-ex.md)).

The hub drives the controllers; phones and laptops send it commands and show what it is doing.

## Get it

Download the hub for your computer from the Releases page. It is one file with nothing else to install.

| Computer | File |
| --- | --- |
| Windows (64-bit) | `railplot-hub-windows-x64.exe` |
| Linux PC | `railplot-hub-linux-x64` |
| Raspberry Pi 3, 4, 5, Zero 2 W with **64-bit** Raspberry Pi OS | `railplot-hub-raspberry-pi-64bit` |
| Mac with Apple silicon | `railplot-hub-mac-apple-silicon` |
| Mac with Intel | `railplot-hub-mac-intel` |

The 32-bit Raspberry Pi OS and the original Pi Zero aren't supported.

From source, with [Bun](https://bun.sh) installed: `bun run hub`, or `bun scripts/build-hub.ts` to make the single-file program.

## Start it

On Windows, double-click the file (Windows may ask whether to let it use the network; allow private networks). On Linux or a Mac, in a terminal:

```sh
chmod +x railplot-hub-linux-x64      # once
./railplot-hub-linux-x64
```

It prints the addresses to use, for example:

```
Railplot hub 0.11.0 is running.
  Phones and laptops: open http://192.168.1.20:8080 (or http://railplot-hub.local:8080)
  WiThrottle and Engine Driver: 192.168.1.20, port 12090 (they should find it by themselves)
  Layout: Sample OO oval with passing loop, kept in /home/pi/railplot-hub/layout.railplot
```

## Give it your layout

1. In Railplot on your computer, open your plan and go to **Control > Set up**.
2. Under **Railplot hub**, type the hub's address (for example `192.168.1.20:8080` or `railplot-hub.local:8080`) and press **Connect**.
3. Choose **Send this layout**.

From then on, changes you make on that computer go to the hub, and the hub passes them to every other device. Phones just open the hub's address and go straight to driving.

The hub keeps the layout, with where every train is and how the points are set, in its layout file (by default `railplot-hub/layout.railplot` in your home folder). It saves every few seconds and when you stop it.

## Options

| Option | What it does |
| --- | --- |
| `--layout FILE` | Where the hub keeps the layout. |
| `--port N` | Port for the web page (8080). |
| `--withrottle N` | Port for throttle apps (12090). `0` turns WiThrottle off. |
| `--name TEXT` | The name throttle apps show ("Railplot"). |
| `--host NAME` | The network name: the hub answers as `NAME.local` (`railplot-hub`). |
| `--no-mdns` | Don't announce the hub on the network. Apps then need its address typed in. |

## On a Raspberry Pi, starting by itself

A Raspberry Pi 4 or Zero 2 W on 64-bit Raspberry Pi OS Lite makes a tidy hub that lives under the layout.
These steps use the user name `pi`; use yours if it is different.

1. Copy `railplot-hub-raspberry-pi-64bit` to `/home/pi/railplot-hub/` and make it executable (`chmod +x`).
2. If DCC-EX is plugged into the Pi by USB, let the hub use serial ports: `sudo usermod -aG dialout pi`, then log out and in.
3. Create `/etc/systemd/system/railplot-hub.service`:

   ```ini
   [Unit]
   Description=Railplot hub
   After=network-online.target
   Wants=network-online.target

   [Service]
   User=pi
   ExecStart=/home/pi/railplot-hub/railplot-hub-raspberry-pi-64bit --name "My railway"
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```

4. `sudo systemctl enable --now railplot-hub`. Check it with `systemctl status railplot-hub` and `journalctl -u railplot-hub -f`.

Raspberry Pi OS already runs its own network announcer, Avahi. If throttle apps don't find the hub by themselves, let Avahi announce it instead: run the hub with `--no-mdns` and add `/etc/avahi/services/withrottle.service`:

```xml
<?xml version="1.0" standalone="no"?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name>Railplot</name>
  <service><type>_withrottle._tcp</type><port>12090</port></service>
</service-group>
```

The Pi itself then answers as `raspberrypi.local` (or whatever its host name is), so phones open `http://raspberrypi.local:8080`.

## Driving in 3D through the hub

Every phone and laptop connected to the hub can **Drive in 3D**: the hub sends its simulator's trains with every update, ten times a second, and each screen keeps them moving smoothly in between. Making up trains in the Trains dialog, placing them, uncoupling and turning them round are all done on the hub, so everyone sees the same trains.

## Claude

The hub program is also the [Claude connector](../claude.md): `railplot-hub mcp` runs it for the Claude desktop app or Claude Code. With the hub running, Claude's proposals reach every Railplot connected to it straight away. If you turn on **Let Claude use the controls** in Control > Set up, Claude can also set routes, points, signals and lights, drive trains and run automations. It can never switch track power.

## Good to know

- **Your network only.** Anyone on the same Wi-Fi can open the hub and drive. Don't forward its ports to the internet.
- **Stopping the hub stops the trains.** It sends a stop to every controller before it quits. ESP32 controllers also cut the power by themselves 1.5 seconds after the hub goes quiet. A DCC-EX command station doesn't, so see [DCC-EX](dcc-ex.md).
- **One hub per layout.** Don't let a phone drive the ESP32 directly while the hub is running. If one does, the hub shows "another device is driving" with a **Take over** button.
- **https pages can't reach it.** Browsers block https pages from talking to devices on your network, so the web version of Railplot can't connect to a hub. The desktop app, the offline file, and the page the hub serves itself all can.
