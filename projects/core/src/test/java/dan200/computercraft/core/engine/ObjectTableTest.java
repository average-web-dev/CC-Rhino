// SPDX-FileCopyrightText: 2026 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.ObjectTable;

import java.util.Map;

class ObjectTableTest implements TableContract<ObjectTable> {
    @Override
    public ObjectTable create(Map<?, ?> map) {
        return new ObjectTable(map);
    }
}
