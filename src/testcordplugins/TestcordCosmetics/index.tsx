/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Flex } from "@components/Flex";
import { TestcordDevs } from "@utils/constants";
import { openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { Button, React, showToast, Text, TextInput, UserStore } from "@webpack/common";
import type { CSSProperties } from "react";

interface Cosmetic {
    color1: string;
    color2?: string;
}

type ColorStrings = Record<"primaryColor" | "secondaryColor" | "tertiaryColor", string | undefined>;

interface MemberContext {
    user?: { id: string; };
}

interface MessageContext {
    message?: { author?: { id: string; }; };
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

const PRESETS: Array<{ name: string; color1: string; color2: string; }> = [
    { name: "Testcord", color1: "#8855FF", color2: "#00DDFF" },
    { name: "Sunset", color1: "#FF7A59", color2: "#FFD46B" },
    { name: "Ocean", color1: "#58B9FF", color2: "#6BFFE3" },
    { name: "Lilac", color1: "#B58CFF", color2: "#FF8AC4" },
    { name: "Mint", color1: "#6BFFB4", color2: "#58D6FF" },
    { name: "Cherry", color1: "#FF4D6D", color2: "#FFB3C6" },
    { name: "Mango", color1: "#FF9A3C", color2: "#FFDD6B" },
    { name: "Lagoon", color1: "#2FD8C8", color2: "#58B9FF" },
    { name: "Flamingo", color1: "#FF6FA3", color2: "#FF9A6B" }
];

function nameStyle(color1: string, color2?: string): CSSProperties {
    if (color2) {
        return {
            backgroundImage: `linear-gradient(90deg, ${color1}, ${color2})`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent"
        };
    }
    return { color: color1 };
}

const settings = definePluginSettings({
    color1: {
        type: OptionType.STRING,
        description: "Primary username color (Hex, e.g. #8855FF)",
        default: ""
    },
    color2: {
        type: OptionType.STRING,
        description: "Secondary username color for gradient (Hex, e.g. #00DDFF, optional)",
        default: ""
    }
});

function NameStyleEditor() {
    const [color1, setColor1] = React.useState(settings.store.color1 || "");
    const [color2, setColor2] = React.useState(settings.store.color2 || "");
    const me = UserStore.getCurrentUser();
    const previewName = me?.username ?? "your name";
    const validPreview = HEX_RE.test(color1.trim());

    function save() {
        const c1 = color1.trim();
        const c2 = color2.trim();
        if (!HEX_RE.test(c1)) {
            showToast("Pick a first color like #8855FF.", "failure");
            return;
        }
        if (c2 && !HEX_RE.test(c2)) {
            showToast("The second color must look like #00DDFF.", "failure");
            return;
        }

        settings.store.color1 = c1;
        settings.store.color2 = c2;
        showToast("Name style saved.", "success");
    }

    function remove() {
        settings.store.color1 = "";
        settings.store.color2 = "";
        setColor1("");
        setColor2("");
        showToast("Name style removed.", "success");
    }

    return (
        <div style={{ padding: 12 }}>
            <Text variant="text-sm/normal" style={{ opacity: 0.8, marginBottom: 8 }}>
                Pick one color for a solid name or two for a gradient. Displayed across chat and the member list.
            </Text>
            <Flex style={{ gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {PRESETS.map(p => (
                    <div
                        key={p.name}
                        role="button"
                        onClick={() => {
                            setColor1(p.color1);
                            setColor2(p.color2);
                        }}
                        style={{
                            padding: "4px 12px",
                            borderRadius: 999,
                            cursor: "pointer",
                            backgroundImage: `linear-gradient(90deg, ${p.color1}, ${p.color2})`,
                            color: "#1a0e14",
                            fontSize: 12,
                            fontWeight: 600
                        }}
                    >
                        {p.name}
                    </div>
                ))}
            </Flex>
            <Flex style={{ gap: 8, alignItems: "center", marginBottom: 10 }}>
                <div style={{ width: 110 }}>
                    <TextInput value={color1} onChange={setColor1} placeholder="#8855FF" maxLength={7} />
                </div>
                <div style={{ width: 110 }}>
                    <TextInput value={color2} onChange={setColor2} placeholder="#00DDFF" maxLength={7} />
                </div>
                <Text
                    variant="text-md/semibold"
                    style={validPreview ? nameStyle(color1.trim(), HEX_RE.test(color2.trim()) ? color2.trim() : undefined) : {}}
                >
                    {previewName}
                </Text>
            </Flex>
            <Flex style={{ gap: 8 }}>
                <Button color={Button.Colors.BRAND} size={Button.Sizes.SMALL} onClick={save}>
                    Save
                </Button>
                {(settings.store.color1 || settings.store.color2) && (
                    <Button color={Button.Colors.RED} look={Button.Looks.LINK} size={Button.Sizes.SMALL} onClick={remove}>
                        Remove
                    </Button>
                )}
            </Flex>
        </div>
    );
}

function NameStyleModal({ rootProps }: { rootProps: RenderModalProps; }) {
    return (
        <div style={{ padding: 16 }}>
            <Text variant="heading-lg/semibold" style={{ marginBottom: 12 }}>Style your name</Text>
            <NameStyleEditor />
        </div>
    );
}

function getMyCosmetic(): Cosmetic | null {
    const c1 = settings.store.color1;
    if (!c1 || !HEX_RE.test(c1)) return null;
    const c2 = settings.store.color2;
    return {
        color1: c1,
        color2: c2 && HEX_RE.test(c2) ? c2 : undefined
    };
}

export default definePlugin({
    id: "TestcordCosmetics",
    name: "TestcordCosmetics",
    description: "Give your username a custom color or gradient in chat and the member list.",
    authors: [TestcordDevs.sirphantom89],
    tags: ["Customisation", "Appearance"],
    settings,
    settingsAboutComponent: NameStyleEditor,

    patches: [
        {
            find: '="SYSTEM_TAG"',
            replacement: {
                match: /({[^}]*?colorString:\i,colorStrings:\i,colorRoleName:\i[^}]*?}=)([^,]+),/,
                replace: "$1$self.wrapMessageColorProps($2, arguments[0]),"
            }
        },
        {
            find: "#{intl::GUILD_OWNER}),children:",
            replacement: {
                match: /function\((\i)\)\{let\{colorRoleName:/,
                replace: "function($1){$1={...$1,...$self.memberListColorProps($1,$1.colorString,$1.colorStrings)};let{colorRoleName:"
            }
        }
    ],

    wrapMessageColorProps(colorProps: { colorString?: string; colorStrings?: ColorStrings; }, context: MessageContext) {
        try {
            const me = UserStore.getCurrentUser();
            if (!me || context?.message?.author?.id !== me.id) return colorProps;
            const c = getMyCosmetic();
            if (!c) return colorProps;
            return {
                ...colorProps,
                colorString: c.color1,
                colorStrings: {
                    primaryColor: c.color1,
                    secondaryColor: c.color2,
                    tertiaryColor: undefined
                }
            };
        } catch {
            return colorProps;
        }
    },

    memberListColorProps(context: MemberContext, colorString: string | null, colorStrings: ColorStrings | undefined) {
        try {
            const me = UserStore.getCurrentUser();
            if (!me || context?.user?.id !== me.id) return { colorString, colorStrings };
            const c = getMyCosmetic();
            if (!c) return { colorString, colorStrings };
            return {
                colorString: c.color1,
                colorStrings: {
                    primaryColor: c.color1,
                    secondaryColor: c.color2,
                    tertiaryColor: undefined
                }
            };
        } catch {
            return { colorString, colorStrings };
        }
    },

    toolboxActions: {
        "Style your name"() {
            openModal(props => <NameStyleModal rootProps={props} />);
        }
    }
});
