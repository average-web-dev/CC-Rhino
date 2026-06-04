// SPDX-FileCopyrightText: 2017 Daniel Ratcliffe
//
// SPDX-License-Identifier: LicenseRef-CCPL

// Interact with disk drives — mirrors the CC Lua disk API. Works on locally
// attached drives (by side, e.g. "left") or remote drives (by name, e.g.
// "drive_0"). Functions are async because they go through peripheral.call.

import peripheral from "/rom/apis/peripheral.js";

async function isDrive(name) {
    if (typeof name !== "string") {
        throw new Error(`bad argument #1 (string expected, got ${type(name)})`);
    }
    return (await peripheral.getType(name))?.[0] === "drive";
}

// Checks whether any item at all is in the disk drive.
async function isPresent(name) {
    if (await isDrive(name)) return peripheral.call(name, "isDiskPresent");
    return false;
}

// Get the label of the media within the given disk drive, or null.
async function getLabel(name) {
    if (await isDrive(name)) return peripheral.call(name, "getDiskLabel");
    return null;
}

// Set the label of the floppy disk or other media.
async function setLabel(name, label) {
    if (await isDrive(name)) await peripheral.call(name, "setDiskLabel", label);
}

// Check whether the current disk provides a mount (disks and computers, not records).
async function hasData(name) {
    if (await isDrive(name)) return peripheral.call(name, "hasData");
    return false;
}

// Find the local directory where the contents of the current mount can be found, or null.
async function getMountPath(name) {
    if (await isDrive(name)) return peripheral.call(name, "getMountPath");
    return null;
}

// Whether the current disk is a music disc.
async function hasAudio(name) {
    if (await isDrive(name)) return peripheral.call(name, "hasAudio");
    return false;
}

// Get the title of the audio track in the drive (false if not a record, null if no drive).
async function getAudioTitle(name) {
    if (await isDrive(name)) return peripheral.call(name, "getAudioTitle");
    return null;
}

// Starts playing the music record in the drive.
async function playAudio(name) {
    if (await isDrive(name)) await peripheral.call(name, "playAudio");
}

// Stops the music record in the drive (or all drives if no name is given).
async function stopAudio(name) {
    if (!name) {
        for (const sName of await peripheral.getNames()) await stopAudio(sName);
    } else if (await isDrive(name)) {
        await peripheral.call(name, "stopAudio");
    }
}

// Ejects any item currently in the drive.
async function eject(name) {
    if (await isDrive(name)) await peripheral.call(name, "ejectDisk");
}

// Returns a number which uniquely identifies the disk in the drive, or null.
async function getID(name) {
    if (await isDrive(name)) return peripheral.call(name, "getDiskID");
    return null;
}

export default {
    isPresent, getLabel, setLabel, hasData, getMountPath, hasAudio,
    getAudioTitle, playAudio, stopAudio, eject, getID,
};
