/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import { ChannelType } from "@vencord/discord-types/enums";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import {
    AuthenticationStore, ChannelActions, ChannelStore, GuildChannelStore, GuildStore,
    PermissionsBits, PermissionStore, RestAPI, RTCConnectionStore, SelectedChannelStore,
    UserStore, VoiceStateStore
} from "@webpack/common";

import type { Game, SessionInfo, SpooferStats, SpoofJob, SpoofOptions, VoiceContext } from "./types";

const logger = new Logger("BadgeSpooferEngine", "#ff73fa");

const GAMES_CDN_URL = "https://cdn.discordapp.com/detectables/games.json";
const SCIENCE_URL = "/science?source=badge_spoofer";
const ME_URL = "/users/@me?with_analytics_token=true";
const JOB_KEY = "badge_spoofer_job";

const CLIENT_VERSION = "1.0.9253";
const CLIENT_BUILD_NUMBER = 594031;
const NATIVE_BUILD_NUMBER = 88414;
const OS_VERSION = "10.0.26200";
const USER_AGENT = typeof navigator !== "undefined" ? navigator.userAgent : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9253 Chrome/148.0.7778.280 Electron/42.7.1 Safari/537.36";

export class BadgeSpooferEngine {
    private static instance: BadgeSpooferEngine;

    private cachedGames: Game[] = [];
    private analyticsToken = "";
    private analyticsTokenFetchedAt = 0;
    private abortController: AbortController | null = null;
    private isRunning = false;
    private autoJoinedChannelId: string | null = null;
    private activeJob: SpoofJob | null = null;
    private cancelRequested = false;
    private resumeTimeout: ReturnType<typeof setTimeout> | null = null;
    private runPromise: Promise<void> | null = null;

    private stats: SpooferStats = {
        totalGamesClaimed: 0,
        totalHoursClaimed: 0,
        totalStreamHoursClaimed: 0,
        usedGames: [],
        fingerprint: ""
    };

    public static getInstance(): BadgeSpooferEngine {
        if (!BadgeSpooferEngine.instance) {
            BadgeSpooferEngine.instance = new BadgeSpooferEngine();
        }
        return BadgeSpooferEngine.instance;
    }

    public async init() {
        await this.loadStats();
        await this.loadJob();
    }

    public async loadStats(): Promise<SpooferStats> {
        try {
            const saved = await DataStore.get("badge_spoofer_stats");
            if (saved && typeof saved === "object") {
                this.stats = {
                    totalGamesClaimed: Number(saved.totalGamesClaimed) || 0,
                    totalHoursClaimed: Number(saved.totalHoursClaimed) || 0,
                    totalStreamHoursClaimed: Number(saved.totalStreamHoursClaimed) || 0,
                    usedGames: Array.isArray(saved.usedGames) ? saved.usedGames : [],
                    fingerprint: typeof saved.fingerprint === "string" ? saved.fingerprint : ""
                };
            }
        } catch (e) {
            logger.error("Failed to load spoofer stats:", e);
        }
        return { ...this.stats };
    }

    public async saveStats(): Promise<void> {
        try {
            await DataStore.set("badge_spoofer_stats", this.stats);
        } catch (e) {
            logger.error("Failed to save spoofer stats:", e);
        }
    }

    public getStats(): SpooferStats {
        return { ...this.stats };
    }

    private async loadJob() {
        try {
            const saved = await DataStore.get(JOB_KEY);
            if (!saved || typeof saved !== "object") {
                this.activeJob = null;
                return;
            }

            const job = saved as SpoofJob;
            if (
                !Array.isArray(job.games) ||
                job.games.length === 0 ||
                typeof job.nextIndex !== "number" ||
                job.nextIndex < 0 ||
                job.nextIndex >= job.games.length ||
                !job.options
            ) {
                await DataStore.del(JOB_KEY);
                this.activeJob = null;
                return;
            }

            this.activeJob = job;
        } catch (e) {
            logger.error("Failed to load saved spoofer job:", e);
            this.activeJob = null;
        }
    }

    private async saveJob(job: SpoofJob) {
        try {
            await DataStore.set(JOB_KEY, job);
        } catch (e) {
            logger.error("Failed to save spoofer job:", e);
        }
    }

    private async clearJob() {
        this.activeJob = null;
        try {
            await DataStore.del(JOB_KEY);
        } catch (e) {
            logger.error("Failed to clear spoofer job:", e);
        }
    }

    public hasPendingJob(): boolean {
        return this.activeJob !== null;
    }

    public getPendingJob(): SpoofJob | null {
        if (!this.activeJob) return null;
        return {
            ...this.activeJob,
            games: [...this.activeJob.games],
            options: { ...this.activeJob.options }
        };
    }

    public setFingerprint(fp: string) {
        this.stats.fingerprint = fp.trim();
        this.saveStats();
    }

    public clearHistory() {
        this.stats.totalGamesClaimed = 0;
        this.stats.totalHoursClaimed = 0;
        this.stats.totalStreamHoursClaimed = 0;
        this.stats.usedGames = [];
        this.saveStats();
    }

    public getIsRunning(): boolean {
        return this.isRunning;
    }

    public async loadGames(forceReload = false): Promise<Game[]> {
        if (this.cachedGames.length > 0 && !forceReload) {
            return this.cachedGames;
        }

        try {
            if (!forceReload) {
                const storedGames = await DataStore.get("badge_spoofer_cached_games");
                if (Array.isArray(storedGames) && storedGames.length > 0) {
                    this.cachedGames = storedGames;
                    return this.cachedGames;
                }
            }

            const response = await fetch(GAMES_CDN_URL);
            if (!response.ok) throw new Error(`HTTP ${response.status} loading games CDN`);

            const data = await response.json();
            const games: Game[] = [];
            const seen = new Set<string>();

            for (const entry of data) {
                const gid = String(entry.id || "");
                if (!/^\d+$/.test(gid) || seen.has(gid)) continue;

                const winExe = entry.executables?.find((e: any) => e.os === "win32" && e.name)?.name || "game.exe";
                seen.add(gid);
                games.push({
                    id: gid,
                    name: entry.name || `Game ${gid}`,
                    exe: winExe
                });
            }

            this.cachedGames = games;
            await DataStore.set("badge_spoofer_cached_games", games);
            return games;
        } catch (e) {
            logger.error("Failed to load games database:", e);
            return this.cachedGames;
        }
    }

    public async getAnalyticsToken(force = false): Promise<string> {
        const storeToken = (AuthenticationStore as { getAnalyticsToken?: () => string | null; }).getAnalyticsToken?.();
        if (storeToken) {
            this.analyticsToken = storeToken;
            this.analyticsTokenFetchedAt = Date.now();
            return storeToken;
        }

        const MAX_AGE = 12 * 3600 * 1000;
        if (!force && this.analyticsToken && (Date.now() - this.analyticsTokenFetchedAt < MAX_AGE)) {
            return this.analyticsToken;
        }

        try {
            const res = await Promise.race([
                RestAPI.get({ url: ME_URL }),
                sleep(5000).then(() => null)
            ]);
            const token = res?.body?.analytics_token;
            if (token && typeof token === "string") {
                this.analyticsToken = token;
                this.analyticsTokenFetchedAt = Date.now();
                return token;
            }
        } catch (e) {
            logger.warn("RestAPI get analytics token failed, attempting fallback:", e);
        }

        try {
            const token = (AuthenticationStore as any)?.getToken?.() || (findStoreLazy("AuthenticationStore") as any)?.getToken?.();
            if (token) {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 5000);
                const res = await fetch("https://discord.com/api/v9/users/@me?with_analytics_token=true", {
                    headers: {
                        authorization: token,
                        "user-agent": USER_AGENT
                    },
                    signal: controller.signal
                });
                clearTimeout(timer);
                if (res.ok) {
                    const data = await res.json();
                    if (data.analytics_token) {
                        this.analyticsToken = data.analytics_token;
                        this.analyticsTokenFetchedAt = Date.now();
                        return this.analyticsToken;
                    }
                }
            }
        } catch (err) {
            logger.error("Failed to fetch analytics token:", err);
        }

        return this.analyticsToken;
    }

    private buildSuperProps(launchSig: string, heartbeatSession: string): string {
        const globalEnv = (typeof window !== "undefined" && (window as any).GLOBAL_ENV) || {};
        const releaseChannel = globalEnv.RELEASE_CHANNEL || "stable";
        const clientVersion = globalEnv.VERSION || CLIENT_VERSION;
        const clientBuildNumber = Number(globalEnv.BUILD_NUMBER) || CLIENT_BUILD_NUMBER;

        const props = {
            os: "Windows",
            browser: "Discord Client",
            release_channel: releaseChannel,
            client_version: clientVersion,
            os_version: OS_VERSION,
            os_arch: "x64",
            app_arch: "x64",
            system_locale: typeof navigator !== "undefined" ? navigator.language : "en-US",
            has_client_mods: false,
            browser_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : USER_AGENT,
            browser_version: "42.7.1",
            os_sdk_version: "26200",
            client_build_number: clientBuildNumber,
            native_build_number: NATIVE_BUILD_NUMBER,
            client_event_source: null,
            client_app_state: "focused",
            client_launch_id: crypto.randomUUID(),
            launch_signature: launchSig,
            client_heartbeat_session_id: heartbeatSession,
        };

        const jsonStr = JSON.stringify(props);
        return typeof btoa !== "undefined" ? btoa(jsonStr) : Buffer.from(jsonStr).toString("base64");
    }

    private createSession(): SessionInfo {
        const heartbeatSession = crypto.randomUUID();
        const launchSignature = crypto.randomUUID();
        const superProps = this.buildSuperProps(launchSignature, heartbeatSession);
        return { heartbeatSession, launchSignature, superProps };
    }

    private async joinEmptyVoiceChannel(): Promise<string | null> {
        const userId = UserStore.getCurrentUser()?.id;
        if (!userId) return null;

        const guilds = Object.values(GuildStore.getGuilds()).sort(
            (a, b) => Number(b.ownerId === userId) - Number(a.ownerId === userId)
        );

        for (const guild of guilds) {
            for (const channelId of GuildChannelStore.getVocalChannelIds(guild.id) ?? []) {
                const channel = ChannelStore.getChannel(channelId);
                if (!channel || channel.type === ChannelType.GUILD_STAGE_VOICE) continue;
                if (guild.afkChannelId === channelId) continue;
                if (!PermissionStore.can(PermissionsBits.CONNECT, channel)) continue;
                if (!PermissionStore.can(PermissionsBits.STREAM, channel)) continue;
                if (Object.keys(VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {}).length > 0) continue;

                ChannelActions.selectVoiceChannel(channelId);
                for (let i = 0; i < 40; i++) {
                    if (SelectedChannelStore.getVoiceChannelId() === channelId && RTCConnectionStore.getMediaSessionId()) {
                        this.autoJoinedChannelId = channelId;
                        return channelId;
                    }
                    await sleep(250);
                }

                ChannelActions.selectVoiceChannel(null);
                return null;
            }
        }

        return null;
    }

    private leaveJoinedVoiceChannel() {
        if (!this.autoJoinedChannelId) return;

        if (SelectedChannelStore.getVoiceChannelId() === this.autoJoinedChannelId) {
            ChannelActions.selectVoiceChannel(null);
        }
        this.autoJoinedChannelId = null;
    }

    private async resolveVoiceContext(): Promise<VoiceContext | null> {
        try {
            let channelId = SelectedChannelStore.getVoiceChannelId() ?? null;
            if (!channelId) {
                channelId = await this.joinEmptyVoiceChannel();
                if (!channelId) return null;
            }

            for (let i = 0; i < 40 && !RTCConnectionStore.getMediaSessionId(); i++) {
                await sleep(250);
            }

            const channel = ChannelStore.getChannel(channelId);
            if (!channel) return null;

            return {
                channelId,
                guildId: channel.guild_id ?? null,
                channelType: channel.type,
                mediaSessionId: RTCConnectionStore.getMediaSessionId() ?? null,
                rtcConnectionId: RTCConnectionStore.getRTCConnectionId() ?? null
            };
        } catch (e) {
            logger.warn("Failed to resolve voice context:", e);
            return null;
        }
    }

    private buildLaunchEvent(game: Game, session: SessionInfo, seq: number, fingerprint?: string, ts?: number, voiceContext?: VoiceContext | null) {
        const now = ts ?? Date.now();
        const props: Record<string, any> = {
            client_track_timestamp: now,
            client_heartbeat_session_id: session.heartbeatSession,
            event_sequence_number: seq,
            game: game.name,
            game_id: game.id,
            verified: true,
            elevated: false,
            is_launcher: false,
            game_platform: "desktop",
            detection_method: "verified_game",
            is_overlay_enabled: false,
            is_overlay_game_enabled: true,
            is_overlay_game_source: "OOP_DEFAULT_DATABASE",
            fullscreen_type: "UNKNOWN",
            hardware_display_count: 1,
            overlay_method: "Disabled",
            activity_status_enabled: true,
            activity_status_shared_guilds: [],
            current_user_status: "online",
            game_detection_enabled: true,
            executable_path: game.exe,
            voice_channel_id: voiceContext?.channelId ?? null,
            voice_channel_type: null,
            voice_channel_bitrate: null,
            voice_channel_guild_id: null,
            hidden_by_distributor: false,
            game_metadata: null,
            client_performance_cpu: null,
            client_performance_memory: null,
            cpu_core_count: null,
            accessibility_features: 0,
            rendered_locale: "en-US",
            launch_signature: session.launchSignature,
            client_rtc_state: null,
            client_app_state: "focused",
            client_send_timestamp: now,
        };

        if (fingerprint) {
            props.executable_fingerprint = fingerprint;
        }

        return { type: "launch_game", properties: props };
    }

    private buildHeartbeatEvent(
        game: Game,
        durationMs: number,
        gameSessionId: string,
        initial: boolean,
        final: boolean,
        session: SessionInfo,
        seq: number,
        ts?: number,
        rtcId: string | null = null,
        mediaId: string | null = null
    ) {
        const timestamp = ts ?? Date.now();
        return {
            type: "running_game_heartbeat",
            properties: {
                client_track_timestamp: timestamp,
                client_heartbeat_session_id: session.heartbeatSession,
                event_sequence_number: seq,
                game_id: game.id,
                game_name: game.name,
                game_metadata: null,
                game_executable: game.exe,
                game_detection_enabled: true,
                game_distributor: null,
                game_distributor_game_id: null,
                initial_heartbeat: initial,
                final_heartbeat: final,
                game_session_id: gameSessionId,
                duration_tracked_ms: durationMs,
                rtc_connection_id: rtcId,
                media_session_id: mediaId,
                client_app_state: "focused",
                client_send_timestamp: timestamp,
            }
        };
    }

    private getRegion(): string | null {
        const match = /^([a-z]+-[a-z]+)/.exec(RTCConnectionStore.getHostname());
        return match ? match[1] : null;
    }

    private buildStreamProperties(
        game: Game,
        voiceContext: VoiceContext | null,
        mediaSessionId: string,
        rtcConnectionId: string,
        userId: string | null
    ) {
        const region = this.getRegion();
        return {
            channel_id: voiceContext?.channelId ?? null,
            guild_id: voiceContext?.guildId ?? null,
            channel_type: voiceContext?.channelType ?? null,
            rtc_connection_id: rtcConnectionId,
            media_session_id: mediaSessionId,
            parent_media_session_id: voiceContext?.mediaSessionId ?? null,
            sender_user_id: userId,
            context: "stream",
            stream_region: region,
            stream_source_type: "screen",
            guild_region: region,
            participant_type: "streamer",
            share_application_name: game.name,
            share_application_id: game.id,
            share_application_executable: game.exe,
            share_application_distributor: null,
            share_application_distributor_game_id: null,
            share_application_game_metadata: null,
            video_layout: "full-screen",
            client_event_source: null,
            voice_backend_version: null,
            rtc_worker_backend_version: null
        };
    }

    private buildMediaSessionJoinedEvent(
        streamStart: number,
        session: SessionInfo,
        seq: number,
        mediaSessionId: string,
        rtcConnectionId: string,
        voiceContext: VoiceContext | null
    ) {
        return {
            type: "media_session_joined",
            properties: {
                client_track_timestamp: streamStart,
                client_heartbeat_session_id: session.heartbeatSession,
                event_sequence_number: seq,
                guild_id: voiceContext?.guildId ?? null,
                channel_id: voiceContext?.channelId ?? null,
                channel_type: voiceContext?.channelType ?? null,
                rtc_connection_id: rtcConnectionId,
                context: "stream",
                voice_backend_version: null,
                rtc_worker_backend_version: null,
                media_session_id: mediaSessionId,
                parent_media_session_id: voiceContext?.mediaSessionId ?? null,
                raw_thermal_state: null
            }
        };
    }

    private buildVideoStreamStartedEvent(
        game: Game,
        streamStart: number,
        session: SessionInfo,
        seq: number,
        mediaSessionId: string,
        rtcConnectionId: string,
        userId: string | null,
        voiceContext: VoiceContext | null
    ) {
        return {
            type: "video_stream_started",
            properties: {
                client_track_timestamp: streamStart,
                client_heartbeat_session_id: session.heartbeatSession,
                event_sequence_number: seq,
                ...this.buildStreamProperties(game, voiceContext, mediaSessionId, rtcConnectionId, userId),
                video_input_resolution: 1080,
                video_input_frame_rate: 60,
                soundshare_session: crypto.randomUUID(),
                share_game_name: game.name,
                share_game_id: game.id,
                quality_preset: "balanced",
                connection_type: null,
                effective_connection_speed: null,
                service_provider: null,
                duration_go_live_modal: 3000,
                source_location_stack: []
            }
        };
    }

    private buildVideoStreamEndedEvent(
        game: Game,
        streamEnd: number,
        streamDurationMs: number,
        session: SessionInfo,
        seq: number,
        mediaSessionId: string,
        rtcConnectionId: string,
        userId: string | null,
        voiceContext: VoiceContext | null
    ) {
        const duration = Math.floor(streamDurationMs / 1000);
        return {
            type: "video_stream_ended",
            properties: {
                client_track_timestamp: streamEnd,
                client_heartbeat_session_id: session.heartbeatSession,
                event_sequence_number: seq,
                ...this.buildStreamProperties(game, voiceContext, mediaSessionId, rtcConnectionId, userId),
                duration,
                duration_aggregation: duration,
                avg_resolution: 1080,
                avg_fps: 60,
                num_frames: Math.max(1, duration * 60),
                num_bytes: duration * 562500,
                num_packets: Math.max(1, duration * 350),
                num_packets_lost: 0,
                avg_bitrate: 4500000,
                num_keyframes: Math.max(1, Math.floor(duration / 5)),
                time_to_first_frame_ms: 250,
                num_layout_changes: 0,
                duration_layout_fullscreen: duration,
                duration_layout_theatre: 0,
                duration_layout_pip: 0,
                duration_layout_popout: 0,
                duration_layout_portrait: 0,
                duration_layout_landscape: 0,
                duration_layout_minimized: 0,
                reason: "stream-end",
                max_viewers: 1,
                hostname: RTCConnectionStore.getHostname() || null,
                hardware_enabled: true,
                device_performance_class: null,
                soundshare_experimental: false,
                quality_preset: "balanced",
                discord_is_elevated: false,
                clips_enabled: false,
                clips_buffer_length: 0,
                app_hardware_acceleration_enabled: true
            }
        };
    }

    private buildGameAndStreamSessionEvents(
        game: Game,
        playDurationMs: number,
        streamDurationMs: number,
        session: SessionInfo,
        getSeq: () => number,
        fingerprint?: string,
        userId?: string,
        voiceContext?: VoiceContext | null
    ) {
        const gameSessionId = crypto.randomUUID();
        const mediaSessionId = streamDurationMs > 0 ? crypto.randomUUID() : null;
        const rtcConnectionId = streamDurationMs > 0 ? crypto.randomUUID() : null;
        const now = Date.now();
        const gameStart = Math.max(0, now - playDurationMs);
        const streamStart = Math.max(0, now - streamDurationMs);

        const events: any[] = [];

        events.push(
            this.buildLaunchEvent(game, session, getSeq(), fingerprint, gameStart, voiceContext)
        );

        events.push(
            this.buildHeartbeatEvent(game, 0, gameSessionId, true, false, session, getSeq(), gameStart,
                voiceContext?.rtcConnectionId ?? null, voiceContext?.mediaSessionId ?? null)
        );

        if (streamDurationMs > 0 && mediaSessionId && rtcConnectionId) {
            events.push(
                this.buildMediaSessionJoinedEvent(streamStart, session, getSeq(), mediaSessionId, rtcConnectionId, voiceContext ?? null)
            );
            events.push(
                this.buildVideoStreamStartedEvent(game, streamStart, session, getSeq(), mediaSessionId, rtcConnectionId, userId ?? null, voiceContext ?? null)
            );
        }

        events.push(
            this.buildHeartbeatEvent(game, playDurationMs, gameSessionId, false, true, session, getSeq(), now,
                voiceContext?.rtcConnectionId ?? null, voiceContext?.mediaSessionId ?? null)
        );

        if (streamDurationMs > 0 && mediaSessionId && rtcConnectionId) {
            events.push(
                this.buildVideoStreamEndedEvent(game, now, streamDurationMs, session, getSeq(), mediaSessionId, rtcConnectionId, userId ?? null, voiceContext ?? null)
            );
        }

        const flushTime = Date.now();
        for (const event of events) {
            event.properties.client_send_timestamp = flushTime;
        }

        return events;
    }

    private getAuthToken(): string | null {
        const candidates = [
            () => (AuthenticationStore as any)?.getToken?.(),
            () => (findStoreLazy("AuthenticationStore") as any)?.getToken?.(),
            () => (findByPropsLazy("getToken") as any)?.getToken?.()
        ];

        for (const read of candidates) {
            try {
                const token = read();
                if (typeof token === "string" && token.length > 0) return token;
            } catch { }
        }

        return null;
    }

    private async postEvents(events: any[], analyticsToken: string, session: SessionInfo): Promise<number> {
        const payload = {
            token: analyticsToken,
            events
        };

        const authToken = this.getAuthToken();

        // Discord's /science endpoint returns 401 for unauthenticated requests.
        // This passthrough used to pass `undefined`, so every run was rejected
        // as "auth rejected" before the authenticated fallbacks could run.
        if (authToken && typeof VencordNative !== "undefined" && VencordNative.privacy?.postScienceEvents) {
            try {
                const res = await VencordNative.privacy.postScienceEvents(payload, authToken, undefined, session.superProps);
                if (res && typeof res.status === "number" && res.status > 0) {
                    return res.status;
                }
            } catch (err: any) {
                logger.warn("Native science passthrough failed, falling back:", err);
            }
        }

        // RestAPI applies the client's own auth + super-properties. It resolves
        // with { ok, status, body } even for HTTP errors, so read the status
        // rather than assuming a resolved promise means success.
        try {
            const res = await RestAPI.post({
                url: SCIENCE_URL,
                body: payload
            });
            if (res && typeof res.status === "number") return res.status;
            return res?.ok ? 204 : 0;
        } catch (err: any) {
            if (err?.status) return err.status;
            logger.warn("RestAPI science fallback failed:", err);
        }

        try {
            const token = (AuthenticationStore as any)?.getToken?.() || (findStoreLazy("AuthenticationStore") as any)?.getToken?.();
            const res = await fetch("https://discord.com/api/v9/science?source=badge_spoofer", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: token || "",
                    "x-super-properties": session.superProps,
                    "x-badge-spoofer": "1"
                },
                body: JSON.stringify(payload)
            });
            return res.status;
        } catch (e: any) {
            logger.error("Error posting science batch:", e);
            return 0;
        }
    }

    private selectGames(allGames: Game[], count: number): Game[] {
        const availableIds = new Set(allGames.map(g => g.id));
        const unusedIds = allGames.map(g => g.id).filter(id => !this.stats.usedGames.includes(id));
        const usedIds = this.stats.usedGames.filter(id => availableIds.has(id));

        let selectedIds: string[] = [];
        if (unusedIds.length >= count) {
            selectedIds = unusedIds.slice(0, count);
        } else {
            selectedIds = [...unusedIds];
            const remaining = count - selectedIds.length;
            if (usedIds.length > 0) {
                const rotated = [...usedIds.slice(remaining), ...usedIds.slice(0, remaining)];
                selectedIds.push(...rotated.slice(0, remaining));
            }
        }

        this.stats.usedGames = [
            ...this.stats.usedGames.filter(id => !selectedIds.includes(id)),
            ...selectedIds
        ];

        const idMap = new Map(allGames.map(g => [g.id, g]));
        return selectedIds.map(id => idMap.get(id)!).filter(Boolean);
    }

    public async startSpoofing(options: SpoofOptions): Promise<void> {
        if (this.isRunning) {
            options.onLog?.({
                id: Math.random().toString(36).substring(2, 9),
                timestamp: Date.now(),
                type: "warn",
                message: "Spoofer is already running."
            });
            return;
        }

        if (this.resumeTimeout) {
            clearTimeout(this.resumeTimeout);
            this.resumeTimeout = null;
        }

        const log = (type: "info" | "success" | "warn" | "error", message: string) => {
            options.onLog?.({
                id: Math.random().toString(36).substring(2, 9),
                timestamp: Date.now(),
                type,
                message
            });
        };

        log("info", "Initializing Badge Spoofer...");

        const allGames = await this.loadGames();
        if (allGames.length === 0) {
            log("error", "Could not load games database from Discord CDN. Check network connection.");
            return;
        }

        log("info", `Loaded ${allGames.length} detectable games from Discord database.`);

        const targetCount = Math.min(Math.max(1, options.count || allGames.length), allGames.length);
        const hours = Math.max(0, options.hours || 0);
        const streamHours = Math.max(0, options.streamHours || 0);
        const batchSize = Math.max(1, options.batchSize || 50);
        const batchDelay = Math.max(100, options.batchDelay || 300);
        const fingerprint = options.fingerprint || this.stats.fingerprint || undefined;
        const selectedGames = this.selectGames(allGames, targetCount);

        const job: SpoofJob = {
            version: 1,
            id: crypto.randomUUID(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            games: selectedGames,
            nextIndex: 0,
            options: { hours, streamHours, batchSize, batchDelay, fingerprint }
        };

        this.activeJob = job;
        await this.saveJob(job);
        this.runPromise = this.runJob(job, options.onLog, options.onProgress);
        try {
            await this.runPromise;
        } finally {
            this.runPromise = null;
        }
    }

    public scheduleResume(delayMs = 5000) {
        if (!this.activeJob || this.isRunning || this.resumeTimeout) return;

        this.resumeTimeout = setTimeout(() => {
            this.resumeTimeout = null;
            void this.resumePendingJob();
        }, delayMs);
    }

    public async resumePendingJob(
        onLog?: SpoofOptions["onLog"],
        onProgress?: SpoofOptions["onProgress"]
    ): Promise<boolean> {
        if (this.resumeTimeout) {
            clearTimeout(this.resumeTimeout);
            this.resumeTimeout = null;
        }
        if (this.isRunning || !this.activeJob) return false;

        const job = this.activeJob;
        if (job.nextIndex >= job.games.length) {
            await this.clearJob();
            return false;
        }

        this.runPromise = this.runJob(job, onLog, onProgress);
        try {
            await this.runPromise;
        } finally {
            this.runPromise = null;
        }
        return true;
    }

    private async runJob(
        job: SpoofJob,
        onLog?: SpoofOptions["onLog"],
        onProgress?: SpoofOptions["onProgress"]
    ) {
        this.isRunning = true;
        this.cancelRequested = false;
        this.abortController = new AbortController();

        const log = (type: "info" | "success" | "warn" | "error", message: string) => {
            onLog?.({
                id: Math.random().toString(36).substring(2, 9),
                timestamp: Date.now(),
                type,
                message
            });
        };

        const { hours, streamHours, batchSize, batchDelay, fingerprint } = job.options;
        const selectedGames = job.games;
        const targetCount = selectedGames.length;
        const playDurationMs = Math.floor(hours * 3600 * 1000);
        const streamDurationMs = Math.floor(streamHours * 3600 * 1000);
        const totalBatches = Math.ceil(targetCount / batchSize);
        const startedAt = job.nextIndex;

        log("info", startedAt > 0
            ? `Resuming saved run at ${startedAt}/${targetCount} games...`
            : "Starting spoofing run...");

        const analyticsToken = await this.getAnalyticsToken();
        if (!analyticsToken) {
            log("error", "Could not retrieve Discord analytics_token. Are you logged in? The saved run will resume on next start.");
            this.isRunning = false;
            return;
        }

        log("success", "Analytics token ready.");

        if (this.abortController.signal.aborted || this.cancelRequested) {
            this.isRunning = false;
            return;
        }

        const currentUserId = UserStore?.getCurrentUser?.()?.id;
        const voiceContext = streamDurationMs > 0 ? await this.resolveVoiceContext() : null;
        if (streamDurationMs > 0 && !voiceContext) {
            log("warn", "Could not join a voice channel - stream events will be sent WITHOUT channel attribution and Discord may discard them. Join a server voice channel before spoofing stream hours.");
        } else if (voiceContext) {
            log("info", `Stream attribution ready (channel ${voiceContext.channelId}${voiceContext.guildId ? `, guild ${voiceContext.guildId}` : ", DM call"}${this.autoJoinedChannelId ? ", auto-joined" : ""}).`);
        }

        const session = this.createSession();
        let seq = 0;
        const getSeq = () => ++seq;

        log("info", `Targeting ${targetCount} games: ${hours}h play each (${(targetCount * hours).toLocaleString()}h), ${streamHours}h stream each (${(targetCount * streamHours).toLocaleString()}h) in ${totalBatches} batches.`);

        onProgress?.({
            total: targetCount,
            sent: startedAt,
            hours,
            streamHours,
            currentBatch: Math.floor(startedAt / batchSize),
            totalBatches,
            isRunning: true,
            status: startedAt > 0 ? `Resuming ${startedAt}/${targetCount}...` : `Starting 0/${targetCount}...`
        });

        let index = startedAt;
        let rateLimitRetries = 0;

        try {
            while (index < targetCount) {
                if (this.abortController.signal.aborted || this.cancelRequested) {
                    log("warn", "Spoofing cancelled by user.");
                    break;
                }

                const batchIndex = Math.floor(index / batchSize) + 1;
                const chunk = selectedGames.slice(index, index + batchSize);
                const events: any[] = [];

                for (const game of chunk) {
                    events.push(...this.buildGameAndStreamSessionEvents(
                        game,
                        playDurationMs,
                        streamDurationMs,
                        session,
                        getSeq,
                        fingerprint,
                        currentUserId,
                        voiceContext
                    ));
                }

                const status = await this.postEvents(events, analyticsToken, session);

                if (this.cancelRequested || this.abortController.signal.aborted) break;

                if (status >= 200 && status < 300) {
                    index += chunk.length;
                    job.nextIndex = index;
                    job.updatedAt = Date.now();
                    this.stats.totalGamesClaimed += chunk.length;
                    this.stats.totalHoursClaimed += chunk.length * hours;
                    this.stats.totalStreamHoursClaimed += chunk.length * streamHours;
                    await Promise.all([this.saveStats(), this.saveJob(job)]);
                    rateLimitRetries = 0;

                    log("success", `Batch ${batchIndex}/${totalBatches} accepted [${status}] (${index}/${targetCount} games, ${hours}h play, ${streamHours}h stream)`);
                } else if (status === 401 || status === 403) {
                    log("error", `Batch ${batchIndex} auth rejected [${status}]. Refreshing analytics token and pausing.`);
                    await this.getAnalyticsToken(true);
                    break;
                } else if (status === 429) {
                    rateLimitRetries++;
                    if (rateLimitRetries > 5) {
                        log("warn", "Rate limited too many times. Pausing the saved run.");
                        break;
                    }
                    log("warn", `Rate limited [429] on batch ${batchIndex}. Backing off ${rateLimitRetries * 2.5}s...`);
                    await sleep(2500 * rateLimitRetries);
                    continue;
                } else {
                    log("warn", `Batch ${batchIndex} returned status [${status}]. Pausing the saved run.`);
                    break;
                }

                onProgress?.({
                    total: targetCount,
                    sent: index,
                    hours,
                    streamHours,
                    currentBatch: batchIndex,
                    totalBatches,
                    isRunning: true,
                    status: `Sent ${index}/${targetCount} games`
                });

                await sleep(batchDelay);
            }
        } catch (e) {
            logger.error("Badge spoofer run failed:", e);
            log("error", `Run paused: ${e instanceof Error ? e.message : String(e)}. It will resume on next start.`);
        } finally {
            this.leaveJoinedVoiceChannel();
            this.isRunning = false;

            const completed = job.nextIndex >= targetCount;
            if (completed || this.cancelRequested) {
                await this.clearJob();
            } else {
                job.updatedAt = Date.now();
                await this.saveJob(job);
            }

            onProgress?.({
                total: targetCount,
                sent: job.nextIndex,
                hours,
                streamHours,
                currentBatch: Math.ceil(job.nextIndex / batchSize),
                totalBatches,
                isRunning: false,
                status: completed
                    ? `Completed: ${job.nextIndex} games claimed.`
                    : this.cancelRequested
                        ? `Cancelled at ${job.nextIndex}/${targetCount}.`
                        : `Paused at ${job.nextIndex}/${targetCount}. Resumes on next start.`
            });

            if (completed) {
                log("success", `Finished: ${job.nextIndex} games claimed (${(job.nextIndex * hours).toLocaleString()}h play, ${(job.nextIndex * streamHours).toLocaleString()}h stream). Badges update in 1-2 days.`);
            } else if (!this.cancelRequested) {
                log("warn", `Paused at ${job.nextIndex}/${targetCount} games. It will resume automatically on the next Discord start.`);
            }
        }
    }

    public async cancelSpoofing() {
        this.cancelRequested = true;
        if (this.resumeTimeout) {
            clearTimeout(this.resumeTimeout);
            this.resumeTimeout = null;
        }
        this.abortController?.abort();
        if (this.runPromise) await this.runPromise;
        this.isRunning = false;
        await this.clearJob();
        this.leaveJoinedVoiceChannel();
    }

    public stopSpoofing() {
        if (this.resumeTimeout) {
            clearTimeout(this.resumeTimeout);
            this.resumeTimeout = null;
        }
        this.abortController?.abort();
        this.leaveJoinedVoiceChannel();
    }
}

export const badgeSpooferEngine = BadgeSpooferEngine.getInstance();
