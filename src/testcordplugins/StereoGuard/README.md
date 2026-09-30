# StereoGuard

A maintained fork of [Kurtzon Audio's StereoGuard](https://github.com/kurtzonaudio/kurtcord-plugins). It measures pan imbalance, stereo width and changing pan on a known participant's two-channel audio stream.

Only a stream still associated with that participant can trigger a local mute. Both channels are sampled from the same audio frame. Mono, stale streams and unknown channel counts cannot trigger detection. Ignore and restoration controls remain available.

Discord Desktop does not expose remote per-participant PCM through its public voice wrapper. A shared output-device capture can contain several sources, so it is informational only and never assigns a mute to a guessed user. Automatic protection requires a client that exposes participant streams, such as the browser audio path.

Copy this folder to `src/testcordplugins/StereoGuard` and build your client. The 2026-09-30 attribution correction passed 21 shared offline regression checks, targeted lint and isolated desktop/Equibop builds. Live activation and Ableton hard-pan verification are pending.

MIT. Original plugin by Kurtzon Audio; maintained by DavidHiFi. See LICENSE.

## Continuous protection

Protection holds local user volume at zero without changing Discord's local-mute toggle. A participant-owned stream continues supplying detection frames. Fresh frames must stay at least 15 score points below the trigger threshold for the configured Auto unmute interval. Silence counts only when actual fresh frames arrive from that participant's stream. Missing frames never count as quiet. The volume then returns over 1.5 seconds. A stereo relapse immediately closes partial recovery. Disconnected streams and ignored users release their saved volume, and manual changes remain intact. Another guard's hold prevents this guard from raising the user.

On Discord Desktop, remote per-user PCM is unavailable through the current native wrapper. Shared output capture is informational and cannot safely drive participant-specific protection. This correction does not create native remote stereo measurement.
