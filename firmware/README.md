# Firmware

`ContactTest-Final.ino` is the Arduino Uno sketch for the electrode contact check and EMG
streaming. It is the file the Arduino IDE actually opens and compiles: the sketchbook entry
at `~/Documents/Arduino/ContactTest-Final/ContactTest-Final.ino` is a symlink pointing here,
so edits made in the IDE land in this repository with no copying step to forget.

If that symlink is ever lost (a fresh machine, a sketchbook move), recreate it with:

    ln -s "$PWD/firmware/ContactTest-Final.ino" \
      ~/Documents/Arduino/ContactTest-Final/ContactTest-Final.ino

Arduino requires the `.ino` basename to match its containing folder, so the sketchbook
folder must stay named `ContactTest-Final`.

The `FIRMWARE_VERSION` string near the top is printed on boot and answers `VERSION`. Bump it
with every flash worth telling apart — confirming the board is running the build you think
it is has caught real bugs here more than once.
