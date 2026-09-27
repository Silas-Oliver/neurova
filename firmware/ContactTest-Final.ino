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
const char FIRMWARE_VERSION[] = "2026-09-27g numeric shortcuts";

const int CONTACT_PIN = A0;
const int CONTACT_DRIVE_PIN = 2;   // top of the divider — HIGH to measure, INPUT to disconnect
const int CONTACT_SINK_PIN = 3;    // return leg — LOW to measure, INPUT to disconnect
const float FIXED_RESISTOR = 1000000.0;  // the fixed leg of the divider, in ohms

// Kept as named constants because they are board characteristics, not arbitrary numbers:
// moving to a 3.3V / 12-bit board later (an ESP32 or Nano 33 BLE for the Bluetooth work)
// changes both, and every stored baseline along with them.
const float ADC_REFERENCE_V = 5.0;
const int ADC_MAX_COUNTS = 1023;

// Above this raw ADC value the divider is reading essentially open — no skin path at all.
const int OPEN_CIRCUIT_RAW = 1015;

// How long the amplifier and the divider need after a mode change before a reading can be
// trusted — switching the drive pin steps the voltage on the electrodes, and the EMG
// module's input filter takes a moment to settle back out afterwards.
const int CONTACT_SETTLE_MS = 50;

// At megohm source impedances the ADC's sample-and-hold cannot charge in one conversion,
// so a single reading is both biased low and very noisy -- measured here as a 73-count
// spread between identical runs, against a real signal of about 25 counts.
//
// Two things help, and neither costs anything. Waiting between conversions gives the
// capacitor time to actually reach the junction voltage. And averaging many readings cuts
// random noise by the square root of the count: 256 samples turns +/-70 counts into about
// +/-4, which is the difference between a signal buried in noise and one that is legible.
const int CONTACT_OVERSAMPLE = 256;
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
enum PathState { PATH_OK, PATH_NO_CONTACT, PATH_BLOCKED };

enum ContactState {
  NO_CONTACT,
  POOR_CONTACT,
  GOOD_CONTACT
};

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
  if (rawReading >= OPEN_CIRCUIT_RAW || rawReading < 0) {
    resistanceOut = -1;
    return false;
  }
  float voltage = rawReading * (ADC_REFERENCE_V / ADC_MAX_COUNTS);
  if (voltage >= ADC_REFERENCE_V) {
    resistanceOut = -1;
    return false;
  }
  // Skin sits on the low side, so the junction voltage rises with skin resistance.
  resistanceOut = voltage * FIXED_RESISTOR / (ADC_REFERENCE_V - voltage);
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
  Serial.println("--- DIAG ---");

  contactCircuitOn();
  Serial.print("D2=HIGH D3=LOW    raw=");
  Serial.println(readContactAdc(), 2);

  digitalWrite(CONTACT_DRIVE_PIN, LOW);
  delay(CONTACT_SETTLE_MS);
  Serial.print("D2=LOW  D3=LOW    raw=");
  Serial.println(readContactAdc(), 2);

  digitalWrite(CONTACT_DRIVE_PIN, HIGH);
  pinMode(CONTACT_SINK_PIN, INPUT);
  delay(CONTACT_SETTLE_MS);
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
float lastPathReleased = 0, lastPathSinking = 0;

PathState contactPathState() {
  pinMode(CONTACT_DRIVE_PIN, OUTPUT);
  digitalWrite(CONTACT_DRIVE_PIN, HIGH);

  pinMode(CONTACT_SINK_PIN, INPUT);              // released
  delay(CONTACT_SETTLE_MS);
  float released = readContactAdc();

  pinMode(CONTACT_SINK_PIN, OUTPUT);             // sinking
  digitalWrite(CONTACT_SINK_PIN, LOW);
  delay(CONTACT_SETTLE_MS);
  float sinking = readContactAdc();

  pinMode(CONTACT_DRIVE_PIN, INPUT);
  pinMode(CONTACT_SINK_PIN, INPUT);
  lastPathReleased = released;
  lastPathSinking = sinking;

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
  delay(CONTACT_SETTLE_MS);
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
                                 : (FIXED_RESISTOR / 2.0);  // fallback if TEST runs uncalibrated
  return (resistanceOut <= threshold) ? GOOD_CONTACT : POOR_CONTACT;
}

// ---------------- commands ----------------

void runCalibration() {
  Serial.println("--- CALIBRATION STARTED ---");
  if (contactPathState() == PATH_BLOCKED) reportPathSuspect();
  contactCircuitOn();

  float sum = 0;
  int validSamples = 0;

  for (int i = 0; i < CALIB_SAMPLE_COUNT; i++) {
    float resistance;
    float rawReading = readContactAdc();
    bool measurable = readResistance(rawReading, resistance);
    if (measurable) {
      sum += resistance;
      validSamples++;
    }
    Serial.print("Calibration sample ");
    Serial.print(i + 1);
    Serial.print("/");
    Serial.print(CALIB_SAMPLE_COUNT);
    Serial.print(": raw=");
    Serial.print(rawReading, 2);
    Serial.print("  ");
    Serial.println(measurable ? String(resistance, 0) : String("no contact"));
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
    ContactState state = classifyContact(readContactAdc(), resistance);

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

void printMenu() {
  Serial.println(F("--- COMMANDS ---"));
  Serial.println(F("  1 CALIBRATE        6 EMG_STREAM_START"));
  Serial.println(F("  2 TEST             7 EMG_STREAM_STOP"));
  Serial.println(F("  3 DIAG             8 VERSION"));
  Serial.println(F("  4 STATUS           9 FORGET (clears saved baseline)"));
  Serial.println(F("  5 EMG              0 repeat last"));
  Serial.println(F("  SETBASELINE:<ohms> | MENU"));
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

    if (input == "MENU" || input == "?") {
      printMenu();
    } else if (input == "CALIBRATE") {
      runCalibration();
    } else if (input == "TEST") {
      if (!isCalibrated) {
        Serial.println("Warning: not calibrated yet, using default thresholds.");
      }
      runContactTest();
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
