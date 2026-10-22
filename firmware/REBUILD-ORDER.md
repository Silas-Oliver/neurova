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

Arduino alone. Nothing wired.

**Pass:** `8` prints the firmware version you just flashed. `MENU` responds.

Flash from `./firmware/flash.sh`, never the IDE -- it writes its own stale copy
of the sketch to disk before compiling and silently flashes that.

## Stage 1 -- supply, with nothing connected to it

Two equal battery packs in series, centre tap to the ground rail, and Arduino
`GND` to that same rail. Two 9 V gives ±9 V; two 3-cell AA holders give ±4.5 V.
No resistor divider -- the 220 Ω pair shifts under uneven load and drains
continuously.

**Pass:** probe each rail against the centre tap. Both within 10% of each other
and above ±3.5 V.

The sensor is **not** connected yet. A supply that holds unloaded and sags
loaded is a separate fault, and testing them together hides it.

## Stage 2 -- contact check

`D2` -> 100 kΩ -> row 24 -> `A0`, red splice at row 24, teal splice to `D3`.

This is the instrument, not the product feature. It exists at this stage so the
EMG test that follows can be interpreted.

**Pass, in order:**

| Test | Expect |
|---|---|
| `AC:1`, electrodes face to face | 0.0 counts |
| `AC:1`, electrodes in free air | ~1022.8 counts |
| `AC:1`, pinched hard between fingers | 400-450 counts |

No glove yet. Hand pressure is enough and it is repeatable.

## Stage 3 -- the EMG question

Sensor `+Vs`, `GND`, `-Vs` to rows 1, 5, 9. `SIG` -> 10 kΩ -> `A1`.

**First, with the jack out:** `CHECK` should show both rails still within 10%
*under this load*. That is the sag test, and it is the last thing that can
invalidate what follows.

**Then the jack in**, electrodes pressed firmly on the forearm by hand, with the
reference on a bony spot. Confirm contact with `AC:1` immediately before --
jack out to measure, jack in to record, because the module shorts the junction
at 500 Hz.

Then `6`, clench hard several times, `7`.

Two free things to try first: run the laptop on battery, and twist the two
signal leads around each other. Both attack mains pickup and cost nothing.

### This is the decision point

| Result | Means | Next |
|---|---|---|
| Envelope rises on clench | The whole chain works | Stage 4 |
| Flat | Amplifier implicated, finally on evidence | MyoWare 2.0, then Stage 4 |
| Noisy but responsive | Interference, not gain | Electrode matching, then Stage 4 |

Nothing below this line is worth doing until one of those three is true.
Mechanical work on a glove whose front end cannot work is wasted.

### If it is flat: eliminate electrode mismatch before buying anything

Common-mode rejection dies on *mismatch* between electrodes, not on absolute
impedance -- two at 50k each reject hum better than one at 2k and one at 50k.
Measure all three pairs with the contact check and solve:

    Z_A = S - Z_BC      where S = (Z_AB + Z_AC + Z_BC) / 2
    Z_B = S - Z_AC
    Z_C = S - Z_AB

Within about 2x of each other and mismatch is not your problem. An order of
magnitude apart and that alone explains the mains coupling, with no amplifier
fault at all.

## Stage 4 -- the mounting

Now, and not before, make contact hold without a hand on it.

A washer 0.5-1 mm thick goes **inside**, between the fabric and the electrode
flange, so the face stands proud of the glove instead of level with it.

**Pass:** `BURST` with the glove on and hands off -- 200 samples under 20k,
range inside 20x. Then three don/doff cycles that agree within about 20%.

## Stage 5 -- flex sensor

`D5` -> row 30 -> flex -> row 33 -> `A2`, and 100 kΩ from row 33 to the rail.

**Pass:** `FLEX` reads about 860 straight and about 570 bent. `CHECK` shows
contact, rail and EMG unchanged.

## Stage 6 -- the analog switch

74HC4066 in DIP-14, breadboard, no soldering. Firmware already calls
`moduleSwitch()` for it.

**Pass:** contact check reads normally with the jack left in. The manual
unplugging is gone, and with it the last step that stops this being automatic.
