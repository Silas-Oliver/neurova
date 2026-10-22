# Rebuild order

One subsystem at a time. Each stage has a pass test of its own and a regression
test on everything beneath it, so a change can only break what it touches.

The reason for the discipline: every dead end in this project came from two
faults being present at once. A dead battery and an ungrounded board and a
floating electrode produce one symptom between them, and no single test
separates them.

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

## Stage 1 -- contact check

`D2` -> 100 kΩ -> row 24 -> `A0`, red splice at row 24, teal splice to `D3`.
Nothing else on the board. No ground rail, no module, no flex.

This goes first because it is the most proven subsystem and the only one that
does not need the ground rail -- `D2` drives, `A0` senses, `D3` sinks, and the
return is through the pin.

**Pass, in order:**

| Test | Expect |
|---|---|
| `AC:1`, electrodes face to face | 0.0 counts |
| `AC:1`, electrodes in free air | ~1022.8 counts |
| `AC:1`, pinched hard between fingers | 400-450 counts |
| `BURST`, glove on | 200 samples under 20k, range inside 20x |

The last one is the hard one and it is mechanical, not electrical. A washer
0.5-1 mm thick goes **inside**, between the fabric and the electrode flange, so
the face stands proud of the glove instead of level with it. Do not move on
until `BURST` passes -- nothing downstream is worth measuring while contact is
still crossing three orders of magnitude inside a second.

## Stage 2 -- ground rail

Arduino `GND` to the bottom rail. Nothing else on it yet.

**Pass:** `CHECK` shows contact unchanged. That is the whole test, and it is
worth running: it confirms in one step that the contact check is independent of
the rail, which is why it kept working for days while everything else failed.

## Stage 3 -- flex sensor

`D5` -> row 30 -> flex -> row 33 -> `A2`, and 100 kΩ from row 33 to the rail.

**Pass:** `FLEX` reads about 860 straight and about 570 bent. `CHECK` shows
contact unchanged.

## Stage 4 -- supply, with nothing connected to it

Two equal battery packs in series, centre tap to the ground rail. Two 9 V gives
±9 V; two 3-cell AA holders give ±4.5 V. No resistor divider -- the 220 Ω pair
shifts under uneven load and drains continuously.

**Pass:** probe each rail against the centre tap. Both within 10% of each other
and above ±3.5 V. `CHECK` shows contact and flex unchanged.

The sensor is **not** connected yet. A supply that holds unloaded and sags
loaded is a separate fault, and testing them together hides it.

## Stage 5 -- sensor powered, electrodes not connected

Sensor `+Vs`, `GND`, `-Vs` to rows 1, 5, 9. `SIG` -> 10 kΩ -> `A1`. Jack out.

**Pass:** rails still within 10% *under this load* -- this is the sag test.
`CHECK` shows EMG idle reading a steady level rather than a rail. Contact and
flex unchanged.

## Stage 6 -- electrodes on the sensor

Jack in.

This is where the two subsystems finally collide, and the collision is
expected: the module's input shorts the contact junction at 500 Hz, so a
contact check with the jack in reads `no contact (junction pinned)`.

**Pass:** contact check pinned with the jack in, normal with it out. Then, and
only now, `6` / clench / `7`.

Interpreting that is in `DIAGNOSTIC-PLAN.md` phase 3. Two free things to try
first: run the laptop on battery, and twist the two signal leads together.
Both attack mains pickup and cost nothing.

## Stage 7 -- the analog switch

74HC4066 in DIP-14, breadboard, no soldering. Firmware already calls
`moduleSwitch()` for it.

**Pass:** contact check reads normally with the jack left in. The manual
unplugging is gone, and with it the last step that stops this being automatic.
