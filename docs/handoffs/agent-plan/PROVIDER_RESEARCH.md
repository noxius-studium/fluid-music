# Provider research and implementation evidence limits

These are retrieved provider contracts, not findings from the owner's failing videos. No live account login, media playback, restriction bypass, payment, Desktop restart or installation was performed while preparing this handoff.

## Why some YouTube videos fail in an embed

The official player distinguishes these errors: `2` invalid parameter/video ID; `5` HTML5/player failure; `100` video removed/not found/private; `101` owner disallows embedding; `150` the same embed restriction as `101`; and `153` missing HTTP Referer or equivalent API-client identification.[1]

The API also exposes `onAutoplayBlocked` for browser-blocked autoplay or scripted playback, including cases involving user interaction or iframe permissions policy.[1] Therefore an autoplay/configuration failure is not evidence that the video itself is inaccessible, and an embed-owner denial is not evidence that normal first-party watch playback will fail. The latter sentence is an engineering distinction to investigate, not a guarantee that every restricted video works in a different surface.

**Required diagnostic acceptance:** preserve the actual sanitized code, selected video/engine/generation, readiness, origin/Referer/identification and retry history. Compare one ordinary working video and actual owner-authorized failing examples. Classify unknowns as unknown, not removed/private merely because the iframe did not start. No hardcoded success case can prove catalogue coverage.

The embedded-player minimum viewport is 200×200 pixels; YouTube recommends 480×270 for 16:9 players.[1][2] Accordingly, the short audio-only mini-player target cannot be imposed on a video region below that minimum. Keep a valid in-plugin video region plus the bottom controls, or expand the existing player; do not create a second YouTube pane or hide a tiny player to pretend audio-only compliance.

The documented `enablejsapi`/`origin` controls support configuring an IFrame API player, but they do not promise access to every video.[1][2] Correct those seams in the existing loopback wrapper, then add a genuine supported first-party watch fallback for eligible embed-denied videos. Full catalogue goals must retain explicit account/content/host restrictions and cannot be certified without actual failing-video evidence. If an additional plugin-owned authorized non-DRM stream resolver is assessed, its coverage, provider terms, URL security and runtime budget must be proven separately; the official iframe documentation does not validate an extractor.

## FluidMusic-owned Spotify

Spotify documents Authorization Code with PKCE as the recommended flow for clients that cannot safely store a client secret.[3] The proposed backend should implement this flow itself with its own protected per-profile token store and HTTP adapter; that ownership is a project design requirement, not a claim that importing another Hermes Spotify plugin would satisfy it.

The Web Playback SDK can create a local Spotify Connect device in a browser and stream/control tracks inside a website; its documentation requires an eligible Spotify Premium subscription.[4] The documentation lists supported browser families and notes encrypted-media/autoplay iframe requirements, but does **not** certify this project's packaged Electron/opaque sandbox runtime.[4] Test that exact capability before promising in-plugin streaming. Distinguish it from FluidMusic's own Connect control of another selected device; both integration paths remain owned by this plugin.

The same SDK page states that commercial use requires Spotify's prior written approval.[4] Record the provider-approval/account eligibility boundary before a commercial release; preparing code, passing fixtures or owning a Premium account does not establish that approval.

## Evidence required from implementation

- Plugin-owned Spotify auth/client module and all calls reachable without another Hermes plugin or private Hermes provider import.
- Actual declared OAuth client/redirect/scopes, safe refresh/logout and account-device capability evidence; no secrets in artifacts.
- YouTube failure/recovery matrix tied to real evidence, plus deterministic fixtures for configuration/embedding/autoplay/stale-generation behavior.
- Supported first-party surface contract, or the exact missing public-SDK capability and owner review needed; no silent fallback to a focused chat tab or external app.
- Optional authorized stream-resolver assessment is not a DRM/entitlement bypass or permission to expose signed URLs, cookies, arbitrary network proxies or heavy transcode/download stacks.
- Honest separation of headless cloud checks, current source contracts and owner's actual Desktop playback/volume/authentication/host-update acceptance.

## Sources

[1] https://developers.google.com/youtube/iframe_api_reference
[2] https://developers.google.com/youtube/player_parameters
[3] https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
[4] https://developer.spotify.com/documentation/web-playback-sdk
