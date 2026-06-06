---
module: [kind=event] redstone
---

<!--
SPDX-FileCopyrightText: 2021 The CC: Tweaked Developers

SPDX-License-Identifier: MPL-2.0
-->

The [`event!redstone`] event is fired whenever any redstone inputs on the computer or [relay][`redstone_relay`] change.
A separate event is fired for each side whose input changed, carrying the side name and its new input strength.

## Return values
1. [`string`]: The event name.
2. [`string`]: The side whose redstone input changed (e.g. "top", "back").
3. [`number`]: The new redstone input strength on that side, between 0 and 15.

## Example
Prints a message when a redstone input changes:
```lua
while true do
  local _, side, strength = os.pullEvent("redstone")
  print(("Redstone input on %s is now %d"):format(side, strength))
end
```

## See also
 - [The `redstone` API on computers][`module!redstone`]
 - [The `redstone_relay` peripheral][`redstone_relay`]
