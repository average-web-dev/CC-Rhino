// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `commands` — run Minecraft commands (command computers). Blocking (main thread).

/** Result of executing a command. */
interface ExecResult {
    ok: boolean;
    /** The command's output, line by line. */
    output: string[];
    /** Number of affected objects, if the command reported one. */
    affected?: number;
}

/** A 3D block position. */
interface BlockPos {
    x: number;
    y: number;
    z: number;
}

interface CommandsModule {
    exec(command: string): ExecResult;
    /** Run a command asynchronously; returns a task id that later fires a `task_complete` event. */
    execAsync(command: string): number;

    list(...subcommand: string[]): string[];

    getDimension(): string;
    getBlockPosition(): BlockPos;

    getBlockInfo(x: number, y: number, z: number, dimension?: string): Details;
    getBlockInfos(
        minX: number, minY: number, minZ: number,
        maxX: number, maxY: number, maxZ: number,
        dimension?: string,
    ): Details[];

    getEntities(selector: string): Details[];
}
