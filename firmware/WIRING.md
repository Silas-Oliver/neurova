# Wiring

The breadboard layout, and the measurements that tell you each zone is right.

Written because "what was the setup when it worked?" once cost a search through a
38 MB conversation transcript. A reading is only evidence if you know what produced it.

## Arduino pins

| Pin | Goes to | Used by |
|---|---|---|
| `GND` | ground rail | everything except the contact check |
| `A0` | row 24 | contact check junction |
| `A1` | row 16 | EMG signal |
| `A2` | row 33 | flex junction |
| `A3` | row 52 | probe / supply monitor |
| `D2` | row 20 | contact drive |
| `D3` | row 26 | contact sink |
| `D5` | row 30 | flex drive |

## Rows

Ground rail carries: Arduino `GND`, sensor `GND`, and jumpers from rows 5 and 36.

| Row | Contents |
|---|---|
| 1 | supply **+** · 220 Ω · sensor **+Vs** · red probe lead when parked |
| 5 | 220 Ω · 220 Ω · jumper to ground rail |
| 9 | supply **−** · 220 Ω · sensor **−Vs** |
| 14 | sensor **SIG** · 10 kΩ |
| 16 | 10 kΩ · jumper to `A1` |
| 20 | jumper from `D2` · 100 kΩ |
| 22 | red lead, both cut ends |
| 24 | 100 kΩ · jumper to `A0` · red splice |
| 26 | jumper from `D3` · teal splice |
| 30 | jumper from `D5` · flex lead |
| 33 | flex lead · jumper to `A2` · 100 kΩ |
| 36 | 100 kΩ · jumper to ground rail |
| 50 | 10 kΩ · red probe lead |
| 52 | 10 kΩ · 10 kΩ · jumper to `A3` |
| 54 | 10 kΩ · jumper straight to an Arduino `GND` pin |

Rows 1, 5 and 9 are the EMG module's dual supply: a 220 Ω pair splitting the supply with
row 5 as the midpoint, tied to Arduino ground. The module needs ±3.5 V minimum and a
single rail cannot give it one. **The supply itself is unresolved** -- the 9 V battery
measured 0.9 V on a verified probe and is finished.

Row 22 is where the isolation relay used to sit. The red lead was cut for it and is
rejoined there; no transistor, diode, or `D4` any more.

## Unplug the EMG jack before any contact measurement

Not optional, and not obvious. The module's input presents about 10 µF, which at the
contact check's 500 Hz is roughly 32 Ω -- it shorts the junction and every reading comes
back as `no contact (junction pinned)`.

This became necessary only when the ground rail was connected, because that tied the
module's ground to the Arduino's and completed the path. Before that the module's ground
floated and the jack was harmless. The relay used to open this path automatically;
removing it made the jack a manual step.

## Known-good readings

Check a zone against these before trusting anything downstream.

| Test | Expect | Means |
|---|---|---|
| `3` (DIAG), electrodes off, jack out | ~1021 / 0 / 1021 | contact divider intact |
| `AC:1`, electrodes face to face | 0.0 counts | divider and 100 kΩ sound, no series break |
| `AC:1`, electrodes in free air | ~1022.8 counts | open-circuit ceiling |
| `AC:1`, pinched hard between fingers | 400-450 counts, 64-78 kΩ | electrodes themselves are fine |
| `FLEX`, finger straight | ~860 | flex divider reaches ground |
| probe on the Arduino's own `5V` pin | 4.99 V | probe is accurate |

The contact check is the one circuit that does not use the ground rail: `D2` drives,
`A0` senses, `D3` sinks, and the return is through the pin. It kept working for days
while nothing on the board was grounded, which is exactly why that fault went unnoticed
-- flex, `RAIL` and EMG were all failing at once and the contact check was not.

## Contact impedance reference

Every figure measured through the divider above, at 500 Hz.

| Condition | Ohms |
|---|---|
| Electrodes shorted together | under 150 |
| Loaded from outside the glove, settled | 1,500 |
| Hand pressure through the glove | 3,900 |
| Pinched between fingers | 64,000 - 78,000 |
| Glove alone, Sept 2026, settled skin | 38,000 |
| Glove alone, Oct 3 2026, cold start | 600,000 - 1,300,000 |
| Dry electrodes, no deliberate loading | 103,000 - 267,000 |
| Electrodes in free air | 2,600,000 |

The 1% repeatability figure came from three glove don/doff cycles reading 283, 286 and
285 counts. Worth recording what that test did and did not establish: the electrode had
already settled to 36 kΩ before the first cycle, so all three re-applied to skin that was
already conditioned. It measured mechanical reproducibility with skin state held
constant. A cold start onto dry skin is a different and much harder test, and that figure
is not evidence about it.

## Sharing the electrodes: decisions carried forward

The contact check and the EMG front end use the same two electrodes, and they interfere.
This is the history of how that has been solved, including one plan that is no longer
viable, recorded so it is not reached for again.

### The capacitor plan is dead

The plan of record was two 2.2 µF non-polarized capacitors, one in each lead between the
electrode tap and the module's jack. The electrode side would keep its path to `A0` and
`D3`, the module side would see only AC, and the firmware's own module-present check
would read open and disable itself with nothing to configure.

That worked because the contact check drove **DC**. It no longer does. A 500 Hz square
wave sits inside the EMG band of 20-500 Hz, so a high-pass cannot separate the two: the
capacitors would pass the contact drive into the amplifier and the module would go on
loading the divider. **Do not buy those capacitors.** Moving the contact check to AC
quietly invalidated the approach at the time and it went unnoticed for days.

### What replaces it

An analog switch -- CD4066 or 74HC4066, one package, one GPIO -- opened for the contact
check and closed for EMG. That is exactly what `moduleSwitch()` already calls for and
what the relay did, without the coil, the transistor, the flyback diode or the 70 mA.
The relay was the right idea built from what the kit contained.

It also removes the manual step of unplugging the jack, which is a workaround for a
missing switch rather than a design.

The two functions never need to run at the same time: the check confirms the electrode is
seated before a session. That makes this a sequencing problem rather than a filtering
problem, which is a much easier one.

### Splicing does not survive into a product

The splices exist because pre-made electrode cables had to be cut into. On a board the
snap is a footprint and the tap point is a node with two traces leaving it. Nothing is
joined, so nothing is spliced.

### The electrode has to stand proud of the fabric

Measured, not assumed. Mounting the stud through a hole seats the electrode flange flat
against the inside of the glove, leaving its face level with the fabric rather than past
it. Whether it touches skin then depends on whether fabric happens to press against skin
at that spot, and a burst caught it crossing from 1,892 ohms to 2,741,665 ohms inside
888 ms -- excellent contact to open air, with no deliberate pressure at either end.

A product needs a moulded or stitched standoff holding the face roughly a millimetre past
the inner surface. On the current build, a 0.5-1 mm washer goes **inside**, between the
fabric and the electrode flange, so it pushes the face toward skin. A spacer on the
outside under the snap does the reverse and makes it worse.
