// SPDX-FileCopyrightText: 2023 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package cc.tweaked.web.peripheral;

import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.api.scripting.ScriptTable;
import dan200.computercraft.api.peripheral.IComputerAccess;
import dan200.computercraft.api.peripheral.IPeripheral;
import org.checkerframework.checker.nullness.qual.MonotonicNonNull;
import org.jspecify.annotations.Nullable;
import org.teavm.jso.webaudio.AudioContext;

import java.util.Optional;

import static dan200.computercraft.api.scripting.ScriptValues.checkFinite;

/**
 * A minimal speaker peripheral, which implements {@code playAudio} and nothing else.
 */
public class SpeakerPeripheral implements TickablePeripheral {
    public static final int SAMPLE_RATE = 48000;

    private static @MonotonicNonNull AudioContext audioContext;

    private @Nullable IComputerAccess computer;

    private @Nullable AudioState state;

    @Override
    public String getType() {
        return "speaker";
    }

    @Override
    public void attach(IComputerAccess computer) {
        this.computer = computer;
    }

    @Override
    public void detach(IComputerAccess computer) {
        this.computer = null;
    }

    @Override
    public void tick() {
        if (state != null && state.shouldSendPending()) {
            state.playNext();
            if (computer != null) computer.queueEvent("speaker_audio_empty", computer.getAttachmentName());
        }
    }

    @ScriptFunction
    @SuppressWarnings("DoNotCallSuggester")
    public final boolean playNote(String instrumentA, Optional<Double> volumeA, Optional<Double> pitchA) throws ScriptException {
        throw new ScriptException("Cannot play notes outside of Minecraft");
    }

    @ScriptFunction
    @SuppressWarnings("DoNotCallSuggester")
    public final boolean playSound(String name, Optional<Double> volumeA, Optional<Double> pitchA) throws ScriptException {
        throw new ScriptException("Cannot play sounds outside of Minecraft");
    }

    @ScriptFunction(unsafe = true)
    public final boolean playAudio(ScriptTable<?, ?> audio, Optional<Double> volume) throws ScriptException {
        checkFinite(1, volume.orElse(0.0));

        var length = audio.length();
        if (length <= 0) throw new ScriptException("Cannot play empty audio");
        if (length > 128 * 1024) throw new ScriptException("Audio data is too large");

        if (audioContext == null) audioContext = new AudioContext();
        if (state == null || !state.isPlaying()) state = new AudioState(audioContext);

        return state.pushBuffer(audio, length, volume);
    }

    @ScriptFunction
    public final void stop() {
        // TODO: Not sure how to do this.
    }

    @Override
    public boolean equals(@Nullable IPeripheral other) {
        return other instanceof SpeakerPeripheral;
    }
}
