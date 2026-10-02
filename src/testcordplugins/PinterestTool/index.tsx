/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import { openModal } from "@utils/modal";
import definePlugin from "@utils/types";

import { PinterestProfileModal } from "./components";
import { type SearchKind, settings } from "./shared";
import managedStyle from "./style.css?managed";

const WrappedPinterestProfileModal = ErrorBoundary.wrap(PinterestProfileModal, { noop: true });

let observer: MutationObserver | null = null;
let scanQueued = false;
let lastProfileImageTarget: Extract<SearchKind, "AVATAR" | "BANNER"> = "AVATAR";
let lastProfileImageTargetAt = 0;

function exactText(root: ParentNode, text: string): HTMLElement | null {
    const nodes = root.querySelectorAll<HTMLElement>("button, [role='button'], div, span");
    for (const node of nodes) {
        if (node.textContent?.trim() === text) return node;
    }
    return null;
}

function clickableRoot(element: HTMLElement, dialog: HTMLElement): HTMLElement {
    let current: HTMLElement | null = element;

    while (current && current !== dialog) {
        if (current.matches("button, [role='button'], [tabindex='0']")) return current;
        current = current.parentElement;
    }

    // Discord occasionally uses a clickable div without role/tabindex.
    // In that case, use a small ancestor around the label rather than the whole modal.
    current = element;
    for (let i = 0; i < 3 && current.parentElement && current.parentElement !== dialog; i++) {
        current = current.parentElement;
    }
    return current;
}

function commonAncestor(a: HTMLElement, b: HTMLElement, limit: HTMLElement): HTMLElement | null {
    const parents = new Set<HTMLElement>();
    let current: HTMLElement | null = a;

    while (current && current !== limit) {
        parents.add(current);
        current = current.parentElement;
    }

    current = b;
    while (current && current !== limit) {
        if (parents.has(current)) return current;
        current = current.parentElement;
    }

    return null;
}

function getTarget(dialog: HTMLElement): Extract<SearchKind, "AVATAR" | "BANNER"> {
    // The control that opened Discord's image picker is the most reliable signal.
    // Discord can reuse the same "Select an Image" modal for avatars and banners,
    // so text such as "Recent Avatars" is not always safe to trust.
    if (Date.now() - lastProfileImageTargetAt < 4000) {
        return lastProfileImageTarget;
    }

    const text = dialog.textContent ?? "";

    if (/Recent\s+Banners?/i.test(text)) return "BANNER";
    if (/Recent\s+Avatars?/i.test(text)) return "AVATAR";

    return lastProfileImageTarget;
}

function rememberProfileImageTarget(event: Event) {
    const path = typeof event.composedPath === "function"
        ? event.composedPath().filter((node): node is HTMLElement => node instanceof HTMLElement)
        : [];

    const elements = path.length
        ? path.slice(0, 9)
        : (() => {
            const fallback: HTMLElement[] = [];
            let current = event.target instanceof HTMLElement ? event.target : null;

            for (let depth = 0; current && depth < 9; depth++, current = current.parentElement) {
                fallback.push(current);
            }

            return fallback;
        })();

    // First prefer explicit Discord metadata. Include class/id/data/alt because
    // the large profile banner itself often has no visible "Banner" text.
    for (const current of elements) {
        const datasetText = Object.entries(current.dataset)
            .map(([key, value]) => `${key} ${value ?? ""}`)
            .join(" ");

        const label = [
            current.textContent,
            current.getAttribute("aria-label"),
            current.getAttribute("title"),
            current.getAttribute("alt"),
            current.id,
            typeof current.className === "string" ? current.className : "",
            datasetText
        ].filter(Boolean).join(" ");

        if (/\bbanner\b/i.test(label)) {
            lastProfileImageTarget = "BANNER";
            lastProfileImageTargetAt = Date.now();
            return;
        }

        if (/\b(avatar|profile\s*(?:image|picture|icon)|user\s*avatar)\b/i.test(label)) {
            lastProfileImageTarget = "AVATAR";
            lastProfileImageTargetAt = Date.now();
            return;
        }
    }

    // Locale-independent fallback: inspect the composed path from the clicked
    // element outward and classify the *nearest* profile-sized control. Doing both
    // shapes in one pass prevents a wide outer profile container from overriding
    // the avatar circle that was actually clicked.
    for (const current of elements.slice(0, 6)) {
        const rect = current.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;

        const ratio = rect.width / rect.height;
        const area = rect.width * rect.height;

        const avatarSized = rect.width >= 42
            && rect.width <= 180
            && rect.height >= 42
            && rect.height <= 180
            && ratio >= 0.78
            && ratio <= 1.28;

        if (avatarSized) {
            const radius = getComputedStyle(current).borderRadius;
            if (radius.includes("%") || parseFloat(radius) >= rect.width * 0.22) {
                lastProfileImageTarget = "AVATAR";
                lastProfileImageTargetAt = Date.now();
                return;
            }
        }

        const bannerSized = rect.width >= 170
            && rect.height >= 55
            && ratio >= 1.7
            && area <= 220_000;

        if (bannerSized) {
            lastProfileImageTarget = "BANNER";
            lastProfileImageTargetAt = Date.now();
            return;
        }
    }
}

function isElementVisible(element: HTMLElement) {
    if (!element.isConnected) return false;
    if (element.getAttribute("aria-hidden") === "true") return false;

    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function closeDiscordImageModal(dialog: HTMLElement) {
    const candidates = Array.from(dialog.querySelectorAll<HTMLElement>("button, [role='button']"))
        .filter(isElementVisible);

    // Keep the old English/Spanish labels as a fast compatibility path, but do
    // not depend on them. Pinterest Tool itself stays in English while Discord
    // is free to use any locale.
    for (const candidate of candidates) {
        const label = candidate.getAttribute("aria-label")?.trim().toLowerCase();
        const title = candidate.getAttribute("title")?.trim().toLowerCase();
        if (label === "close" || title === "close" || label === "cerrar" || title === "cerrar") {
            candidate.click();
            return;
        }
    }

    // Locale-independent fallback: Discord's modal close control is an icon-only
    // button placed at a top corner. Prefer that geometry instead of maintaining
    // a translation table for every language Discord supports.
    const dialogRect = dialog.getBoundingClientRect();
    const iconButtons = candidates
        .filter(candidate => {
            const rect = candidate.getBoundingClientRect();
            const text = (candidate.textContent ?? "").trim();
            const nearTop = rect.top <= dialogRect.top + Math.min(88, dialogRect.height * 0.22);
            const nearEdge = rect.left <= dialogRect.left + 72 || rect.right >= dialogRect.right - 72;
            return nearTop
                && nearEdge
                && rect.width <= 52
                && rect.height <= 52
                && text.length <= 2
                && candidate.querySelector("svg") !== null;
        })
        .sort((a, b) => {
            const aRect = a.getBoundingClientRect();
            const bRect = b.getBoundingClientRect();
            return aRect.top - bRect.top || Math.min(aRect.left - dialogRect.left, dialogRect.right - aRect.right)
                - Math.min(bRect.left - dialogRect.left, dialogRect.right - bRect.right);
        });

    iconButtons[0]?.click();
}

function isImageInput(input: HTMLInputElement) {
    const accept = input.accept.trim().toLowerCase();
    if (!accept) return true;

    // Discord's profile uploader currently advertises image formats as file
    // extensions (for example: .jpg,.jpeg,.jfif,.png,.gif,.webp,.avif) rather
    // than MIME types such as image/*. Treat both forms as image-only inputs.
    return accept.split(",").some(rawToken => {
        const token = rawToken.trim();
        return token === "image/*"
            || token.startsWith("image/")
            || /^\.(?:jpe?g|jfif|png|gif|webp|avif|bmp|ico|tiff?)$/i.test(token);
    });
}

function isSafeProfileImageInput(input: HTMLInputElement) {
    // Profile avatar/banner pickers are single-image flows. Reject generic or
    // multi-file uploaders so Pinterest Tool can never hand media to chat.
    return input.type === "file" && isImageInput(input) && !input.multiple;
}

function getReferencedFileInput(element: HTMLElement): HTMLInputElement | null {
    // Discord may render the visible Upload Image tile as a <label> whose real
    // file input lives elsewhere in the DOM. Resolve only explicit DOM
    // relationships; never scan arbitrary document-wide file inputs.
    let current: HTMLElement | null = element;

    for (let depth = 0; current && depth < 6; depth++, current = current.parentElement) {
        if (current instanceof HTMLLabelElement) {
            const { control } = current;
            if (control instanceof HTMLInputElement && isSafeProfileImageInput(control)) return control;
        }

        const descendant = current.querySelector<HTMLInputElement>("input[type='file']");
        if (descendant && isSafeProfileImageInput(descendant)) return descendant;

        const ids = [
            current.getAttribute("for"),
            current.getAttribute("aria-controls")
        ].filter((value): value is string => Boolean(value));

        for (const rawIds of ids) {
            for (const id of rawIds.split(/\s+/g)) {
                const referenced = document.getElementById(id);
                if (referenced instanceof HTMLInputElement && isSafeProfileImageInput(referenced)) {
                    return referenced;
                }
            }
        }
    }

    return null;
}

function getImageFileInput(dialog: HTMLElement): HTMLInputElement | null {
    const uploadRoot = findUploadTile(dialog);

    // First use an input physically owned by this dialog. Prefer the one
    // structurally related to Upload Image when Discord exposes that relation.
    if (uploadRoot) {
        const referenced = getReferencedFileInput(uploadRoot);
        if (referenced) return referenced;
    }

    const localInputs = Array.from(dialog.querySelectorAll<HTMLInputElement>("input[type='file']"))
        .filter(isSafeProfileImageInput);

    return localInputs.length === 1 ? localInputs[0] : null;
}

function setInputFile(input: HTMLInputElement, file: File) {
    const transfer = new DataTransfer();
    transfer.items.add(file);

    try {
        input.files = transfer.files;
    } catch {
        Object.defineProperty(input, "files", {
            configurable: true,
            value: transfer.files
        });
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

function getControlSearchText(node: HTMLElement) {
    return [
        node.textContent,
        node.getAttribute("aria-label"),
        node.getAttribute("title")
    ].filter(Boolean).join(" ").trim();
}

function findGifTile(dialog: HTMLElement): HTMLElement | null {
    // "GIF" is a media-format name rather than a translated action label. It is
    // therefore a much safer structural landmark than strings such as
    // "Choose GIF" / "Elegir GIF" / etc.
    const nodes = Array.from(dialog.querySelectorAll<HTMLElement>(
        "button, [role='button'], [tabindex='0'], label, div, span"
    ));

    const candidates = nodes
        .filter(node => {
            const label = getControlSearchText(node);
            // Ignore large parent containers whose text happens to include the GIF
            // tile somewhere deep inside; we want the tile/label nearest to GIF.
            return label.length <= 96 && /\bgifs?\b/i.test(label);
        })
        .map(node => clickableRoot(node, dialog))
        .filter((root, index, roots) => root !== dialog && roots.indexOf(root) === index)
        .filter(isElementVisible)
        .map(root => ({ root, rect: root.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width >= 70 && rect.height >= 44)
        .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);

    return candidates[0]?.root ?? null;
}

function getClickableCandidate(container: HTMLElement, dialog: HTMLElement): HTMLElement {
    if (container.matches("button, [role='button'], [tabindex='0'], label")) return container;

    const nested = container.querySelector<HTMLElement>("button, [role='button'], [tabindex='0'], label");
    if (nested) return nested;

    // Discord occasionally puts the React onClick directly on an otherwise
    // unannotated tile wrapper. Returning the wrapper is intentional: the input
    // capture probe can still dispatch Discord's native click handler on it.
    return container;
}

function findUploadTileNextToGif(dialog: HTMLElement, gifTile: HTMLElement): HTMLElement | null {
    const gifRect = gifTile.getBoundingClientRect();
    let branch: HTMLElement = gifTile;
    let ancestor = gifTile.parentElement;

    // Walk from the GIF tile outwards until we reach the row that owns both large
    // picker tiles. The sibling with matching geometry is the Upload Image tile,
    // regardless of the language of its visible label.
    while (ancestor && ancestor !== dialog) {
        const siblings = Array.from(ancestor.children)
            .filter((child): child is HTMLElement => child instanceof HTMLElement && child !== branch)
            .filter(isElementVisible)
            .map(sibling => ({ sibling, rect: sibling.getBoundingClientRect() }))
            .filter(({ rect }) => {
                const sameRow = Math.abs(rect.top - gifRect.top) <= Math.max(30, gifRect.height * 0.35);
                const similarHeight = rect.height >= gifRect.height * 0.55 && rect.height <= gifRect.height * 1.7;
                const tileSized = rect.width >= 70 && rect.height >= 44;
                return sameRow && similarHeight && tileSized;
            })
            .sort((a, b) => {
                const aDistance = Math.abs(a.rect.left - gifRect.left);
                const bDistance = Math.abs(b.rect.left - gifRect.left);
                return aDistance - bDistance;
            });

        if (siblings.length) {
            const candidate = getClickableCandidate(siblings[0].sibling, dialog);
            if (candidate !== gifTile && !candidate.contains(gifTile) && !gifTile.contains(candidate)) {
                return candidate;
            }
        }

        branch = ancestor;
        ancestor = ancestor.parentElement;
    }

    return null;
}

function findUploadTileFromLocalInput(dialog: HTMLElement): HTMLElement | null {
    const inputs = Array.from(dialog.querySelectorAll<HTMLInputElement>("input[type='file']"))
        .filter(isSafeProfileImageInput);
    if (inputs.length !== 1) return null;

    const input = inputs[0];
    if (input.id) {
        const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(input.id)
            : input.id.replace(/["\\]/g, "\\$&");
        const label = dialog.querySelector<HTMLElement>(`label[for="${escapedId}"]`);
        if (label) return clickableRoot(label, dialog);
    }

    const parentLabel = input.closest<HTMLElement>("label");
    if (parentLabel && dialog.contains(parentLabel)) return clickableRoot(parentLabel, dialog);

    let current = input.parentElement;
    for (let depth = 0; current && current !== dialog && depth < 6; depth++, current = current.parentElement) {
        if (current.matches("button, [role='button'], [tabindex='0'], label")) return current;
    }

    return null;
}

function findLegacyUploadTile(dialog: HTMLElement): HTMLElement | null {
    // Last-resort compatibility only. New locale support must not rely on this list.
    const labels = ["Upload Image", "Subir imagen", "Cargar imagen", "Upload", "Subir"];

    for (const label of labels) {
        const match = exactText(dialog, label);
        if (match) return clickableRoot(match, dialog);
    }

    return null;
}

function findUploadTile(dialog: HTMLElement): HTMLElement | null {
    // Current Discord profile pickers expose a GIF companion tile. Pairing its
    // sibling by layout makes Upload Image detection independent of Discord locale.
    const gifTile = findGifTile(dialog);
    if (gifTile) {
        const fromPair = findUploadTileNextToGif(dialog, gifTile);
        if (fromPair) return fromPair;
    }

    // Some Discord variants expose the actual input in the picker DOM. This is
    // also language-independent, but comes second so unrelated upload dialogs do
    // not outrank the characteristic profile-picker GIF pair.
    const fromInput = findUploadTileFromLocalInput(dialog);
    if (fromInput) return fromInput;

    return findLegacyUploadTile(dialog);
}

function logProfileInputDiagnostics(dialog: HTMLElement) {
    const uploadRoot = findUploadTile(dialog);
    const localInputs = Array.from(dialog.querySelectorAll<HTMLInputElement>("input[type='file']"));

    console.info("[PinterestTool] Edit handoff diagnostics", {
        uploadElement: uploadRoot?.tagName ?? null,
        uploadRole: uploadRoot?.getAttribute("role") ?? null,
        uploadFor: uploadRoot?.getAttribute("for") ?? null,
        uploadAriaControls: uploadRoot?.getAttribute("aria-controls") ?? null,
        localFileInputs: localInputs.map(input => ({
            accept: input.accept,
            multiple: input.multiple,
            id: input.id || null,
            name: input.name || null
        }))
    });
}

function findDiscordImageEditorDialog(originalDialog: HTMLElement): HTMLElement | null {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>("[role='dialog']"));

    return candidates.find(candidate => {
        // Discord may keep a finished editor mounted but hidden for reuse. Treat
        // hidden dialogs as closed so Cancel works in every locale even when the
        // button label itself is unknown to Pinterest Tool.
        if (!isElementVisible(candidate)) return false;
        // Ignore the original "Select an Image" dialog itself — it can still
        // contain matching words mid-transition, which previously caused a
        // false positive: we'd close the Pinterest modal thinking the real
        // editor had appeared, before it actually had, making it look like
        // the editor "flashed and disappeared".
        if (candidate === originalDialog || originalDialog.contains(candidate)) return false;

        const text = candidate.textContent ?? "";
        const hasEditorText =
            /Edit\s+Image|Editar\s+imagen/i.test(text)
            || (/\bReset\b/i.test(text) && /\bApply\b/i.test(text) && /\bCancel\b/i.test(text))
            || (/\bRestablecer\b/i.test(text) && /\bAplicar\b/i.test(text) && /\bCancelar\b/i.test(text));

        // Some Discord builds (and the banner editor specifically) may not use
        // this exact wording. Fall back to detecting the actual crop/zoom
        // controls (a range slider and/or a canvas), which is more resilient
        // to locale/copy differences between the avatar and banner editors.
        const hasEditorControls =
            candidate.querySelector("input[type='range']") !== null
            || candidate.querySelector("canvas") !== null;

        return hasEditorText || hasEditorControls;
    }) ?? null;
}

async function hasDiscordImageEditor(originalDialog: HTMLElement, settleMs = 220): Promise<boolean> {
    const first = findDiscordImageEditorDialog(originalDialog);
    if (!first) return false;

    // Confirm the editor dialog is still there a moment later, instead of
    // trusting the very first detection. This avoids reporting "found" on a
    // dialog that was only transiently present during Discord's own modal
    // transition.
    await new Promise(resolve => window.setTimeout(resolve, settleMs));
    return findDiscordImageEditorDialog(originalDialog) !== null;
}

type DiscordImageEditorOutcome = "APPLIED" | "CANCELLED";

function getEditorControlLabel(element: HTMLElement) {
    return [
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title")
    ].filter(Boolean).join(" ").trim();
}

function getBackgroundAlpha(element: HTMLElement) {
    const color = getComputedStyle(element).backgroundColor.trim();
    if (!color || color === "transparent") return 0;

    const rgba = /^rgba?\(([^)]+)\)$/i.exec(color);
    if (!rgba) return 1;

    const parts = rgba[1].split(",").map(part => part.trim());
    return parts.length >= 4 ? Number(parts[3]) || 0 : 1;
}

function isControlInsideEditor(control: HTMLElement, editor: HTMLElement) {
    if (editor.contains(control)) return true;

    // Some Discord builds portal footer controls. Geometry keeps this association
    // locale-independent without accepting unrelated buttons elsewhere on screen.
    const editorRect = editor.getBoundingClientRect();
    const controlRect = control.getBoundingClientRect();
    const x = controlRect.left + controlRect.width / 2;
    const y = controlRect.top + controlRect.height / 2;
    return x >= editorRect.left - 16
        && x <= editorRect.right + 16
        && y >= editorRect.top - 16
        && y <= editorRect.bottom + 32;
}

function getEditorFooterButtons(editor: HTMLElement, clicked: HTMLElement) {
    const editorRect = editor.getBoundingClientRect();
    const clickedRect = clicked.getBoundingClientRect();
    const clickedCenterY = clickedRect.top + clickedRect.height / 2;

    return Array.from(document.querySelectorAll<HTMLElement>("button, [role='button']"))
        .filter(isElementVisible)
        .filter(button => isControlInsideEditor(button, editor))
        .filter(button => {
            const rect = button.getBoundingClientRect();
            const centerY = rect.top + rect.height / 2;
            const inFooter = centerY >= editorRect.top + editorRect.height * 0.55;
            const sameRow = Math.abs(centerY - clickedCenterY) <= Math.max(18, clickedRect.height * 0.7);
            return inFooter && sameRow && rect.width >= 48 && rect.height >= 24 && rect.height <= 64;
        });
}

function classifyEditorControl(control: HTMLElement, editor: HTMLElement): DiscordImageEditorOutcome | null {
    const label = getEditorControlLabel(control);

    // Preserve the known labels as a compatibility fast path.
    if (/^(?:Apply|Aplicar)$/i.test(label)) return "APPLIED";
    if (/^(?:Cancel|Cancelar)$/i.test(label)) return "CANCELLED";

    if (!isControlInsideEditor(control, editor)) return null;

    // Native form semantics are language-independent and are the strongest Apply signal.
    const type = control instanceof HTMLButtonElement ? control.type : control.getAttribute("type");
    if (type?.toLowerCase() === "submit") return "APPLIED";

    const buttons = getEditorFooterButtons(editor, control);
    if (buttons.length < 2) return null;

    const primaryScore = (button: HTMLElement) => {
        const classText = typeof button.className === "string" ? button.className : "";
        const buttonType = button instanceof HTMLButtonElement ? button.type : button.getAttribute("type");
        let score = 0;

        if (buttonType?.toLowerCase() === "submit") score += 100;
        // Discord class names are hashed, but semantic fragments such as lookFilled
        // and colorBrand have historically remained useful hints. They are only a
        // fallback signal; locale text is never required.
        if (/lookFilled|colorBrand|buttonColor/i.test(classText)) score += 30;
        if (/lookLink|lookBlank/i.test(classText)) score -= 15;
        score += getBackgroundAlpha(button) * 10;
        return score;
    };

    const ranked = buttons
        .map(button => ({ button, score: primaryScore(button) }))
        .sort((a, b) => b.score - a.score);

    const primary = ranked[0];
    const second = ranked[1];
    if (primary && primary.score >= 4.5 && (!second || primary.score - second.score >= 2.5)) {
        if (primary.button === control) return "APPLIED";

        const primaryRect = primary.button.getBoundingClientRect();
        const controlRect = control.getBoundingClientRect();
        const gap = Math.max(
            0,
            Math.max(primaryRect.left, controlRect.left) - Math.min(primaryRect.right, controlRect.right)
        );
        if (gap <= 220) return "CANCELLED";
    }

    return null;
}

async function waitForDiscordImageEditorOutcome(
    originalDialog: HTMLElement,
    onApplyStart?: () => void
): Promise<DiscordImageEditorOutcome | false> {
    const editor = findDiscordImageEditorDialog(originalDialog);
    if (!editor) return false;

    console.info("[PinterestTool] Edit lifecycle: editor opened; keeping Pinterest underneath until Apply/Cancel.");

    return await new Promise(resolve => {
        let pendingAction: DiscordImageEditorOutcome | null = null;
        let settled = false;

        const cleanup = () => {
            document.removeEventListener("click", onDocumentClick, true);
            document.removeEventListener("keydown", onDocumentKeyDown, true);
            document.removeEventListener("submit", onDocumentSubmit, true);
            observer.disconnect();
        };

        const finish = (outcome: DiscordImageEditorOutcome) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(outcome);
        };

        const onDocumentClick = (event: Event) => {
            // Listen at document capture level rather than on the editor element.
            // Discord can portal/re-parent the editor footer controls and can also
            // unmount/reuse the dialog during the same click. In either case an
            // editor-local listener may never observe Apply/Cancel, leaving the
            // Pinterest selection lock active forever.
            const target = event.target instanceof Element
                ? event.target.closest<HTMLElement>("button, [role='button']")
                : null;
            if (!target) return;

            const activeEditor = findDiscordImageEditorDialog(originalDialog);
            if (!activeEditor && !editor.isConnected) return;

            const action = activeEditor ? classifyEditorControl(target, activeEditor) : null;

            if (action === "APPLIED") {
                pendingAction = "APPLIED";

                // Close Pinterest while Discord's editor is still above it, then
                // resolve immediately. Do not wait for Discord to physically remove
                // the editor node because current builds may reuse/hide that node.
                onApplyStart?.();
                console.info("[PinterestTool] Edit lifecycle: Apply selected.");
                finish("APPLIED");
                return;
            }

            if (action === "CANCELLED") {
                pendingAction = "CANCELLED";

                // Cancel should immediately release Pinterest's selection lock so
                // another result can be chosen as soon as the picker is revealed.
                console.info("[PinterestTool] Edit lifecycle: Cancel selected.");
                finish("CANCELLED");
                return;
            }

            const ariaLabel = target.getAttribute("aria-label")?.trim() ?? "";
            const title = target.getAttribute("title")?.trim() ?? "";
            if (/^(?:Close|Cerrar)$/i.test(ariaLabel) || /^(?:Close|Cerrar)$/i.test(title)) {
                finish("CANCELLED");
                return;
            }

            // Unknown localized footer labels are still safe: after Discord handles
            // the click, the visibility-aware observer below sees a hidden/replaced
            // editor and releases the lock as Cancel unless an Apply signal occurred.
        };

        const onDocumentSubmit = (event: Event) => {
            if (settled) return;

            const activeEditor = findDiscordImageEditorDialog(originalDialog);
            if (!activeEditor) return;

            const form = event.target instanceof HTMLFormElement ? event.target : null;
            if (!form) return;
            if (!activeEditor.contains(form) && !form.contains(activeEditor)) return;

            pendingAction = "APPLIED";
            onApplyStart?.();
            console.info("[PinterestTool] Edit lifecycle: Apply submitted.");
            finish("APPLIED");
        };

        const onDocumentKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") finish("CANCELLED");
        };

        const observer = new MutationObserver(() => {
            if (settled) return;

            // If Discord really removes the editor, preserve the old fallback.
            if (!editor.isConnected) {
                finish(pendingAction ?? "CANCELLED");
                return;
            }

            // Some Discord builds keep the same dialog node mounted but remove the
            // editor contents / replace it with another dialog. Treat that as closed.
            const currentEditor = findDiscordImageEditorDialog(originalDialog);
            if (!currentEditor) {
                finish(pendingAction ?? "CANCELLED");
            }
        });

        document.addEventListener("click", onDocumentClick, true);
        document.addEventListener("keydown", onDocumentKeyDown, true);
        document.addEventListener("submit", onDocumentSubmit, true);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "style", "aria-hidden", "data-state"]
        });

        // Handle the race where Discord closes/replaces the editor before the
        // listeners/observer finish attaching.
        if (!editor.isConnected) finish("CANCELLED");
    });
}

async function captureDiscordProfileInput(dialog: HTMLElement): Promise<HTMLInputElement | null> {
    const uploadRoot = findUploadTile(dialog);
    if (!uploadRoot) return null;

    // Discord does not currently expose the profile file input in/through the
    // Select an Image dialog. Ask Discord's own Upload Image control which input
    // it would use, while temporarily intercepting the native file-picker calls.
    // This gives us Discord's exact input without opening Windows Explorer and
    // without ever scanning/guessing document-wide inputs such as chat upload.
    const inputPrototype = HTMLInputElement.prototype;
    const originalClick = inputPrototype.click;
    const originalShowPicker = (inputPrototype as any).showPicker as ((this: HTMLInputElement) => void) | undefined;

    const probe = {
        captured: null as HTMLInputElement | null,
        rejected: null as HTMLInputElement | null
    };

    const capture = (input: HTMLInputElement) => {
        if (input.type !== "file") return false;

        // Suppress every native file chooser during this very short probe so an
        // unexpected Discord implementation still cannot open Windows Explorer.
        if (!probe.captured && isSafeProfileImageInput(input)) probe.captured = input;
        else if (!isSafeProfileImageInput(input)) probe.rejected = input;
        return true;
    };

    function interceptedClick(this: HTMLInputElement) {
        if (capture(this)) return;
        return originalClick.call(this);
    }

    function interceptedShowPicker(this: HTMLInputElement) {
        if (capture(this)) return;
        return originalShowPicker?.call(this);
    }

    // Prevent browser/label default activation while still allowing Discord's
    // React click handler to run. If that handler calls input.click/showPicker,
    // the temporary hooks above capture the exact input and suppress the picker.
    const preventNativeActivation = (event: Event) => event.preventDefault();

    try {
        inputPrototype.click = interceptedClick;
        if (originalShowPicker) (inputPrototype as any).showPicker = interceptedShowPicker;
        uploadRoot.addEventListener("click", preventNativeActivation, true);

        uploadRoot.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window
        }));

        // React handlers normally call the file input synchronously, but leave a
        // tiny window for a queued callback while the interception remains active.
        for (let attempt = 0; attempt < 8 && !probe.captured; attempt++) {
            await new Promise(resolve => window.setTimeout(resolve, 20));
        }
    } catch (error) {
        console.warn("[PinterestTool] Edit handoff: Discord upload-input probe failed.", error);
    } finally {
        uploadRoot.removeEventListener("click", preventNativeActivation, true);
        inputPrototype.click = originalClick;
        if (originalShowPicker) (inputPrototype as any).showPicker = originalShowPicker;
    }

    const { captured, rejected } = probe;
    if (captured) {
        console.info("[PinterestTool] Edit handoff: captured Discord's profile upload input without opening the OS picker.", {
            insideDialog: dialog.contains(captured),
            accept: captured.accept,
            multiple: captured.multiple,
            id: captured.id || null,
            name: captured.name || null
        });
        return captured;
    }

    if (rejected) {
        console.warn("[PinterestTool] Edit handoff: Discord requested a non-profile/multi-file input; refusing it.", {
            accept: rejected.accept,
            multiple: rejected.multiple,
            id: rejected.id || null,
            name: rejected.name || null
        });
    }

    return null;
}

async function handoffToDiscordImageEditor(
    dialog: HTMLElement,
    file: File,
    onApplyStart?: () => void
): Promise<DiscordImageEditorOutcome | false> {
    if (!dialog.isConnected) return false;

    // Fast path: use an input Discord explicitly exposes through the profile
    // dialog. Current builds usually do not, so the capture probe is the safe
    // fallback before direct-apply.
    let input = getImageFileInput(dialog);

    if (!input) {
        console.info("[PinterestTool] Edit handoff: no explicit profile input; probing Discord's native Upload Image action.");
        input = await captureDiscordProfileInput(dialog);
    }

    if (!input) {
        console.warn("[PinterestTool] Edit handoff: Discord did not reveal a safe profile image input; using direct-apply fallback.");
        logProfileInputDiagnostics(dialog);
        return false;
    }

    try {
        setInputFile(input, file);
    } catch (error) {
        console.warn("[PinterestTool] Edit handoff: failed to assign the Pinterest file to Discord's captured profile input.", error);
        return false;
    }

    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
        if (await hasDiscordImageEditor(dialog)) {
            console.info("[PinterestTool] Edit handoff: Discord Edit Image detected.");
            return await waitForDiscordImageEditorOutcome(dialog, onApplyStart);
        }
        await new Promise(resolve => window.setTimeout(resolve, 60));
    }

    console.warn("[PinterestTool] Edit handoff: profile input accepted the file, but Edit Image was not detected; using direct-apply fallback.");
    return false;
}

function PinterestMark() {
    const mark = document.createElement("span");
    mark.className = "vc-pinterest-tool-mark";
    mark.setAttribute("aria-hidden", "true");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "15");
    svg.setAttribute("height", "15");
    svg.setAttribute("fill", "currentColor");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
        "d",
        "M12 0C5.4 0 0 5.4 0 12c0 5.1 3.2 9.4 7.6 11.1-.1-.9-.2-2.3 0-3.3.2-.9 1.3-5.6 1.3-5.6s-.3-.7-.3-1.6c0-1.5.9-2.7 2-2.7.9 0 1.4.7 1.4 1.6 0 1-.6 2.4-1 3.7-.3 1.1.5 2 1.6 2 1.9 0 3.4-2 3.4-5 0-2.6-1.9-4.5-4.6-4.5-3.1 0-5 2.3-5 4.8 0 .9.3 1.8.8 2.4.1.1.1.2 0 .3l-.3 1.2c-.1.2-.2.3-.4.2-1.5-.7-2.4-2.8-2.4-4.6 0-3.7 2.7-7.2 7.8-7.2 4.1 0 7.3 2.9 7.3 6.8 0 4.1-2.6 7.3-6.1 7.3-1.2 0-2.3-.6-2.7-1.4l-.7 2.8c-.3 1-1 2.3-1.4 3.1.1 0 .2.1.3.1 1.1.4 2.2.6 3.4.6 6.6 0 12-5.4 12-12S18.6 0 12 0z"
    );

    svg.append(path);
    mark.append(svg);
    return mark;
}

function buildPinterestEntry(
    dialog: HTMLElement,
    target: Extract<SearchKind, "AVATAR" | "BANNER">
) {
    // Use our own compact button instead of cloning Discord's upload-tile classes.
    // Cloning those classes can inherit height:100% and make the whole modal enormous.
    const entry = document.createElement("button");
    entry.className = "vc-pinterest-tool-profile-entry";
    entry.setAttribute("data-vc-pinterest-tool", "true");
    entry.setAttribute("aria-label", target === "BANNER" ? "Find a banner on Pinterest" : "Find an icon on Pinterest");
    entry.setAttribute("tabindex", "0");
    if (!entry.hasAttribute("role")) entry.setAttribute("role", "button");
    entry.type = "button";

    entry.append(PinterestMark());

    const text = document.createElement("div");
    text.className = "vc-pinterest-tool-profile-entry-text";
    text.textContent = target === "BANNER" ? "Find a banner on Pinterest" : "Find an icon on Pinterest";
    entry.append(text);

    const activate = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();

        const liveTarget = getTarget(dialog);

        openModal(props => (
            <WrappedPinterestProfileModal
                {...props}
                target={liveTarget}
                onEditFile={(file, onApplyStart) => handoffToDiscordImageEditor(dialog, file, onApplyStart)}
                onApplied={() => closeDiscordImageModal(dialog)}
            />
        ));
    };

    entry.addEventListener("click", activate, true);
    entry.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") activate(event);
    }, true);

    return entry;
}

function enhanceImageDialog(dialog: HTMLElement) {
    if (dialog.querySelector("[data-vc-pinterest-tool='true']")) return;
    if (!isElementVisible(dialog)) return;

    // The crop/zoom editor is a different Discord modal and must never receive a
    // Pinterest entry even if a future build happens to expose a file input there.
    if (dialog.querySelector("canvas, input[type='range']")) return;

    // Never key Pinterest Tool activation to Discord's translated copy. Locate the
    // profile image picker from its real controls/geometry instead; Pinterest Tool's
    // own UI intentionally remains English for every Discord locale.
    const uploadTile = findUploadTile(dialog);
    if (!uploadTile) return;

    const gifTile = findGifTile(dialog);
    const row = gifTile ? commonAncestor(uploadTile, gifTile, dialog) : null;
    const anchor = row ?? uploadTile;

    const target = getTarget(dialog);
    const entry = buildPinterestEntry(dialog, target);

    // Keep Discord's native tiles untouched and place the compact Pinterest button
    // underneath the picker row. GIF is optional so a Discord UI variant without a
    // GIF tile can still expose Pinterest through an explicit profile image input.
    anchor.insertAdjacentElement("afterend", entry);
}

function scanForImageDialogs() {
    scanQueued = false;

    const dialogs = document.querySelectorAll<HTMLElement>("[role='dialog']");
    for (const dialog of dialogs) enhanceImageDialog(dialog);
}

function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(scanForImageDialogs);
}

function removeInjectedEntries() {
    document.querySelectorAll("[data-vc-pinterest-tool='true']").forEach(node => node.remove());
}

export default definePlugin({
    name: "Pinterest Tool",
    description: "Adds Pinterest search to Discord's avatar and banner picker, with GIFs, favorites, themes and image editing—no manual downloads.",
    tags: ["Utility", "Customisation"],
    authors: [TestcordDevs.szcx404],
    settings,
    managedStyle,

    start() {
        document.addEventListener("pointerdown", rememberProfileImageTarget, true);
        queueScan();
        observer = new MutationObserver(queueScan);
        observer.observe(document.body, { childList: true, subtree: true });
    },

    stop() {
        document.removeEventListener("pointerdown", rememberProfileImageTarget, true);
        observer?.disconnect();
        observer = null;
        removeInjectedEntries();
    }
});
