/* eslint-disable simple-header/header -- Independently written MIT plugin. */
/* Copyright (c) 2026 DavidHiFi. SPDX-License-Identifier: MIT */

// Checked against Discord Stable and PTB web build 620157, 2026-09-25.
// tests/patches.test.ts runs these against a downloaded Discord bundle.
export const patches = [
    // Voice gateway opcode 12. Viewers build the stream badge from these stream parameters.
    {
        find: "this._sentVideo&&",
        replacement: {
            match: /this\._sentVideo&&(\i)\.video\((\i),(\i),(\i),(\i)\)/,
            replace: "this._sentVideo&&$1.video($2,$3,$4,$self.advertise(this,$5))"
        }
    },
    // Your own stream tile builds its badge from local settings, not from the gateway.
    {
        find: '"useMaxQuality"',
        replacement: {
            match: /(\i===\i\.user\.id\?\{maxFrameRate:)(\i)\.fps,maxResolution:(\(0,\i\.\i\)\("useMaxQuality",\i,\{[^{}]+\},\i\.fps\))/,
            replace: "$1$self.badgeFps($2.fps),maxResolution:$self.badgeResolution($3)"
        }
    },
    // Encoder limits. Every transport update for video goes through applyQualityConstraints.
    {
        find: "overwriteQualityForTesting(",
        replacement: {
            match: /return (this\.videoQualityManager\.applyQualityConstraints\(\i,\i\))/,
            replace: "return $self.constraints(this,$1)"
        }
    },
    // Native stream connection: capture size, frame rate, bitrate, codec, keyframes and HDR.
    {
        find: "lastDesktopEncodingOptions",
        replacement: [
            {
                match: /(setDesktopEncodingOptions\((\i),(\i),(\i)\)\{if\(this\.destroyed\)return;this\.lastDesktopEncodingOptions=\{[^{}]+\};)(let (\i)=this\.calcMaxBitrateFunc\(\{[^{}]+\}\);null==\6&&\(\6=[^;]+\);)/,
                replace: "$1[$2,$3,$4]=$self.encoding(this,$2,$3,$4);$5$6=$self.maxBitrate(this,$6);"
            },
            {
                match: /setCodecs\((\i),(\i),(\i)\)\{/,
                replace: "$&$2=$self.codec(this,$1,$2,$3);"
            },
            {
                match: /setKeyframeInterval\((\i)\)\{/,
                replace: "$&$1=$self.keyframe(this,$1);"
            },
            {
                match: /setGoLiveSource\((\i)\)\{/,
                replace: "$&$1=$self.goLiveSource(this,$1);"
            }
        ]
    },
    // Unlocks Discord's own high quality stream presets without Nitro.
    {
        find: "canUseCustomStickersEverywhere:",
        replacement: {
            match: /(?<=canStreamQuality:function\(\i,\i\)\{)/,
            replace: "return true;"
        }
    }
];
