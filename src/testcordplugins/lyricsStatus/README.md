# Better lyrics sync

LyricsStatus shows the current lyric line from Dopamine, TIDAL or Spotify as your Discord custom status. This is a maintained copy of TestCord's LyricsStatus plugin. The optional Dopamine companion adds artwork and a playback clock to its Discord Rich Presence.

Copy `src/lyricsStatus/` from this folder to `<TestCord>/src/testcordplugins/lyricsStatus/`, then build TestCord. Load the new build after your voice call ends. Choose a player in LyricsStatus settings. Automatic selection prefers a playing Dopamine instance, then the other supported players. The plugin fetches lyrics from LRCLIB and times status updates against playback. It supports templates, delay adjustments and restoration of your previous status.

Dopamine uses a local loopback bridge supplied by `dopamine-rpc-patch/`. TIDAL requires a compatible TidaLuna installation. Spotify requires the client's Spotify integration. See the companion README before running its patcher. Set its path variables for your own machine; its legacy defaults are specific to the maintainer's installation. The source-only tests for the companion do not verify an installed player.

GPL-3.0-or-later. Original TestCord contributors remain credited in source. See LICENSE.

The optional Dopamine companion is maintained at https://github.com/DavidHiFi/Discord-Plugins/tree/main/better-lyrics-sync/dopamine-rpc-patch. This PR updates the TestCord plugin only and does not patch or install Dopamine.
