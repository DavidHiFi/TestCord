# LyricsStatus

LyricsStatus puts the line you are hearing into your Discord custom status. It works with Dopamine, TIDAL and Spotify, and it fetches synced lyrics from LRCLIB.

## Setup

Enable the plugin. With the source on Automatic, it uses whichever player is playing and checks Dopamine first.

Dopamine needs no patch or companion app, only one switch in Dopamine itself: Settings, Online, "Enable Discord Rich Presence", which is off in a new install. The plugin reads the title, artist and play position from the activity Dopamine then sends to Discord. TIDAL needs TidaLuna, and Spotify uses the client's own Spotify connection.

## What it does

- Each line goes into your status at the moment it starts. During an instrumental break the status shows the format without a lyric, `🎵` by default.
- When the song changes, the new song's lines replace the old ones. When music stops or the plugin turns off, your stop message or previous status comes back.
- Dopamine's activity gets the album cover from Apple's public iTunes search. Tracks tagged like `Uploader / Artist - Title` and game or film soundtracks are matched too. A track with no match keeps Dopamine's icon. You can turn covers off in the settings.
- Discord sends at most 5 status changes to other people in 20 seconds. Lines change on your screen right away, and other people get the newest line as fast as Discord allows. The saved copy on Discord's servers updates at most every 10 seconds.

## Settings

| Setting | What it does |
| --- | --- |
| Format | Status template. `{lyrics}` is the line, `{song}` the track and `{artist}` the artist. |
| Source | Automatic, Dopamine, TIDAL or Spotify. |
| Dopamine covers | Adds the album cover to Dopamine's activity. |
| Custom message on stop | Shows a fixed message when music stops. Leave the message blank to clear the status. |
| Restore status on stop | Puts back the status you had before music started. |
| Show panel button | Adds an on and off button to the user area. |

The lyric delay from Music Controls also applies here, both the global delay and the per-song delay.

## Upgrading from the Dopamine RPC patch

Earlier versions needed `dopamine-rpc-patch`, which changed Dopamine's `app.asar`. It is no longer used. After a Discord restart its reconnect loop could keep Dopamine from reconnecting, so remove it: reinstall Dopamine, or run `node patch-asar.cjs rollback` from the copy you installed it with.
