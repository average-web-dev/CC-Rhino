// SPDX-FileCopyrightText: 2017 Daniel Ratcliffe
//
// SPDX-License-Identifier: LicenseRef-CCPL

// List the programs available on the shell's path — a port of the CC Lua
// `programs` program. Pass "all" to include hidden programs.

export default async function programs(shell, ...args) {
    const bAll = args.length > 0 && args[0] === "all";
    const tPrograms = shell.programs(bAll);
    await textutils.pagedTabulate(tPrograms);
}
