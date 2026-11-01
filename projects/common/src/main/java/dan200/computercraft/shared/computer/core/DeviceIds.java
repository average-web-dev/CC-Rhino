// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.shared.computer.core;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;
import dan200.computercraft.api.peripheral.IPeripheral;
import dan200.computercraft.shared.peripheral.monitor.MonitorBlockEntity;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.entity.BlockEntity;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.Reader;
import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

/**
 * The ids of devices (peripherals), like the ids of computers and disks: {@code monitor_3}, {@code speaker_0}.
 * <p>
 * A device is identified by where it lives — the block it belongs to (dimension and position; the origin of a
 * multi-block monitor), or, for a device that is not a block (a turtle or pocket upgrade), its computer and side — and
 * its type. The first lookup assigns {@code type + "_" + n} from the {@code peripheral.<type>} counter of
 * {@link ServerContext#getNextId(String)}; later lookups return the same id, whether the device is attached to a
 * computer's side or reached through a wired network, and after a restart ({@code device_ids.json}).
 */
public final class DeviceIds {
    private static final Logger LOG = LoggerFactory.getLogger(DeviceIds.class);

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Type IDS_TOKEN = new TypeToken<Map<String, String>>() {
    }.getType();

    private final ServerContext context;
    private final Path file;
    private final Path newFile;
    private @Nullable Map<String, String> ids;

    DeviceIds(ServerContext context, Path file) {
        this.context = context;
        this.file = file;
        newFile = file.resolveSibling(file.getFileName() + ".new");
    }

    /**
     * The key of a device that is a block.
     *
     * @param level The block's level.
     * @param pos   The block's position.
     * @return The key.
     */
    public static String blockKey(Level level, BlockPos pos) {
        return level.dimension().location() + "|" + pos.getX() + "," + pos.getY() + "," + pos.getZ();
    }

    /**
     * The key of a device that is not a block, like a turtle or pocket upgrade.
     *
     * @param computerId The computer the device belongs to.
     * @param side       The side it is attached to.
     * @return The key.
     */
    public static String upgradeKey(int computerId, String side) {
        return "computer/" + computerId + "|" + side;
    }

    /**
     * The key of a device whose target ({@link IPeripheral#getTarget()}) is a block entity: its block, or the origin of
     * a multi-block monitor.
     *
     * @param target The device's target.
     * @return The key, or {@code null} if the target is not a block entity in a level.
     */
    public static @Nullable String blockKey(@Nullable Object target) {
        if (target instanceof MonitorBlockEntity monitor) {
            var level = monitor.getLevel();
            return level == null ? null : blockKey(level, monitor.getOriginPos());
        }
        if (target instanceof BlockEntity entity) {
            var level = entity.getLevel();
            return level == null ? null : blockKey(level, entity.getBlockPos());
        }
        return null;
    }

    /**
     * The id of a device: the same for every lookup with the same key and type.
     *
     * @param key  Where the device lives ({@link #blockKey(Object)}, {@link #blockKey(Level, BlockPos)},
     *             {@link #upgradeKey(int, String)}).
     * @param type The device's type.
     * @return The device's id.
     */
    public synchronized String idOf(String key, String type) {
        var ids = this.ids;
        if (ids == null) ids = this.ids = load();
        key = key + "|" + type;

        var existing = ids.get(key);
        if (existing != null) return existing;

        var id = type + "_" + context.getNextId("peripheral." + type);
        ids.put(key, id);
        save(ids);
        return id;
    }

    private Map<String, String> load() {
        if (Files.isRegularFile(file)) {
            try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
                Map<String, String> result = GSON.fromJson(reader, IDS_TOKEN);
                if (result != null) return new HashMap<>(result);
                LOG.error("Device id file {} is corrupted, device ids will change", file);
            } catch (Exception e) {
                LOG.error("Cannot load device id file '{}'", file, e);
            }
        }
        return new HashMap<>();
    }

    private void save(Map<String, String> ids) {
        // As IDAssigner: write a ".new" file, then move it over the original.
        try {
            Files.createDirectories(Objects.requireNonNull(file.getParent()));
            Files.writeString(newFile, GSON.toJson(ids), StandardCharsets.UTF_8);
            try {
                Files.move(newFile, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException | UnsupportedOperationException e) {
                Files.move(newFile, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            LOG.error("Cannot update device id file '{}'", file, e);
        }
    }
}
