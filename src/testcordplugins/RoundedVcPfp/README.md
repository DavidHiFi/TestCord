# RoundedVCPFP

Adds full-resolution avatars with configurable rounded corners to TestCord call tiles. Disable FullVCPFP before enabling RoundedVCPFP in the plugin settings.

Only call tile components receive the avatar background. Avatar lookup uses the guild avatar, global avatar and default avatar fallbacks when needed.

Settings, topmost first:

- Profile picture corner rounding shapes the avatar itself. 0 is a flat square like FullVCPFP; 50 and higher is a full circle. The rounding scales with the picture.
- Tile corner rounding shapes the whole tile box, in pixels, snapping to whole even values from 0 to 52.
- Avatar zoom scales the picture inside the tile; 100 keeps the full fill, lower values zoom out around the tile center down to 25.
- Turn off the tile background removes the background box behind profile pictures so only the picture shows. Focus and speaking highlights on the tile are hidden with it. Stream tiles keep their video.
- Turn the glow on shapes a two-layer glow that trails the masked picture outline (radius, zoom and mask all carry along). It applies when the background switch is on.
- Glow color takes the hex code of that glow, for example #45475a. The glow mixes its own transparency levels, so an alpha channel in the hex is ignored.

Changes apply when affected tiles re-render (layout changes, speaking state, participants joining or leaving) rather than the same frame.

Adapted from Equicord FullVCPFP by mochienya, maintained by DavidHiFi. GPL-3.0-or-later. See LICENSE.
