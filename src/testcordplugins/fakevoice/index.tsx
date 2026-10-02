/* eslint-disable simple-header/header -- This permitted fork uses the MIT license. */
/*
 * FakeVoice user plugin
 * Original plugin by deracul; maintained by DavidHiFi
 * SPDX-License-Identifier: MIT
 */

import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import type { VoiceState } from "@vencord/discord-types";
import { findByCode, findByProps, findStore } from "@webpack";
import { ChannelStore, ContextMenuApi, Menu, PermissionsBits, PermissionStore, React, SelectedChannelStore, Toasts, UserStore } from "@webpack/common";

/* ===========================
 * Module Lookups
 * =========================== */
let VoiceStateStore, MediaEngineStore, GatewayConnectionStore, SelectedGuildStore;

const safeFind = (...props) => {
    try { return findByProps(...props); } catch { return null; }
};

function loadStores() {
    if (!VoiceStateStore) VoiceStateStore = safeFind("getVoiceChannelId");
    if (!MediaEngineStore) MediaEngineStore = safeFind("isSelfMute");
    if (!GatewayConnectionStore) GatewayConnectionStore = safeFind("getSocket");
    if (!SelectedGuildStore) SelectedGuildStore = safeFind("getLastSelectedGuildId");
}

/* ===========================
 * State
 * =========================== */
const fakeStates = {
    mute: true,
    deafen: true,
    video: false
};

export let faked = false;

const STREAM = 1n << 9n;
const WATCH_TOGETHER_APPLICATION_ID = "880218394199220334";
let fakeStreamActive = false;
let globalForceUpdate: (() => void) | null = null;

/* ===========================
 * External control (Stream Deck bridge)
 * Same code paths as the context menu, exposed on window.__fakeVoice and read
 * from the main process by native.ts.
 * =========================== */
export type FakeVoiceKind = "mute" | "deafen" | "camera" | "stream" | "game";

export function getFakeStates(): Record<FakeVoiceKind, boolean> {
    return {
        mute: !fakeStates.mute,
        deafen: !fakeStates.deafen,
        camera: fakeStates.video,
        stream: settings.store.fakeStream,
        game: settings.store.fakeGame
    };
}

export function setFakeState(kind: FakeVoiceKind, value: boolean): Record<FakeVoiceKind, boolean> {
    switch (kind) {
        case "mute":
            fakeStates.mute = !value;
            showFakeToast("mute", value);
            triggerGatewayUpdate();
            break;
        case "deafen":
            fakeStates.deafen = !value;
            showFakeToast("deafen", value);
            triggerGatewayUpdate();
            break;
        case "camera":
            fakeStates.video = value;
            showFakeToast("video", value);
            triggerGatewayUpdate();
            break;
        case "stream":
            toggleFakeStream(value);
            showFakeToast("stream", value);
            break;
        case "game":
            toggleFakeGame(value);
            showFakeToast("game", value);
            break;
    }

    globalForceUpdate?.();
    return getFakeStates();
}

export function toggleFakeState(kind: FakeVoiceKind): Record<FakeVoiceKind, boolean> {
    return setFakeState(kind, !getFakeStates()[kind]);
}

/* ===========================
 * Settings
 * =========================== */
const settings = definePluginSettings({
    fakeStream: {
        description: "Fake stream toggle",
        type: OptionType.BOOLEAN,
        default: false
    },
    fakeGame: {
        description: "Fake game (Watch Together) toggle",
        type: OptionType.BOOLEAN,
        default: false
    },
    disableFakeDeafen: {
        description: "Enable or disable fake deafen",
        type: OptionType.BOOLEAN,
        default: true,
        onChange: value => fakeStates.deafen = value
    },
    disableFakeMute: {
        description: "Enable or disable fake mute",
        type: OptionType.BOOLEAN,
        default: true,
        onChange: value => fakeStates.mute = value
    }
});

/* ===========================
 * Gateway Push
 * =========================== */
function triggerGatewayUpdate() {
    loadStores();
    if (!VoiceStateStore || !GatewayConnectionStore) return;

    const channelId = VoiceStateStore.getVoiceChannelId();
    if (!channelId) return;

    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return;

    let guildId = channel.guild_id;
    if (!guildId && (channel.type === 2 || channel.type === 13)) {
        if (SelectedGuildStore) guildId = SelectedGuildStore.getLastSelectedGuildId();
        if (!guildId) return;
    }

    const socket = GatewayConnectionStore.getSocket();
    if (!socket || typeof socket.send !== "function") return;

    const realMute = MediaEngineStore ? MediaEngineStore.isSelfMute() : false;
    const realDeaf = MediaEngineStore ? MediaEngineStore.isSelfDeaf() : false;
    const realVideo = MediaEngineStore ? MediaEngineStore.isVideoEnabled() : false;

    try {
        socket.send(4, {
            guild_id: guildId,
            channel_id: channelId,
            self_mute: !fakeStates.mute ? true : realMute,
            self_deaf: !fakeStates.deafen ? true : realDeaf,
            self_video: fakeStates.video || realVideo
        });
    } catch (e) {
        console.error("[FakeVoice] Send Failed:", e);
    }
}

/* ===========================
 * Stream / Activity helpers
 * =========================== */
function getSelectedVoiceChannel() {
    const selected = SelectedChannelStore.getVoiceChannelId();
    if (!selected) return null;
    return ChannelStore.getChannel(selected);
}

function canUseFakeActivity(channel) {
    return PermissionStore.can(PermissionsBits.USE_EMBEDDED_ACTIVITIES, channel);
}

function getEmbeddedActivityLocation(channelId: string) {
    return {
        channelId,
        guildId: ChannelStore.getChannel(channelId)?.guild_id ?? null
    };
}

async function startActivity(channelId: string) {
    const activityApi = findByProps("su", "_H");
    if (!activityApi?.su) return;
    await activityApi.su({
        channelId,
        applicationId: WATCH_TOGETHER_APPLICATION_ID,
        isStart: true,
        locationObject: getEmbeddedActivityLocation(channelId)
    });
}

function hasFakeActivity(channelId: string) {
    const store = findStore("EmbeddedActivitiesStore");
    return store?.getSelfEmbeddedActivityForChannel?.(channelId)?.applicationId === WATCH_TOGETHER_APPLICATION_ID;
}

function hasFakeStream() {
    const store = findStore("StreamRTCConnectionStore");
    return store?.getAllActiveStreamKeys?.().length > 0;
}

function leaveActivity(channelId?: string) {
    const activityApi = findByProps("su", "_H");
    const frameApi = findByProps("launchFrame", "refreshProxyTicket", "stopFrame");
    const store = findStore("EmbeddedActivitiesStore");
    const activity = store?.getCurrentEmbeddedActivity?.()
        ?? (channelId ? store?.getSelfEmbeddedActivityForChannel?.(channelId) : null);
    const location = store?.getConnectedActivityLocation?.()
        ?? activity?.location
        ?? (channelId ? getEmbeddedActivityLocation(channelId) : null);
    if (!location || !activity?.applicationId) return;
    activityApi?._H?.({ location, applicationId: activity.applicationId, showFeedback: false });
    frameApi?.stopFrame?.({ applicationId: activity.applicationId });
}

function stopStream() {
    const ConnectionStore = findStore("StreamRTCConnectionStore");
    const stopStreamFn = findByCode('type:"STREAM_STOP"');
    for (const streamKey of ConnectionStore.getAllActiveStreamKeys()) {
        stopStreamFn(streamKey, { streamKey, appContext: "app" });
        break;
    }
}

function toggleFakeStream(enabled: boolean) {
    settings.store.fakeStream = enabled;
    faked = enabled || settings.store.fakeGame;
    const channel = getSelectedVoiceChannel();
    if (!channel) { fakeStreamActive = false; return; }

    if (enabled && PermissionStore.can(STREAM, channel)) {
        fakeStreamActive = true;
        const startStreamFn = findByCode('type:"STREAM_START"');
        startStreamFn(channel.guild_id, channel.id, {
            pid: null, sourceId: null, sourceName: null,
            audioSourceId: null, sound: false, previewDisabled: true
        });
    } else {
        fakeStreamActive = false;
        stopStream();
    }
}

function toggleFakeGame(enabled: boolean) {
    settings.store.fakeGame = enabled;
    faked = enabled || settings.store.fakeStream;
    const channel = getSelectedVoiceChannel();
    if (!channel) return;

    if (enabled && canUseFakeActivity(channel)) {
        void startActivity(channel.id);
    } else {
        leaveActivity(channel.id);
    }
}

/* ===========================
 * Toast helper
 * =========================== */
function showFakeToast(type: "mute" | "deafen" | "video" | "stream" | "game", enabled: boolean) {
    Toasts.show({
        message: `Fake ${type} ${enabled ? "enabled" : "disabled"}`,
        id: `fake-${type}`,
        type: enabled ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE,
        options: { position: Toasts.Position.BOTTOM }
    });
}

/* ===========================
 * Keybinds
 * =========================== */
function keybindDeafen(e) {
    if (e.ctrlKey && e.key.toLowerCase() === "l") {
        fakeStates.deafen = !fakeStates.deafen;
        showFakeToast("deafen", !fakeStates.deafen);
        triggerGatewayUpdate();
        globalForceUpdate?.();
    }
}

function keybindMute(e) {
    if (e.ctrlKey && e.key.toLowerCase() === "j") {
        fakeStates.mute = !fakeStates.mute;
        showFakeToast("mute", !fakeStates.mute);
        triggerGatewayUpdate();
        globalForceUpdate?.();
    }
}

/* ===========================
 * Icon
 * =========================== */
function makeIcon(active?: boolean) {
    return ({ className }: { className?: string }) => (
        <svg className={className} xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 512 512">
            <path
                fill="currentColor"
                d="M256 48C141.1 48 48 141.1 48 256v40c0 13.3-10.7 24-24 24s-24-10.7-24-24V256C0 114.6 114.6 0 256 0S512 114.6 512 256V400.1c0 48.6-39.4 88-88.1 88L313.6 488c-8.3 14.3-23.8 24-41.6 24H240c-26.5 0-48-21.5-48-48s21.5-48 48-48h32c17.8 0 33.3 9.7 41.6 24l110.4.1c22.1 0 40-17.9 40-40V256c0-114.9-93.1-208-208-208zM144 208h16c17.7 0 32 14.3 32 32V352c0 17.7-14.3 32-32 32H144c-35.3 0-64-28.7-64-64V272c0-35.3 28.7-64 64-64zm224 0c35.3 0 64 28.7 64 64v48c0 35.3-28.7 64-64 64H352c-17.7 0-32-14.3-32-32V240c0-17.7 14.3-32 32-32h16z"
            />
            {!active && (
                <line x1="495" y1="10" x2="10" y2="464" stroke="var(--status-danger)" strokeWidth="40" />
            )}
        </svg>
    );
}

/* ===========================
 * Context Menu — flat 5 items, separator between groups
 * =========================== */
function FakeVoiceContextMenu() {
    const [_, forceUpdate] = React.useReducer(x => x + 1, 0);
    settings.use(["fakeStream", "fakeGame"]);

    return (
        <Menu.Menu navId="fake-voice-menu" onClose={() => {}}>
            <Menu.MenuCheckboxItem
                id="vc-fake-mute"
                label="Fake Mute"
                checked={!fakeStates.mute}
                action={() => {
                    toggleFakeState("mute");
                    forceUpdate();
                }}
            />
            <Menu.MenuCheckboxItem
                id="vc-fake-deafen"
                label="Fake Deafen"
                checked={!fakeStates.deafen}
                action={() => {
                    toggleFakeState("deafen");
                    forceUpdate();
                }}
            />
            <Menu.MenuCheckboxItem
                id="vc-fake-video"
                label="Fake Camera"
                checked={fakeStates.video}
                action={() => {
                    toggleFakeState("camera");
                    forceUpdate();
                }}
            />
            <Menu.MenuSeparator />
            <Menu.MenuCheckboxItem
                id="vc-fake-stream"
                label="Fake Stream"
                checked={settings.store.fakeStream}
                action={() => {
                    toggleFakeState("stream");
                    forceUpdate();
                }}
            />
            <Menu.MenuCheckboxItem
                id="vc-fake-game"
                label="Fake Game"
                checked={settings.store.fakeGame}
                action={() => {
                    toggleFakeState("game");
                    forceUpdate();
                }}
            />
        </Menu.Menu>
    );
}
function FakeVoiceButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const [_, forceUpdate] = React.useReducer(x => x + 1, 0);
    const ref = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        globalForceUpdate = forceUpdate;
        forceUpdate();
        return () => { globalForceUpdate = null; };
    }, []);

    React.useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const handler = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            ContextMenuApi.openContextMenu(e as any, () => <FakeVoiceContextMenu />);
        };
        el.addEventListener("contextmenu", handler, true);
        return () => el.removeEventListener("contextmenu", handler, true);
    }, []);

    const anyMuteDeafCamActive = !fakeStates.mute || !fakeStates.deafen || fakeStates.video;
    const anyActive = anyMuteDeafCamActive || faked;
    const Icon = makeIcon(anyActive);

    return (
        <div ref={ref} style={{ display: "contents" }}>
            <UserAreaButton
                tooltipText={hideTooltips ? void 0 : "Fake Voice"}
                icon={<Icon className={iconForeground} />}
                role="switch"
                aria-checked={anyActive}
                redGlow={false}
                plated={nameplate != null}
                onClick={() => {
                    if (anyMuteDeafCamActive) {
                        fakeStates.mute = true;
                        fakeStates.deafen = true;
                        fakeStates.video = false;
                        showFakeToast("mute", false);
                        showFakeToast("deafen", false);
                        showFakeToast("video", false);
                    } else {
                        fakeStates.mute = false;
                        showFakeToast("mute", true);
                    }
                    triggerGatewayUpdate();
                    forceUpdate();
                }}
            />
        </div>
    );
}
const SafeFakeVoiceButton = ErrorBoundary.wrap(FakeVoiceButton, { noop: true });

export default definePlugin({
    name: "FakeVoice",
    description: "Fake mute, deafen, camera, stream, and game. Right-click the button for all options.",
    authors: [TestcordDevs.deracul, TestcordDevs.DavidHiFi],
    dependencies: ["UserAreaAPI"],
    settings,
    patches: [
        {
            find: "}voiceStateUpdate(",
            replacement: {
                match: /self_mute:([^,]+),self_deaf:([^,]+)/,
                replace: "self_mute:$self.state('mute',$1),self_deaf:$self.state('deafen',$2)"
            }
        },
        {
            find: "voiceServerPing(){",
            replacement: {
                match: /voiceStateUpdate\((\w+)\)\{(.{0,10})guildId:/,
                replace: "voiceStateUpdate($1){$1=$self.modifyVoiceState($1);$2guildId:"
            }
        },
        {
            find: "OPEN_EMBEDDED_ACTIVITY,{location:",
            replacement: {
                match: /\i\._\.dispatch\(\i\.\i\.OPEN_EMBEDDED_ACTIVITY,\{location:\i,applicationId:\i,/,
                replace: "$self.shouldOpenEmbeddedActivity()&&$&"
            }
        },
        {
            find: "handleOpenActivityPopout",
            replacement: {
                match: /\i\.open\(\i\.\i\.ACTIVITY_POPOUT,.{0,80}?defaultHeight:480\}\)/,
                replace: "$self.shouldOpenEmbeddedActivity()&&$&"
            }
        },
        {
            find: "CAMERA_PREVIEW]:",
            noWarn: true,
            replacement: {
                match: /d\.set\(\i,\i\),(\i)===(\i\.\i)\.VIDEO.{0,100}?\2\.HAVEN&&null==\i&&\(\i=\i\)/,
                replace: "(($1!==$2.ACTIVITY||$self.shouldOpenEmbeddedActivity())&&($1!==$2.VIDEO||$self.shouldOpenStreamPip()))&&($&)"
            }
        }
    ],

    userAreaButton: {
        icon: makeIcon(true),
        render: props => <SafeFakeVoiceButton {...props} />
    },

    state(type: "mute" | "deafen", real: boolean) {
        if (type === "mute" && !fakeStates.mute) return true;
        if (type === "deafen" && !fakeStates.deafen) return true;
        return real;
    },

    modifyVoiceState(e: any) {
        e.selfVideo = fakeStates.video || e.selfVideo;
        return e;
    },

    shouldOpenEmbeddedActivity: () => !(faked && settings.store.fakeGame),
    shouldOpenStreamPip: () => !(faked && fakeStreamActive),

    flux: {
        async VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[] }) {
            const myId = UserStore.getCurrentUser().id;
            const selected = SelectedChannelStore.getVoiceChannelId();
            if (!selected) return;
            const channel = ChannelStore.getChannel(selected);
            const myVoiceState = voiceStates.find(s => s.userId === myId && s.channelId === selected);

            if (settings.store.fakeGame && faked && myVoiceState && canUseFakeActivity(channel) && !hasFakeActivity(selected)) {
                void startActivity(selected);
            }

            if (settings.store.fakeStream && faked && myVoiceState && PermissionStore.can(STREAM, channel)) {
                fakeStreamActive = true;
                if (!hasFakeStream()) {
                    const startStreamFn = findByCode('type:"STREAM_START"');
                    startStreamFn(channel.guild_id, selected, {
                        pid: null, sourceId: null, sourceName: null,
                        audioSourceId: null, sound: false, previewDisabled: true
                    });
                }
            }
        }
    },
    start() {
        loadStores();
        document.addEventListener("keydown", keybindDeafen);
        document.addEventListener("keydown", keybindMute);
        (window as any).__fakeVoice = {
            state: getFakeStates,
            set: setFakeState,
            toggle: toggleFakeState
        };
    },
    stop() {
        document.removeEventListener("keydown", keybindDeafen);
        document.removeEventListener("keydown", keybindMute);
        delete (window as any).__fakeVoice;
        globalForceUpdate = null;
        if (settings.store.fakeGame) leaveActivity(getSelectedVoiceChannel()?.id);
        if (fakeStreamActive) stopStream();
        faked = false;
        fakeStreamActive = false;
    }
});
