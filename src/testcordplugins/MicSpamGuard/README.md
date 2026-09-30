# MicSpamGuard

A Vencord and Equicord user plugin that balances each person's voice volume and temporarily mutes sustained extreme loudness in Discord. Both controls can run together.

Fork of [Kurtzon Audio's MicSpamGuard](https://github.com/kurtzonaudio/kurtcord-plugins). This version reads Discord Desktop's incoming voice statistics.

## Voice balancing

Enable Dynamic User Volume to reduce loud voices and gradually boost quiet speech. Each person has a separate controller. Their manual local volume is the baseline, and manual changes become the new baseline. The default 2:1 compression and level target of 65 apply moderate correction. Brief pauses hold the adjustment. Sustained silence restores the manual volume smoothly. Silence and low background noise do not trigger a boost.

Automatic boosts stop at 200% on Discord's slider. Higher manual volumes remain intact. The plugin uses Discord's nonlinear volume conversion functions, including when VolumeBooster unlocks a higher slider range.

## Settings

| Setting | Behavior |
| --- | --- |
| Enabled | Master switch. Disabling restores held volumes and mutes. |
| Extreme loudness protection | Independently enable sustained-extreme muting. |
| Extreme loudness threshold | Range 90 to 100. Default 98. Everyday loud speech is handled by balancing. |
| Mute sensitivity | Higher reacts sooner. Normal or quiet samples reset the consecutive-extreme count. |
| Auto unmute | Continuous fresh safe voice audio required before a 1.5-second return to the saved volume. Off requires manual restore. |
| Dynamic User Volume | Independently enable smooth voice balancing. |
| Voice level | Target 55 to 75. Default 65. Higher preserves more loudness. |
| Maximum volume reduction | Cap of 3 to 18 dB below the manual baseline. Default 12 dB. |
| Maximum quiet voice boost | Cap of 0 to 12 dB above baseline. Default 6 dB. Zero disables boosting. |
| Response speed | Fast, Balanced or Gentle. Default Balanced. |
| Ignore Friends | Exclude friends from both protections. |
| Notify | Toasts for mute, unmute and manual restore. Balancing stays silent. |

Self, bots, ignored users, locally muted users and users manually set to zero are excluded. Restore pauses balancing for that person until Resume. Leaving the call, disabling the feature or stopping the plugin restores held baselines. The plugin persists held raw volumes for recovery after a restart.

Existing aggressive settings above 18 dB reduction migrate once to a level target of 65, a 12 dB reduction cap and a 6 dB boost cap. Legacy thresholds below 90 migrate to 98. Other saved choices remain intact.

Periodic incoming voice statistics limit reaction time. Brief bursts can arrive before correction, and background noise above the speech gate can count as speech. Response speed controls smoothing after a sample arrives.

The user-area button opens settings on left click and toggles the guard on right click.

## Install

Copy this folder into `src/testcordplugins/MicSpamGuard` in your client tree and rebuild:

```sh
node scripts/generateBDPlugins.mjs
node --require=./scripts/suppressExperimentalWarnings.js scripts/build/build.mjs
```

Skip `generateBDPlugins` if your fork does not have it. Restart the client after leaving your voice call to load the new bundle.

## License

MIT. DavidHiFi.

## Participant identity

The guard requires a current voice member and consistent participant-key, SSRC and explicit user identities. Conflicting, missing, malformed, self and outgoing identities are ignored before volume or mute actions. SSRC lookup failures do not fall back to a guessed target. The master repository's regression suite reproduces wrong-user cases. These offline checks do not establish that the running client has loaded the correction.

## Continuous protection

Extreme protection writes your local user-volume setting to zero. It keeps the original baseline and continues reading only that participant's incoming statistics. A hold opens only after fresh, positive voice readings stay at least 10 meter points below the trigger threshold for the configured Auto unmute interval. Missing or zero readings cannot prove safety because some clients report post-volume silence. Brief natural pauses preserve the safe interval only while a recent positive reading remains fresh; a gap longer than two seconds restarts the interval. If the client stops reporting source levels at zero, use manual Restore after checking the participant.

Volume returns over 1.5 seconds. A new unsafe sample closes the recovery and requires the complete safe interval again. Ordinary voice balancing remains independent. Manual volume changes remain intact. The two guards share their held baseline so one cannot turn up a user the other still protects. No audio classifier can establish whether a loud source is speech, noise or a deliberate sound effect from scalar levels alone.
