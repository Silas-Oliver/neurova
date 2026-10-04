# Diagnostic plan

Written because every EMG test so far has had at least two faults present at once --
a dead supply, an ungrounded board, megohm contact, often all three -- and a test
with two unknowns in it resolves neither.

Work in order. Do not start a phase until the one before it passes. A failure in
phase 3 means nothing if phase 1 and 2 were never verified.

## Phase 1 -- contact

Costs nothing. Everything downstream depends on it.

### 1.1 Does the mounting hold?

Fit a 0.5-1 mm washer **inside**, between the fabric and the electrode flange, so the
face stands proud of the glove rather than level with it. Then `BURST`.

| Result | Meaning |
|---|---|
| 200 samples under 20k, range inside 20x | Pass. Go on. |
| `UNSTABLE`, range over 20x | Still crossing the touch boundary. Thicker washer. |
| All over 500k, steady | Not touching at all. Wrong spot, or the washer is too thin. |

### 1.2 Is it reproducible?

Three don/doff cycles, `BURST` after each. Compare the three.

Within ~20% is a pass. Wildly different means the mounting is not repeatable, which is
a product problem, not a measurement one -- the loading has to be a fixed object
(a sewn band of measured length), not a technique applied by hand.

### 1.3 Are the three electrodes matched?

**The test that has never been run, and it bears directly on EMG.** Common-mode
rejection dies on *mismatch* between electrodes, not on absolute impedance: two at
50k each reject hum far better than one at 2k and one at 50k.

The contact check measures whatever sits between the drive lead (red splice, row 24)
and the sink lead (teal splice, row 26). Move those leads to take all three pairs:

    Z_AB, Z_AC, Z_BC

Then, with S = (Z_AB + Z_AC + Z_BC) / 2:

    Z_A = S - Z_BC
    Z_B = S - Z_AC
    Z_C = S - Z_AB

Assumes body bulk resistance is small against skin impedance, which holds except at
the very best contact.

If the three are within about 2x of each other, mismatch is not your problem. If one
is an order of magnitude off the others, that alone could explain the mains coupling
with no amplifier fault at all.

## Phase 2 -- supply

The v3 needs **±3.5 V minimum**. Two facts worth holding together:

- A 9 V battery through the 220 Ω divider gives ±4.5 V, in spec -- but that battery
  measured **0.9 V** on a verified probe.
- A virtual ground off the Arduino's 5 V gives only ±2.5 V, which is **below spec**.

So it is entirely possible the v3 has never once been correctly powered, and that no
EMG result so far means anything.

### 2.1 Build a real dual supply

Two **equal** battery packs in series, centre tap to ground. Two 9 V gives ±9 V; two
3-cell AA holders give ±4.5 V and AA cells are likelier to already be in the house.

No resistor divider. The 220 Ω pair was always a compromise -- it shifts whenever the
load is uneven and drains about 15 mA continuously.

### 2.2 Verify before connecting the sensor

Probe each rail against the centre tap. Both should read within 10% of each other.

### 2.3 Verify again with the sensor connected

A supply that holds unloaded and sags loaded is a different fault, and it looks exactly
like a sensor problem if you never check.

## Phase 3 -- EMG

Only after 1 and 2 pass. `6`, clench hard several times, `7`.

| Result | Meaning | Action |
|---|---|---|
| Envelope rises on clench | The whole chain works | Buy nothing yet |
| Completely flat | Amplifier implicated | MyoWare justified on evidence |
| Noisy but responsive | Interference, not gain | See 1.3 -- mismatch or missing right-leg drive |

The third outcome is the likeliest and the most informative. A difference amplifier
with 10k inputs has no right-leg drive and poor common-mode rejection under mismatch,
so a responsive-but-buried signal points at the architecture rather than a fault.

## What each phase rules out

| Passing phase | Eliminates |
|---|---|
| 1.1 | Electrode mounting, electrode condition |
| 1.2 | Day-to-day reproducibility |
| 1.3 | Electrode mismatch as a CMRR cause |
| 2.2 | Dead cells, wrong topology |
| 2.3 | Supply sag under load |
| 3 | Everything upstream of the amplifier |

Only when 1 and 2 have passed does a phase 3 failure justify buying anything.
