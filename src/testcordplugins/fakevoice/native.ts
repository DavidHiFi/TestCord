/* eslint-disable simple-header/header -- This permitted fork uses the MIT license. */
/*
 * FakeVoice user plugin
 * Original plugin by deracul; maintained by DavidHiFi
 * SPDX-License-Identifier: MIT
 *
 * Main-process (native) side of FakeVoice.
 *
 * The fake states themselves live in the renderer, so this module does not
 * implement them: it exposes the renderer's `window.__fakeVoice` API (installed
 * by index.tsx) to outside controllers over a tiny loopback HTTP API, and adds
 * optional system-wide hotkeys. Both paths call the same functions the user-area
 * context menu calls, so behaviour is identical.
 *
 *   GET /fakevoice/ping
 *   GET /fakevoice/state
 *   GET /fakevoice/toggle/<mute|deafen|camera|stream|game>
 *   GET /fakevoice/set/<kind>/<0|1>
 *
 * Bound to 127.0.0.1 only. Nothing is sent anywhere; Toggling goes straight back
 * into this process's renderer.
 */

import { app, BrowserWindow, globalShortcut } from "electron";
import * as http from "http";

const HOST = "127.0.0.1";
const PORT = 47830;
const LOG_PREFIX = "[FakeVoice][bridge]";

const KINDS = ["mute", "deafen", "camera", "stream", "game"] as const;
type FakeKind = (typeof KINDS)[number];

/** Optional system-wide hotkeys. Safe to delete if they clash with something. */
const HOTKEYS: Record<string, FakeKind> = {
    "Control+Alt+Shift+F9": "mute",
    "Control+Alt+Shift+F10": "deafen",
    "Control+Alt+Shift+F11": "camera",
    "Control+Alt+Shift+F12": "stream",
    "Control+Alt+Shift+F8": "game"
};

function isKind(value: string): value is FakeKind {
    return (KINDS as readonly string[]).includes(value);
}

function rendererWindows(): BrowserWindow[] {
    return BrowserWindow.getAllWindows().filter(
        win => !win.isDestroyed() && !win.webContents.isDestroyed()
    );
}

/**
 * Runs the expression in every live window until one answers. The main Discord
 * window holds the renderer; other windows (popouts) simply return null.
 */
async function callRenderer(expression: string): Promise<unknown> {
    for (const win of rendererWindows()) {
        try {
            const result = await win.webContents.executeJavaScript(expression, true);
            if (result !== null && result !== undefined) return result;
        } catch {
            // Not a window that hosts the plugin renderer; try the next one.
        }
    }
    return null;
}

function stateExpression(): string {
    return "window.__fakeVoice ? JSON.stringify(window.__fakeVoice.state()) : null";
}

function toggleExpression(kind: FakeKind): string {
    return `window.__fakeVoice ? JSON.stringify(window.__fakeVoice.toggle(${JSON.stringify(kind)})) : null`;
}

function setExpression(kind: FakeKind, value: boolean): string {
    return `window.__fakeVoice ? JSON.stringify(window.__fakeVoice.set(${JSON.stringify(kind)}, ${value})) : null`;
}

const NOT_LOADED = {
    ok: false,
    error: "FakeVoice is not loaded in the Discord renderer (plugin disabled or Discord still starting)"
};

function send(res: http.ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(json),
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store"
    });
    res.end(json);
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", `http://${HOST}:${PORT}`).pathname.replace(/\/+$/, "") || "/";

    if (path === "/fakevoice/ping") {
        return send(res, 200, { ok: true, plugin: "FakeVoice", port: PORT });
    }

    if (path === "/fakevoice/state") {
        const raw = await callRenderer(stateExpression());
        if (typeof raw !== "string") return send(res, 503, NOT_LOADED);
        return send(res, 200, JSON.parse(raw));
    }

    const toggleMatch = /^\/fakevoice\/toggle\/([a-z]+)$/.exec(path);
    if (toggleMatch) {
        const kind = toggleMatch[1];
        if (!isKind(kind)) return send(res, 400, { ok: false, error: `Unknown fake state "${kind}"` });

        const raw = await callRenderer(toggleExpression(kind));
        if (typeof raw !== "string") return send(res, 503, NOT_LOADED);
        return send(res, 200, { ok: true, kind, state: JSON.parse(raw) });
    }

    const setMatch = /^\/fakevoice\/set\/([a-z]+)\/([01])$/.exec(path);
    if (setMatch) {
        const kind = setMatch[1];
        if (!isKind(kind)) return send(res, 400, { ok: false, error: `Unknown fake state "${kind}"` });

        const value = setMatch[2] === "1";
        const raw = await callRenderer(setExpression(kind, value));
        if (typeof raw !== "string") return send(res, 503, NOT_LOADED);
        return send(res, 200, { ok: true, kind, value, state: JSON.parse(raw) });
    }

    send(res, 404, { ok: false, error: `No route for ${path}` });
}

let server: http.Server | null = null;

function startServer(): void {
    if (server) return;

    server = http.createServer((req, res) => {
        handleRequest(req, res).catch(err => {
            console.error(LOG_PREFIX, "request failed:", err);
            try { send(res, 500, { ok: false, error: "Internal bridge error" }); } catch { /* response already sent */ }
        });
    });

    server.on("error", err => {
        console.error(LOG_PREFIX, `HTTP server error on ${HOST}:${PORT}:`, err);
        server = null;
    });

    server.listen(PORT, HOST, () => console.log(`${LOG_PREFIX} listening on http://${HOST}:${PORT}`));
}

function stopServer(): void {
    if (!server) return;
    try { server.close(); } catch { /* already closed */ }
    server = null;
}

function registerHotkeys(): void {
    for (const [accelerator, kind] of Object.entries(HOTKEYS)) {
        try {
            if (!globalShortcut.register(accelerator, () => { void callRenderer(toggleExpression(kind)); })) {
                console.warn(`${LOG_PREFIX} hotkey ${accelerator} is already taken; not registered`);
            }
        } catch (err) {
            console.warn(`${LOG_PREFIX} hotkey ${accelerator} failed:`, err);
        }
    }
}

function unregisterHotkeys(): void {
    // Only ours: unregisterAll() would also drop Discord's own global hotkeys.
    for (const accelerator of Object.keys(HOTKEYS)) {
        try { globalShortcut.unregister(accelerator); } catch { /* not registered */ }
    }
}

startServer();
app.whenReady().then(registerHotkeys);

app.on("before-quit", () => {
    unregisterHotkeys();
    stopServer();
});
