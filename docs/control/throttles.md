# Throttle apps: Engine Driver and WiThrottle

The [Railplot hub](hub.md) speaks the WiThrottle protocol, the one Engine Driver (Android), WiThrottle (iPhone and iPad) and many other throttle apps and handheld throttles use with JMRI and DCC-EX. With the hub running, those apps drive Railplot's analogue trains as if they were DCC locos.

## Connect

1. Start the hub, and make sure the phone is on the same Wi-Fi.
2. Open the app. It should list **Railplot** among the servers it finds. If it doesn't, add a server by hand: the hub's IP address (the hub prints it) and port **12090**.

## Drive

- **Train 1 is address 1**, train 2 is address 2, and so on, in the order of **Set up > Trains**. Railplot shows each train's address when you hover over its colour swatch. Pick a train from the app's roster, or type its address (short or long both work).
- **Speed and direction** work as usual. A train keeps its direction when you bring the speed to zero.
- **Emergency stop** stops the train at once, without momentum.
- **Track power** in the app turns all of Railplot's track power on and off.
- **Functions** (lights, sound) do nothing: analogue locos have none.
- Momentum, top speed and the starting speed come from Railplot's settings for that train, so a gentle app slider still gives a scale start.

## Points and routes

- **Turnouts** in the app are Railplot's points, named `RP1`, `RP2`… with the point's number and part. Thrown means any route other than straight; on a three-way point, Thrown moves to the left route and Toggle steps through all three.
- **Routes** in the app are Railplot's routes, plus one called "Auto: …" for each automation. Setting an "Auto" route starts that automation, or stops it if it is already running.

## Safety

- **Blocks, signals and point locking still apply.** The app can't drive a train into an occupied block, through a red signal, or move a point under a moving train; Railplot tells the app why with a message.
- **A phone that goes quiet stops its trains.** If the app's heartbeat lapses (it misses about 15 seconds of contact), or its connection drops without saying goodbye, the hub stops the trains it was driving.
- **Railplot and the app share the trains.** Someone in the browser and someone with the app can both move the same train's throttle; the last one wins, and both see the change. Moving a train's throttle in the app stops any automation running that train.

## Tested with

The hub's WiThrottle side is tested against the published protocol, with automated tests and a scripted client. It hasn't yet been tried with each app on real phones; [Hardware testing](testing.md) lists what has been checked, and reports are welcome.
