# FakeVoice

DavidHiFi's maintained fork of deracul's FakeVoice. It controls local fake mute, deafen, camera, stream and Watch Together states through the user-area button and its context menu. The original author remains credited. This fork uses MIT with the copyright holders' permission.

Copy both `index.tsx` and `native.ts` into `src/testcordplugins/fakevoice` in a TestCord source checkout and rebuild. The native helper provides a loopback-only bridge on `127.0.0.1:47830` for the Stream Deck companion. It also registers the hotkeys listed in `native.ts`. Adapt or remove those registrations before building if they conflict with another application.

The optional Stream Deck plugin is in `streamdeck/com.davidhifi.fakevoice.sdPlugin`. Its actions call the native bridge. Install it using Stream Deck's plugin installation route. This repository does not modify your Stream Deck profiles.

Fake voice states affect this client's state handling. They do not grant server permissions. Optional Discord patches depend on the client build. Previous health records can retain an Unstable badge after a source correction.

MIT. Original plugin by deracul; maintained by DavidHiFi. See LICENSE.
