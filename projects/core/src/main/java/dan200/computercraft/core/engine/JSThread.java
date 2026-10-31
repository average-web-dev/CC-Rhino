// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import org.jspecify.annotations.Nullable;

import java.util.ArrayDeque;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * A green thread of the JS machine.
 *
 * <p>Threads form a tree rooted at the machine's {@linkplain #isRoot() root thread}, which runs the bios and every
 * piece of work not started inside another thread. A thread is created by {@code parallel.waitFor*} (as a member of a
 * {@link JSTaskGroup}) or by {@code parallel.spawn}, and is a child of the thread that created it.
 *
 * <p>Everything the event loop holds on behalf of JS — parked continuations, {@code events.on} listeners, queued
 * microtasks and {@code setImmediate} callbacks — is tagged with the thread that created it. This makes stopping a
 * thread real: {@linkplain EventLoop#kill killing} it discards all work owned by it and its descendants, so nothing it
 * started ever runs again.
 *
 * <p>A thread ends in one of two ways:
 * <ul>
 *   <li>{@link State#RETURNED}: its function returned. Work it leaves behind (listeners, child threads, listener
 *   invocations still parked) is inherited by its parent, like an orphaned process; see {@link #effective()}.</li>
 *   <li>{@link State#KILLED}: it threw an uncaught error or was stopped. All work owned by it and its descendants is
 *   discarded.</li>
 * </ul>
 */
final class JSThread {
    enum State {
        RUNNING, RETURNED, KILLED,
    }

    final int id;
    /** The thread that owns this one, or {@code null} for the root thread. Updated when the parent returns. */
    @Nullable JSThread parent;
    final Set<JSThread> children = new LinkedHashSet<>();
    /** The group this thread is a member of, or {@code null} for the root thread and spawned threads. */
    final @Nullable JSTaskGroup group;
    /** The thread's position within its {@link #group}. */
    final int index;

    State state = State.RUNNING;
    /** The uncaught JS error this thread failed with, if any. */
    @Nullable Object error;
    /**
     * A script value set with {@code internal/loop.setContext} (the ROM's job: its TTY, argv, working directory),
     * inherited by every descendant; see {@link #context()}.
     */
    @Nullable Object context;
    /** The TTY the program in this thread runs on (set with the context; 0 = none), for routing Ctrl+C. */
    int terminal;

    JSThread(int id, @Nullable JSThread parent, @Nullable JSTaskGroup group, int index) {
        this.id = id;
        this.parent = parent;
        this.group = group;
        this.index = index;
        if (parent != null) parent.children.add(this);
    }

    boolean isRoot() {
        return parent == null;
    }

    /**
     * The thread that currently owns work created by this one: this thread while it runs, otherwise the nearest
     * ancestor that has not returned. A killed thread is its own effective owner.
     */
    JSThread effective() {
        var thread = this;
        while (thread.state == State.RETURNED && thread.parent != null) thread = thread.parent;
        return thread;
    }

    /** Whether work created by this thread has been discarded, i.e. its effective owner was killed. */
    boolean isDead() {
        return effective().state == State.KILLED;
    }

    /**
     * Whether this thread is part of the foreground of its program, i.e. it and all its ancestors up to the root, or up
     * to the thread a program runs in (one with its own {@link #context}), are being waited for by a
     * {@code parallel.waitFor*} call. Only foreground threads receive {@code terminate}; spawned background threads of a
     * program and their descendants do not.
     */
    boolean isForeground() {
        for (var thread = this; thread.parent != null; thread = thread.parent) {
            if (thread.context != null) return true;
            if (thread.group == null) return false;
        }
        return true;
    }

    /** Mark this thread and all its descendants as killed, detaching it from its parent. */
    void markKilled() {
        if (parent != null) parent.children.remove(this);
        var queue = new ArrayDeque<JSThread>();
        queue.add(this);
        while (!queue.isEmpty()) {
            var thread = queue.poll();
            thread.state = State.KILLED;
            queue.addAll(thread.children);
            thread.children.clear();
        }
    }

    /** The TTY of this thread: its own, or the nearest ancestor's (0 if none). */
    int terminal() {
        for (var thread = this; thread != null; thread = thread.parent) {
            if (thread.terminal != 0) return thread.terminal;
        }
        return 0;
    }

    /** The context of this thread: its own, or the nearest ancestor's. */
    @Nullable Object context() {
        for (var thread = this; thread != null; thread = thread.parent) {
            if (thread.context != null) return thread.context;
        }
        return null;
    }

    /** Mark this thread as returned, handing its children over to its parent (they keep this thread's context). */
    void markReturned() {
        state = State.RETURNED;
        var newParent = parent;
        if (newParent == null) return;
        newParent.children.remove(this);
        var inherited = context();
        var inheritedTerminal = terminal();
        for (var child : children) {
            if (child.context == null) child.context = inherited;
            if (child.terminal == 0) child.terminal = inheritedTerminal;
            child.parent = newParent;
            newParent.children.add(child);
        }
        children.clear();
    }

    @Override
    public String toString() {
        return "JSThread#" + id + "[" + state + "]";
    }
}
