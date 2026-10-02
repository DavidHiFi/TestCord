/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { classes } from "@utils/misc";

import { GctrapStore } from "../store";
import { LogEntry } from "../types";
import { cl } from "../utils";

function timeOf(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function LogRow({ entry }: { entry: LogEntry; }) {
    return (
        <div className={classes(cl("log-row"), cl(entry.kind))}>
            <span className={cl("log-time")}>{timeOf(entry.ts)}</span>
            <span className={cl("log-group")}>{entry.group}</span>
            <span className={cl("log-text")}>{entry.text}</span>
        </div>
    );
}

export default function LogTab() {
    const log = GctrapStore(state => state.log);
    const clear = GctrapStore(state => state.clearLog);

    return (
        <div className={cl("log")}>
            <div className={cl("log-head")}>
                <span className={cl("hint")}>Newest first, the last 100 events only.</span>
                <Button size="xs" variant="secondary" disabled={!log.length} onClick={clear}>Clear</Button>
            </div>
            <div className={cl("log-list")}>
                {log.slice().reverse().map(entry => <LogRow key={entry.id} entry={entry} />)}
                {!log.length && <div className={cl("empty")}>Nothing has happened yet.</div>}
            </div>
        </div>
    );
}
