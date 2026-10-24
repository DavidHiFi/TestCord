/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Flex } from "@components/Flex";
import { TestcordDevs } from "@utils/constants";
import { getCurrentChannel, insertTextIntoChatInputBox } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { saveFile } from "@utils/web";
import type { RenderModalProps } from "@vencord/discord-types";
import { Button, DraftType, IconUtils, React, showToast, Text, UploadHandler, UserStore } from "@webpack/common";

const logger = new Logger("ShowOff");
const WIDTH = 1200;
const HEIGHT = 630;
const LOOK_FILENAME = "testcord-look.png";
const CAPTION = "Check out my Testcord look! ✨";

async function loadImageCors(url: string): Promise<HTMLImageElement | null> {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

async function renderCard(): Promise<Blob | null> {
    const me = UserStore.getCurrentUser();
    if (!me) return null;

    if (document.fonts?.ready) await document.fonts.ready;

    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    bg.addColorStop(0, "#0c0814");
    bg.addColorStop(0.5, "#181028");
    bg.addColorStop(1, "#0a0612");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Accent glow
    const glow = ctx.createRadialGradient(WIDTH / 2, 220, 10, WIDTH / 2, 220, 400);
    glow.addColorStop(0, "rgba(136, 85, 255, 0.25)");
    glow.addColorStop(0.6, "rgba(0, 221, 255, 0.08)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Avatar
    const avatarUrl = IconUtils.getUserAvatarURL(me, true, 256);
    const avatar = avatarUrl ? await loadImageCors(avatarUrl) : null;
    const ax = WIDTH / 2 - 80;
    const ay = 80;
    const asize = 160;

    if (avatar) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(WIDTH / 2, ay + asize / 2, asize / 2 + 4, 0, Math.PI * 2);
        const ringGrad = ctx.createLinearGradient(ax, ay, ax + asize, ay + asize);
        ringGrad.addColorStop(0, "#8855FF");
        ringGrad.addColorStop(1, "#00DDFF");
        ctx.fillStyle = ringGrad;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(WIDTH / 2, ay + asize / 2, asize / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(avatar, ax, ay, asize, asize);
        ctx.restore();
    }

    // Name & Username
    const displayName = me.globalName || me.username;
    ctx.textAlign = "center";
    ctx.font = "bold 44px sans-serif";

    // Text gradient
    const nameGrad = ctx.createLinearGradient(WIDTH / 2 - 150, 0, WIDTH / 2 + 150, 0);
    nameGrad.addColorStop(0, "#8855FF");
    nameGrad.addColorStop(1, "#00DDFF");
    ctx.fillStyle = nameGrad;
    ctx.fillText(displayName, WIDTH / 2, 300);

    ctx.font = "500 24px sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.fillText(`@${me.username}`, WIDTH / 2, 340);

    // Pill badge for Testcord
    const pillText = "Testcord Client Mod";
    ctx.font = "600 22px sans-serif";
    const pw = ctx.measureText(pillText).width + 48;
    const px = (WIDTH - pw) / 2;
    const py = 390;
    const ph = 46;

    ctx.fillStyle = "rgba(136, 85, 255, 0.15)";
    roundRect(ctx, px, py, pw, ph, ph / 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(136, 85, 255, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.fillText(pillText, WIDTH / 2, py + 32);

    // Footer
    ctx.font = "500 20px sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.fillText("Generated with Testcord ShowOff", WIDTH / 2, HEIGHT - 40);

    return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
}

function ShowOffModal({ rootProps }: { rootProps: RenderModalProps; }) {
    const [blob, setBlob] = React.useState<Blob | null>(null);
    const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(true);

    React.useEffect(() => {
        let active = true;
        let url: string | null = null;
        renderCard()
            .then(b => {
                if (!active) return;
                if (b) {
                    url = URL.createObjectURL(b);
                    setBlob(b);
                    setPreviewUrl(url);
                }
                setBusy(false);
            })
            .catch(err => {
                logger.error("Failed to render look card", err);
                if (active) setBusy(false);
            });

        return () => {
            active = false;
            if (url) URL.revokeObjectURL(url);
        };
    }, []);

    function save() {
        if (!blob) return;
        saveFile(new File([blob], LOOK_FILENAME, { type: "image/png" }));
        showToast("Saved your look card.", "success");
    }

    async function copy() {
        if (!blob) return;
        try {
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
            showToast("Copied to clipboard.", "success");
        } catch (e) {
            logger.warn("Clipboard copy failed", e);
            showToast("Copying images isn't supported here — use Save instead.", "failure");
        }
    }

    function postInChat() {
        if (!blob) return;
        const channel = getCurrentChannel();
        if (!channel) {
            showToast("Open a chat first to post it there.", "failure");
            return;
        }
        insertTextIntoChatInputBox(CAPTION);
        UploadHandler.promptToUpload([new File([blob], LOOK_FILENAME, { type: "image/png" })], channel, DraftType.ChannelMessage);
        rootProps.onClose?.();
    }

    return (
        <ModalRoot {...rootProps} size={ModalSize.LARGE}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>Show Off Your Look</Text>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <div style={{ padding: "16px 0", textAlign: "center" }}>
                    {busy ? (
                        <Text variant="text-md/normal">Generating card…</Text>
                    ) : previewUrl ? (
                        <img
                            src={previewUrl}
                            alt="Your look card"
                            style={{
                                width: "100%",
                                maxHeight: 380,
                                objectFit: "contain",
                                borderRadius: 12,
                                border: "1px solid var(--border-subtle)"
                            }}
                        />
                    ) : (
                        <Text variant="text-md/normal" color="text-danger">Could not generate your look card.</Text>
                    )}
                </div>
                <Flex style={{ gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
                    <Button color={Button.Colors.BRAND} onClick={copy} disabled={!blob}>
                        Copy Image
                    </Button>
                    <Button color={Button.Colors.PRIMARY} onClick={save} disabled={!blob}>
                        Save PNG
                    </Button>
                    <Button color={Button.Colors.GREEN} onClick={postInChat} disabled={!blob}>
                        Post in Chat
                    </Button>
                </Flex>
            </ModalContent>
        </ModalRoot>
    );
}

export default definePlugin({
    id: "ShowOff",
    name: "ShowOff",
    description: "Turn your Discord avatar, name, and styling into an aesthetic showcase card you can copy, save, or post in chat.",
    authors: [TestcordDevs.sirphantom89],
    tags: ["Utility", "Customisation"],

    toolboxActions: {
        "Show off my look"() {
            openModal(props => <ShowOffModal rootProps={props} />);
        }
    }
});
