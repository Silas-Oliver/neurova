# Rebuild order

One subsystem at a time. Each stage has a pass test of its own and a regression
test on everything beneath it, so a change can only break what it touches.

The reason for the discipline: every dead end in this project came from two
faults being present at once. A dead battery and an ungrounded board and a
floating electrode produce one symptom between them, and no single test
separates them.

## Why EMG comes early

The first version of this file built the glove up and reached EMG last. That
was wrong. EMG is the only part that has never worked, so it carries all the
remaining uncertainty, and it does **not** depend on the glove mounting -- only
on contact being adequate at the moment of the test. Pressing the electrodes on
by hand gives 400-450 counts, repeatably, which is enough to find out whether
the amplifier works.

The mounting is the slow problem. Solving it first would mean days of mechanical
work on a product that might not have a working front end, and if the amplifier
turns out to be wrong, that work was spent on a dead end.

Two things stay early regardless:

**The supply, because EMG cannot be judged without it.** The sensor needs
±3.5 V. The battery measured 0.9 V, and a virtual ground off the Arduino's 5 V
reaches only ±2.5 V, which is under spec. There may be no point in this project
where that chip was correctly powered, which would mean no EMG result so far
means anything.

**The contact check, because it is the instrument.** It is not a prerequisite
for EMG -- it is how you know contact was good when EMG was tried. Without it a
flat trace still has two explanations.

## The loop

Every stage runs the same three steps.

1. **Add one thing.**
2. **Pass its own test**, below.
3. **`CHECK`** -- rail, contact, flex and EMG idle, each against the saved
   reference. Anything outside tolerance prints a delta. If something moved
   that this stage did not touch, stop and find out why before going on.
4. **`CHECK:SAVE`** once the stage passes, locking the new state in as the
   reference the next stage is judged against.

`CHECK:SAVE` is the commit. Never save a reference you have not just verified,
or every later comparison is against a broken state.

## Stage 0 -- bare board

**0.1** Strip the breadboard completely. Every jumper, every resistor, the
sensor, the batteries. Start from nothing.

**0.2** Close the Arduino IDE's Serial Monitor and any browser tab holding the
port. Web Serial keeps it open until you disconnect, and the upload fails with
"Resource busy".

**0.3** `./firmware/flash.sh`. Never the IDE -- it writes its own stale copy of
the sketch to disk before compiling and silently flashes that.

**0.4** Open the serial console at 9600.

**0.5** Press `8`. It must print the version string you just flashed. If it
prints an older one, the upload did not take and nothing below this means
anything.

**Pass:** version matches, `MENU` responds.

## Stage 1 -- the probe, then the supply

Build the instrument before the thing it measures. In that order -- a supply
reading checked with an unverified probe tells you nothing, and that exact
mistake cost an evening when a 100 kΩ divider's source impedance made the ADC
drift and the readings contradicted each other.

### 1a -- the probe

**1.1** Arduino `GND` -> bottom ground rail. One jumper.

**1.2** 10 kΩ from row 50 to row 52.

**1.3** 10 kΩ from row 52 to row 54.

**1.4** Jumper row 52 -> `A3`.

**1.5** Jumper row 54 -> an Arduino `GND` **pin directly**, not the rail. The
probe gets its own return so a rail problem cannot corrupt the instrument
measuring it.

**1.6** A flying jumper from row 50. That loose end is the red probe tip.

**1.7** Touch the probe tip to the Arduino's own `5V` pin. `RAIL` must read
**4.99 V**, or near it.

**Do not continue if it does not.** Everything after this trusts this number.

### 1b -- the supply

Use **two 3-cell AA holders**, ±4.5 V. Not 9 V batteries, for a reason that
matters: this probe divides by two against a 5 V ADC, so it can read up to
10 V safely. Two 9 Vs in series is 18 V, which arrives at `A3` as 9 V and
damages the pin. At ±4.5 V both the half and the whole are inside the probe's
range, so you can check the balance. AAs are also likelier to be in the house.

**1.8** Pack A red -> row 1. Pack A black -> row 5.

**1.9** Pack B red -> row 5. Pack B black -> row 9.

Row 5 is now the centre tap: the junction of the two packs.

**1.10** Jumper row 5 -> ground rail. That makes the centre tap your zero, and
rows 1 and 9 become +4.5 V and -4.5 V with respect to it.

**1.11** Probe row 1. Expect **+4.5 V**, or above +3.5 V at minimum.

**1.12** Check the balance, since the probe cannot read a negative voltage.
Move the ground-rail jumper from row 5 to row 9 temporarily and probe row 1
again. It should read **twice** the figure from 1.11 -- about 9 V. If it does,
the two halves are equal and the negative rail is as good as the positive one.
Put the jumper back on row 5.

**1.13** `CHECK:SAVE`. This is the first commit.

**Pass:** probe validated at 4.99 V, +4.5 V on row 1, about 9 V across the
whole pack, nothing connected to the supply yet.

## Stage 2 -- contact check

**2.1** Jumper `D2` -> row 20.

**2.2** 100 kΩ from row 20 to row 24.

**2.3** Jumper row 24 -> `A0`.

**2.4** Red splice -> row 24.

**2.5** Jumper `D3` -> row 26.

**2.6** Teal splice -> row 26.

Row 22 holds both cut ends of the red lead, rejoining what the relay used to
break. The EMG module is not connected to anything yet.

**2.7** `3` with the electrodes off and apart. Line 1 should read near 1021.

**2.8** `AC:1` with the two electrodes pressed face to face.

**2.9** `AC:1` with them held apart in free air.

**2.10** `AC:1` pinched hard between finger and thumb.

| Step | Expect | If wrong |
|---|---|---|
| 2.8 | 0.0 counts | Something is open in the leads or the divider |
| 2.9 | ~1022.8 counts | Something is shorting the junction |
| 2.10 | 400-450 counts | Electrodes are spent, or the skin is very dry |

**2.11** `CHECK:SAVE`.

No glove at this stage. Hand pressure is repeatable and that is all the EMG
test needs.

## Stage 3 -- the EMG question

### 3a -- the sensor, powered, electrodes not connected

**3.1** Sensor `+Vs` -> row 1. Sensor `GND` -> ground rail. Sensor `-Vs` ->
row 9. Jack **out**.

**3.2** Probe row 1 again. Still +4.5 V? A supply that holds unloaded and sags
loaded is a separate fault, and this is the only step that separates them.

**3.3** Sensor `SIG` -> row 14. 10 kΩ from row 14 to row 16. Jumper row 16 ->
`A1`.

**3.4** `CHECK`. Rail and contact should both be inside tolerance. EMG idle
should sit at a steady level, not pinned at 0 or 1023.

**3.5** `CHECK:SAVE`.

### 3b -- the free interference fixes, before you measure anything

**3.6** Unplug the laptop from mains. Run it on battery. This removes the earth
path your hum is riding in on, and costs nothing.

**3.7** Twist the two signal leads around each other along their length.
Magnetic pickup scales with the loop area between them, and twisting collapses
it.

Do both before the first reading, so you are not chasing interference you could
have removed in thirty seconds.

### 3c -- the measurement

**3.8** Electrodes on the forearm, both signal electrodes over the same muscle
belly a few centimetres apart, reference on a bony spot -- wrist or elbow.
Press them on and keep them pressed.

**3.9** Jack **out**, `AC:1`. Record the number. This is your proof that
contact was good at the moment of the test. Under about 100 counts is good.

**3.10** Jack **in**. The contact check is now unusable -- the module shorts the
junction at 500 Hz -- which is expected and is why 3.9 comes first.

**3.11** `6`. Clench hard, hold two seconds, release. Repeat five times. `7`.

### 3d -- the decision

| Result | Means | Next |
|---|---|---|
| Envelope rises on each clench | The whole chain works | Stage 4 |
| Completely flat | Amplifier implicated, on evidence | 3e, then MyoWare 2.0 |
| Noisy but responsive | Interference, not gain | 3e |

Nothing below this line is worth doing until one of those is true. Mechanical
work on a glove whose front end cannot work is wasted.

### 3e -- if it is flat or noisy: rule out electrode mismatch first

Common-mode rejection dies on *mismatch* between electrodes, not on absolute
impedance. Two at 50k each reject hum better than one at 2k and one at 50k.

**3.12** Jack out. Measure all three pairs with `AC:1`, moving the red and teal
splices between the three electrode leads: Z_AB, Z_AC, Z_BC.

**3.13** Solve for each electrode:

    S = (Z_AB + Z_AC + Z_BC) / 2
    Z_A = S - Z_BC
    Z_B = S - Z_AC
    Z_C = S - Z_AB

Within about 2x of each other and mismatch is not the problem. An order of
magnitude apart and that alone explains the coupling, with no amplifier fault
at all -- reseat the odd one and repeat 3c before spending anything.

## Stage 4 -- the mounting

Only now, and only if stage 3 gave a usable signal.

**4.1** Cut a washer 0.5-1 mm thick, electrode-sized, with a hole for the stud.
Felt, silicone, or a slice of eraser.

**4.2** Fit it **inside**, between the fabric and the electrode flange, so the
face stands proud of the glove rather than level with it. Outside, under the
snap, does the opposite and makes it worse.

**4.3** Tape each lead to the glove 3-4 cm from the snap, leaving a small loop
of slack, so cable movement cannot lever the electrode off.

**4.4** Glove on, hands off, `BURST`.

**4.5** Three don/doff cycles, `BURST` after each.

**Pass:** 200 samples under 20k with the range inside 20x, and the three cycles
agreeing within about 20%.

## Stage 5 -- flex sensor

**5.1** Jumper `D5` -> row 30.

**5.2** Flex sensor lead 1 -> row 30. Lead 2 -> row 33.

**5.3** Jumper row 33 -> `A2`.

**5.4** 100 kΩ from row 33 to row 36. Jumper row 36 -> ground rail.

**5.5** `FLEX` straight, then bent. Expect about 860 and about 570.

**5.6** `CHECK` -- contact, rail and EMG must all be unchanged.

**5.7** `CHECK:SAVE`.

## Stage 6 -- the analog switch

74HC4066 in DIP-14, straddling the breadboard centre channel. No soldering.

**6.1** Pin 14 -> ground rail's positive counterpart (+5 V from the Arduino),
pin 7 -> ground rail.

**6.2** Route the red lead through one switch channel: row 22's two cut ends
become the channel's in and out.

**6.3** Control pin -> `D4`, which `moduleSwitch()` already drives.

**6.4** Contact check with the jack left in. It should read normally.

**Pass:** no more unplugging. The device is automatic for the first time.
