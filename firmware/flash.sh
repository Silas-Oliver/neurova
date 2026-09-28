#!/usr/bin/env bash
# Compile and upload the sketch without going through the Arduino IDE.
#
# The IDE keeps its own copy of an open sketch in memory and never reloads a file that
# changed on disk, so edits made outside it are invisible until the window is closed and
# reopened -- and worse, the IDE writes that stale copy back to disk before it compiles,
# which silently discards the edits and flashes the old build. Uploading from here avoids
# the whole problem: the file on disk is what gets built.
#
# The IDE's Serial Monitor holds the port open, so close that tab before running this.
set -e
CLI="/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli"
SKETCH="$HOME/Documents/Arduino/ContactTest-Final"   # symlinks to firmware/ in this repo
FQBN="arduino:avr:uno"
PORT="${1:-$(ls /dev/cu.usbmodem* 2>/dev/null | head -1)}"

[ -n "$PORT" ] || { echo "No board found. Is it plugged in?"; exit 1; }
echo "Building..."
"$CLI" compile --fqbn "$FQBN" "$SKETCH" | tail -2
echo "Uploading to $PORT..."
"$CLI" upload -p "$PORT" --fqbn "$FQBN" "$SKETCH"
echo "Done. Flashed: $(grep -o '"[^"]*"' "$SKETCH/ContactTest-Final.ino" | grep -m1 '20[0-9][0-9]-')"
