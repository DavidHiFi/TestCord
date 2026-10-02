/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NativeSettings } from "@main/settings";
import { spawn } from "child_process";
import { dialog } from "electron";
import { existsSync, mkdirSync, readdirSync,readFileSync } from "fs";
import { mkdir, readdir, rm } from "fs/promises";
import { basename, join, sep } from "path";

import { type Commit, parseRepoLink, type PluginMeta } from "./repo";

const IS_WINDOWS = process.platform === "win32";

function repoRoot() {
    const candidates = [join(__dirname, "../.."), join(__dirname, ".."), process.cwd()];
    for (const candidate of candidates) {
        if (existsSync(join(candidate, "package.json")) && existsSync(join(candidate, "src"))) return candidate;
    }
    return join(__dirname, "..");
}

function userpluginsDir() {
    const dir = join(repoRoot(), "src", "userplugins");
    if (!existsSync(dir)) {
        try {
            mkdirSync(dir, { recursive: true });
        } catch { }
    }
    return dir;
}

/** Every directory argument crosses the IPC boundary, so it gets checked against the root. */
function pluginDir(directory: string) {
    const root = userpluginsDir();
    if (!directory || basename(directory) !== directory || directory.includes("..")) {
        throw new Error("Invalid plugin name");
    }

    const dir = join(root, directory);
    if (!dir.startsWith(root + sep)) throw new Error("Invalid plugin name");
    return dir;
}

function gitPath() {
    return NativeSettings.store.plugins?.UserpluginInstaller?.gitPath || "git";
}

export async function setGitPath(_: unknown, path: string) {
    if (!NativeSettings.store.plugins.UserpluginInstaller) {
        NativeSettings.store.plugins.UserpluginInstaller = { gitPath: undefined };
    }
    NativeSettings.store.plugins.UserpluginInstaller.gitPath = path.trim() || undefined;
}

/** argv arrays only, never a shell string, so a configured path cannot smuggle in commands */
function run(command: string, args: string[], cwd: string) {
    return new Promise<{ code: number; out: string; err: string }>((resolve, reject) => {
        const proc = spawn(command, args, { cwd, shell: false, windowsHide: true });

        let out = "";
        let err = "";
        proc.stdout?.on("data", chunk => { out += String(chunk); });
        proc.stderr?.on("data", chunk => { err += String(chunk); });
        proc.on("error", reject);
        proc.once("close", code => resolve({ code: code ?? -1, out, err }));
    });
}

function git(args: string[], cwd: string) {
    return run(gitPath(), args, cwd);
}

function readMeta(directory: string, path: string): PluginMeta {
    const files = readdirSync(path);
    const entry = files.find(file => ["index.ts", "index.tsx", "index.js", "index.jsx"].includes(file));
    if (!entry) throw new Error("No index file found");

    const source = readFileSync(join(path, entry), "utf8");

    let remote = "";
    const configPath = join(path, ".git", "config");
    if (existsSync(configPath)) {
        const config = readFileSync(configPath, "utf8");
        const url = config.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/)?.[1];
        if (url) remote = parseRepoLink(url)?.link ?? "";
    }

    return {
        directory,
        name: source.match(/name:\s*["'`]([^"'`]+)["'`]/)?.[1]?.trim() || directory,
        description: source.match(/description:\s*["'`]([^"'`]+)["'`]/)?.[1]?.trim() || "No description",
        remote,
        usesNative: files.some(file => /^native\.[jt]sx?$/.test(file)),
        usesPreSend: /onBeforeMessage|addPreSendListener/.test(source)
    };
}

async function confirm(prompt: string, detail: string, confirmLabel: string) {
    const { response } = await dialog.showMessageBox({
        type: "warning",
        message: prompt,
        detail,
        buttons: [confirmLabel, "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true
    });

    return response === 0;
}

export async function ensurePluginsDirectory() {
    await mkdir(userpluginsDir(), { recursive: true });
}

export async function getUserplugins(): Promise<PluginMeta[]> {
    const root = userpluginsDir();
    if (!existsSync(root)) return [];

    const entries = await readdir(root, { withFileTypes: true });
    const metas = await Promise.allSettled(
        entries
            .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
            .map(entry => readMeta(entry.name, join(root, entry.name)))
    );

    return metas
        .filter((result): result is PromiseFulfilledResult<PluginMeta> => result.status === "fulfilled")
        .map(result => result.value);
}

export async function clonePlugin(_: unknown, link: string): Promise<PluginMeta> {
    const parsed = parseRepoLink(link);
    if (!parsed) throw new Error("That does not look like a supported git repository");

    const target = pluginDir(parsed.repo);
    if (existsSync(target)) throw new Error(`${parsed.repo} is already installed`);

    const { code, err } = await git(["clone", parsed.link], userpluginsDir());
    if (code !== 0) {
        await rm(target, { recursive: true, force: true });
        throw new Error(err.trim() || `git clone exited with ${code}`);
    }

    return readMeta(parsed.repo, target);
}

export async function discardPlugin(_: unknown, directory: string) {
    await rm(pluginDir(directory), { recursive: true, force: true });
}

export async function removePlugin(_: unknown, directory: string) {
    const dir = pluginDir(directory);
    const meta = readMeta(directory, dir);

    if (!await confirm(`Uninstall ${meta.name}?`, `${dir}\n\nThis deletes the files from disk.`, "Uninstall")) {
        throw new Error("Cancelled");
    }

    await rm(dir, { recursive: true, force: true });
}

export async function build() {
    const result = IS_WINDOWS
        ? await run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "pnpm build"], repoRoot())
        : await run("pnpm", ["build"], repoRoot());
    if (result.code !== 0) {
        throw new Error(result.err.trim().slice(-1500) || `Build exited with ${result.code}`);
    }
}

export async function pendingCommits(_: unknown, directory: string): Promise<Commit[]> {
    const dir = pluginDir(directory);
    if (!existsSync(join(dir, ".git"))) return [];

    const fetched = await git(["fetch", "--quiet"], dir);
    if (fetched.code !== 0) return [];

    const log = await git(["log", "HEAD..@{upstream}", "--pretty=format:%an%x1f%h%x1f%s"], dir);
    if (log.code !== 0) return [];

    return log.out
        .split("\n")
        .filter(Boolean)
        .map(line => {
            const [author, shortHash, message] = line.split("\x1f");
            return { author: author ?? "", shortHash: shortHash ?? "", message: message ?? "" };
        });
}

export async function hasUpdates(_: unknown, directory: string) {
    return (await pendingCommits(_, directory)).length > 0;
}

export async function updatePlugin(_: unknown, directory: string) {
    const dir = pluginDir(directory);
    if (!existsSync(dir)) throw new Error("That plugin is not installed");
    if (!existsSync(join(dir, ".git"))) throw new Error("This plugin is maintained locally. Update it from its source collection.");

    const status = await git(["status", "--porcelain"], dir);
    if (status.code !== 0 || status.out.trim()) throw new Error("This plugin has local changes. Preserve them before updating.");

    const fetched = await git(["fetch", "--quiet"], dir);
    if (fetched.code !== 0) throw new Error("The plugin update could not be fetched.");

    const result = await git(["merge", "--ff-only", "@{upstream}"], dir);
    if (result.code !== 0) {
        throw new Error(result.err.trim() || `git rebase exited with ${result.code}`);
    }
}

export async function checkGit() {
    const { code, out, err } = await run(gitPath(), ["--version"], repoRoot());
    if (code !== 0) throw new Error(err.trim() || "git is not runnable at that path");
    return out.trim();
}
