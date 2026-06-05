<!--
SPDX-FileCopyrightText: 2026 average-web-dev

SPDX-License-Identifier: MPL-2.0
-->

# JS API Redesign (CC: Rhino)

Redesign of the `*API.java` surfaces for the Rhino/JS version — Node.js-oriented,
**without Promises**, with callback and blocking variants.

Source: analysis of `FSAPI`, `OSAPI`, `HTTPAPI`, `TermAPI`/`TermMethods`,
`RedstoneAPI`/`RedstoneMethods`, `PeripheralAPI`, `TurtleAPI`, `CommandAPI`, `PocketAPI`.

The new structure does **not** need to stay compatible with the old Lua API.

---

## Global design rules

| Topic | Lua/CC today | JS/Rhino new |
|---|---|---|
| **Multiple return values** | Lua can `return x, y` | JS cannot → **object** `{x, y}` or **array** `[x, y]`. Biggest incompatibility. |
| **Async** | Events/`pullEvent` | No Promises → **error-first callback** `(err, result) => …` **or** thread-blocking |
| **Errors** | `nil, "msg"` pattern | Real errors → `throw new Error()`. "Expected" failure (e.g. `turtle.forward` into a wall) → result object |
| **Binary data** | string of bytes | `Buffer` / `Uint8Array` |
| **Sync suffix** | – | Blocking variant is named `…Sync` (Node convention), callback variant without suffix |

Chosen default conventions (overridable):
- Result of "can-fail" actions = `{ok: boolean, reason?: string}`
- Coordinates/sizes = object instead of tuple

---

## `fs` — modelled on Node `fs` (callback) + `fs.…Sync`

Every operation comes twice: blocking (`…Sync`, throws on error) and callback (`(err, res)`).

| Function | Parameters | Return (Sync) | Replaces today |
|---|---|---|---|
| `readFileSync` / `readFile` | `path, encoding?` | `string \| Buffer` | (new, convenience) |
| `writeFileSync` / `writeFile` | `path, data, encoding?` | `void` | (new, convenience) |
| `appendFileSync` / `appendFile` | `path, data, encoding?` | `void` | (new) |
| `readdirSync` / `readdir` | `path` | `string[]` | `list` |
| `mkdirSync` / `mkdir` | `path, {recursive?}` | `void` | `makeDir` (recursive=true default) |
| `rmSync` / `rm` | `path, {recursive?, force?}` | `void` | `delete` |
| `renameSync` / `rename` | `src, dest` | `void` | `move` |
| `cpSync` / `cp` | `src, dest, {recursive?}` | `void` | `copy` |
| `copyFileSync` / `copyFile` | `src, dest` | `void` | (file-only variant) |
| `existsSync` | `path` | `boolean` | `exists` |
| `statSync` / `stat` | `path` | `Stats` (below) | `attributes` + `getSize`/`isDir`/`isReadOnly` |
| `openSync` / `open` | `path, flags` | `FileHandle` | `open` |
| `realpathSync` | `path` | `string` | (new) |

**CC-specific extensions** (no Node equivalent, stay in `fs`):

| Function | Parameters | Return |
|---|---|---|
| `getDrive` | `path` | `string \| null` |
| `getCapacity` | `path` | `number \| null` |
| `getFreeSpace` | `path` | `number \| "unlimited"` |
| `isReadOnly` | `path` | `boolean` |

`flags` of `open`: `"r" "w" "a" "r+" "w+"` + optional `"b"` for binary.

### `Stats` object (return of `stat`) — replaces `attributes`

| Field/method | Type |
|---|---|
| `size` | `number` |
| `mtimeMs` / `ctimeMs` / `birthtimeMs` | `number` (ms since epoch — directly `new Date(stat.mtimeMs)`) |
| `isDirectory()` | `boolean` |
| `isFile()` | `boolean` |
| `isReadOnly` | `boolean` (CC extra) |

### `FileHandle` (return of `fs.open`)

| Function | Parameters | Return |
|---|---|---|
| `read` | `count?` | `string \| Buffer \| number \| null` |
| `readLine` | `withTrailing?` | `string \| null` |
| `readAll` | – | `string \| Buffer` |
| `write` | `data` | `void` |
| `seek` | `whence?, offset?` | `number` (new position) |
| `flush` | – | `void` |
| `close` | – | `void` |

---

## `path` — split path logic out of `fs` (Node `path`)

In Node these do **not** belong in `fs`. Proposal: a dedicated `path` module.

| Function | Parameters | Return | Replaces |
|---|---|---|---|
| `join` | `...parts` | `string` | `fs.combine` |
| `basename` | `path, ext?` | `string` | `fs.getName` |
| `dirname` | `path` | `string` | `fs.getDir` |
| `extname` | `path` | `string` | (new) |
| `resolve` | `...parts` | `string` | (new, against cwd) |
| `sep` | (property) | `string` `"/"` | (new) |

---

The old `os` is split up: **`process`** (computer control/info), **`events`** (event bus),
and global **timer functions** (Node style).

## `process` — computer control & info (Node `process` analog)

Trimmed down: date/time removed (→ `new Date()`), only the MC-specific in-game values remain.

| Function | Parameters | Return | Note |
|---|---|---|---|
| `shutdown` | – | `void` | Lifecycle |
| `reboot` | – | `void` | Lifecycle |
| `getComputerID` | – | `number` | kept |
| `getComputerLabel` | – | `string \| null` | returns `null` directly instead of a `nil` array |
| `setComputerLabel` | `label?` | `void` | kept |
| `clock` | – | `number` (seconds uptime) | like Node `process.uptime()` |
| `time` | – | `number` (in-game 0–24) | **ingame** only; `utc`/`local` dropped |
| `day` | – | `number` (in-game day) | **ingame** only |
| `epoch` | – | `number` (in-game ms) | **ingame** only |
| ~~`date`~~ | – | – | **drop** → `new Date()` |
| ~~`dateString`~~ | – | – | **drop** → `Intl.DateTimeFormat` / `toLocaleString()` |

Rationale: everything real-world (`utc`/`local`/`date`/`dateString`) is done better natively by
JS. Only the **in-game** values are MC-specific and must stay.

## `events` — event bus (global singleton)

> **Note:** Node's `events` module exports the `EventEmitter` **class**. Here `events` is
> deliberately a **global singleton emitter** for the single CC event queue. The emitter API
> (`on`/`once`/`off`/`emit`) is the preferred form; `pullEvent` remains only as a blocking
> low-level variant.

| Function | Parameters | Return | Kind |
|---|---|---|---|
| `on` | `event, cb` | `void` | EventEmitter (Phase 5) |
| `once` | `event, cb` | `void` | EventEmitter |
| `off` | `event, cb` | `void` | EventEmitter |
| `emit` / `queueEvent` | `name, ...args` | `void` | push event onto the queue |
| `pullEvent` | `filter?` | `[name, ...args]` | **blocking** (low-level) |
| `pullEventRaw` | `filter?` | `[name, ...args]` | **blocking** (no terminate handling) |

**CC low-level timers/alarms** (fire events, hence here):

| Function | Parameters | Return | Note |
|---|---|---|---|
| `startTimer` | `seconds` | `number` (id) | fires `timer` event |
| `cancelTimer` | `id` | `void` | |
| `setAlarm` | `time` | `number` (id) | fires `alarm` event (in-game time) |
| `cancelAlarm` | `id` | `void` | |

## Global timer functions (Node style)

In Node these are **globals**, not a module — layered on top of the CC timer mechanism.

| Function | Parameters | Return | Kind |
|---|---|---|---|
| `setTimeout` | `cb, ms` | `number` (id) | preferred over `startTimer` |
| `setInterval` | `cb, ms` | `number` (id) | |
| `clearTimeout` | `id` | `void` | |
| `clearInterval` | `id` | `void` | |
| `sleep` | `seconds` | `void` | **blocking**, CC extension (deliberately absent in Node) |

---

## `http` — Node `http`/`https` style

`fetch()` is not possible (needs a Promise). Hence callback + blocking variant.

| Function | Parameters | Return | Kind |
|---|---|---|---|
| `requestSync` | `url, {method?, body?, headers?, binary?, timeout?, redirect?}` | `Response` (below) | **blocking** |
| `request` | `opts, (err, res) => …` | `void` | callback |
| `get` | `url, (err, res) => …` | `void` | callback shortcut |
| `getSync` | `url` | `Response` | blocking |
| `checkURLSync` | `url` | `boolean` | blocking |
| `websocket` | `url, opts?` | `WebSocket` (below) | returns immediately, events async |

### `Response` object

| Field/method | Type |
|---|---|
| `status` | `number` |
| `headers` | `object` |
| `ok` | `boolean` |
| `text()` | `string` |
| `json()` | `any` |
| `buffer()` | `Buffer` |

### `WebSocket` object (browser/`ws`-compatible, EventEmitter)

| Function | Parameters | Return |
|---|---|---|
| `send` | `data` | `void` |
| `on` | `"message"\|"close"\|"open", cb` | `void` |
| `close` | – | `void` |

---

## `term` — kept, but multiple returns → objects

Function names are already camelCase. Main change: tuple returns become objects.

| Function | Parameters | Return (new) | today |
|---|---|---|---|
| `write` | `text` | `void` | same |
| `blit` | `text, fg, bg` | `void` | same |
| `scroll` | `y` | `void` | same |
| `clear` / `clearLine` | – | `void` | same |
| `getCursorPos` | – | `{x, y}` (**0-based**) | was 2 returns, 1-based |
| `setCursorPos` | `x, y` | `void` | **0-based** (was 1-based) |
| `getCursorBlink` | – | `boolean` | same |
| `setCursorBlink` | `blink` | `void` | same |
| `getSize` | – | `{width, height}` | was 2 returns |
| `getTextColor` / `setTextColor` | `color?` | `number` / `void` | same |
| `getBackgroundColor` / `setBackgroundColor` | `color?` | `number` / `void` | same |
| `isColor` | – | `boolean` | same |
| `getPaletteColor` | `color` | `{r, g, b}` | was 3 returns |
| `setPaletteColor` | `color, rgb \| r,g,b` | `void` | same |
| `nativePaletteColor` | `color` | `{r, g, b}` | was 3 returns |

> **Decided:** cursor coordinates are **0-based** (`{x: 0, y: 0}` = top left), diverging from
> the CC docs (1-based) but JS-idiomatic. `getSize` is unaffected (width/height are lengths,
> not indices). Internally a +1 is applied when crossing into CC's terminal.

---

## `redstone` (`rs`) — almost unchanged

| Function | Parameters | Return |
|---|---|---|
| `getSides` | – | `string[]` |
| `setOutput` | `side, on` | `void` |
| `getOutput` / `getInput` | `side` | `boolean` |
| `setAnalogOutput` | `side, value` | `void` |
| `getAnalogOutput` / `getAnalogInput` | `side` | `number` |
| `setBundledOutput` | `side, mask` | `void` |
| `getBundledOutput` / `getBundledInput` | `side` | `number` |
| `testBundledInput` | `side, mask` | `boolean` |

No tuples, no async → portable 1:1.

---

## `peripheral` — `wrap()` as a JS proxy

| Function | Parameters | Return (new) | today |
|---|---|---|---|
| `getNames` | – | `string[]` | same |
| `isPresent` | `side` | `boolean` | same |
| `getType` | `side` | `string[] \| null` | was cons-array |
| `hasType` | `side, type` | `boolean \| null` | same |
| `getMethods` | `side` | `string[] \| null` | same |
| `call` | `side, method, ...args` | `any` (array if multiple) | MethodResult |
| `wrap` | `side` | `object \| null` (proxy with methods) | previously only in Lua CraftOS |

`wrap()` is the most JS-friendly form: `const m = peripheral.wrap("right"); m.someMethod()`.

---

## `turtle` — result object instead of `(bool, string)` tuple

All functions **block** (world interaction). "Can-fail" return → `{ok: boolean, reason?: string}`.

| Function | Parameters | Return |
|---|---|---|
| `forward` / `back` / `up` / `down` | – | `{ok, reason?}` |
| `turnLeft` / `turnRight` | – | `{ok, reason?}` |
| `dig` / `digUp` / `digDown` | `side?` | `{ok, reason?}` |
| `place` / `placeUp` / `placeDown` | `text?` | `{ok, reason?}` |
| `drop` / `dropUp` / `dropDown` | `count?` | `{ok, reason?}` |
| `suck` / `suckUp` / `suckDown` | `count?` | `{ok, reason?}` |
| `attack` / `attackUp` / `attackDown` | `side?` | `{ok, reason?}` |
| `detect` / `detectUp` / `detectDown` | – | `boolean` |
| `compare` / `compareUp` / `compareDown` | – | `boolean` |
| `inspect` / `inspectUp` / `inspectDown` | – | `{ok: boolean, data?: object, reason?: string}` |
| `select` | `slot` | `void` (or throws) |
| `getSelectedSlot` | – | `number` |
| `getItemCount` / `getItemSpace` | `slot?` | `number` |
| `getItemDetail` | `slot?, detailed?` | `object \| null` |
| `compareTo` | `slot` | `boolean` |
| `transferTo` | `slot, count?` | `{ok, reason?}` |
| `refuel` | `count?` | `{ok, reason?}` |
| `getFuelLevel` / `getFuelLimit` | – | `number \| "unlimited"` |
| `equipLeft` / `equipRight` | – | `{ok, reason?}` |
| `getEquippedLeft` / `getEquippedRight` | – | `object \| null` |

> **Alternative to `{ok, reason}`:** tuple `[ok, reason]` for `const [ok] = turtle.forward()`.
> Downside: `if (turtle.forward())` is always truthy with either variant → needs clear docs.
> Recommendation: `{ok, reason}`.

---

## `commands` — multiple returns → objects, mainThread = blocking

| Function | Parameters | Return (new) | today |
|---|---|---|---|
| `exec` | `command` | `{ok: boolean, output: string[], affected?: number}` | 3 returns |
| `execAsync` | `command` | `number` (taskId) | same |
| `list` | `...subcmd` | `string[]` | same |
| `getDimension` | – | `string` | same |
| `getBlockPosition` | – | `{x, y, z}` | was 3 returns |
| `getBlockInfo` | `x, y, z, dim?` | `object` | same |
| `getBlockInfos` | `minX…maxZ, dim?` | `object[]` | same |
| `getEntities` | `selector` | `object[]` | same |

---

## `pocket` — result object

| Function | Parameters | Return |
|---|---|---|
| `equipBack` | – | `{ok: boolean, reason?: string}` |
| `unequipBack` | – | `{ok: boolean, reason?: string}` |

---

## Summary of the biggest changes

1. **`fs` split:** path logic → dedicated **`path` module**; `attributes`/`getSize`/`isDir` →
   `stat()` with a `Stats` object; `…Sync` + callback variant everywhere; `readFile`/`writeFile`
   convenience added.
2. **`os` broken apart** into **`process`** (computer control + in-game time), **`events`**
   (event bus, emitter preferred), and global **`setTimeout`/`setInterval`**. `date`,
   `dateString` and `utc`/`local` dropped (→ `Date`).
3. **`http`:** `request`/`get` as callback + `…Sync` blocking, `Response` object with
   `.json()/.text()/.buffer()`, `WebSocket` as an EventEmitter.
4. **Tuples → objects everywhere:** `getCursorPos`→`{x,y}`, `getBlockPosition`→`{x,y,z}`,
   turtle/pocket→`{ok, reason}`.
5. **`term` coordinates 0-based** (JS-idiomatic, diverging from CC).

## Decisions

- **(a)** turtle/pocket result as **`{ok, reason}`** ✅ (tuple `[ok, reason]` rejected)
- **(b)** `term` coordinates **0-based** ✅
- **(c)** path helpers in a **dedicated `path` module** ✅
- **(d)** computer control named **`process`** ✅
