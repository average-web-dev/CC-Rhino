// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// ── Firmware / Bootloader ──────────────────────────────────────────────────
// Responsibilities (in order):
//   1. Terminal hardware reset
//   2. Define the global `print` helper (bios.ts runs in global scope)
//   3. Set require.paths so /rom/lib and /rom/bin are resolvable
//   4. Discover alternate boot entries (disk drives, local /boot.js)
//   5. If only the default OS → boot it directly (synchronous)
//   6. If alternates exist → register async GRUB-style selection menu,
//      boot happens when the user picks an entry or the countdown expires
//
// Everything after the handoff (PATH, aliases, startup scripts, shell) is
// the OS layer's job (/rom/os/index.ts).


// TODO: change bios loading so nothing leaks anymore and only the exports are callable from the global scope
// FIX scoping problem bios has leaked all methodes.
(function (){
  const term   = require('term');
  const fs     = require('fs');
  const events = require('events');
  const system = require('system');
  const peripheral = require('peripheral');

  // ── Global print ───────────────────────────────────────────────────────────
  // Defined here in global scope so it is available to all subsequent code
  // (bios.ts is eval'd directly in the Rhino global scope, not as a module).

  function print(...args: unknown[]): void {
      const text = args.map(String).join('\t');
      term.write(text);
      const { y } = term.getCursorPos();
      const { height } = term.getSize();
      if (y + 1 >= height) {
          term.scroll(1);
          term.setCursorPos({ x: 0, y: height - 1 });
      } else {
          term.setCursorPos({ x: 0, y: y + 1 });
      }
  }

  globalThis.print = print;

  // ── Boot entry ─────────────────────────────────────────────────────────────

  interface BootEntry {
      label: string;   // displayed in the menu
      detail: string;  // right-aligned path hint
      path: string;    // passed to require()
  }

  // ── Discovery ──────────────────────────────────────────────────────────────

  // TODO: query peripheral API for disk drives instead of hardcoding mount points.
  const DISK_BOOT_FILE  = "boot.js";
  const DISK_LABEL_FILE = ".label";
  const LOCAL_BOOT_FILE = "/boot.js";

  function readFirstLine(path: string): string | null {
      try {
          const content = fs.readFileSync(path) as string;
          return content.split("\n", 1)[0].trim() || null;
      } catch {
          return null;
      }
  }

  function discoverBootEntries(): BootEntry[] {
      const entries: BootEntry[] = [];

      entries.push({ label: "CC: Tweaked JS", detail: "/rom/os/index", path: "/rom/os/index" });

      if (fs.existsSync(LOCAL_BOOT_FILE)) {
          entries.push({
              label:  readFirstLine("/boot.label") ?? "Local Boot",
              detail: LOCAL_BOOT_FILE,
              path:   LOCAL_BOOT_FILE,
          });
      }

      for (let side of peripheral.getSides()) {
          if (!peripheral.hasType(side, 'drive')) {
              continue;
          }

          if (!peripheral.call(side, 'hasData')) {
              continue;
          }

          let mountPoint = peripheral.call(side, 'getMountPath');
          let diskLabel = peripheral.call(side, 'getDiskLabel');

          let script = `${mountPoint}/${DISK_BOOT_FILE}`;
          let labelFile = `${mountPoint}/${DISK_LABEL_FILE}`;

          let label = `Disk (${diskLabel ?? side})`
          if (fs.existsSync(labelFile)) {
              label = readFirstLine(labelFile) ?? label
          }

          print(label);

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
  const COL_WHITE     = 1;
  const COL_BLACK     = 32768;
  const COL_GREY      = 256;

  function drawMenu(entries: BootEntry[], selected: number, remaining: number): void {
      const { width, height } = term.getSize();
      const canColor = term.isColor();

      term.clear();

      term.setCursorPos({ x: 0, y: 0 });
      if (canColor) term.setTextColor(COL_WHITE);
      term.write("  CC: Tweaked  Boot Selection");

      term.setCursorPos({ x: 0, y: 1 });
      if (canColor) term.setTextColor(COL_GREY);
      term.write("─".repeat(width));

      for (let i = 0; i < entries.length; i++) {
          let isSelected = i === selected;
          term.setCursorPos({ x: 0, y: 3 + i });
          if (canColor) {
              term.setBackgroundColor(isSelected ? COL_WHITE : COL_BLACK);
              term.setTextColor(isSelected ? COL_BLACK : COL_WHITE);
          }
          let prefix   = isSelected ? " > " : "   ";
          let maxDetail = 22;
          let detail   = entries[i].detail.slice(-maxDetail).padStart(maxDetail);
          let label    = entries[i].label.padEnd(width - prefix.length - maxDetail - 2);
          term.write(`${prefix}${label}  ${detail}`);
      }

      if (canColor) {
          term.setBackgroundColor(COL_BLACK);
          term.setTextColor(COL_GREY);
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
          events.off("key",   onKey);
          events.off("timer", onTimer);
      }

      function doBoot(entry: BootEntry): void {
          cleanup();
          term.clear();
          term.setCursorPos({ x: 0, y: 0 });
          try {
              require(entry.path);
          } catch (e: unknown) {
              const msg: string = (e as any)?.message ?? String(e);
              print(`bios: failed to boot '${entry.label}'`);
              print(msg);
              // No listeners remain — machine halts.
          }
      }

      function onKey(key: number, held: boolean): void {
          if (held) return;
          remaining = -1; // any keypress stops auto-boot
          term.setCursorPos({ x: 0, y: 13 });
          switch (key) {
              case 265:    selected = (selected - 1 + entries.length) % entries.length; break;
              case 264:  selected = (selected + 1) % entries.length; break;
              case 257:
              case 335:
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

      events.on("key",   onKey);
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
      print("CC: Tweaked JS Edition");
      print(`Computer ${require('system').getComputerID()}`);
      print("");
      try {
          require(target.path);
      } catch (e: unknown) {
          const msg: string = (e as any)?.message ?? String(e);
          term.clear();
          term.setCursorPos({ x: 0, y: 0 });
          print(`bios: failed to boot '${target.label}'`);
          print(msg);
      }
  } else {
      // Alternates detected — start async menu and return.
      // Boot fires from inside the key/timer listeners registered by startBootMenu.
      startBootMenu(bootEntries);
  }
})()
