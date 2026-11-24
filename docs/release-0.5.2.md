# FluidMusic 0.5.2

FluidMusic 0.5.2 finishes the local-library and provider repair started in 0.5.1.

## Changes

- Local music roots now drive both recursive scanning and the YouTube download destination.
- Folder scanning includes supported audio in every subdirectory.
- YouTube-only audio downloads are available on result rows and beside **Show player** in the compact player.
- Downloaded audio is indexed into Local Music and added to Up Next without interrupting playback.
- Spotify authorization now opens through the native Hermes Desktop browser launcher and uses the loopback callback `http://127.0.0.1:41337/spotify/callback`.
- FluidMusic can reuse the active profile's public Spotify Client ID without sharing another integration's OAuth tokens.
- Settings panels use opaque Hermes theme surfaces to prevent content bleed-through.
- The production README now includes screenshots, pinned installation instructions, provider setup, and the personal-use/use-at-your-own-risk download notice.
- A release-pinned GitHub Actions workflow can propose the first Hermes catalog entry and later pin updates for maintainer review.

## Download notice

The YouTube download feature is for personal use only. Users are responsible for permissions, provider terms, and applicable law. The project does not bypass DRM, ads, authentication, paid access, or entitlements. Use the feature entirely at your own risk.

## Verification

- 168 Python tests
- 205 JavaScript tests
- Chromium responsive-layout, keyboard-focus, accessibility, and screenshot verification
- Deterministic release archive comparison and SHA-256 verification
