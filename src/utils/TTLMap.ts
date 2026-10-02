/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A Map whose entries expire after a given amount of time. When an entry expires, it is automatically removed from the map and an optional callback is called.
 *
 * Expiry is driven by a single re-armed timer that fires at the earliest pending
 * deadline, not one `setTimeout` per entry. The old shape kept N live timers for
 * N entries, so a cache keyed per track/per message paid N timer registrations and
 * N wakeups to expire them; with a bounded map that is N wakeups the event loop
 * has no reason to schedule. Overwriting a key also no longer has to clear a
 * stale timer, and expiry order is exact.
 *
 * `maxSize` evicts the oldest insertion once the map exceeds it, so a keyspace
 * that never repeats (track ids, message ids, urls) cannot grow forever.
 */
export class TTLMap<K, V> extends Map<K, V> {
    private readonly deadlines = new Map<K, number>();
    private timer: ReturnType<typeof setTimeout> | null = null;
    /** Earliest pending deadline, or null when nothing is scheduled. */
    private earliest: number | null = null;

    public constructor(
        public readonly expiryMs: number,
        private readonly onExpire?: (key: K, value: V) => void,
        public readonly maxSize = Infinity,
    ) {
        super();
    }

    public set(key: K, value: V) {
        const now = Date.now();
        const isNewKey = !this.deadlines.has(key);
        const deadline = now + this.expiryMs;

        this.deadlines.set(key, deadline);
        super.set(key, value);

        let evictedEarliest = false;
        if (isNewKey) {
            while (this.deadlines.size > this.maxSize) {
                // deadlines is insertion-ordered, so the first key is the oldest.
                const oldest = this.deadlines.keys().next();
                if (oldest.done) break;
                if (this.deadlines.get(oldest.value) === this.earliest) evictedEarliest = true;
                this.expire(oldest.value);
            }
        }

        // Only the earliest deadline decides when the timer fires, and a normal
        // insert lands at or after it (every entry shares `expiryMs`, so a newer
        // key is never sooner than an older one). Re-arming unconditionally made
        // every insert a clearTimeout + setTimeout pair for no change at all;
        // this keeps it to the inserts that actually move the deadline, and to
        // the removals that could remove it.
        if (evictedEarliest || this.earliest === null || deadline < this.earliest) this.rearm(now);
        return this;
    }

    public delete(key: K) {
        const wasEarliest = this.deadlines.get(key) === this.earliest;
        this.deadlines.delete(key);
        const deleted = super.delete(key);
        if (wasEarliest) this.rearm(Date.now());
        return deleted;
    }

    clear(): void {
        this.deadlines.clear();
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.earliest = null;
        return super.clear();
    }

    private expire(key: K) {
        if (!this.deadlines.delete(key)) return;
        const value = super.get(key);
        super.delete(key);
        if (value !== undefined) this.onExpire?.(key, value);
    }

    /** Recompute the earliest pending deadline and re-arm the timer for it. */
    private rearm(now: number) {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.earliest = null;

        if (!this.deadlines.size) return;

        let earliest = Infinity;
        for (const deadline of this.deadlines.values()) {
            if (deadline < earliest) earliest = deadline;
        }
        if (earliest === Infinity) return;

        this.earliest = earliest;
        // Floor at 0: a backwards clock jump would otherwise ask for a negative
        // delay, which the platform coerces into an immediate spin.
        this.timer = setTimeout(() => {
            this.timer = null;
            this.sweep();
        }, Math.max(0, earliest - now));
    }

    private sweep() {
        const now = Date.now();

        // Re-check deadlines on every entry: the map may have grown and shrunk
        // since the timer was armed, and an entry can be overwritten in place
        // (which moves its deadline without changing its position).
        for (const key of [...this.deadlines.keys()]) {
            const deadline = this.deadlines.get(key);
            if (deadline === undefined) continue;
            if (deadline > now) continue;
            this.deadlines.delete(key);
            const value = super.get(key);
            super.delete(key);
            if (value !== undefined) this.onExpire?.(key, value);
        }

        this.rearm(now);
    }

    /** Earliest pending expiry deadline, or 0 when nothing is scheduled. */
    public get nextExpiry(): number {
        return this.earliest ?? 0;
    }
}
