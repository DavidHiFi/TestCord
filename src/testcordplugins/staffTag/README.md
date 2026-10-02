# StaffTag User Plugin

StaffTag adds a crown or text badge beside server owners, administrators, and members with moderation permissions. Badges appear in voice channels, the member list, and messages. TestCord and Equicord also support a badge in profiles. Hover over a badge to see its label.

This is a source plugin for [TestCord](https://github.com/TestcordDev/TestCord), [Equicord](https://github.com/Equicord/Equicord), and [Vencord](https://github.com/Vendicated/Vencord). It does not need BetterDiscord or BDFDB.

## Install

You need a source checkout of your client, Node.js, and the pnpm version required by that checkout. The [collection ZIP](https://github.com/DavidHiFi/Discord-Plugins/archive/refs/heads/main.zip) contains both plugin variants.

1. In your client checkout, create `src/testcordplugins/staffTag/`.
2. For **TestCord or Equicord**, copy this repository's [`index.tsx`](index.tsx) into that folder. For **Vencord**, copy [`vencord/index.tsx`](vencord/index.tsx) instead. The resulting path must be `<client>/src/testcordplugins/staffTag/index.tsx`.
3. From the client checkout, run `pnpm install` if dependencies are not installed, then `pnpm build`.
4. If this is a new client installation, follow that client's desktop injection instructions (`pnpm inject` in current source checkouts). Restart Discord to load the new build.
5. Open Discord **User Settings → TestCord, Equicord, or Vencord → Plugins → StaffTag**. Enable StaffTag and adjust its settings.

If the client is already injected, step 4 only needs a Discord restart. Building a user plugin does not install it into an existing running Discord window.

## Settings

- Show a crown or a text label, with optional member role color.
- Choose badges for owners, administrators, and moderation or management permissions.
- Show or hide badges for bots and your own account.
- Choose where badges appear: voice channels, member list, messages, and profiles where supported.
- Change the text for each badge type.

StaffTag reads Discord's cached guild and role data. A missing member cache entry can leave a badge hidden until Discord loads that member. It does not grant or change permissions.

## Client support

| Client | Source file | Voice | Member list | Messages | Profiles |
| --- | --- | --- | --- | --- | --- |
| TestCord | `index.tsx` | Yes | Yes | Yes | Yes |
| Equicord | `index.tsx` | Yes | Yes | Yes | Yes |
| Vencord | `vencord/index.tsx` | Yes | Yes | Yes | No profile icon API |

The TestCord voice and message badges were confirmed in Discord PTB, and TestCord loaded cleanly in both PTB and Stable. The Equicord and Vencord variants passed source builds, lint, and TypeScript checks; they have not been tested in a live Discord window.

Version 1.0.0 logged `Failed to start plugin Error: Style "..." does not exist` at every Discord start. That error stopped the member list, message, and profile badges from registering, so only the voice badge worked. Version 1.0.1 fixes this; update if you see that error.

The voice badge uses a Discord renderer patch. A future Discord UI change may require an update to that patch. If the client logs a StaffTag patch warning after an update, check this repository for a newer release.

## Credits and license

Inspired by DevilBro's [BetterDiscord StaffTag](https://github.com/mwittrien/BetterDiscordAddons/tree/20e22dfbf7f55d84b22a703a594242275c525399/Plugins/StaffTag). This TypeScript implementation uses the clients' plugin APIs and contains no BetterDiscord source or BDFDB dependency. The source in this repository is licensed under [MIT](LICENSE).
