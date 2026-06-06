# JS ROM Features — Design Spec

> **Audience**: Implementers of CC: Rhino's ROM layer.
> **Purpose**: Describe every capability that must be present in `src/ts/rom/` as a JS feature specification.
> **Not covered**: Lua implementation details, porting notes, or internal data-structure choices.

---

## Boot Sequence (`bios.ts`)

**Summary**: Runs once on computer start; sets up the shell path, aliases, tab-completion registrations, autorun files, and user startup scripts before handing control to the user's shell.

**Feature contract**:
1. Determine the active peripheral set to build a colon-separated program search path that always includes:
   - `.` (cwd), `/rom/programs`, `/rom/programs/http`
   - `/rom/programs/advanced` when `term.isColor()` is true
   - `/rom/programs/turtle` on turtles, else `/rom/programs/rednet` + `/rom/programs/fun`
   - `/rom/programs/fun/advanced` on colour non-turtle
   - `/rom/programs/pocket` on pocket computers
   - `/rom/programs/command` on command computers
2. Call `shell.setPath(computedPath)` and `help.setPath("/rom/help")`.
3. Register standard aliases: `ls→list`, `dir→list`, `cp→copy`, `mv→move`, `rm→delete`, `clr→clear`, `rs→redstone`, `sh→shell`; on colour terminals also `background→bg`, `foreground→fg`.
4. Register tab-completion handlers for every ROM program (see Startup section of source for the full list). Each handler is registered with `shell.setCompletionFunction(romProgramPath, completionFn)`.
5. Run all non-hidden files inside `/rom/autorun/` via `shell.run()`, in file-system order.
6. Optionally show MOTD (`settings.get("motd.enable")`), then run `/rom/programs/motd`.
7. Discover user startup programs: if `shell.allow_startup` is set, look for `/startup`, `/startup.lua`, or files inside `/startup/`. If `shell.allow_disk_startup` is set, scan all disk drives for a startup file (first drive with a startup wins). Run all discovered startup files in order.

**CC-specific behaviour**:
- Startup from disk takes priority over root startup.
- Startup search looks for `startup` (bare), `startup.lua`, and `startup/` directory; both a bare file and a directory may coexist.
- Autorun files must be sorted as returned by `fs.list` (alphabetical).

**Dependencies**: `shell`, `help`, `settings`, `fs`, `term`, `peripheral`, `disk`, `cc.shell.completion`

**Implementation notes**: In JS this is module-level setup code in `bios.ts`. There are no coroutines; all calls are synchronous. `shell.setPath`/`shell.setAlias`/`shell.setCompletionFunction` must be callable before any user program runs.

**Priority**: essential

---

## APIs (`src/ts/rom/apis/`)

### colors / colours

**Summary**: Named colour constants and utility functions for combining, testing, and converting 16-terminal palette colours.

**Feature contract**:
```
// Named constants (power-of-2 bitmasks, 1..32768)
colors.white = 0x1      colors.orange = 0x2     colors.magenta = 0x4
colors.lightBlue = 0x8  colors.yellow = 0x10    colors.lime = 0x20
colors.pink = 0x40      colors.gray = 0x80      colors.lightGray = 0x100
colors.cyan = 0x200     colors.purple = 0x400   colors.blue = 0x800
colors.brown = 0x1000   colors.green = 0x2000   colors.red = 0x4000
colors.black = 0x8000

colors.combine(...colors: number): number          // bitwise OR of all args
colors.subtract(base: number, ...remove: number): number  // base & ~each
colors.test(set: number, color: number): boolean   // (set & color) === color

colors.packRGB(r: number, g: number, b: number): number  // r,g,b in [0,1] → 0xRRGGBB
colors.unpackRGB(rgb: number): [number, number, number]  // 0xRRGGBB → [r,g,b] in [0,1]
colors.rgb8(...)  // deprecated alias; delegates to pack/unpackRGB based on arg count

colors.toBlit(color: number): string   // power-of-2 colour → single hex char "0"-"f"
colors.fromBlit(hex: string): number | null  // single hex char → power-of-2 colour
```

**CC-specific behaviour**:
- `colours` (British) is an identical alias for `colors`.
- Blit char mapping: `white=0`, `orange=1`, ..., `black=f` (index = log₂(value)).
- On monochrome terminals all colours still exist as constants; they render as nearest grey.

**Dependencies**: none (pure math)

**Implementation notes**: All arithmetic is integer / bitwise. JS `Math.log2` + `Math.floor` replaces Lua's `math.log(x, 2)`.

**Priority**: essential

---

### disk

**Summary**: Query and control disk drives (floppy content, music records, labels, mount paths).

**Feature contract**:
```
disk.isPresent(name: string): boolean
disk.getLabel(name: string): string | null
disk.setLabel(name: string, label: string | null): void
disk.hasData(name: string): boolean         // true if floppy/computer disk (not music)
disk.getMountPath(name: string): string | null
disk.hasAudio(name: string): boolean
disk.getAudioTitle(name: string): string | false | null
disk.playAudio(name: string): void
disk.stopAudio(name?: string): void         // omit to stop all drives
disk.eject(name: string): void
disk.getID(name: string): string | null
```

**CC-specific behaviour**:
- All functions silently do nothing / return null when no drive peripheral is found at `name`.
- `stopAudio()` with no argument iterates all peripherals and stops each.

**Dependencies**: `peripheral` (native)

**Implementation notes**: Each function checks `peripheral.getType(name) === "drive"`, then calls the appropriate peripheral method. Implemented entirely in JS on top of the native `peripheral` module.

**Priority**: important

---

### fs

**Summary**: File-system access with path helpers, wildcard search, and tab-completion support.

**Feature contract** (extends the native `fs` module):
```
// All native fs methods are available as-is (open, list, exists, isDir, isReadOnly,
// getDrive, getFreeSpace, getCapacity, makeDir, delete, copy, move, combine, getName,
// getDir, getSize, attributes, find, complete, isDriveRoot)

fs.complete(
  path: string,
  location: string,
  options?: boolean | { include_files?: boolean, include_dirs?: boolean, include_hidden?: boolean }
): string[]
// Returns suffix completions for `path` relative to `location`.
// Directories always appear with a trailing "/"; plain dirs also appear without
// when include_dirs is not false.
// Hidden files (leading ".") are excluded by default unless include_hidden=true
// or the typed prefix itself starts with ".".

fs.find(pattern: string): string[]
// Glob: "*" matches any chars within one path segment, "?" matches one char.
// Patterns are per-segment only (no cross-directory wildcards).
// Errors if the pattern tries to escape the root via "..".

fs.isDriveRoot(path: string): boolean
// Returns true if the path is a mount point (root, rom, disk mount, etc.).
```

**CC-specific behaviour**:
- Path separators: both `/` and `\` are accepted; `combine` normalises to `/`.
- `fs.complete` returns `.` and `..` entries when applicable.

**Dependencies**: native `fs`

**Implementation notes**: The JS `fs` module wraps the native Java-backed module. `complete` and `find` are pure JS helpers layered on top.

**Priority**: essential

---

### gps

**Summary**: Locate the current computer or turtle's world coordinates by communicating with GPS host computers via modem.

**Feature contract**:
```
gps.CHANNEL_GPS = 65534

gps.locate(timeout?: number, debug?: boolean): [number, number, number] | null
// Broadcasts a "PING" on CHANNEL_GPS, collects modem_message replies,
// runs trilateration with 3+ distance/position fixes, and returns [x, y, z].
// Returns null on timeout or if position is ambiguous.
// On command computers, delegates to commands.getBlockPosition() directly.
```

**CC-specific behaviour**:
- Requires a wireless modem peripheral.
- Opens CHANNEL_GPS on the modem if not already open, closes it when done.
- Timeout defaults to 2 seconds.

**Dependencies**: `peripheral`, `vector`, events (`modem_message`, `timer`)

**Implementation notes**: The Lua implementation uses coroutines to wait for events; in JS this is a synchronous blocking call (Rhino continuation). The trilateration math (dot product, cross product, square root) is implemented in pure JS using the `vector` module. The event loop inside `locate` blocks until either 3+ fixes are received or the timer fires.

**Priority**: important

---

### help

**Summary**: Manage and search a colon-separated help-file path, returning file locations for topics.

**Feature contract**:
```
help.path(): string                    // current colon-separated search path
help.setPath(newPath: string): void
help.lookup(topic: string): string | null  // returns file path (.md, .txt, or bare)
help.topics(): string[]                // sorted list of all available topic names
help.completeTopic(prefix: string): string[]  // suffix completions for read()
```

**CC-specific behaviour**:
- Default path is `/rom/help`.
- Files are found with these extensions tried in order: `""`, `".md"`, `".txt"`.
- `topics()` always includes `"index"`.
- Hidden files (starting with `.`) are skipped.

**Dependencies**: `fs`

**Priority**: essential

---

### http / http

**Summary**: Synchronous and asynchronous HTTP requests and WebSocket connections.

**Feature contract**:
```
// Synchronous wrappers (block until response or error)
http.get(url: string, headers?: Record<string,string>, binary?: boolean): Response | [null, string, Response?]
http.get(options: HttpOptions): Response | [null, string, Response?]

http.post(url: string, body: string, headers?, binary?): Response | [null, string, Response?]
http.post(options: HttpOptions): Response | [null, string, Response?]

// Asynchronous (returns immediately; fires http_success / http_failure events)
http.request(url: string | HttpOptions, body?, headers?, binary?): void

// URL validation
http.checkURL(url: string): [true] | [false, string]   // synchronous
http.checkURLAsync(url: string): void                   // fires http_check event

// WebSocket
http.websocket(url: string | WsOptions, headers?): WebSocket | [false, string]
http.websocketAsync(url: string | WsOptions, headers?): void  // fires websocket_success/failure

// Response object (ReadHandle with extra methods):
//   response.getResponseCode(): number
//   response.getResponseHeaders(): Record<string,string>
//   response.readAll(): string
//   response.readLine(): string | null
//   response.read(n?): string | null
//   response.close(): void

// WebSocket object:
//   ws.send(message: string, binary?: boolean): void
//   ws.receive(timeout?: number): string | null
//   ws.close(): void

interface HttpOptions {
  url: string; body?: string; headers?: Record<string,string>;
  binary?: boolean; method?: string; redirect?: boolean; timeout?: number;
}
```

**CC-specific behaviour**:
- Supported HTTP methods: GET, POST, HEAD, OPTIONS, PUT, DELETE, PATCH, TRACE.
- The synchronous functions internally fire/consume `http_success` / `http_failure` events.
- Responses read raw bytes (not UTF-8 decoded) since 1.109.

**Dependencies**: native `http`, events

**Implementation notes**: `get` and `post` are synchronous Rhino continuations. The async `request` just calls native and the events arrive later. In JS the response object wraps Java's HTTP response handle.

**Priority**: important

---

### io

**Summary**: Lua-style file I/O with `FILE*`-compatible handle objects, standard streams, and an `io.lines` iterator.

**Feature contract**:
```
io.stdin: Handle   // reads from shell's read() prompt
io.stdout: Handle  // writes via write()
io.stderr: Handle  // writes in red on colour terminals

io.open(filename: string, mode?: "r"|"w"|"a"|"r+"|"w+"|"rb"|"wb"...): Handle | [null, string]
io.close(file?: Handle): void
io.flush(): void
io.input(file?: Handle | string): Handle
io.output(file?: Handle | string): Handle
io.read(...formats): (string | null)[]
io.write(...values): Handle
io.lines(filename?: string, ...formats): () => string | null

// Handle methods:
//   handle:read(...formats)   // "l" line, "L" line+newline, "a" all, or number of bytes
//   handle:write(...values)
//   handle:lines(...formats)
//   handle:seek(whence?, offset?): number
//   handle:flush()
//   handle:close(): true | [null, string]
//   handle:setvbuf()  // no-op, compatibility only
```

**CC-specific behaviour**:
- `io.stderr.write` sets text colour to `colors.red` while writing, restores afterward.
- `io.lines` with a filename auto-closes the handle at EOF.
- `setvbuf` is a no-op.

**Dependencies**: `fs`, `term`, `colors`

**Priority**: essential

---

### keys

**Summary**: Named constants for every keyboard keycode, plus a `getName` lookup.

**Feature contract**:
```
// Constants: keys.<name> = number
// e.g. keys.space=32, keys.enter=257, keys.backspace=259, keys.left=263,
//      keys.right=262, keys.up=265, keys.down=264, keys.f1=290 ... keys.f25=314
//      keys.leftCtrl=341, keys.rightShift=344, etc.
// Aliases: keys.return = keys.enter

keys.getName(code: number): string | null
```

**CC-specific behaviour**:
- Key codes match GLFW 3 scancodes.
- `keys.return` is an alias for `keys.enter`.
- `keys.scollLock` (sic) aliases `keys.scrollLock` for backwards compat.

**Dependencies**: none

**Implementation notes**: Just a static lookup table of number→name and name→number.

**Priority**: essential

---

### paintutils

**Summary**: Draw pixels, lines, boxes, and colour images (`.nfp` format) on the terminal.

**Feature contract**:
```
paintutils.parseImage(imageStr: string): number[][]  // parse .nfp text to 2D colour array
paintutils.loadImage(path: string): number[][] | null

paintutils.drawPixel(x: number, y: number, color?: number): void
paintutils.drawLine(x1: number, y1: number, x2: number, y2: number, color?: number): void
paintutils.drawBox(x1: number, y1: number, x2: number, y2: number, color?: number): void
paintutils.drawFilledBox(x1: number, y1: number, x2: number, y2: number, color?: number): void
paintutils.drawImage(image: number[][], x: number, y: number): void
```

**CC-specific behaviour**:
- `.nfp` image format: each character is a hex digit (`0`-`f`) representing one pixel colour; rows separated by newlines; `0` is transparent (not drawn).
- All draw functions use `term.setBackgroundColor` + `term.write(" ")` for each pixel.
- `drawBox` and `drawFilledBox` use `term.blit` for efficiency on rows.
- Cursor position and background colour are side effects (not restored).
- Coordinates are 1-indexed (matching CC terminal convention).

**Dependencies**: `term`, `colors`, `io`, `fs`

**Priority**: optional

---

### parallel

**Summary**: Run multiple JS functions "concurrently" by interleaving their event-driven execution, stopping when any (waitForAny) or all (waitForAll) complete.

**Feature contract**:
```
parallel.waitForAny(...fns: Function[]): number  // index of the first fn that returned
parallel.waitForAll(...fns: Function[]): void
```

**CC-specific behaviour**:
- Each function gets its own view of the event queue; consuming an event in one function does not remove it from others.
- If any function throws, the error propagates out of the `waitForAny`/`waitForAll` call.
- `terminate` events are delivered to all active functions regardless of their event filter.

**Dependencies**: events

**Implementation notes**: In Lua this uses coroutines with filter strings. In JS, since there are no coroutines, this must be implemented with Rhino continuations or a fiber model. Each "thread" is a Rhino continuation context that is resumed whenever its filter matches the current event. The host runtime must expose a mechanism to suspend and resume synchronous contexts. `waitForAny` returns when the first continuation reaches its end; `waitForAll` waits for all.

**Priority**: important

---

### peripheral

**Summary**: Discover, query, and call methods on attached peripherals (both direct-side and wired-modem-remote).

**Feature contract**:
```
peripheral.getNames(): string[]
peripheral.isPresent(name: string): boolean
peripheral.getType(nameOrWrapped: string | object): string | null   // returns first type
peripheral.hasType(nameOrWrapped: string | object, type: string): boolean | null
peripheral.getMethods(name: string): string[] | null
peripheral.getName(wrapped: object): string
peripheral.call(name: string, method: string, ...args): any
peripheral.wrap(name: string): object | null    // plain object with method functions
peripheral.find(type: string, filter?: (name, wrapped) => boolean): object[]
```

**CC-specific behaviour**:
- Direct-side names are `"top"`, `"bottom"`, `"left"`, `"right"`, `"front"`, `"back"`.
- Wired-modem remotes: if a side has type `"peripheral_hub"`, its remote names are added to `getNames()`.
- `wrap` returns an object whose methods all delegate to `peripheral.call`; the wrapped object has `__name="peripheral"`, `name`, and `types` metadata.
- `find` returns all wrapped peripherals of the given type that pass the optional filter.

**Dependencies**: native `peripheral`, `redstone` (for side list)

**Priority**: essential

---

### rednet

**Summary**: High-level modem messaging layer with addressed sends, broadcast, protocol filtering, and hostname-based service discovery.

**Feature contract**:
```
rednet.CHANNEL_BROADCAST = 65535
rednet.CHANNEL_REPEAT = 65533
rednet.MAX_ID_CHANNELS = 65500

rednet.open(modem: string): void
rednet.close(modem?: string): void     // no arg = close all
rednet.isOpen(modem?: string): boolean // no arg = any open

rednet.send(recipient: number, message: any, protocol?: string): boolean
rednet.broadcast(message: any, protocol?: string): void
rednet.receive(protocolFilter?: string, timeout?: number): [number, any, string|null] | null

rednet.host(protocol: string, hostname: string): void   // errors if hostname taken
rednet.unhost(protocol: string): void
rednet.lookup(protocol: string, hostname?: string, timeout?: number): number | number[]

rednet.run(): void  // background daemon; translates modem_message → rednet_message events
```

**CC-specific behaviour**:
- `send` wraps the message in `{ nMessageID, nRecipient, nSender, message, sProtocol }`.
- Duplicate-message suppression: received message IDs are cached for ~10 seconds.
- `run()` must run in a background task; it also handles DNS `lookup` responses automatically.
- `send` to self (own computer ID) bypasses the modem and queues a `rednet_message` event directly.
- `lookup` broadcasts a DNS query and collects replies within a 2-second (default) window.

**Dependencies**: `peripheral`, events (`modem_message`, `rednet_message`, `timer`)

**Implementation notes**: `run()` is the rednet daemon. In the JS ROM it should be started as a background event-listener at boot (via `events.on("modem_message", ...)`) rather than as a separate coroutine. The deduplication timer can use `setTimeout`.

**Priority**: important

---

### settings

**Summary**: Persistent named key-value configuration store with typed definitions, file persistence, and change events.

**Feature contract**:
```
settings.define(name: string, options?: { description?: string, default?: any, type?: string }): void
settings.undefine(name: string): void

settings.set(name: string, value: number | string | boolean | object): void
settings.get(name: string, default?: any): any
settings.getDetails(name: string): { description?, default?, type?, value?, changed: boolean }
settings.unset(name: string): void
settings.clear(): void

settings.getNames(): string[]   // sorted list of defined + set keys

settings.load(path?: string): boolean   // default ".settings"; merges into current values
settings.save(path?: string): boolean   // default ".settings"; serialises current values
```

**CC-specific behaviour**:
- Every `set`, `unset`, or `clear` fires a `setting_changed` event with `(name, newValue, oldValue)`.
- `get` returns the per-call `default`, then the definition's `default`, then `null`.
- `load` deserialises the file with `textutils.unserialize` (CC's Lua-table format, not JSON).
- Settings file format is `textutils.serialize(valuesObject)`.
- Typed settings reject values of the wrong type.

**Dependencies**: `fs`, `textutils`, events

**Implementation notes**: The `setting_changed` event must be fired via the runtime event queue. The file format is CC's own serialisation format, not JSON — the JS `textutils.serialize/unserialize` module must handle it.

**Priority**: essential

---

### term

**Summary**: Terminal redirect layer: wraps the native terminal object and allows redirecting all output to an alternate terminal (monitor, window, etc.).

**Feature contract**:
```
term.redirect(target: TermRedirect): TermRedirect   // returns old target
term.current(): TermRedirect                         // current redirect
term.native(): TermRedirect                          // original hardware terminal
term.nativePaletteColor(color: number): [number, number, number]  // not redirectable
term.nativePaletteColour(...)  // alias

// All standard terminal methods are forwarded to current():
//   write, blit, clear, clearLine, setCursorPos, getCursorPos,
//   setCursorBlink, getCursorBlink, getSize, scroll,
//   setTextColor, getTextColor, setBackgroundColor, getBackgroundColor,
//   isColor, setPaletteColor, getPaletteColor
//   (+ British spellings)
```

**CC-specific behaviour**:
- `term` itself cannot be used as a redirect target (use `term.current()`).
- When redirecting, if the target is missing any method that the native terminal has, a stub that throws an error is injected for that method.
- `nativePaletteColor`/`nativePaletteColour` always read from the hardware terminal, not the redirect.

**Dependencies**: native `term`

**Implementation notes**: In JS, `term` is a proxy object whose method calls delegate to `redirectTarget`. `redirect` simply swaps `redirectTarget` and returns the old one.

**Priority**: essential

---

### textutils

**Summary**: String formatting, paged printing, columnar display, CC serialisation, JSON serialisation/deserialisation, and URL encoding.

**Feature contract**:
```
textutils.slowWrite(text: string, rate?: number): void  // default 20 chars/sec
textutils.slowPrint(text: string, rate?: number): void

textutils.formatTime(time: number, twentyFourHour?: boolean): string
// time is a fractional hour value (0-24); outputs "6:30 PM" or "18:30"

textutils.pagedPrint(text: string, freeLines?: number): number
// Prints text; pauses with "Press any key to continue" at screen bottom.
// Returns number of lines printed.

textutils.tabulate(...rows: (string[] | number)[]): void
// Print columns; number args set text colour for subsequent rows.
textutils.pagedTabulate(...): void  // same but paged

textutils.serialize(value: any, opts?: { compact?: boolean, allow_repetitions?: boolean }): string
textutils.serialise(...)  // alias
textutils.unserialize(s: string): any | null
textutils.unserialise(...)  // alias

textutils.serializeJSON(value: any, opts?: { nbt_style?, unicode_strings?, allow_repetitions? } | boolean): string
textutils.serialiseJSON(...)  // alias
textutils.unserializeJSON(s: string, opts?: { nbt_style?, parse_null?, parse_empty_array? }): any | [null, string]
textutils.unserialiseJSON(...)  // alias

textutils.empty_json_array  // sentinel table representing JSON []
textutils.json_null          // sentinel table representing JSON null

textutils.urlEncode(str: string): string

textutils.complete(searchText: string, searchTable?: object): string[]
// Tab-completion for Lua expressions; appends "(" for functions, "." for tables.
```

**CC-specific behaviour**:
- `serialize` produces Lua-table syntax (`{ 1, 2, a = "b" }`), not JSON.
- `serialize` errors on recursive tables unless `allow_repetitions` is set.
- `unserialize` runs `load("return " + s)` — it evaluates Lua-syntax strings.
- `serializeJSON` encodes non-string-keyed tables as JSON objects; numeric-key-only tables as arrays. Empty tables become `{}`.
- `json_null` and `empty_json_array` are special sentinel objects; `tostring()` on them returns `"null"` / `"[]"`.
- `pagedPrint` uses `term.redirect` to intercept scroll operations.

**Dependencies**: `term`, `cc.strings`, events (`key`)

**Implementation notes**: `unserialize` in Lua uses `load("return " .. s)`. In JS use a safe Lua-syntax parser or a small sandboxed evaluator for the CC table format. `serializeJSON`/`unserializeJSON` can delegate to a standard JSON library with special handling for sentinels and NBT-style. `complete` traverses the prototype chain of the search table.

**Priority**: essential

---

### turtle / turtle

**Summary**: Wraps the native turtle API; adds `craft` method dynamically when a workbench peripheral is present.

**Feature contract**:
All native turtle methods are exposed directly:
```
// Movement (return { ok: boolean, reason?: string })
turtle.forward(), turtle.back(), turtle.up(), turtle.down()
turtle.turnLeft(), turtle.turnRight()

// Digging
turtle.dig(side?: "left"|"right"), turtle.digUp(), turtle.digDown()

// Placing
turtle.place(text?: string), turtle.placeUp(), turtle.placeDown()

// Interaction
turtle.detect(), turtle.detectUp(), turtle.detectDown()
turtle.compare(), turtle.compareUp(), turtle.compareDown()
turtle.compareTo(slot: number): boolean
turtle.attack(side?: string), turtle.attackUp(), turtle.attackDown()
turtle.suck(count?: number), turtle.suckUp(), turtle.suckDown()
turtle.drop(count?: number), turtle.dropUp(), turtle.dropDown()

// Inventory
turtle.select(slot: number): boolean
turtle.getSelectedSlot(): number
turtle.getItemCount(slot?: number): number
turtle.getItemSpace(slot?: number): number
turtle.getItemDetail(slot?: number, detailed?: boolean): object | null
turtle.transferTo(slot: number, count?: number): boolean

// Fuel
turtle.getFuelLevel(): number | "unlimited"
turtle.getFuelLimit(): number
turtle.refuel(count?: number): boolean

// Equipment
turtle.equipLeft(), turtle.equipRight()  // return { ok, reason? }

// Crafting (injected when workbench present)
turtle.craft(limit?: number): boolean
```

**CC-specific behaviour**:
- `equipLeft`/`equipRight` re-check for a workbench peripheral after equipping and update the `craft` method accordingly.
- `craft` is `null`/absent when no workbench is attached.
- `turtle.native` is the raw underlying API.

**Dependencies**: native `turtle`, `peripheral`

**Priority**: essential (turtle environments only)

---

### vector

**Summary**: Immutable 3D vector type for world-coordinate math.

**Feature contract**:
```
vector.new(x: number, y: number, z: number): Vector

// Vector instance methods
v.add(other: Vector): Vector        // v + other
v.sub(other: Vector): Vector        // v - other
v.mul(factor: number): Vector       // v * factor
v.div(factor: number): Vector       // v / factor
v.unm(): Vector                     // -v
v.dot(other: Vector): number
v.cross(other: Vector): Vector
v.length(): number
v.normalize(): Vector
v.round(tolerance?: number): Vector // tolerance default 1.0
v.tostring(): string                // "x,y,z"
v.equals(other: Vector): boolean

// Operator overloads (via object proxy or method forwarding):
// v1 + v2, v1 - v2, v1 * n, v1 / n, -v1, v1 == v2, tostring(v)
```

**CC-specific behaviour**:
- Vectors are plain objects with `x`, `y`, `z` number fields.
- `tostring(v)` → `"x,y,z"` (no spaces).

**Dependencies**: none

**Implementation notes**: JS has no operator overloading. The vector object can expose all methods explicitly; callers must call `v.add(other)` rather than `v + other`. The `+` / `-` syntax only works in Lua/Cobalt.

**Priority**: important

---

### window

**Summary**: A buffered off-screen terminal redirect that occupies a sub-region of a parent terminal; supports visibility toggling, repositioning, and content redrawing.

**Feature contract**:
```
window.create(
  parent: TermRedirect,
  x: number, y: number,
  width: number, height: number,
  visible?: boolean
): Window

// Window implements all term.Redirect methods plus:
window.setVisible(visible: boolean): void
window.isVisible(): boolean
window.redraw(): void              // force repaint to parent
window.restoreCursor(): void       // sync parent cursor to window cursor
window.getPosition(): [number, number]
window.reposition(newX, newY, newWidth?, newHeight?, newParent?): void
window.getLine(y: number): [string, string, string]  // text, fgColors, bgColors (blit format)
```

**CC-specific behaviour**:
- `create` immediately redraws itself if `visible=true`.
- Content is buffered per-line as three parallel strings: text, fg blit, bg blit.
- Cursor position is 1-indexed within the window (not parent).
- When invisible, no writes reach the parent; making visible triggers immediate redraw.
- Palette changes propagate to parent when visible.
- `reposition` can simultaneously change size and parent.
- Scrolling shifts buffered lines and fills new empty lines with current bg colour.

**Dependencies**: `colors`, native `term`

**Implementation notes**: The window stores 1-indexed cursor coords internally. The parent terminal uses 1-indexed coords shifted by the window's offset. All write operations clip to the window bounds before forwarding to parent.

**Priority**: essential

---

## Standard Library Modules (`src/ts/rom/modules/cc/`)

### cc/expect

**Summary**: Runtime argument type checking with clear error messages.

**Feature contract**:
```
import { expect, field, range } from 'cc/expect'

expect(index: number, value: any, ...allowedTypes: string[]): any
// Throws "bad argument #N (TYPE expected, got TYPE)" if value's type is not in allowedTypes.
// Returns value on success.

field(tbl: object, key: string, ...allowedTypes: string[]): any
// Like expect but for object fields; throws "bad field 'KEY' (TYPE expected, got TYPE)".

range(num: number, min?: number, max?: number): number
// Throws if num < min or num > max or is NaN.
```

**CC-specific behaviour**:
- `expect` can be called as a function directly: `expect(1, val, "string")`.
- Type names include `"table"` for objects and `"nil"` for null/undefined.
- Uses `__name` metatable field (if present) as the display type name.

**Dependencies**: none

**Implementation notes**: In JS, map Lua types: `nil`→`null`/`undefined`, `table`→`object`/`Array`, `string`→`string`, `number`→`number`, `boolean`→`boolean`, `function`→`function`. The `__name` concept doesn't apply in JS — use the constructor name or `typeof`.

**Priority**: essential

---

### cc/strings

**Summary**: Text utility functions for wrapping, padding, and splitting strings.

**Feature contract**:
```
import { wrap, ensure_width, split } from 'cc/strings'

wrap(text: string, width?: number): string[]
// Word-wrap text into lines of at most `width` chars (default: terminal width).
// Handles long words by breaking them.

ensure_width(line: string, width?: number): string
// Truncate or pad with spaces to exactly `width` chars.

split(str: string, delimiter: string, plain?: boolean, limit?: number): string[]
// Split by regex (or literal if plain=true). Returns ["str"] if no matches.
// limit: maximum number of parts.
```

**Dependencies**: `term` (for default width), `cc/expect`

**Priority**: essential

---

### cc/pretty

**Summary**: Document-based pretty-printer for structured data, with colour support.

**Feature contract**:
```
import * as pretty from 'cc/pretty'

// Document primitives
pretty.empty: Doc
pretty.space: Doc
pretty.line: Doc       // line break (removed by group)
pretty.space_line: Doc // line break → space when collapsed by group

// Combinators
pretty.text(str: string, colour?: number): Doc
pretty.concat(...docs: Doc[]): Doc       // also doc1 + doc2 in some contexts
pretty.nest(depth: number, doc: Doc): Doc
pretty.group(doc: Doc): Doc              // try single-line, fall back to multi-line

// Output
pretty.write(doc: Doc, ribbonFrac?: number): void   // to current terminal
pretty.print(doc: Doc, ribbonFrac?: number): void   // write + newline
pretty.render(doc: Doc, width?: number, ribbonFrac?: number): string

// High-level
pretty.pretty(obj: any, options?: { function_args?: boolean, function_source?: boolean }): Doc
pretty.pretty_print(obj: any, options?, ribbonFrac?): void
```

**CC-specific behaviour**:
- Strings render in red, numbers in magenta, functions in lightGray, tables in `{}` with nested docs.
- `pretty.pretty` does not recurse into the same table twice (cycle detection).
- `group` collapses a doc to one line if it fits within `ribbonFrac * width` (default 0.6).
- `Doc.__concat` allows `doc1 .. doc2` syntax in Lua; in JS use `pretty.concat(doc1, doc2)`.

**Dependencies**: `term`, `colors`, `cc/expect`

**Priority**: important

---

### cc/require

**Summary**: A portable `require`/`package` factory that each shell instance creates to scope module loading to a directory.

**Feature contract**:
```
import { make } from 'cc/require'

const [require, pkg] = make(env: object, dir: string)
// Returns a require function and package table scoped to `dir`.

// package properties:
pkg.loaded: Record<string, any>   // module cache
pkg.path: string                  // semicolon-separated search path with "?" placeholders
pkg.preload: Record<string, Function>
pkg.loaders: [preload, fromFile]
pkg.searchpath(name, path, sep?, rep?): string | [null, string]
```

**CC-specific behaviour**:
- Default `package.path` includes `/rom/modules/main/?.lua` etc.
- On turtle environments adds `/rom/modules/turtle/` paths.
- On command computers adds `/rom/modules/command/` paths.
- `package.loaded` is pre-populated from the global module registry (so core modules are shared).
- Loop detection: loading a module that is currently being loaded throws an error.

**Dependencies**: `fs`

**Implementation notes**: In JS this is the module system itself — CommonJS `require` already provides this. The CC `require` module is mainly needed so that `shell` can provide each program with its own isolated `require` instance scoped to the program's directory. The JS implementation may expose `cc/require.make(env, dir)` which returns a CJS-compatible `require` function that searches the given directory first.

**Priority**: essential

---

### cc/completion

**Summary**: Input-completion helpers for `read()`: choices, peripheral names, sides, settings, and commands.

**Feature contract**:
```
import { choice, peripheral, side, setting, command } from 'cc/completion'

choice(text: string, choices: string[], addSpace?: boolean): string[]
peripheral(text: string, addSpace?: boolean): string[]
side(text: string, addSpace?: boolean): string[]
setting(text: string, addSpace?: boolean): string[]
command(text: string, addSpace?: boolean): string[]
```

All return suffix strings (what to append to `text` to complete it).

**Dependencies**: `peripheral`, `redstone`, `settings`, `commands` (optional)

**Priority**: important

---

### cc/shell/completion

**Summary**: Shell-specific tab-completion builders for programs registered with `shell.setCompletionFunction`.

**Feature contract**:
```
import * as completion from 'cc/shell/completion'

// Leaf completers (shell, text, previous) → string[]
completion.file(shell, text): string[]
completion.dir(shell, text): string[]
completion.dirOrFile(shell, text, previous, addSpace?): string[]
completion.program(shell, text): string[]
completion.programWithArgs(shell, text, previous, startIndex): string[]

// Re-exported from cc/completion, adapted for shell signature:
completion.help, completion.choice, completion.peripheral, completion.side,
completion.setting, completion.command

// Builder
completion.build(...args: (Function | [Function, ...extraArgs, many?: boolean] | null)[]): CompletionFn
// Returns a (shell, index, text, previous) → string[] function.
// Argument i in the build call handles argument i of the program.
// The last argument with many=true is used for all remaining arguments.
```

**Dependencies**: `fs`, `settings`, `help`, `cc/completion`

**Priority**: essential

---

### cc/audio/dfpwm

**Summary**: Encode and decode DFPWM (1-bit audio) data used by the speaker peripheral.

**Feature contract**:
```
import { make_encoder, encode, make_decoder, decode } from 'cc/audio/dfpwm'

make_encoder(): (input: number[]) => string
// Returns an encoder function. Each call encodes a PCM chunk (amplitudes -128..127)
// to a DFPWM binary string (1 bit per sample, packed 8 per byte).

encode(input: number[]): string   // convenience: make_encoder()(input)

make_decoder(): (dfpwm: string) => number[]
// Returns a decoder function. Each call decodes a DFPWM binary string to PCM amplitudes.

decode(dfpwm: string): number[]   // convenience: make_decoder()(dfpwm)
```

**CC-specific behaviour**:
- Encoders/decoders are stateful; do not reuse across independent streams.
- Amplitude range is strictly -128 to 127.
- DFPWM uses a dynamic filter predictor with precision constant `PREC = 10`.

**Dependencies**: none (pure math)

**Priority**: optional

---

### cc/base64

**Summary**: Base64 encode/decode with support for alternate character sets (e.g. URL-safe base64).

**Feature contract**:
```
import { encode, decode } from 'cc/base64'

encode(str: string, altChars?: string): string
// altChars: 2-char string replacing "+" and "/" (e.g. "-_" for base64url)

decode(str: string, altChars?: string): string | [null, string]
// Returns null+error on invalid input (must have correct padding)
```

**Dependencies**: none

**Priority**: optional

---

### cc/image/nft

**Summary**: Parse and render NFT (Nitrogen Fingers Text) images that support coloured text.

**Feature contract**:
```
import { parse, load, draw } from 'cc/image/nft'

// NFT image: array of { text: string, foreground: string, background: string }
// where foreground/background are blit-format strings (one hex char per character)

parse(imageStr: string): NftImage
load(path: string): NftImage | [null, string]
draw(image: NftImage, x: number, y: number, target?: TermRedirect): void
```

**CC-specific behaviour**:
- NFT escape bytes: `\x1F` (char 31) = set foreground, `\x1E` (char 30) = set background.
- Line boundaries reset colours to white foreground, black background.
- Default target is `term` (current terminal).

**Dependencies**: `io`, `term`, `cc/expect`

**Priority**: optional

---

### cc/internal/edit_runner

**Summary**: Helper used by the `edit` program to launch and run edited files in a separate multishell tab.

**Feature contract**:
```
// Used internally: edit_runner(title, path, contents)
// 1. Sets the multishell tab title.
// 2. Loads `contents` as a JS/Lua program via `load`.
// 3. Runs it via exception.try(), reports errors with syntax highlighting.
// 4. On syntax error, runs the parser to provide structured feedback.
// 5. Prints "Press any key to continue" and waits for a key.
```

**Dependencies**: `multishell`, `term`, `cc/internal/exception`, `cc/internal/syntax`, `cc/strings`

**Priority**: optional

---

### cc/internal/error_hints

**Summary**: Provides "did you mean" suggestions for nil-access errors by computing edit distance against local/global names.

**Feature contract**:
```
// Internal; used by exception.report()
get_tip(err: string, thread: Coroutine, frameOffset: number): Doc | null
```

**Dependencies**: `cc/pretty`, `cc/internal/error_info`

**Priority**: optional

---

### cc/internal/error_printer

**Summary**: Renders structured error messages with annotated source lines and coloured underlines to the terminal.

**Feature contract**:
```
// Internal: errorPrinter(context, annotations)
// context: { get_pos(pos) → [line, col], get_line(pos) → string }
// annotations: array of { tag: "annotate", start_pos, end_pos, msg } or plain strings/Docs
```

**Dependencies**: `cc/pretty`, `cc/strings`, `term`, `colors`

**Priority**: optional

---

### cc/internal/event

**Summary**: Utility for discarding a stale `char` event that follows a consumed `key` event.

**Feature contract**:
```
// Internal
discard_char(): void
// Waits one tick via a zero timer; stops early if another key/char event is seen.
```

**Dependencies**: events

**Priority**: optional

---

### cc/internal/exception

**Summary**: Structured error handling with try/catch, exception objects containing a coroutine reference, and error reporting.

**Feature contract**:
```
// Internal
make_exception(message: string, thread: Coroutine): Exception
is_exception(e: any): boolean
try_barrier(parent, fn, ...args): any   // barrier marker on the call stack
can_wrap_errors(thread?): boolean       // true if no pcall on the stack
try(fn: Function, ...args): [true, ...results] | [false, string, Coroutine]
report(err: string, thread: Coroutine, sourceMap?: Record<string, string>): void
```

**Dependencies**: `cc/internal/error_printer`, `cc/internal/error_hints`

**Implementation notes**: In JS there are no Lua coroutines. The "exception" mechanism maps to normal JS `try/catch`. The `thread` field in exceptions can be omitted or set to `null`. `try()` becomes `function try(fn, ...args) { try { return [true, fn(...args)]; } catch(e) { return [false, e.message, null]; } }`. `report()` prints error context when available.

**Priority**: important

---

### cc/internal/import

**Summary**: Handles the `file_transfer` event: prompts the user to confirm overwriting existing files, then saves transferred files to disk.

**Feature contract**:
```
// Internal: import(files: TransferredFile[])
// Checks for overwrites, asks "Overwrite? (yes/no)", writes files via fs.open("wb").
// Returns true on success, [null, errorMsg] on failure.
```

**Dependencies**: `shell`, `fs`, `io`, `textutils`, `colors`, `cc/completion`

**Priority**: optional

---

### cc/internal/menu

**Summary**: A reusable bottom-bar menu widget used by `edit` and `paint`.

**Feature contract**:
```
// Internal
create(items: string[]): Menu
draw(menu: Menu): void
// Renders at bottom row. Selected item is [highlighted]; others have spaces.
// Colour terminal: selected highlight in yellow; mono: white.

handle_event(menu: Menu, event: string, ...args): null | false | string
// Returns:
//   null   → no action taken
//   false  → menu dismissed (Ctrl/Alt key or click outside bar)
//   string → selected item name
```

**CC-specific behaviour**:
- Arrow keys navigate left/right through items.
- Enter or numpad Enter selects.
- First letter of any item name selects it (case-insensitive).
- Mouse click on the bottom row selects the clicked item; click elsewhere closes.
- Left Ctrl, Right Ctrl, or Right Alt closes the menu.

**Dependencies**: `term`, `keys`, `colors`

**Priority**: optional

---

### cc/internal/syntax

**Summary**: Lexer, parser, and error set for the Lua/CC syntax used by the REPL and editor to provide structured parse-error messages.

**Feature contract**:
```
// Internal; exposed sub-modules: init, lexer, parser, errors
const syntax = require('cc/internal/syntax')
syntax.parse_program(source: string): boolean   // false = errors were printed
syntax.parse_repl(source: string): boolean      // same for interactive REPL input
```

**Dependencies**: `cc/internal/error_printer`, `term`

**Implementation notes**: For JS-only environments this module may be replaced with an equivalent JS parser. If the runtime uses JavaScript instead of Lua, a JS syntax checker can be substituted here.

**Priority**: optional

---

### cc/internal/tiny_require

**Summary**: A minimal `require` implementation for APIs that need to load cc modules without the full shell environment being set up.

**Feature contract**:
```
// Returns a require(name) function that loads from /rom/modules/main/<name>.js (or .lua).
// Results are cached.
```

**Dependencies**: `fs`

**Implementation notes**: In JS this is just CommonJS `require` with a path prefix — or simply a mapping to the module registry.

**Priority**: essential (internal bootstrap)

---

## Programs (`src/ts/rom/programs/`)

### shell

**Summary**: The interactive command-line shell; provides program execution, path/alias management, tab completion, and the shell API.

**Feature contract**:
```
// shell API (injected into every child program's environment)
shell.run(...args: string[]): boolean
shell.execute(program: string, ...args: string[]): boolean
shell.exit(): void
shell.dir(): string
shell.setDir(path: string): void
shell.path(): string
shell.setPath(path: string): void
shell.resolve(path: string): string
shell.resolveProgram(name: string): string | null
shell.programs(includeHidden?: boolean): string[]
shell.completeProgram(prefix: string): string[]
shell.setAlias(alias: string, program: string): void
shell.clearAlias(alias: string): void
shell.aliases(): Record<string, string>
shell.setCompletionFunction(path: string, fn: CompletionFn): void
shell.getCompletionFunction(path: string): CompletionFn | null
shell.getCompletionInfo(): Record<string, { fnComplete: CompletionFn }>
shell.complete(line: string): string[]
shell.openTab(...args: string[]): number | null   // multishell only
shell.switchTab(id: number): void                 // multishell only
shell.getRunningProgram(): string
```

**CC-specific behaviour**:
- Program resolution order: alias → current dir → each path segment. Extensions `.lua` and `.js` are tried if no extension given.
- Hashbang (`#!program`) on first line: the file is passed to the named interpreter.
- Prompt is yellow on colour terminals, white on mono.
- Tab completion: `Tab` triggers shell completion; cycles through results.
- `Ctrl+T` terminates the current program.
- Each child program gets its own `shell` + `require` + `package` environment.
- `shell.run` returns `false` if the program is not found or throws an error.

**Dependencies**: `term`, `fs`, `settings`, `cc/require`, `cc/internal/exception`, `cc/shell/completion`, `colors`, `keys`, multishell (optional)

**Implementation notes**: The shell is the central event loop for the computer when no multishell is active. In JS it must run its own input-read loop and dispatch commands. Each launched program runs in a separate execution context (or on the same thread with continuation support).

**Priority**: essential

---

### multishell (advanced)

**Summary**: Tabbed multi-program interface for colour Advanced Computers; shows a tab bar, supports switching between programs.

**Feature contract**:
```
// multishell API (injected by the multishell program)
multishell.launch(env: object, program: string, ...args): number
multishell.getCurrent(): number
multishell.getCount(): number
multishell.setTitle(id: number, title: string): void
multishell.getTitle(id: number): string | null
multishell.getFocus(): number
multishell.setFocus(id: number): boolean
```

**CC-specific behaviour**:
- Tab bar at top row (height 1); each tab shows its title, max ~8 chars.
- `Ctrl+Tab` or clicking a tab switches focus.
- Each tab owns a `window` sized to `(termWidth, termHeight - 1)` at y=2.
- Only the focused tab's window is visible.
- `multishell.launch` creates a new tab and optionally focuses it.
- `bg` launches in background (no focus change); `fg` launches and focuses.

**Dependencies**: `window`, `term`, `keys`, `colors`, `fs`, `cc/expect`

**Priority**: important (colour terminals only)

---

### bg (advanced) / fg (advanced)

**Summary**: Launch a program in a new background (`bg`) or foreground (`fg`) multishell tab.

**Feature contract**:
- `bg [program args...]` → opens a new tab running `program` (or `shell` if no args).
- `fg [program args...]` → same, but switches focus to the new tab.
- Both require `shell.openTab`; print an error if multishell is unavailable.

**Dependencies**: `shell` (openTab, switchTab)

**Priority**: important (multishell only)

---

### edit

**Summary**: Full-screen text editor with syntax highlighting, line numbers, save/run/print/exit menu.

**Feature contract**:
- `edit <path>` opens or creates a file.
- Displays content with syntax highlighting (keywords in yellow on colour; all white on mono).
- Ctrl+S: save; Ctrl+R: run in new multishell tab; Ctrl+P: print; Ctrl+X / menu "Exit": exit.
- Ctrl+A: select all; Ctrl+C: copy; Ctrl+V: paste; Ctrl+X: cut (with selection) or exit (without).
- Arrow keys, Home, End, Page Up/Down for navigation.
- Status bar at bottom row with current menu or status message.
- Read-only files show "File is read only" status; `Save` is removed from the menu.

**CC-specific behaviour**:
- Auto-adds `.lua` extension (configured by `edit.default_extension` setting) when creating new files.
- Syntax-highlights JS keywords if the runtime supports it (via `cc/internal/syntax`).
- Shows disk-space warning when free space < 1 KiB.
- Print: sends to a connected `printer` peripheral.

**Dependencies**: `term`, `fs`, `keys`, `colors`, `settings`, `shell`, `cc/internal/menu`, `cc/internal/syntax`, `cc/internal/edit_runner`, multishell (optional), peripheral

**Priority**: important

---

### about

**Summary**: Prints the CC: Tweaked (or CC: Rhino) version and credits.

**Feature contract**: `about` → prints version string and credits text to terminal.

**Dependencies**: `term`, `colors`

**Priority**: optional

---

### alias

**Summary**: Get or set shell command aliases.

**Feature contract**: `alias [name] [program]` → with no args lists all aliases; with one arg shows the alias target; with two sets the alias.

**Dependencies**: `shell`

**Priority**: important

---

### apis

**Summary**: Lists all currently loaded APIs (global modules).

**Feature contract**: `apis` → prints a sorted list of all names in the global environment that are tables (APIs).

**Dependencies**: none

**Priority**: optional

---

### cd

**Summary**: Change the shell's working directory.

**Feature contract**: `cd <path>` → changes cwd; `cd` alone goes to root.

**Dependencies**: `shell`, `fs`

**Priority**: essential

---

### clear

**Summary**: Clear the terminal screen, palette, or both.

**Feature contract**: `clear [screen|palette|all]` → clears the terminal display and/or resets the colour palette.

**Dependencies**: `term`, `colors`

**Priority**: essential

---

### copy

**Summary**: Copy a file or directory.

**Feature contract**: `copy <source> <destination>` → copies file or directory recursively.

**Dependencies**: `fs`

**Priority**: essential

---

### delete

**Summary**: Delete one or more files/directories.

**Feature contract**: `delete <path> [paths...]` → deletes each path (recursively for directories).

**Dependencies**: `fs`

**Priority**: essential

---

### drive

**Summary**: Show the name of the disk or mount at the given directory.

**Feature contract**: `drive [path]` → prints the drive name (result of `fs.getDrive`).

**Dependencies**: `fs`

**Priority**: optional

---

### eject

**Summary**: Eject the disk from a drive peripheral.

**Feature contract**: `eject <drive>` → calls `disk.eject(drive)`.

**Dependencies**: `disk`

**Priority**: optional

---

### exit

**Summary**: Exit the current shell.

**Feature contract**: `exit` → calls `shell.exit()`.

**Dependencies**: `shell`

**Priority**: essential

---

### gps (program)

**Summary**: GPS utility for locating the computer or hosting a GPS server.

**Feature contract**:
- `gps locate [debug]` → calls `gps.locate` and prints coordinates.
- `gps host <x> <y> <z>` → opens a modem and responds to GPS PING requests with the given coordinates.

**Dependencies**: `gps`, `peripheral`

**Priority**: optional

---

### help (program)

**Summary**: Display help text for a topic.

**Feature contract**: `help [topic]` → if topic given, pages the file at `help.lookup(topic)`; otherwise pages `/rom/help/index`.

**Dependencies**: `help`, `fs`, `term`, `textutils`

**Priority**: important

---

### id

**Summary**: Display the computer ID and optionally the ID of a connected peripheral.

**Feature contract**: `id [peripheral]` → prints computer ID or peripheral-reported ID.

**Dependencies**: native `os`, `peripheral`

**Priority**: optional

---

### import

**Summary**: Handles files dragged onto the computer window (the `file_transfer` event).

**Feature contract**: `import` → waits for a `file_transfer` event then delegates to `cc/internal/import`.

**Dependencies**: `cc/internal/import`, events

**Priority**: optional

---

### label

**Summary**: Get, set, or clear the label of this computer or a disk drive.

**Feature contract**: `label get [drive]`, `label set <name> [drive]`, `label clear [drive]`.

**Dependencies**: native `os`, `disk`

**Priority**: optional

---

### list

**Summary**: List files in a directory with size and type information.

**Feature contract**: `list [path]` → prints each entry with `<DIR>` marker for directories and byte count for files. On colour terminals, directories are shown in a different colour.

**Dependencies**: `fs`, `term`, `colors`

**Priority**: essential

---

### lua (REPL)

**Summary**: Interactive Lua/JavaScript REPL with history, expression pretty-printing, and tab completion.

**Feature contract**:
- Prompt: `lua> `
- Accepts expressions (auto-wraps in `return`), statements, and multiline input.
- Tab-completes using `textutils.complete` against the REPL environment.
- Pretty-prints results using `cc/pretty`.
- On error, shows parse/runtime error with source annotation.
- `exit()` or Ctrl+D exits the REPL.

**CC-specific behaviour**:
- `exit` variable prints a hint when displayed.
- `local` at the start of input shows a warning (locals are lost between lines).
- Function args and source are shown if `lua.function_args`/`lua.function_source` settings are set.

**Dependencies**: `cc/pretty`, `cc/internal/exception`, `cc/internal/syntax`, `textutils`, `settings`

**Priority**: important

---

### mkdir

**Summary**: Create one or more directories.

**Feature contract**: `mkdir <path> [paths...]` → creates each directory (and parent dirs).

**Dependencies**: `fs`

**Priority**: essential

---

### monitor

**Summary**: Run a program on an attached monitor peripheral.

**Feature contract**:
- `monitor <name> <program> [args...]` → redirects term to the monitor, runs the program there.
- `monitor scale <name> <scale>` → sets the monitor's text scale (0.5–5).
- Translates `monitor_touch` events to `mouse_click`/`mouse_up` events.
- Translates `monitor_resize` to `term_resize`.

**Dependencies**: `peripheral`, `shell`, `term`, events

**Priority**: optional

---

### motd

**Summary**: Display a "message of the day" from `/rom/motd.txt` (random line).

**Feature contract**: `motd` → reads `/rom/motd.txt`, picks a random line (or cycles), prints it with colour if available.

**Dependencies**: `fs`, `term`, `settings`

**Priority**: optional

---

### move / rename

**Summary**: Move or rename a file or directory.

**Feature contract**: `move <source> <destination>` (alias `rename`).

**Dependencies**: `fs`

**Priority**: essential

---

### peripherals

**Summary**: List all attached peripherals and their types.

**Feature contract**: `peripherals` → prints each peripheral name and its type(s).

**Dependencies**: `peripheral`

**Priority**: optional

---

### programs

**Summary**: List all programs available on the shell path.

**Feature contract**: `programs [all]` → lists programs found on `shell.path()`. With `all`, includes hidden programs.

**Dependencies**: `shell`, `fs`, `textutils`, `term`

**Priority**: important

---

### reboot / shutdown

**Summary**: Reboot or shut down the computer.

**Feature contract**: `reboot` → `os.reboot()`; `shutdown` → `os.shutdown()`.

**Dependencies**: native `os`

**Priority**: essential

---

### redstone (program)

**Summary**: Query or set redstone signal levels on any side.

**Feature contract**:
- `redstone probe` → print the input level on all sides.
- `redstone set <side> <level>` → set analogue output (0–15).
- `redstone pulse <side> <duration>` → pulse for duration seconds.

**Dependencies**: native `redstone`

**Priority**: optional

---

### set

**Summary**: View or change settings values.

**Feature contract**:
- `set` → list all defined settings with values and descriptions.
- `set <name>` → show current value and definition of a setting.
- `set <name> <value>` → set a setting value.

**Dependencies**: `settings`, `textutils`

**Priority**: important

---

### time

**Summary**: Display the current in-game time.

**Feature contract**: `time` → prints the current in-game time formatted as 12-hour.

**Dependencies**: native `os`, `textutils`

**Priority**: optional

---

### type

**Summary**: Show whether a path is a file or directory.

**Feature contract**: `type <path>` → prints "file", "directory", or "no such file".

**Dependencies**: `fs`

**Priority**: optional

---

### http/wget

**Summary**: Download a file from a URL, or run it directly.

**Feature contract**:
- `wget <url> [filename]` → downloads URL to file.
- `wget run <url> [args...]` → downloads and runs the script.

**Dependencies**: `http`, `fs`, `shell`

**Priority**: important

---

### http/pastebin

**Summary**: Upload to, download from, or run programs from pastebin.com.

**Feature contract**:
- `pastebin put <filename>` → uploads file to pastebin, prints ID.
- `pastebin get <code> <filename>` → downloads paste to file.
- `pastebin run <code> [args...]` → downloads and runs paste.

**Dependencies**: `http`, `fs`, `shell`, `textutils`

**Priority**: optional

---

### rednet/chat

**Summary**: Multi-user chat program using rednet protocols.

**Feature contract**:
- `chat host <hostname>` → host a chat server; accepts join/leave/chat/command messages.
- `chat join <hostname> <nickname>` → connect to a chat server; split display (title, history, prompt).
- Supports `/me`, `/nick`, `/users`, `/help`, `/logout` commands.
- Uses ping-pong keep-alive to detect disconnected clients.

**Dependencies**: `rednet`, `parallel`, `window`, `term`, `colors`, `peripheral`

**Priority**: optional

---

### rednet/repeat

**Summary**: Rednet repeater daemon: forwards modem messages to extend wireless range.

**Feature contract**: `repeat` → opens `CHANNEL_REPEAT` on all modems, rebroadcasts unique messages to all other modems and the target channel. Runs until terminated.

**Dependencies**: `peripheral`, `rednet`, events

**Priority**: optional

---

### command/commands (program)

**Summary**: List all available Minecraft commands on a command computer.

**Feature contract**: `commands [filter]` → lists commands, optionally filtered by prefix.

**Dependencies**: native `commands`

**Priority**: optional (command computers only)

---

### command/exec

**Summary**: Execute a raw Minecraft command on a command computer.

**Feature contract**: `exec <command...>` → calls `commands.exec(command)`, prints output.

**Dependencies**: native `commands`

**Priority**: optional (command computers only)

---

### fun/adventure

**Summary**: A text-adventure game.

**Feature contract**: Standalone text game; no external API dependencies beyond basic I/O.

**Dependencies**: `term`, `read`, `print`

**Priority**: optional

---

### fun/dj

**Summary**: Play music discs on a disk drive via commands.

**Feature contract**:
- `dj play [drive]` → plays the disc in the given (or any) drive.
- `dj stop [drive]` → stops playback.

**Dependencies**: `disk`, `peripheral`

**Priority**: optional

---

### fun/hello

**Summary**: Hello World demo.

**Feature contract**: Prints "Hello, World!" to the terminal.

**Priority**: optional

---

### fun/speaker

**Summary**: Play audio files or Minecraft sounds through a speaker peripheral.

**Feature contract**:
- `speaker play <file|url> [speaker]` → streams a DFPWM or WAV file to a speaker.
- `speaker sound <sound> [volume] [pitch] [speaker]` → plays a Minecraft sound event.
- `speaker stop [speaker]` → stops playback.
- Supports DFPWM and 8-bit mono 48 kHz WAV input.
- Detects and rejects Ogg, FLAC, MP3.

**Dependencies**: `peripheral`, `http`, `fs`, `cc/audio/dfpwm`, `cc/pretty`

**Priority**: optional

---

### fun/worm

**Summary**: Classic snake/worm game on the terminal.

**Feature contract**: Arrow-key-controlled snake game. Requires colour terminal.

**Dependencies**: `term`, `colors`, `keys`, events

**Priority**: optional

---

### fun/advanced/paint

**Summary**: Pixel art editor for `.nfp` files using the mouse.

**Feature contract**:
- Opens or creates an `.nfp` paint file.
- Mouse left-click draws with the selected colour; right-click erases.
- Colour palette displayed on right or bottom.
- Menu bar (Ctrl or menu click): Save, Exit.
- Requires colour terminal.

**Dependencies**: `term`, `fs`, `colors`, `paintutils`, `keys`, `cc/internal/menu`, `settings`

**Priority**: optional

---

### fun/advanced/redirection

**Summary**: A puzzle game demonstrating redstone and redirection concepts.

**Feature contract**: Interactive demo/game on a colour Advanced Computer.

**Dependencies**: `term`, `colors`, `keys`

**Priority**: optional

---

### pocket/equip, pocket/unequip

**Summary**: Equip or unequip a pocket computer upgrade.

**Feature contract**:
- `equip` → calls `pocket.equipBack()`.
- `unequip` → calls `pocket.unequipBack()`.

**Dependencies**: native `pocket`

**Priority**: optional (pocket computers only)

---

### pocket/falling

**Summary**: Demonstrates the pocket computer's accelerometer (falls with gravity).

**Feature contract**: Reads accelerometer data and animates the display.

**Dependencies**: native `pocket`, `term`

**Priority**: optional

---

### turtle/craft

**Summary**: Craft items using the turtle's inventory and an attached workbench.

**Feature contract**: `craft [count]` → calls `turtle.craft(count)`.

**Dependencies**: native `turtle`

**Priority**: optional (turtle only)

---

### turtle/dance

**Summary**: Makes the turtle dance (performs random movement pattern).

**Feature contract**: Runs a scripted sequence of turtle movements.

**Dependencies**: native `turtle`

**Priority**: optional

---

### turtle/equip / turtle/unequip

**Summary**: Equip or unequip an item from the turtle's inventory into a peripheral slot.

**Feature contract**:
- `equip <slot> [left|right]` → calls `turtle.equipLeft()` or `turtle.equipRight()`.
- `unequip [left|right]` → equips an empty slot to remove the peripheral.

**Dependencies**: native `turtle`

**Priority**: optional (turtle only)

---

### turtle/excavate

**Summary**: Mine a square quarry of configurable diameter down to bedrock, auto-refuelling and auto-depositing.

**Feature contract**: `excavate <diameter>` → mines a NxN shaft, deposits in chest behind start, refuels from inventory, returns home when done.

**Dependencies**: native `turtle`

**Priority**: optional

---

### turtle/go

**Summary**: Move the turtle a given number of steps in specified directions.

**Feature contract**: `go <direction> [n] [direction] [n]...` → directions: `forward`, `back`, `up`, `down`, `left`, `right`.

**Dependencies**: native `turtle`

**Priority**: optional

---

### turtle/refuel

**Summary**: Refuel the turtle from inventory items.

**Feature contract**: `refuel [count]` → calls `turtle.refuel(count)` on each slot until fuel is restored.

**Dependencies**: native `turtle`

**Priority**: optional

---

### turtle/tunnel

**Summary**: Dig a 1×2 tunnel of given length forward, supporting walls, floor, and ceiling.

**Feature contract**: `tunnel <length>` → mines forward the given number of blocks in a 1-wide 2-tall shaft.

**Dependencies**: native `turtle`

**Priority**: optional

---

### turtle/turn

**Summary**: Turn the turtle left or right one or more times.

**Feature contract**: `turn <left|right> [n]` → turns the turtle `n` times (default 1).

**Dependencies**: native `turtle`

**Priority**: optional

---

## Settings Reference

The following settings are read by ROM programs:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `motd.enable` | boolean | true | Show MOTD on boot |
| `shell.allow_startup` | boolean | true | Run user startup files |
| `shell.allow_disk_startup` | boolean | true | Run disk startup files |
| `shell.autocomplete_hidden` | boolean | false | Tab-complete hidden files |
| `edit.default_extension` | string | `"lua"` | Extension added to new files in edit |
| `paint.default_extension` | string | `"nfp"` | Extension added to new files in paint |
| `lua.autocomplete` | boolean | true | Tab completion in the Lua REPL |
| `lua.function_args` | boolean | false | Show function args in pretty-print |
| `lua.function_source` | boolean | false | Show function source in pretty-print |
| `lua.warn_against_use_of_local` | boolean | true | Warn about `local` in REPL |

---

## Event Reference

Events that the ROM layer produces or consumes:

| Event | Fields | Description |
|-------|--------|-------------|
| `key` | `keyCode: number, held: boolean` | Key pressed |
| `key_up` | `keyCode: number` | Key released |
| `char` | `char: string` | Character typed |
| `mouse_click` | `button: number, x: number, y: number` | Mouse button pressed (1-indexed coords) |
| `mouse_up` | `button, x, y` | Mouse button released |
| `mouse_scroll` | `direction: number, x, y` | Mouse wheel |
| `mouse_drag` | `button, x, y` | Mouse dragged |
| `paste` | `text: string` | Clipboard paste |
| `terminate` | — | Ctrl+T: terminate current program |
| `timer` | `id: number` | `setTimeout`-style timer fired |
| `modem_message` | `side, channel, replyChannel, message, distance` | Raw modem packet |
| `rednet_message` | `senderId: number, message: any, protocol: string` | High-level rednet message |
| `http_success` | `url: string, response: Response` | HTTP request succeeded |
| `http_failure` | `url: string, error: string, response?: Response` | HTTP request failed |
| `http_check` | `url: string, ok: boolean, reason?: string` | URL check result |
| `websocket_success` | `url: string, ws: WebSocket` | WS connection opened |
| `websocket_failure` | `url: string, error: string` | WS connection failed |
| `websocket_message` | `url: string, message: string, binary: boolean` | WS message received |
| `websocket_closed` | `url: string` | WS connection closed |
| `peripheral` | `name: string` | Peripheral attached |
| `peripheral_detach` | `name: string` | Peripheral removed |
| `monitor_touch` | `name, x, y` | Touch screen tapped |
| `monitor_resize` | `name: string` | Monitor resized |
| `term_resize` | — | Terminal resized |
| `speaker_audio_empty` | — | Speaker buffer exhausted, can send more |
| `file_transfer` | `files: TransferredFile[]` | Files dragged onto computer |
| `setting_changed` | `name: string, new: any, old: any` | Settings value changed |
| `redstone` | `side?: string` | Redstone input changed |
| `disk` | `side: string` | Disk inserted |
| `disk_eject` | `side: string` | Disk ejected |
| `turtle_inventory` | — | Turtle inventory changed |

---

## Terminal Coordinate Convention

- The CC terminal uses **1-indexed** `(x, y)` coordinates internally.
- The JS native `term` module exposes **0-indexed** coordinates at the Java boundary.
- The `term` API layer (and all programs) must always use 1-indexed coordinates.
- The conversion (`-1` on write, `+1` on read) happens at the native module boundary.

---

## Parallelism Model

CC: Rhino has no Lua coroutines. The mapping is:

| Lua/CC concept | JS/Rhino equivalent |
|---|---|
| `os.pullEvent()` | Rhino continuation; suspends until event arrives |
| `parallel.waitForAny/All` | Multiple Rhino continuation contexts, resumed by event dispatcher |
| `rednet.run()` background daemon | `events.on("modem_message", ...)` persistent listener |
| Timer (`os.startTimer`) | `setTimeout`; fires a `timer` event into the event queue |
| `sleep(n)` | Continuation that resumes after `setTimeout(n * 1000)` |
| Coroutine filter (yield value) | Continuation stores a filter string; dispatcher skips non-matching events |
