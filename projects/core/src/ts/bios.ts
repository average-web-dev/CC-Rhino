// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// ── Firmware / Bootloader ──────────────────────────────────────────────────
// Responsibilities (in order):
//   1. Install the Node-style globals `process` and `console` (and with them the computer's TTY)
//   2. Terminal reset
//   3. Set require.paths so /rom/lib and /rom/bin are resolvable
//   4. Discover alternate boot entries (disk drives, local /boot.js)
//   5. If only the default OS → boot it directly (synchronous)
//   6. If alternates exist → register async GRUB-style selection menu,
//      boot happens when the user picks an entry or the countdown expires
//
// Everything after the handoff (PATH, aliases, startup scripts, shell) is
// the OS layer's job (/rom/os/index.ts).
//
// The bios runs in the global scope, so everything lives in a function: the only globals it leaves behind are
// `process` and `console` (plus the engine's `require`), like Node.

// Must come first: loading `process` takes over the screen (the computer's TTY, see /rom/lib/internal/tty.ts).
require('/rom/lib/internal/globals');

(function (){
  const { Term, ColorIndex } = require('/rom/lib/term') as typeof import('/rom/lib/term');
  const term   = new Term();
  const Key    = (require('/rom/lib/tty') as typeof import('/rom/lib/tty')).Key;
  const fs     = require('fs');
  const events = require('events');
  const system = require('system');
  const peripheral = require('peripheral');

  // ── Boot entry ─────────────────────────────────────────────────────────────

  interface BootEntry {
      label: string;   // displayed in the menu
      detail: string;  // right-aligned path hint
      path: string;    // passed to require()
  }

  // ── Discovery ──────────────────────────────────────────────────────────────

  const DISK_BOOT_FILE  = "boot.js";
  const DISK_LABEL_FILE = ".label";
  const LOCAL_BOOT_FILE = "/boot.js";

  function readFirstLine(path: string): string | null {
      try {
          const content = fs.readFileSync(path);
          return content.split("\n", 1)[0].trim() || null;
      } catch {
          return null;
      }
  }

  function discoverBootEntries(): BootEntry[] {
      const entries: BootEntry[] = [];

      entries.push({ label: "CC: Rhino", detail: "/rom/os/index", path: "/rom/os/index" });

      if (fs.existsSync(LOCAL_BOOT_FILE)) {
          entries.push({
              label:  readFirstLine("/boot.label") ?? "Local Boot",
              detail: LOCAL_BOOT_FILE,
              path:   LOCAL_BOOT_FILE,
          });
      }

      // Every drive whose disk has a boot.js, on a side or behind a wired modem.
      for (let drive of peripheral.find('drive')) {
          let mountPath = drive.hasData() ? drive.getMountPath() : null;
          if (mountPath === null) {
              continue;
          }

          // getMountPath() is relative to the root ("mnt/disk"); require() needs an absolute path.
          let mountPoint = '/' + mountPath;
          let script = `${mountPoint}/${DISK_BOOT_FILE}`;
          if (!fs.existsSync(script)) {
              continue;
          }

          let label = readFirstLine(`${mountPoint}/${DISK_LABEL_FILE}`) ?? `Disk (${drive.getDiskLabel() ?? drive.id})`;
          entries.push({
              label,
              detail: script,
              path:   script,
          });
      }

      return entries;
  }

  // ── GRUB-style boot menu ───────────────────────────────────────────────────

  const TIMEOUT_SECS  = 5;

  function drawMenu(entries: BootEntry[], selected: number, remaining: number): void {
      const { width, height } = term.getSize();
      const canColor = term.isColor();

      term.clear();

      term.setCursorPos({ x: 0, y: 0 });
      if (canColor) term.setTextColor(ColorIndex.WHITE);
      term.write("  CC: Rhino  Boot Selection");

      term.setCursorPos({ x: 0, y: 1 });
      if (canColor) term.setTextColor(ColorIndex.LIGHT_GRAY);
      term.write("─".repeat(width));

      for (let i = 0; i < entries.length; i++) {
          let isSelected = i === selected;
          term.setCursorPos({ x: 0, y: 3 + i });
          if (canColor) {
              term.setBackgroundColor(isSelected ? ColorIndex.WHITE : ColorIndex.BLACK);
              term.setTextColor(isSelected ? ColorIndex.BLACK : ColorIndex.WHITE);
          }
          let prefix   = isSelected ? " > " : "   ";
          let maxDetail = 22;
          let detail   = entries[i].detail.slice(-maxDetail).padStart(maxDetail);
          let label    = entries[i].label.padEnd(width - prefix.length - maxDetail - 2);
          term.write(`${prefix}${label}  ${detail}`);
      }

      if (canColor) {
          term.setBackgroundColor(ColorIndex.BLACK);
          term.setTextColor(ColorIndex.LIGHT_GRAY);
      }

      term.setCursorPos({ x: 0, y: height - 2 });
      term.write("─".repeat(width));
      term.setCursorPos({ x: 0, y: height - 1 });
      if (remaining > 0) {
          term.write(` Booting in ${remaining}s...   ↑↓ select   Enter boot`);
      } else {
          term.write(`                             ↑↓ select   Enter boot`);
      }
  }

  // Registers async listeners and returns immediately.
  // Boot happens when the user selects an entry or the countdown reaches zero.
  function startBootMenu(entries: BootEntry[]): void {
      let selected    = 0;
      let remaining   = TIMEOUT_SECS;
      let tickTimerId = system.startTimer(1);

      drawMenu(entries, selected, remaining);

      function cleanup(): void {
          process.stdin.off("keydown", onKey);
          events.off("timer", onTimer);
          // Hand the TTY on as it was: cooked, not flowing, nothing typed left over.
          process.stdin.setRawMode(false);
          (process.stdin as TtyStdin).setFlowing(null);
          (process.stdin as TtyStdin).discard();
      }

      function doBoot(entry: BootEntry): void {
          cleanup();
          term.clear();
          term.setCursorPos({ x: 0, y: 0 });
          try {
              require.uncached(entry.path);
          } catch (e: unknown) {
              const msg: string = (e as any)?.message ?? String(e);
              console.error(`bios: failed to boot '${entry.label}'`);
              console.error(msg);
              // No listeners remain — machine halts.
          }
      }

      function onKey(key: TtyKeyInput): void {
          if (key.repeat) return;
          remaining = -1; // any keypress stops auto-boot
          term.setCursorPos({ x: 0, y: 13 });
          switch (key.code) {
              case Key.ARROW_UP:   selected = (selected - 1 + entries.length) % entries.length; break;
              case Key.ARROW_DOWN: selected = (selected + 1) % entries.length; break;
              case Key.ENTER:
              case Key.NUMPAD_ENTER:
                  doBoot(entries[selected]);
                  return;
          }
          drawMenu(entries, selected, remaining);
      }

      function onTimer(id: number): void {
          if (id !== tickTimerId) return; // not our timer
          if (remaining < 0)      return; // user already in control
          remaining--;
          drawMenu(entries, selected, remaining);
          if (remaining <= 0) {
              doBoot(entries[selected]);
          } else {
              tickTimerId = system.startTimer(1) as number;
          }
      }

      process.stdin.setRawMode(true);
      process.stdin.on("keydown", onKey);
      events.on("timer", onTimer);
  }

  // ── Main boot sequence ─────────────────────────────────────────────────────

  term.clear();
  term.setCursorPos({ x: 0, y: 0 });

  require.paths = ["/rom/lib", "/rom/bin"];

  const bootEntries = discoverBootEntries();

  if (bootEntries.length === 1) {
      // Fast path — boot directly, no menu needed.
      const target = bootEntries[0];
      console.log("CC: Rhino");
      console.log(`Computer ${system.getComputerID()}`);
      console.log("");
      try {
          require.uncached(target.path);
      } catch (e: unknown) {
          const msg: string = (e as any)?.message ?? String(e);
          term.clear();
          term.setCursorPos({ x: 0, y: 0 });
          console.error(`bios: failed to boot '${target.label}'`);
          console.error(msg);
      }
  } else {
      // Alternates detected — start async menu and return.
      // Boot fires from inside the key/timer listeners registered by startBootMenu.
      startBootMenu(bootEntries);
  }
})()
