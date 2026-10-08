# RoundedVCPFP

Adds full-resolution avatars with configurable rounded corners to TestCord call tiles. Disable FullVCPFP before enabling RoundedVCPFP in the plugin settings.

Only call tile components receive the avatar background. Avatar lookup uses the guild avatar, global avatar and default avatar fallbacks when needed. The corner radius setting snaps to whole even pixels from 0 to 36. The zoom setting scales the picture inside the tile; 100 keeps the full fill, lower values zoom out around the tile center.

Adapted from Equicord FullVCPFP by mochienya, maintained by DavidHiFi. GPL-3.0-or-later. See LICENSE.
