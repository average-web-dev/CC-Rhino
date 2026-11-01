// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.filesystem;

import dan200.computercraft.api.filesystem.FileOperationException;
import dan200.computercraft.api.filesystem.Mount;
import dan200.computercraft.core.apis.handles.ArrayByteChannel;
import org.jspecify.annotations.Nullable;

import java.io.IOException;
import java.nio.channels.SeekableByteChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.FileTime;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentSkipListMap;

import static dan200.computercraft.api.filesystem.MountConstants.*;

/**
 * {@code /dev}: a read-only, flat directory of device files (#61). Each file is a character device whose contents
 * describe the device ({@code {"id":"speaker_4","types":["speaker"]}}); the OS names and fills them
 * ({@code internal/peripheral.setDeviceFile}).
 */
public final class DevMount implements Mount {
    private final Map<String, byte[]> files = new ConcurrentSkipListMap<>();

    /**
     * Create or replace a device file.
     *
     * @param name     The file's name.
     * @param contents Its contents.
     */
    public void put(String name, String contents) {
        files.put(name, contents.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Remove a device file.
     *
     * @param name The file's name.
     * @return Whether there was such a file.
     */
    public boolean remove(String name) {
        return files.remove(name) != null;
    }

    private byte[] file(String path) throws FileOperationException {
        if (path.isEmpty()) throw new FileOperationException(path, NOT_A_FILE);
        var contents = files.get(path);
        if (contents == null) throw new FileOperationException(path, NO_SUCH_FILE);
        return contents;
    }

    @Override
    public boolean exists(String path) {
        return path.isEmpty() || files.containsKey(path);
    }

    @Override
    public boolean isDirectory(String path) {
        return path.isEmpty();
    }

    @Override
    public void list(String path, List<String> contents) throws IOException {
        if (!path.isEmpty()) throw new FileOperationException(path, exists(path) ? NOT_A_DIRECTORY : NO_SUCH_FILE);
        contents.addAll(files.keySet());
    }

    @Override
    public long getSize(String path) throws IOException {
        return path.isEmpty() ? 0 : file(path).length;
    }

    @Override
    public SeekableByteChannel openForRead(String path) throws IOException {
        return new ArrayByteChannel(file(path));
    }

    @Override
    public BasicFileAttributes getAttributes(String path) throws IOException {
        return new DeviceAttributes(path.isEmpty(), getSize(path));
    }

    /** A directory, or a device file: {@link #isOther()} (a character device in {@code fs.Stats}). */
    private record DeviceAttributes(boolean isDirectory, long size) implements BasicFileAttributes {
        @Override
        public FileTime lastModifiedTime() {
            return EPOCH;
        }

        @Override
        public FileTime lastAccessTime() {
            return EPOCH;
        }

        @Override
        public FileTime creationTime() {
            return EPOCH;
        }

        @Override
        public boolean isRegularFile() {
            return false;
        }

        @Override
        public boolean isSymbolicLink() {
            return false;
        }

        @Override
        public boolean isOther() {
            return !isDirectory;
        }

        @Override
        public @Nullable Object fileKey() {
            return null;
        }
    }
}
