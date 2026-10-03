// Neurova — electrode contact check + EMG
//
// Wiring (contact-check circuit):
//   D2 -> fixedResistor -> junction        (D2 drives the divider; see below)
//   junction -> E1 -> [skin] -> E2 -> D3   (D3 is the return leg)
//   A0 -> the resistor/E1 junction
// The skin between E1 and E2 is the LOW half of the divider, with the fixed resistor on
// top. That orientation is what makes readResistance()'s formula and OPEN_CIRCUIT_RAW
// correct: lift an electrode and the junction floats UP toward the drive voltage, which
// is why a near-maximum reading means "no contact" rather than a very high resistance.
//
// The divider is driven from a digital pin rather than a supply rail for two reasons.
// A pin can be switched to INPUT (high-impedance) to lift the whole circuit off the
// electrodes, which is what will let the contact check and the EMG module eventually
// share one set of electrodes instead of needing two. And a pin's HIGH level is the same
// rail the ADC measures against, so the measurement is ratiometric: supply sag cancels
// out of the ratio instead of skewing every resistance. (Driving this from VIN is
// actively wrong — VIN is not 5V, and on barrel-jack power it can exceed A0's rating.)
//
// Wiring (EMG module):
//   Module Vs+ -> 5V
//   Module Vs- -> GND
//   Module SIG -> A1
// EMG reads muscle electrical activity as a rising signal above a low resting baseline.
// This has been verified working on the bench with two active electrodes plus a working
// reference electrode. A bad reference electrode connection doesn't just make the signal
// noisy — it can make it unreadable across the entire gain range, so if EMG_RESULT looks
// wrong, check the physical electrode connections before assuming the code is wrong.
//
// Serial protocol (9600 baud, newline-terminated, matches the website):
//   CALIBRATE            -> CALIBRATION_RESULT:done:<ohms>  | CALIBRATION_RESULT:failed
//   SETBASELINE:<ohms>   -> BASELINE_SET:<ohms>:restored    | BASELINE_SET:failed
//   TEST                 -> TEST_RESULT:<verdict>:<good>,<poor>,<none>:<avgOhms|N/A>
//   STATUS               -> CONFIG:<fixedResistorOhms>:<adcRefV>, then a STATUS line
//                           STATUS:calibrated:<ohms>:<measured|restored> | STATUS:uncalibrated
//   FORGET               -> BASELINE_FORGOTTEN, then a STATUS line
//   DIAG                 -> raw ADC under three known pin states, for wiring faults
//   VERSION              -> FIRMWARE:<build tag>, to confirm what is actually running
//   EMG                  -> EMG_RESULT:<avg>,<min>,<max>
//   EMG_STREAM_START      -> EMG_STREAM:started, then continuous "EMG_LIVE:<mean>,<p2p>"
//                            every ~25ms until stopped
//   EMG_STREAM_STOP       -> EMG_STREAM:stopped
//
// EMG_STREAM is a different shape from every other command here: everything else is a
// one-shot "ask, then get one answer" exchange. Streaming has to keep listening for the
// STOP command *while* it's still sending readings, so it can't just block inside a loop
// with delay() the way runCalibration()/runContactTest() do — it uses millis() timing
// in the main loop() instead, so incoming serial bytes never sit unread for long.
//
// The baseline is a personal number: your own best-contact resistance. Every sample is
// judged against it rather than against a fixed universal threshold, because skin
// conductivity genuinely varies from person to person.

#include <EEPROM.h>

// Printed at boot and on VERSION. Its only job is answering "is the board actually
// running the build I just edited?" without having to infer it from behaviour — the
// Arduino IDE does not reload a sketch that changed on disk, so an upload can silently
// flash stale code from an editor window opened earlier.
const char FIRMWARE_VERSION[] = "2026-10-02a rig check";

const int CONTACT_PIN = A0;
const int CONTACT_DRIVE_PIN = 2;   // top of the divider — HIGH to measure, INPUT to disconnect
const int CONTACT_SINK_PIN = 3;    // return leg — LOW to measure, INPUT to disconnect
const float FIXED_RESISTOR = 100000.0;   // the fixed leg of the divider, in ohms

// Kept as named constants because they are board characteristics, not arbitrary numbers:
// moving to a 3.3V / 12-bit board later (an ESP32 or Nano 33 BLE for the Bluetooth work)
// changes both, and every stored baseline along with them.
const float ADC_REFERENCE_V = 5.0;
const int ADC_MAX_COUNTS = 1023;

// Above this raw ADC value the divider is reading essentially open — no skin path at all.
const int OPEN_CIRCUIT_RAW = 1015;

// Declared here because the Arduino preprocessor inserts function prototypes above the
// first function in the file, and those prototypes reference these types.
enum PathState { PATH_OK, PATH_NO_CONTACT, PATH_BLOCKED };
enum ContactState {
  NO_CONTACT,
  POOR_CONTACT,
  GOOD_CONTACT
};

// The EMG module's inputs are permanently wired to the same electrodes, and they are not a
// short, but it is also not slow-settling noise: swept with SETTLE:<ms>, the HIGH-vs-LOW
// gap grows 49 -> 108 -> 121.18 -> 121.21 counts at 50/250/1000/3000 ms and then stops, so
// the input is capacitive and only the settled reading means anything. Settled, it is
// ~13.4 kOhm to a 1.03 V bias, which predicts the measured 305.41 to within two counts.
//
// 13.4 kOhm sits in PARALLEL with skin, so it caps what can be measured through it: open
// circuit and 470 kOhm skin differ by five counts at the junction. Compensating for it
// recovers accuracy at low skin resistance but cannot recover range, so a real contact
// check still needs the module disconnected from the electrodes -- by series capacitors
// (4.7 uF suffices against a 13.4 kOhm input) or an analog switch.
const float EMG_SHUNT_OHMS = 13400.0;
const float EMG_BIAS_V = 1.03;
// With the module connected the junction tops out near 571 counts, so a reading above this
// can only mean the module is absent and the junction is floating free.
const float MODULE_ABSENT_MIN_RAW = 900.0;

// Relay coil, through a PN2222 with a flyback diode across the coil. The module's inputs
// carry roughly 10 uF to ground -- measured two ways, as a 1.1 s DC settle against 113 kOhm
// and as an impedance falling 1281 / 236 / 125 ohms at 10 / 50 / 100 Hz -- which shorts the
// junction at every frequency the contact check could use. Series capacitors cannot isolate
// an AC measurement (they pass AC by definition) and cutting the module's power made it
// worse, its input clamping to a dead rail. Only a real open circuit works.
//
// Wired to the relay's NC contact, so a released coil leaves the module connected: the
// board can lose power or run older firmware and EMG still behaves as it always did. The
// coil is only energised for the moment a contact measurement takes, which also keeps it
// quiet during EMG, when the signal is microvolts and a buzzing coil alongside it would
// not be.
// 1 ms half-period = 500 Hz, the top of the EMG band and the best-conditioned point in the
// sweep: 10 and 100 Hz both sat near full scale where the reading says only "very high".
const int CONTACT_AC_HALF_MS = 1;
// Flex sensor: a resistor that changes with bend angle, on its own pins so it shares
// nothing with the contact check or the EMG module -- no relay, no switching, no
// interference. Driven from a pin rather than 5V for the same reason the contact divider
// is: the firmware can release it between reads, and the measurement is ratiometric, so
// supply sag cancels out of the ratio instead of skewing every reading.
//
//   D5 --[flex]--+-- A2
//                +--[FLEX_FIXED_RESISTOR]-- GND
//
// Starting at 100k because that is what is to hand; the right value is near the geometric
// mean of the sensor's flat and bent resistance, which the first readings will show.
const int FLEX_PIN = A2;
const int FLEX_DRIVE_PIN = 5;
const float FLEX_FIXED_RESISTOR = 100000.0;
const int FLEX_OVERSAMPLE = 32;
// Reads the EMG module's positive rail through a 2:1 divider, so the Arduino can act as a
// voltmeter for the one thing we otherwise cannot see. The LED test only proves a rail
// EXISTS -- an LED lights from about 2 V -- and a resistive virtual ground fails by
// drifting, not by disappearing. A supply sitting at +7/-2 lights both LEDs and is still
// below the sensor's minimum.
//
//   +Vs --[10k]--+-- A3
//                +--[10k]-- GND
//
// 10k, not 100k: a 100k pair presents ~50k to the pin, five times past the ATmega's 10k
// source-impedance limit, and readings taken through it drift and contradict themselves.
// 10k presents 5k, inside spec, and still draws under half a milliamp.
//
// The divider halves it, so even a full 9 V on +Vs arrives at 4.5 V and cannot harm the
// pin. It draws about 45 uA, far too little to disturb what it is measuring.
const int RAIL_PIN = A3;
const float RAIL_DIVIDER_RATIO = 2.0;
const int MODULE_RELAY_PIN = 4;
const int RELAY_SETTLE_MS = 15;

// Opens the relay, disconnecting the EMG module from the electrodes for a measurement.
bool moduleRelayConnected = true;

void moduleSwitch(bool connected) {
  if (connected == moduleRelayConnected) return;   // idempotent: no coil, no delay
  moduleRelayConnected = connected;
  digitalWrite(MODULE_RELAY_PIN, connected ? LOW : HIGH);
  delay(RELAY_SETTLE_MS);
}

// Whether the EMG module is currently loading the divider. Set from a measurement rather
// than assumed, so one firmware measures correctly with the jack in or out.
bool moduleConnected = false;
float lastPathReleased = 0, lastPathSinking = 0;

// The reading that means "no skin path at all" under present conditions. With the module
// unplugged that is the junction floating to the top of the range; with it connected the
// module's bias holds it far lower, and comparing against a fixed constant would report
// every open electrode as a valid measurement.
float openThresholdRaw() {
  if (!moduleConnected) return OPEN_CIRCUIT_RAW;
  return lastPathReleased - 12.0;   // a few counts of margin below the measured open value
}


// How long the amplifier and the divider need after a mode change before a reading can be
// trusted — switching the drive pin steps the voltage on the electrodes, and the EMG
// module's input filter takes a moment to settle back out afterwards.
// Not const: SETTLE:<ms> overrides it at runtime. The EMG module's input does not behave
// like a resistor -- its apparent impedance measured eightfold different at 1 MOhm and at
// 100 kOhm -- which points at an AC-coupled or actively biased input still charging when
// the reading is taken. Sweeping this is how that gets settled without reflashing.
int contactSettleMs = 1200;

// At megohm source impedances the ADC's sample-and-hold cannot charge in one conversion,
// so a single reading is both biased low and very noisy -- measured here as a 73-count
// spread between identical runs, against a real signal of about 25 counts.
//
// Two things help, and neither costs anything. Waiting between conversions gives the
// capacitor time to actually reach the junction voltage. And averaging many readings cuts
// random noise by the square root of the count: 256 samples turns +/-70 counts into about
// +/-4, which is the difference between a signal buried in noise and one that is legible.
// 100 kOhm puts the ADC's source impedance within a few multiples of its 10 kOhm spec
// instead of a hundred times past it, so far less averaging is needed than the 1 MOhm
// divider demanded. 64 samples still divides random noise by 8 and keeps a reading brief.
const int CONTACT_OVERSAMPLE = 64;
const unsigned int CONTACT_ADC_SETTLE_US = 400;

// How far the sink pin must be able to move the junction for the reading to mean
// anything. Observed: about 5 counts with the EMG module attached, about 383 with only
// skin. Anywhere in between is ambiguous, so this sits well clear of the former.
const float CONTACT_PATH_CONTROL_MIN = 100.0;
// Above this the junction is floating up, which is an open circuit -- the opposite of
// something holding the line down. Well below OPEN_CIRCUIT_RAW on purpose: a 21 MOhm skin
// path reads ~960, nowhere near the ~1020 of a fully lifted electrode, but it is still
// electrically "no contact" and must not be mistaken for a blocked line.
const float CONTACT_PATH_FLOATING_MIN = 700.0;
const int EMG_SETTLE_MS = 750;

const int CALIB_SAMPLE_COUNT = 10;
const int CALIB_SAMPLE_DELAY = 300;
const int TEST_SAMPLE_COUNT = 10;
const int TEST_SAMPLE_DELAY = 300;

// A calibration only counts if most of its samples were actually measurable — otherwise
// we'd happily "calibrate" against an electrode that isn't touching skin.
const int CALIB_MIN_VALID_SAMPLES = 6;

// A sample is good contact if its resistance is within this multiple of the baseline.
// Baseline is your best contact, so higher resistance means worse contact.
const float GOOD_CONTACT_MULTIPLE = 1.5;

// Sanity bounds for a baseline arriving over serial, so a typo or a garbled line can't
// silently install a nonsense reference that makes every later test meaningless.
const float MIN_PLAUSIBLE_BASELINE = 1000.0;        // 1 kilohm
const float MAX_PLAUSIBLE_BASELINE = 20000000.0;    // 20 megohm

// EEPROM lets the baseline survive the automatic reset that happens every time a serial
// connection opens — without it, the board forgets its calibration on every reconnect.
const int EEPROM_ADDR_MAGIC = 0;
const int EEPROM_ADDR_BASELINE = 4;
const int EEPROM_ADDR_FIXED_R = 8;
const int EEPROM_ADDR_ADC_REF = 12;
// Bumped when the stored layout or its meaning changes, so baselines written by an older
// build are ignored rather than misread. (V2: excitation moved from VIN to a driven pin,
// which changed what every stored resistance means.)
const unsigned long EEPROM_MAGIC = 0x4E524257UL;  // "NRBW"
// The flex calibration keeps its own magic and its own slot, so a board that has one and
// not the other restores whichever it has rather than discarding both.
const int EEPROM_ADDR_FLEX_MAGIC = 16;
const int EEPROM_ADDR_FLEX_FLAT = 20;
const int EEPROM_ADDR_FLEX_BENT = 24;
const unsigned long EEPROM_FLEX_MAGIC = 0x4E524658UL;  // "NRFX"
// Endpoints closer together than this are not a hand opening and closing -- most likely
// the same pose captured twice, which would make every later reading meaningless.
const float FLEX_MIN_SPAN_COUNTS = 60.0;

// A saved snapshot of the rig in a state that worked. The hard part of this build has not
// been getting a signal, it has been getting back to a signal after something moved: a pin
// loose in a barrel plug, a jack, three unsecured leads. Comparing today's rig against a
// recorded good one turns "it worked yesterday" into a number per subsystem.
const int EEPROM_ADDR_CHECK_MAGIC = 28;
const int EEPROM_ADDR_CHECK_RAIL = 32;
const int EEPROM_ADDR_CHECK_CONTACT = 36;
const int EEPROM_ADDR_CHECK_EMG = 40;
const unsigned long EEPROM_CHECK_MAGIC = 0x4E524348UL;  // "NRCH"
// Deviations beyond these are worth pointing at. Generous on the rail, which is a supply
// and should barely move; looser on contact, which legitimately varies with skin.
const float CHECK_RAIL_TOLERANCE_V = 0.25;
const float CHECK_CONTACT_TOLERANCE_FRAC = 0.20;

float baselineResistance = -1;
bool isCalibrated = false;
bool baselineWasRestored = false;  // true if it came from EEPROM or the website, not a fresh measurement

// ---------------- EMG ----------------

const int EMG_PIN = A1;
const int EMG_SAMPLE_COUNT = 25;
const int EMG_SAMPLE_DELAY = 20;  // faster than contact-check — muscle signal changes quickly

// Live streaming for the website's plotter. 25ms (~40 samples/sec) is fast enough to look
// smooth on a live plot while staying comfortably under what 9600 baud can carry — each
// "EMG_LIVE:1023\n" line is about 14 bytes, so this uses roughly 560 bytes/sec of the
// ~960 bytes/sec the connection actually has.
const unsigned long EMG_STREAM_INTERVAL_MS = 25;

// One mains cycle at 60 Hz. Averaging across exactly one cycle cancels mains hum, since
// equal amounts of its positive and negative halves land in the sum. Averaging that many
// samples also shrinks random noise by roughly the square root of the count. Use 20000
// for 50 Hz regions.
const unsigned long EMG_AVERAGE_WINDOW_US = 16667;
bool emgStreaming = false;
unsigned long lastEmgStreamSampleTime = 0;

// Declared up here rather than beside its function: the IDE inserts generated prototypes
// above the first function, and a return type defined later in the file is not yet known
// at that point.


// ---------------- baseline storage ----------------

// A baseline is only meaningful alongside the circuit that produced it: swap the fixed
// resistor or move to a board with a different ADC reference and the same stored number
// describes different skin. So the circuit constants are written next to the baseline and
// checked on the way back in, which makes a stale baseline invalidate itself instead of
// silently skewing every later verdict.
void saveBaselineToEeprom(float ohms) {
  EEPROM.put(EEPROM_ADDR_MAGIC, EEPROM_MAGIC);
  EEPROM.put(EEPROM_ADDR_BASELINE, ohms);
  EEPROM.put(EEPROM_ADDR_FIXED_R, FIXED_RESISTOR);
  EEPROM.put(EEPROM_ADDR_ADC_REF, ADC_REFERENCE_V);
}

void forgetBaselineInEeprom() {
  unsigned long blank = 0;
  EEPROM.put(EEPROM_ADDR_MAGIC, blank);
  baselineResistance = -1;
  isCalibrated = false;
  baselineWasRestored = false;
}

// Floats that made the round trip through EEPROM should compare exactly, but a relative
// tolerance keeps a harmless last-bit difference from throwing away a good baseline.
static bool sameConstant(float a, float b) {
  return fabs(a - b) <= (fabs(b) * 0.0001);
}

// Returns true and fills ohms if EEPROM holds a baseline we wrote and still trust.
bool loadBaselineFromEeprom(float &ohms) {
  unsigned long magic = 0;
  EEPROM.get(EEPROM_ADDR_MAGIC, magic);
  if (magic != EEPROM_MAGIC) return false;

  float storedFixedR = -1;
  float storedAdcRef = -1;
  EEPROM.get(EEPROM_ADDR_FIXED_R, storedFixedR);
  EEPROM.get(EEPROM_ADDR_ADC_REF, storedAdcRef);
  if (!sameConstant(storedFixedR, FIXED_RESISTOR)) return false;
  if (!sameConstant(storedAdcRef, ADC_REFERENCE_V)) return false;

  float stored = -1;
  EEPROM.get(EEPROM_ADDR_BASELINE, stored);
  if (isnan(stored) || stored < MIN_PLAUSIBLE_BASELINE || stored > MAX_PLAUSIBLE_BASELINE) {
    return false;
  }
  ohms = stored;
  return true;
}

void applyBaseline(float ohms, bool restored) {
  baselineResistance = ohms;
  isCalibrated = true;
  baselineWasRestored = restored;
  saveBaselineToEeprom(ohms);
}

// ---------------- measurement ----------------

// Converts one raw ADC reading into a resistance. Returns false when the divider reads
// open, which means "not measurable" rather than "very high resistance".
bool readResistance(float rawReading, float &resistanceOut) {
  // Only a reading at the TOP of the range means "nothing connected" — that is the
  // junction floating up through the fixed resistor with no path to the sink pin.
  // A reading of zero is the opposite: a dead short, i.e. perfect contact. Treating it
  // as unmeasurable reported the best possible contact as no contact at all.
  if (rawReading >= openThresholdRaw() || rawReading < 0) {
    resistanceOut = -1;
    return false;
  }
  float voltage = rawReading * (ADC_REFERENCE_V / ADC_MAX_COUNTS);
  if (voltage >= ADC_REFERENCE_V) {
    resistanceOut = -1;
    return false;
  }
  // Skin sits on the low side, so the junction voltage rises with skin resistance.
  //
  // Current into the junction has to equal current out of it. Without the module that is
  // just the fixed resistor against the skin. With the module connected its 63 kOhm to
  // 1.40 V feeds the junction too, and ignoring it would report the parallel combination
  // of skin and module as though it were skin alone -- reading 27 kOhm skin as 19 kOhm,
  // and an open electrode as 63 kOhm rather than infinity.
  float feedCurrent = (ADC_REFERENCE_V - voltage) / FIXED_RESISTOR;
  if (moduleConnected) feedCurrent += (EMG_BIAS_V - voltage) / EMG_SHUNT_OHMS;
  if (feedCurrent <= 0) {
    resistanceOut = -1;
    return false;
  }
  resistanceOut = voltage / feedCurrent;
  return true;
}

// At megohm source impedances the ADC's sample-and-hold cannot charge within a single
// conversion, so one reading is both biased low and very noisy -- measured on this rig as
// a 73-count spread between identical runs, against a real signal of about 25 counts.
//
// Waiting between conversions gives the capacitor time to actually reach the junction
// voltage, and averaging cuts random noise by the square root of the sample count: 256
// samples turns roughly +/-70 counts into +/-4.
//
// Returns a fractional reading, because the average carries resolution finer than one ADC
// count and rounding would give back much of what the averaging just bought.
float readContactAdc() {
  analogRead(CONTACT_PIN);                    // discard: starts charging the S/H capacitor
  delayMicroseconds(CONTACT_ADC_SETTLE_US);
  analogRead(CONTACT_PIN);                    // discard again, now from a settled start

  unsigned long sum = 0;
  for (int i = 0; i < CONTACT_OVERSAMPLE; i++) {
    delayMicroseconds(CONTACT_ADC_SETTLE_US);
    sum += analogRead(CONTACT_PIN);
  }
  return (float)sum / CONTACT_OVERSAMPLE;
}

// Samples the EMG pin as fast as the ADC allows for one mains cycle, and reports two
// different views of that window.
//
// Which one carries the muscle signal depends on what the module actually outputs, and
// that is worth measuring rather than assuming. If it outputs a smoothed envelope, the
// MEAN rises with contraction and the averaging is pure gain in signal-to-noise. If it
// outputs raw EMG swinging about a bias, the mean stays put and the PEAK-TO-PEAK spread
// is what grows — and averaging the mean would actively destroy the signal.
//
// Reporting both costs nothing and settles the question with one clench.
void readEmgWindow(int &meanOut, int &peakToPeakOut) {
  unsigned long start = micros();
  unsigned long sum = 0;
  unsigned int count = 0;
  int lowest = ADC_MAX_COUNTS;
  int highest = 0;

  while (micros() - start < EMG_AVERAGE_WINDOW_US) {
    int sample = analogRead(EMG_PIN);
    sum += sample;
    count++;
    if (sample < lowest) lowest = sample;
    if (sample > highest) highest = sample;
  }

  if (count == 0) {          // should not happen, but never divide by zero
    meanOut = analogRead(EMG_PIN);
    peakToPeakOut = 0;
    return;
  }
  meanOut = (int)((sum + count / 2) / count);   // rounded, not truncated
  peakToPeakOut = highest - lowest;
}

// Reports the raw ADC under three known pin states, which separates a wiring fault from
// a contact problem. With the divider wired as documented and the junction shorted to the
// sink pin, the expected pattern is:
//   D2 HIGH, D3 LOW    -> near 0        the sink pin is pulling the junction down
//   D2 LOW,  D3 LOW    -> near 0        nothing is driving the junction up
//   D2 HIGH, D3 float  -> near max      junction pulled up through the fixed resistor
// A high reading in the first state means the sink side is not connected. A low reading
// in the third means the resistor or the drive pin is not connected.
void runDiagnostics() {
  moduleSwitch(false);
  Serial.println("--- DIAG ---");

  contactCircuitOn();
  Serial.print("D2=HIGH D3=LOW    raw=");
  Serial.println(readContactAdc(), 2);

  digitalWrite(CONTACT_DRIVE_PIN, LOW);
  delay(contactSettleMs);
  Serial.print("D2=LOW  D3=LOW    raw=");
  Serial.println(readContactAdc(), 2);

  digitalWrite(CONTACT_DRIVE_PIN, HIGH);
  pinMode(CONTACT_SINK_PIN, INPUT);
  delay(contactSettleMs);
  Serial.print("D2=HIGH D3=float  raw=");
  Serial.println(readContactAdc(), 2);

  contactCircuitOff();
  Serial.println("--- DIAG COMPLETE ---");
}

// Three distinguishable states, not two.
//
// The test is whether the sink pin can move the junction at all. If it can, the divider
// is in control and the reading means something. If it cannot, the two readings agree --
// and WHICH value they agree on says why:
//
//   both near the drive rail -> nothing is bridging the electrodes. No skin, or an
//                               electrode off. Ordinary, and the sampling loop already
//                               reports it properly, so this is not worth blocking on.
//   both held below it       -> something is driving the node harder than the divider
//                               can. In practice the EMG module's input bias, which
//                               makes every reading its bias rather than skin.
//
// Absolute level cannot be the test on its own: wearing the electrodes, the body itself
// leaks to ground -- measured here around 780k -- so the released reading never reaches
// the rail while anyone is actually wearing them.
PathState contactPathState() {
  pinMode(CONTACT_DRIVE_PIN, OUTPUT);
  digitalWrite(CONTACT_DRIVE_PIN, HIGH);

  pinMode(CONTACT_SINK_PIN, INPUT);              // released
  delay(contactSettleMs);
  float released = readContactAdc();

  pinMode(CONTACT_SINK_PIN, OUTPUT);             // sinking
  digitalWrite(CONTACT_SINK_PIN, LOW);
  delay(contactSettleMs);
  float sinking = readContactAdc();

  pinMode(CONTACT_DRIVE_PIN, INPUT);
  pinMode(CONTACT_SINK_PIN, INPUT);
  lastPathReleased = released;
  lastPathSinking = sinking;
  moduleConnected = (released < MODULE_ABSENT_MIN_RAW);

  if ((released - sinking) >= CONTACT_PATH_CONTROL_MIN) return PATH_OK;
  // A line that is genuinely blocked is held DOWN, so the deciding question is where the
  // junction sits, not merely whether the sink pin moved it. Sitting high means no path to
  // ground at all; only a junction that stays low despite the sink pin being released is
  // evidence of something else driving it.
  if (sinking >= CONTACT_PATH_FLOATING_MIN) return PATH_NO_CONTACT;
  return PATH_BLOCKED;
}

// Advisory only. This cannot tell the EMG module apart from the body's own leakage to
// ground -- both hold the junction down without going through the sink pin, and the
// second one is just what wearing the electrodes looks like. Refusing on it blocked
// legitimate calibrations more often than it caught a real fault, so it now says what it
// saw and lets the reading proceed to be judged on its own merits.
void reportPathSuspect() {
  Serial.print("Note: the sink pin barely moved the junction (released ");
  Serial.print(lastPathReleased, 1);
  Serial.print(", sinking ");
  Serial.print(lastPathSinking, 1);
  Serial.println("). If the EMG module is still plugged in, unplug it -- its input bias would");
  Serial.println("make every reading below its bias rather than your skin. Proceeding anyway.");
}

// Energises the divider. Only on while a reading is actually being taken, so the
// electrodes are not sitting with DC across them any longer than necessary.
void contactCircuitOn() {
  pinMode(CONTACT_DRIVE_PIN, OUTPUT);
  digitalWrite(CONTACT_DRIVE_PIN, HIGH);
  pinMode(CONTACT_SINK_PIN, OUTPUT);
  digitalWrite(CONTACT_SINK_PIN, LOW);
  delay(contactSettleMs);
}

// Lifts the divider off the electrodes entirely. INPUT is high-impedance, which is a real
// disconnection rather than just driving 0V — nothing the EMG amplifier can see.
void contactCircuitOff() {
  pinMode(CONTACT_DRIVE_PIN, INPUT);
  pinMode(CONTACT_SINK_PIN, INPUT);
}

ContactState classifyContact(float rawReading, float &resistanceOut) {
  if (!readResistance(rawReading, resistanceOut)) {
    return NO_CONTACT;
  }
  float threshold = isCalibrated ? (baselineResistance * GOOD_CONTACT_MULTIPLE)
                                 : (FIXED_RESISTOR * 3.0);  // fallback if TEST runs uncalibrated
  return (resistanceOut <= threshold) ? GOOD_CONTACT : POOR_CONTACT;
}

// ---------------- commands ----------------

void runCalibration() {
  moduleSwitch(false);
  Serial.println("--- CALIBRATION STARTED ---");
  if (contactPathState() == PATH_BLOCKED) reportPathSuspect();
  contactCircuitOn();

  float sum = 0;
  int validSamples = 0;

  for (int i = 0; i < CALIB_SAMPLE_COUNT; i++) {
    float impedance;
    bool measurable = measureContactImpedance(impedance);
    if (measurable) {
      sum += impedance;
      validSamples++;
    }
    Serial.print("Calibration sample ");
    Serial.print(i + 1);
    Serial.print("/");
    Serial.print(CALIB_SAMPLE_COUNT);
    Serial.print(": ");
    Serial.println(measurable ? String(impedance, 0) : String("no contact"));
    delay(CALIB_SAMPLE_DELAY);
  }

  contactCircuitOff();

  if (validSamples < CALIB_MIN_VALID_SAMPLES) {
    Serial.println("CALIBRATION_RESULT:failed");
    return;
  }

  // Hold a fresh calibration to the same bounds a restored one has to clear. Without
  // this, a reading pinned near open circuit gets stored happily, then silently dropped
  // on the next boot for being implausible -- calibration appearing to succeed and then
  // vanishing is far more confusing than it failing here and saying so.
  float measured = sum / validSamples;
  if (measured < MIN_PLAUSIBLE_BASELINE || measured > MAX_PLAUSIBLE_BASELINE) {
    Serial.print("Measured ");
    Serial.print(measured, 0);
    Serial.println(" ohms, outside the plausible range for skin — check electrode contact and the fixed resistor value.");
    Serial.println("CALIBRATION_RESULT:failed");
    return;
  }

  applyBaseline(measured, false);
  Serial.print("CALIBRATION_RESULT:done:");
  Serial.println(baselineResistance, 0);
}

// Installs a baseline measured earlier (restored from the website's account record).
// Deliberately validated rather than trusted: a stale or garbled number here would
// quietly skew every later verdict.
void setBaselineFromSerial(const String &payload) {
  float ohms = payload.toFloat();
  if (ohms < MIN_PLAUSIBLE_BASELINE || ohms > MAX_PLAUSIBLE_BASELINE) {
    Serial.println("BASELINE_SET:failed");
    return;
  }
  applyBaseline(ohms, true);
  Serial.print("BASELINE_SET:");
  Serial.print(baselineResistance, 0);
  Serial.println(":restored");
}

// A resistance only means something alongside the divider that produced it. The website
// stores this with every logged session so a resistor swap cannot silently make old and
// new readings look comparable when they are not.
void reportConfig() {
  Serial.print("CONFIG:");
  Serial.print(FIXED_RESISTOR, 0);
  Serial.print(":");
  Serial.println(ADC_REFERENCE_V, 2);
}

void reportStatus() {
  if (!isCalibrated) {
    Serial.println("STATUS:uncalibrated");
    return;
  }
  Serial.print("STATUS:calibrated:");
  Serial.print(baselineResistance, 0);
  Serial.println(baselineWasRestored ? ":restored" : ":measured");
}

void runContactTest() {
  moduleSwitch(false);
  if (contactPathState() == PATH_BLOCKED) reportPathSuspect();
  contactCircuitOn();
  int goodCount = 0;
  int poorCount = 0;
  int noContactCount = 0;
  float resistanceSum = 0;
  int resistanceSamples = 0;

  Serial.println("--- CONTACT TEST STARTED ---");

  for (int i = 0; i < TEST_SAMPLE_COUNT; i++) {
    float resistance;
    ContactState state;
    if (!measureContactImpedance(resistance)) {
      state = NO_CONTACT;
    } else {
      float threshold = isCalibrated ? (baselineResistance * GOOD_CONTACT_MULTIPLE)
                                     : (FIXED_RESISTOR * 3.0);
      state = (resistance <= threshold) ? GOOD_CONTACT : POOR_CONTACT;
    }

    if (state == GOOD_CONTACT) {
      goodCount++;
      resistanceSum += resistance;
      resistanceSamples++;
    } else if (state == POOR_CONTACT) {
      poorCount++;
      resistanceSum += resistance;
      resistanceSamples++;
    } else {
      noContactCount++;
    }

    Serial.print("Sample ");
    Serial.print(i + 1);
    Serial.print("/");
    Serial.print(TEST_SAMPLE_COUNT);
    Serial.print(": ");
    if (state == GOOD_CONTACT) Serial.println("GOOD");
    else if (state == POOR_CONTACT) Serial.println("POOR");
    else Serial.println("NONE");

    delay(TEST_SAMPLE_DELAY);
  }

  float goodPercent = (goodCount * 100.0) / TEST_SAMPLE_COUNT;
  float avgResistance = (resistanceSamples > 0) ? (resistanceSum / resistanceSamples) : -1;

  String verdict;
  if (noContactCount >= TEST_SAMPLE_COUNT / 2) verdict = "NO_CONTACT";
  else if (goodPercent >= 90) verdict = "EXCELLENT";
  else if (goodPercent >= 70) verdict = "GOOD";
  else if (goodPercent >= 40) verdict = "MARGINAL";
  else verdict = "POOR";

  Serial.print("TEST_RESULT:");
  Serial.print(verdict);
  Serial.print(":");
  Serial.print(goodCount);
  Serial.print(",");
  Serial.print(poorCount);
  Serial.print(",");
  Serial.print(noContactCount);
  Serial.print(":");
  if (avgResistance >= 0) Serial.println(avgResistance, 0);
  else Serial.println("N/A");

  contactCircuitOff();
  Serial.println("--- CONTACT TEST COMPLETE ---");
}

// Takes a short burst of raw EMG readings and reports the average, minimum, and maximum.
// This deliberately doesn't judge "good flex" vs "no flex" yet — that threshold hasn't
// been tuned on real data, and guessing at one here would be the same mistake as the
// invented GOOD_CONTACT_MULTIPLE was before it got tuned against something real.
void runEmgReading() {
  Serial.println("--- EMG READING STARTED ---");
  contactCircuitOff();
  delay(EMG_SETTLE_MS);

  int minReading = ADC_MAX_COUNTS;
  int maxReading = 0;
  long sum = 0;

  for (int i = 0; i < EMG_SAMPLE_COUNT; i++) {
    int raw = analogRead(EMG_PIN);
    if (raw < minReading) minReading = raw;
    if (raw > maxReading) maxReading = raw;
    sum += raw;
    delay(EMG_SAMPLE_DELAY);
  }

  int avgReading = sum / EMG_SAMPLE_COUNT;

  Serial.print("EMG_RESULT:");
  Serial.print(avgReading);
  Serial.print(",");
  Serial.print(minReading);
  Serial.print(",");
  Serial.println(maxReading);

  Serial.println("--- EMG READING COMPLETE ---");
}

// ---------------- setup / loop ----------------

void setup() {
  Serial.begin(9600);

  float stored;
  if (loadBaselineFromEeprom(stored)) {
    baselineResistance = stored;
    isCalibrated = true;
    baselineWasRestored = true;
  }

  // Start with the electrodes clear: nothing should be driving DC into them until a
  // contact reading is actually asked for.
  contactCircuitOff();
  pinMode(MODULE_RELAY_PIN, OUTPUT);
  digitalWrite(MODULE_RELAY_PIN, LOW);   // released: module connected, as it was before
  loadFlexCalibration();
  loadCheckReference();   // without this the saved endpoints are written and never read

  Serial.print("System Ready. Firmware: ");
  Serial.println(FIRMWARE_VERSION);
  reportConfig();
  reportStatus();  // so the website knows immediately whether it has to ask for a calibration
  printMenu();
}

// --- Numeric shortcuts -------------------------------------------------------------
// Typing CALIBRATE and EMG_STREAM_START by hand dozens of times per debugging session is
// its own source of errors, so single digits stand in for the commands. The full words
// still work and remain what the website sends; this is purely a convenience for the
// Serial Monitor. Kept in PROGMEM because RAM is the scarce resource on this board, not
// flash. 0 repeats whatever ran last, which is the one most worth having during a
// tighten-something-and-measure-again loop.
const char CMD_1[] PROGMEM = "CALIBRATE";
const char CMD_2[] PROGMEM = "TEST";
const char CMD_3[] PROGMEM = "DIAG";
const char CMD_4[] PROGMEM = "STATUS";
const char CMD_5[] PROGMEM = "EMG";
const char CMD_6[] PROGMEM = "EMG_STREAM_START";
const char CMD_7[] PROGMEM = "EMG_STREAM_STOP";
const char CMD_8[] PROGMEM = "VERSION";
const char CMD_9[] PROGMEM = "FORGET";
const char *const DIGIT_COMMANDS[] PROGMEM = {
  CMD_1, CMD_2, CMD_3, CMD_4, CMD_5, CMD_6, CMD_7, CMD_8, CMD_9
};

char lastCommand[20] = "";

float measureRailVolts(){
  analogRead(RAIL_PIN);
  delayMicroseconds(500);
  analogRead(RAIL_PIN);
  long sum = 0;
  for(int i = 0; i < 64; i++){
    delayMicroseconds(200);
    sum += analogRead(RAIL_PIN);
  }
  return ((float)sum / 64) * (ADC_REFERENCE_V / ADC_MAX_COUNTS) * RAIL_DIVIDER_RATIO;
}

void runRailReading(){
  // One discard is not enough at any real source impedance. The first reading of this pin
  // after another channel carries charge left on the sample-and-hold from that channel,
  // and a divider that cannot refill the capacitor between conversions produces readings
  // that drift and depend on what was measured before -- which is exactly how the first
  // rail numbers came out unstable and inconsistent. Discard twice with a pause, then
  // average with a gap between conversions.
  analogRead(RAIL_PIN);
  delayMicroseconds(500);
  analogRead(RAIL_PIN);
  long sum = 0;
  for(int i = 0; i < 64; i++){
    delayMicroseconds(200);
    sum += analogRead(RAIL_PIN);
  }
  float raw = (float)sum / 64;
  float volts = raw * (ADC_REFERENCE_V / ADC_MAX_COUNTS) * RAIL_DIVIDER_RATIO;
  Serial.print(F("RAIL +Vs="));
  Serial.print(volts, 2);
  Serial.print(F(" V  (raw "));
  Serial.print(raw, 1);
  Serial.println(F(")"));
  // A split supply made from one battery should sit near half of it on each side. Far off
  // centre means the midpoint is being dragged by uneven current draw, which is the known
  // weakness of a resistive virtual ground.
  if(volts < 3.5){
    Serial.println(F("Below the sensor's minimum -- it cannot work at this voltage."));
  } else if(volts > 5.5){
    Serial.println(F("High: the midpoint has drifted up, so -Vs is correspondingly small."));
    Serial.println(F("Halve both divider resistors to hold the middle more firmly."));
  } else {
    Serial.println(F("In range. The supply is not what is stopping it."));
  }
}

// ---------------- rig check ----------------

float checkRefRail = 0, checkRefContact = 0, checkRefEmg = 0;
bool checkRefValid = false;

void loadCheckReference(){
  unsigned long magic = 0;
  EEPROM.get(EEPROM_ADDR_CHECK_MAGIC, magic);
  if(magic != EEPROM_CHECK_MAGIC) return;
  EEPROM.get(EEPROM_ADDR_CHECK_RAIL, checkRefRail);
  EEPROM.get(EEPROM_ADDR_CHECK_CONTACT, checkRefContact);
  EEPROM.get(EEPROM_ADDR_CHECK_EMG, checkRefEmg);
  if(isnan(checkRefRail) || isnan(checkRefContact) || isnan(checkRefEmg)) return;
  checkRefValid = true;
}

// Resting level and how much it wanders. The spread matters as much as the level: a signal
// buried in noise and a quiet one can sit at the same mean.
void measureEmgIdle(float &meanOut, int &spreadOut){
  unsigned long start = millis();
  long sum = 0; unsigned int n = 0;
  int lo = ADC_MAX_COUNTS, hi = 0;
  while(millis() - start < 1000){
    int s = analogRead(EMG_PIN);
    sum += s; n++;
    if(s < lo) lo = s;
    if(s > hi) hi = s;
  }
  meanOut = n ? (float)sum / n : 0;
  spreadOut = hi - lo;
}

void printDelta(float now, float ref, float tolAbs, float tolFrac){
  float allowed = (tolFrac > 0) ? (ref * tolFrac) : tolAbs;
  float diff = now - ref;
  Serial.print(F("  (was "));
  Serial.print(ref, (ref > 100 ? 0 : 2));
  Serial.print(F(", "));
  if(fabs(diff) <= allowed) Serial.print(F("matches"));
  else {
    Serial.print(diff > 0 ? F("+") : F("-"));
    Serial.print(fabs(diff), (ref > 100 ? 0 : 2));
    Serial.print(F(" OFF"));
  }
  Serial.println(F(")"));
}

void runCheck(bool save){
  Serial.println(F("--- CHECK ---"));

  float rail = measureRailVolts();
  Serial.print(F("Supply   "));
  Serial.print(rail, 2);
  Serial.print(F(" V"));
  if(rail < 3.5) Serial.print(F("   BELOW the sensor minimum"));
  if(checkRefValid && !save) printDelta(rail, checkRefRail, CHECK_RAIL_TOLERANCE_V, 0);
  else Serial.println();

  float contact = readAcAmplitude(CONTACT_AC_HALF_MS, 32);
  Serial.print(F("Contact  "));
  Serial.print(contact, 1);
  Serial.print(F(" counts"));
  if(checkRefValid && !save) printDelta(contact, checkRefContact, 0, CHECK_CONTACT_TOLERANCE_FRAC);
  else Serial.println();

  float emgMean; int emgSpread;
  measureEmgIdle(emgMean, emgSpread);
  Serial.print(F("EMG idle "));
  Serial.print(emgMean, 1);
  Serial.print(F("  spread "));
  Serial.print(emgSpread);
  if(checkRefValid && !save) printDelta(emgMean, checkRefEmg, 0, CHECK_CONTACT_TOLERANCE_FRAC);
  else Serial.println();

  if(save){
    checkRefRail = rail; checkRefContact = contact; checkRefEmg = emgMean;
    checkRefValid = true;
    EEPROM.put(EEPROM_ADDR_CHECK_MAGIC, EEPROM_CHECK_MAGIC);
    EEPROM.put(EEPROM_ADDR_CHECK_RAIL, rail);
    EEPROM.put(EEPROM_ADDR_CHECK_CONTACT, contact);
    EEPROM.put(EEPROM_ADDR_CHECK_EMG, emgMean);
    Serial.println(F("Saved as the reference for this rig."));
  } else if(!checkRefValid){
    Serial.println(F("No reference saved. Run CHECK:SAVE while it is working."));
  }
  Serial.println(F("--- CHECK COMPLETE ---"));
}

// ---------------- flex sensor ----------------
//
// Purely resistive, so unlike the contact check there is no capacitance to wait out -- a
// couple of milliseconds after the drive pin goes high is enough.
float readFlexRaw(){
  pinMode(FLEX_DRIVE_PIN, OUTPUT);
  digitalWrite(FLEX_DRIVE_PIN, HIGH);
  delay(3);
  analogRead(FLEX_PIN);                 // discard: lets the sample-and-hold settle
  long sum = 0;
  for(int i = 0; i < FLEX_OVERSAMPLE; i++) sum += analogRead(FLEX_PIN);
  pinMode(FLEX_DRIVE_PIN, INPUT);       // release it again
  return (float)sum / FLEX_OVERSAMPLE;
}

float flexFlatRaw = 0, flexBentRaw = 0;
bool flexCalibrated = false;
bool flexStreaming = false;
unsigned long lastFlexStreamSampleTime = 0;
const unsigned long FLEX_STREAM_INTERVAL_MS = 60;

void saveFlexCalibration(){
  EEPROM.put(EEPROM_ADDR_FLEX_MAGIC, EEPROM_FLEX_MAGIC);
  EEPROM.put(EEPROM_ADDR_FLEX_FLAT, flexFlatRaw);
  EEPROM.put(EEPROM_ADDR_FLEX_BENT, flexBentRaw);
}

void loadFlexCalibration(){
  unsigned long magic = 0;
  EEPROM.get(EEPROM_ADDR_FLEX_MAGIC, magic);
  if(magic != EEPROM_FLEX_MAGIC) return;
  float flat = 0, bent = 0;
  EEPROM.get(EEPROM_ADDR_FLEX_FLAT, flat);
  EEPROM.get(EEPROM_ADDR_FLEX_BENT, bent);
  if(isnan(flat) || isnan(bent) || (flat - bent) < FLEX_MIN_SPAN_COUNTS) return;
  flexFlatRaw = flat; flexBentRaw = bent; flexCalibrated = true;
}

// Raw counts mean nothing on their own: where the strip sits on the finger changes them
// from one wearing to the next. Reported against the wearer's own flat-to-fist range, a
// reading is comparable between sessions -- the same argument as the contact baseline.
// 0% is flat, 100% is fully closed. Not clamped, so overshoot stays visible instead of
// being quietly hidden by the calibration being slightly off.
int flexPercent(float raw){
  return (int)roundf((flexFlatRaw - raw) * 100.0 / (flexFlatRaw - flexBentRaw));
}

void reportFlexStatus(){
  Serial.print(F("FLEX_STATUS:"));
  if(!flexCalibrated){ Serial.println(F("uncalibrated")); return; }
  Serial.print(F("calibrated:"));
  Serial.print(flexFlatRaw, 1);
  Serial.print(F(":"));
  Serial.println(flexBentRaw, 1);
}

// Captures one end of the range. Averaged over a moment because a hand held still still
// drifts a little, and one instant of that drift should not define an endpoint.
void captureFlexEndpoint(bool flat){
  float sum = 0;
  for(int i = 0; i < 8; i++){ sum += readFlexRaw(); delay(25); }
  float raw = sum / 8;
  if(flat) flexFlatRaw = raw; else flexBentRaw = raw;
  Serial.print(F("FLEX_CAL:"));
  Serial.print(flat ? F("flat=") : F("bent="));
  Serial.println(raw, 1);

  if(flexFlatRaw > 0 && flexBentRaw > 0){
    if((flexFlatRaw - flexBentRaw) < FLEX_MIN_SPAN_COUNTS){
      flexCalibrated = false;
      Serial.println(F("FLEX_CAL:failed -- flat and bent are too close together."));
      Serial.println(F("Capture FLAT with the hand open and BENT with it fully closed."));
      return;
    }
    flexCalibrated = true;
    saveFlexCalibration();
    Serial.println(F("FLEX_CAL:done"));
  }
}

void runFlexReading(){
  float raw = readFlexRaw();
  Serial.print(F("FLEX raw="));
  Serial.print(raw, 1);
  // The sensor is the TOP leg, so the junction rises as the sensor's resistance falls:
  //   V = 5 * Rfixed / (Rflex + Rfixed)  ->  Rflex = Rfixed * (full - raw) / raw
  if(raw < 1.0 || raw >= ADC_MAX_COUNTS - 0.5){
    Serial.println(F("  (out of range -- check the wiring and the fixed resistor)"));
    return;
  }
  float ohms = FLEX_FIXED_RESISTOR * (ADC_MAX_COUNTS - raw) / raw;
  Serial.print(F("  R="));
  Serial.print(ohms, 0);
  Serial.print(F(" ohms"));
  if(flexCalibrated){
    Serial.print(F("  bend="));
    Serial.print(flexPercent(raw));
    Serial.print(F("%"));
  }
  Serial.println();
}

// ---------------- AC contact measurement ----------------
//
// The DC check measures the wrong quantity for a dry electrode. Dry skin's outer layer is
// nearly an insulator to DC -- megohms, indistinguishable from an electrode lying on the
// bench -- while at EMG frequencies that same layer behaves as a capacitor and the
// interface drops by two or three orders of magnitude. Measured here as 1.3 MOhm at DC
// against roughly 67 kOhm at 50 Hz, on the same arm, seconds apart.
//
// So instead of holding the drive pin high and waiting for a level, this squares it up and
// down and measures how much of that swing reaches the junction. Bigger swing means lower
// impedance. Nothing else about the circuit changes -- same pins, same fixed resistor.
//
// Three things fall out of measuring a difference rather than a level: the module's DC bias
// cancels, the 1.2 s settle disappears because nothing has to reach a DC steady state, and
// hydration drift largely cancels too, since it moves DC resistance far more than AC
// impedance.
float readAcAmplitude(int halfPeriodMs, int cycles) {
  pinMode(CONTACT_DRIVE_PIN, OUTPUT);
  pinMode(CONTACT_SINK_PIN, OUTPUT);
  digitalWrite(CONTACT_SINK_PIN, LOW);

  // One cycle discarded: the first edge lands on a node sitting wherever the last
  // measurement left it, and that transient is not part of the steady-state response.
  digitalWrite(CONTACT_DRIVE_PIN, HIGH); delay(halfPeriodMs);
  digitalWrite(CONTACT_DRIVE_PIN, LOW);  delay(halfPeriodMs);

  long sum = 0;
  for (int i = 0; i < cycles; i++) {
    digitalWrite(CONTACT_DRIVE_PIN, HIGH);
    delay(halfPeriodMs);
    int high = analogRead(CONTACT_PIN);
    digitalWrite(CONTACT_DRIVE_PIN, LOW);
    delay(halfPeriodMs);
    int low = analogRead(CONTACT_PIN);
    sum += (high - low);
  }
  contactCircuitOff();
  return (float)sum / cycles;
}

// The measurement the contact check now runs on. AC rather than DC because dry skin is
// nearly an insulator to DC -- 1.3 MOhm, indistinguishable from an electrode lying on the
// bench -- while at 500 Hz the same interface reads 127-142 kOhm and, unlike the DC
// figure, repeats within about 12% across the day instead of swinging 300-fold.
//
// Returns false when the swing is too near either end of the range to mean anything.
bool measureContactImpedance(float &ohmsOut) {
  float amp = readAcAmplitude(CONTACT_AC_HALF_MS, 32);
  float fraction = amp / ADC_MAX_COUNTS;
  if (fraction <= 0.001 || fraction >= 0.999) {
    ohmsOut = -1;
    return false;
  }
  ohmsOut = FIXED_RESISTOR * fraction / (1.0 - fraction);
  return true;
}

// Turns that swing into the impedance shunting the junction. The drive swings the full
// supply across the fixed resistor and whatever sits from junction to ground, so the
// fraction of the swing that survives gives the ratio directly.
void runAcTest(int halfPeriodMs) {
  moduleSwitch(false);
  float ampCounts = readAcAmplitude(halfPeriodMs, 32);
  float fraction = ampCounts / ADC_MAX_COUNTS;
  Serial.print(F("AC ")); Serial.print(1000 / (2 * halfPeriodMs));
  Serial.print(F(" Hz  amplitude=")); Serial.print(ampCounts, 1);
  Serial.print(F(" counts"));

  if (fraction <= 0.001 || fraction >= 0.999) {
    Serial.println(F("  (out of range)"));
    return;
  }
  // amplitude/full = Z / (Rfixed + Z), so Z = Rfixed * fraction / (1 - fraction).
  float z = FIXED_RESISTOR * fraction / (1.0 - fraction);
  Serial.print(F("  Z=")); Serial.print(z, 0); Serial.print(F(" ohms"));

  // The module hangs on the junction at AC as well, so the figure above is it in parallel
  // with skin. Backing it out is only meaningful while skin is the smaller of the two.
  if (moduleConnected && z < EMG_SHUNT_OHMS) {
    float skin = 1.0 / (1.0 / z - 1.0 / EMG_SHUNT_OHMS);
    Serial.print(F("  skin~")); Serial.print(skin, 0);
  }
  Serial.println();
}

void printMenu() {
  Serial.println(F("--- COMMANDS ---"));
  Serial.println(F("  1 CALIBRATE        6 EMG_STREAM_START"));
  Serial.println(F("  2 TEST             7 EMG_STREAM_STOP"));
  Serial.println(F("  3 DIAG             8 VERSION"));
  Serial.println(F("  4 STATUS           9 FORGET (clears saved baseline)"));
  Serial.println(F("  5 EMG              0 repeat last"));
  Serial.println(F("  SETBASELINE:<ohms> | SETTLE:<ms> | AC[:<halfMs>] | MENU"));
  Serial.println(F("  CHECK | CHECK:SAVE | RAIL | FLEX | FLEXCAL:FLAT | FLEXCAL:BENT"));
  Serial.println(F("  FLEX_STREAM_START | FLEX_STREAM_STOP"));
}

// Turns a bare digit into the command it stands for, leaving anything else untouched.
String expandCommand(String input) {
  if (input.length() != 1) return input;
  char c = input.charAt(0);

  if (c == '0') {
    if (lastCommand[0] == '\0') {
      Serial.println(F("Nothing to repeat yet."));
      return "";
    }
    Serial.print(F("Repeating: "));
    Serial.println(lastCommand);
    return String(lastCommand);
  }

  if (c < '1' || c > '9') return input;
  char buf[20];
  strcpy_P(buf, (char *)pgm_read_word(&DIGIT_COMMANDS[c - '1']));
  Serial.print(F("> "));
  Serial.println(buf);
  return String(buf);
}

void loop() {
  if (Serial.available() > 0) {
    String input = Serial.readStringUntil('\n');
    input.trim();
    input = expandCommand(input);
    // Remembered before dispatch so 0 repeats the command even if it fails partway.
    if (input.length() > 0 && input.length() < sizeof(lastCommand)) {
      input.toCharArray(lastCommand, sizeof(lastCommand));
    }

    // Reconnected here rather than at the end of each measurement, because those have
    // several early returns and any one of them could otherwise leave the module cut off
    // from the electrodes -- with EMG then reading nothing and no indication why.
    bool handled = true;
    if (input == "MENU" || input == "?") {
      printMenu();
    } else if (input == "CALIBRATE") {
      runCalibration();
    } else if (input == "TEST") {
      if (!isCalibrated) {
        Serial.println("Warning: not calibrated yet, using default thresholds.");
      }
      runContactTest();
    } else if (input == "CHECK") {
      runCheck(false);
    } else if (input == "CHECK:SAVE") {
      runCheck(true);
    } else if (input == "RAIL") {
      runRailReading();
    } else if (input == "FLEX") {
      runFlexReading();
    } else if (input == "FLEXCAL:FLAT") {
      captureFlexEndpoint(true);
    } else if (input == "FLEXCAL:BENT") {
      captureFlexEndpoint(false);
    } else if (input == "FLEXCAL:STATUS") {
      reportFlexStatus();
    } else if (input == "FLEX_STREAM_START") {
      flexStreaming = true;
      lastFlexStreamSampleTime = millis();
      Serial.println(F("FLEX_STREAM:started"));
    } else if (input == "FLEX_STREAM_STOP") {
      flexStreaming = false;
      Serial.println(F("FLEX_STREAM:stopped"));
    } else if (input == "AC") {
      runAcTest(5);
    } else if (input.startsWith("AC:")) {
      int h = input.substring(3).toInt();
      if (h < 1) h = 1;
      runAcTest(h);
    } else if (input.startsWith("SETTLE:")) {
      contactSettleMs = input.substring(7).toInt();
      Serial.print(F("SETTLE_MS:"));
      Serial.println(contactSettleMs);
    } else if (input.startsWith("SETBASELINE:")) {
      setBaselineFromSerial(input.substring(12));
    } else if (input == "VERSION") {
      Serial.print("FIRMWARE:");
      Serial.println(FIRMWARE_VERSION);
    } else if (input == "DIAG") {
      runDiagnostics();
    } else if (input == "FORGET") {
      forgetBaselineInEeprom();
      Serial.println("BASELINE_FORGOTTEN");
      reportStatus();
    } else if (input == "STATUS") {
      reportConfig();
      reportStatus();
    } else if (input == "EMG") {
      runEmgReading();
    } else if (input == "EMG_STREAM_START") {
      emgStreaming = true;
      lastEmgStreamSampleTime = millis();
      contactCircuitOff();
      delay(EMG_SETTLE_MS);   // let the amplifier recover before the first sample goes out
      Serial.println("EMG_STREAM:started");
    } else if (input == "EMG_STREAM_STOP") {
      emgStreaming = false;
      Serial.println("EMG_STREAM:stopped");
    } else {
      handled = false;
    }
    if (handled) moduleSwitch(true);
  }

  if (flexStreaming) {
    unsigned long now = millis();
    if (now - lastFlexStreamSampleTime >= FLEX_STREAM_INTERVAL_MS) {
      lastFlexStreamSampleTime = now;
      float raw = readFlexRaw();
      // Percent first: it is the figure that survives being worn differently tomorrow,
      // and it is what the website plots. Raw follows it for diagnostics.
      Serial.print(F("FLEX_LIVE:"));
      Serial.print(flexCalibrated ? flexPercent(raw) : -1);
      Serial.print(F(","));
      Serial.println(raw, 1);
    }
  }

  // Runs alongside the command check above rather than inside it, so a STOP command
  // gets seen right away instead of waiting behind a fixed-length sampling loop.
  if (emgStreaming) {
    unsigned long now = millis();
    if (now - lastEmgStreamSampleTime >= EMG_STREAM_INTERVAL_MS) {
      lastEmgStreamSampleTime = now;
      int emgMean, emgPeakToPeak;
      readEmgWindow(emgMean, emgPeakToPeak);
      // The website's parser reads the first number and ignores the rest, so adding the
      // spread here tells us more without changing what the site already understands.
      Serial.print("EMG_LIVE:");
      Serial.print(emgMean);
      Serial.print(",");
      Serial.println(emgPeakToPeak);
    }
  }
}
