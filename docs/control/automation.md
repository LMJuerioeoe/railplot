# Automation: routes, trips and shuttles

Railplot can set points for you and drive trains on their own. You set this up on the **Auto** tab in Control mode. Everything runs on the same blocks, sensors and signals as driving by hand, so automated trains are kept apart just like yours.

Try it without hardware: **File > Open the two-train control demo**, then **Auto > Goods shuttle > Start**.

## Routes

A route sets several points with one tap, such as "Into the loop" or "Main line through the station".

1. On the **Auto** tab, press **New route**.
2. Choose a position for each point the route needs. Leave the others as **Leave as it is**. **Use how the points are set now** fills it in from the plan.
3. Save. The route appears as a button on the **Drive** tab, lit while all its points are set its way.

A point won't move while a moving train is in its block, so a route can be refused. Stop the train, or wait until it has passed.

## Trips

A trip drives one train to another block and stops it there. Railplot works out the way from the plan, including which points to set.

1. Place the train on the plan (Drive or Set up), and make sure the layout is split into blocks with sensors at the joints.
2. On the **Auto** tab, press **New trip**.
3. Choose the train and where it should go. Railplot lists up to three ways there, shortest first, with the points each one sets.
4. Choose how it sets off (**Forward** or **Back**, as on its throttle), its speed, and how it arrives:
   - **Slow to** a gentle speed when it enters the last block,
   - **Stop after** that many seconds.
5. Choose what happens next: stay there, wait and come back, or shuttle back and forth until you stop it.
6. **Save and start**.

While a trip runs, Railplot only powers the blocks on the chosen way. If the train sets off the wrong way, it simply stops at the end of its block; change **Set off** and try again. Analogue locos don't tell Railplot which way they face, so the first run of a new trip is worth watching.

On arrival the train is **held**: the block beyond it gets no power until its next trip sets off. Even if it coasts, it stops at the gap.

## Automations

A trip is a ready-made automation. **New automation** lets you write your own, step by step, for station stops, timetables and light shows.

| Step | What it does |
| --- | --- |
| Drive | Set the throttle: forward or back, and a speed. Carries straight on to the next step. |
| Wait until it reaches | Wait until the train's sensors say it is in a block. |
| Slow down and stop | Slow to a speed, then stop after some seconds, without running past the end of the block it is in. |
| Stop | Throttle to zero, and wait until the train has stopped (momentum still applies). |
| Wait | Wait some seconds. |
| Wait until a block is free | Wait until no other train is in a block or heading into it. |
| Set a route | Set a route's points. Waits if a point can't move yet. |
| Set a point | Set one point. Waits if it can't move yet. |
| Signal | Hold a signal at red, or put it back to automatic. |
| Light | Turn a light on or off. |
| Wait until the clock says | Wait until the layout clock (below) says a time, such as 10:05. |

Tick **Start again from the first step** to make it repeat, for a shuttle or a timetable that runs all afternoon.

## Timetables and the layout clock

The **Clock** on the Auto tab is the layout's own time. Set the time it starts at and how fast it runs: real time, or up to 12 times faster, so a day's trains fit into an evening (at 4 times, an hour goes by in 15 minutes). **Back to the start** puts it back. The Drive tab shows it once an automation uses it, and every device connected to the hub sees the same time.

**New timetable** makes an automation from a list of departures:

1. Choose the train. It starts from the block it's in.
2. For each departure, give the time and where it goes. Railplot takes the shortest way there, setting the points, and stops the train in that block.
3. Tick **Run it again every day** for a timetable that repeats; the last departure then has to take the train back to where it started.
4. Save, then **Start** it. The train waits for each time on the clock. If it's held up (a signal, another train) it leaves as soon as it can.

The timetable is an ordinary automation: **Edit** shows its steps.

An automation without a train can still work points, signals and lights: an evening sequence that turns the station lights on, say.

### Rules worth knowing

- **One automation per train.** Starting a second one for the same train stops the first.
- **You can always take over.** Moving a train's throttle stops its automation. So does **Stop all trains** and turning the track power off.
- **Blocks and signals still apply.** An automated train stops at a red signal or an occupied block like any other, and carries on when the way clears.
- **Automations run where the layout runs.** Without a hub, that's the phone or laptop driving: close it and they stop (and the controller cuts the power). With the [hub](hub.md), they keep running with every screen closed.

## In throttle apps

Throttle apps connected to the hub show routes as routes, and each automation as a route called "Auto: …". Setting the "Auto" route starts the automation, or stops it if it is running.
