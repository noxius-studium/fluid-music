"""Latest owner scope supersedes the initial deferred-Spotify draft, before generation."""
import re

CONTRACT='''# Included provider integration, new features and update durability

## Latest scope — mandatory, not optional or deferred

Spotify IS INCLUDED IN THIS BUILD. FluidMusic owns OAuth/PKCE, protected token storage/refresh, provider HTTP client, model mapping, library/playlist/search/device/transport actions and errors. Do not import Spotify implementation from Hermes core or another Hermes plugin. Radio, local, YouTube, history and player orchestration also remain in this unified package. Standard public Hermes plugin SDK and normal third-party protocol libraries are platform/development dependencies, not delegated product ownership.

Earlier 'leave Spotify for later' instructions in historical source are superseded by this later explicit owner request. No handoff card may silently defer Spotify. Missing credentials/account permissions or unsupported SDK capability are real review/blocker states, not permission to mark integration done or replace it with another plugin.

## YouTube coverage objective and diagnostic flow

Goal: play the widest YouTube catalogue the user's actual account/location has legitimate access to, entirely through the existing FluidMusic player workflow. Investigate WHY the owner's failed videos differ, then implement compatibility fixes/fallbacks; do not just display 'video unavailable' for every failure or claim every embed-only restriction is a rights restriction.

1. Reproduce representative failures only with consent and bounded requests. Record sanitized video ID, engine, player error code, readiness/origin/Referer, login/consent state, timestamps, host/renderer versions and whether ordinary first-party watch playback works for the user. A test video that always embeds is insufficient.
2. Separate invalid URL/ID, stale command, script/ready timeout, missing origin/Referer/client identity, blocked autoplay/user activation, embed-owner denial, HTML5/runtime codec failure, network/rate issue and actual account/content unavailability. Exact official meanings and limits are in PROVIDER_RESEARCH.md; do not invent a root cause without runtime evidence.
3. Fix configuration/lifecycle defects in the current loopback/iframe engine first. For content that refuses embedding but works on the authorized normal YouTube watch page, route through a persistent FluidMusic-owned FIRST-PARTY watch surface, integrated into the SAME player, using a verified supported host capability. This avoids reliance on the embed-only limitation; it is not DRM or entitlement defeat. A versioned plugin-owned authorized non-DRM stream resolver may also be assessed as a third compatibility adapter, with provider/terms, security and actual coverage evidence, not an unreviewed downloader service.
4. Login/consent uses the genuine provider page in an isolated owned browser context; do not capture passwords, borrow cookies from other profiles, proxy credentials, disable host security, spoof entitlement or promise inaccessible/private/deleted/geo/age/rights-restricted videos will play. No DRM or paid-access bypass is specified. Authorized non-DRM resolution for streaming may be assessed within FluidMusic: validate provider/CDN URLs, redirects/DNS and expiry, never log signed URLs or credentials, restrict requests to safe public targets, fence refresh/retries to the current item, and do not add a heavy transcoding/download stack or claim unsupported codecs work. Report exact residual provider restriction and evidence, not fake success.
5. Keep exactly one active engine and one queue/current item/history event when switching embed -> owned watch. Retain position/volume where supported, visibly state 'Switching player' then actual state. Do not advance queue on a recoverable embed error or loop indefinitely among engines. Limit retry/fallback attempts and provide explicit Retry/Skip/why actions.
6. Feature-detect the owned first-party surface before promising it. If the current public Hermes SDK cannot mount/control an owned view inside FluidMusic, document the exact missing contract and reach a concrete owner/host-capability review; do NOT silently use the focused chat Browser, external user browser, another plugin, duplicate YouTube pane or a private Hermes monkeypatch. Preserve the full objective and unresolved acceptance.
7. The YouTube embedded video viewport must respect the official minimum; the proposed very-short mini-player layout cannot squeeze the actual video below provider constraints. When short, retain controls and require a minimum/expanded in-plugin video region rather than hidden tiny-background-player tricks. See PROVIDER_RESEARCH.md.

## Spotify integration contract

Own namespaced backend modules such as dashboard/providers/spotify.py and a small token-store interface if needed, retaining current route compatibility. Use official OAuth Authorization Code + PKCE, validated state/redirect/account binding, refresh single-flight, explicit logout/revoke/local token removal and protected profile-local credentials separate from public SQLite history. Keep old credential stores untouched until a separately approved explicit migration/login; never copy raw tokens to renderer/storage/logs.

Implement direct official provider API support for login/status, catalogue search, own library/playlists, playlist item pagination/occurrence identity, devices, transfer, play/pause, seek, volume, shuffle/repeat, queue and refresh/errors under actual scopes. Spotify playback/device/account limits remain visible. FluidMusic's own controls can drive a Connect device without depending on the Hermes Spotify plugin. For audio INSIDE FluidMusic, assess the official Web Playback SDK and actual packaged browser capability, encrypted-media support, account eligibility and provider approval. Do not silently equate Connect remote control with in-plugin decoded audio; leave that exact gap reviewable if unsupported. See PROVIDER_RESEARCH.md.

Settings shows a real owned connection card: Disconnected / Connecting / Connected / Refresh needed / Permission required / No device / Unsupported local playback / Provider error, with relevant actions. No duplicate secondary-provider product UI or static 'connected' badge. All provider play paths use the existing coordinator and shared bottom bar.

## New functionality included (not renamed bug fixes)

1. **Queue editing and provenance:** Play next/Add to end, multi-select remove/move, clear-upcoming vs clear-all confirmation, undo last queue edit, duplicate occurrence IDs and 'Added from search/history/collection/provider' information. Queue actions never silently edit provider-owned playlists.
2. **Listening sessions:** named snapshots of safe source references and order, explicit Save session/Restore/Replace-or-append review and clear unsupported/unavailable items. These are resumable listening sessions, not a new writable mixed-provider playlist hierarchy. Never persist cookies, capability URLs, decrypted tokens, raw local media paths or autoplay on app startup.
3. **Resume and bookmarks:** remember position for eligible long-form YouTube/local items, user-defined timestamp bookmarks and explicit Resume/Start over; do not treat LIVE radio as seekable. Store safe profile-local references and bounded metadata.
4. **History discovery:** query by title/source/date, stable paginated results, replay, remove entry/clear with scope/confirmation and an explicit retention preference. Provider state/history privacy is not a fabricated recommendation engine.
5. **Sleep timer:** 15/30/60 minutes, end-of-current-item where supported, custom bounded duration and Cancel. Show remaining time in the shared player, use monotonic timing and one controller owner, and pause only the selected current engine; no unseen global device takeover after source change.
6. **Recovery center:** source-health row and action-specific problem details, bounded backoff/rate cooldown, Retry/Skip/Retry after sign-in, immutable error/retry provenance and a sanitized copy-diagnostics action. No wall of permanent notices or falsely automatic rights recovery.

Design these additions inside existing Browse/Library/Queue/Settings and shared popover, not as permanent new primary tabs or a new sidebar. Use common row/dialog/action anatomy and the exact semantic theme/control rules in DESIGN_CONTRACT. Make each action meaningful at 320–390px and keyboard accessible; use small contextual menus/sheets rather than squeezing every command into every row.

## Stability and Hermes-update durability

- A small public-SDK compatibility adapter is the only host door; all provider implementations and persistence live in FluidMusic. No deep Hermes imports, private raw bridges, sibling-plugin imports, renderer DOM selectors, source-path patch scripts or hand-edited app.asar dependency.
- Namespace import plus capability checks must occur before referencing optional exports, since a missing named ESM import can abort the whole plugin before fallback renders. Distinguish source SDK from the actual packaged host SDK. Declare a genuine supported minimum/capability contract; do not promise arbitrary future breaking updates cannot break anything.
- Capability matrix covers storage, public HTTP/REST namespace, app-level lifecycle, panes/titlebar/settings, audio/media and owned first-party video. Existing safe sources remain usable when one optional capability disappears. Never silently substitute another provider/engine/account or erase data.
- Keep versioned DB/preferences with backward-compatible migrations, explicit backup/rollback and raw legacy preservation. Install/update uses atomic generated artifact replacement, no source checkout reset and no auto-resume audio on plugin reload without safe user intent. Don't cache opaque handles between activations.
- Small N/N+1 SDK contract fixtures, optional-capability-absent startup, plugin disable/reload/disposal, stale async events, refresh races, DB busy/retry and restore fixtures exercise durability without installing/rebuilding multiple Hermes/Electron versions. Such fixtures do not prove actual compatibility with an unreleased host; owner packaged-host acceptance remains explicit.
- Provider authentication/catalogue/playback/thumbnail failure isolation, shared bounded schedulers, active-source-only observation, request cancellation and resource disposal prevent runaway work or duplicate engines. No heavy background indexing, visualizer, media bytes in SQLite, unbounded metadata caches or retry loops.
'''

def extend(requirements,policy,visual,arch,cards):
    replacements=[
        ('Do not self-approve the review or start the deferred Spotify work.','Do not self-approve the review; Spotify is included and must have its own integration evidence.'),
        ('Do not install into the current Hermes profile, restart/repair Hermes or gateway, run Plugin Doctor, launch another Desktop, migrate user history or change optional-provider accounts just to validate the plan.','Do not install into the current Hermes profile, restart/repair Hermes or gateway, run Plugin Doctor, launch another Desktop, migrate user history or change provider accounts just to validate the plan.'),
        ('Continue core work through FM-16, then request owner review. FM-17 Spotify remains a separate explicit review/decision gate.','Continue the complete authorized chain through FM-25, including Spotify, then request owner review.'),
        ('historical DESIGN.md and old screenshots','historical DESIGN.md and old screenshots'),
        ('and the deferred state of Spotify','and the included FluidMusic-owned Spotify integration'),
        ('Spotify routes remain retained but repair is explicitly deferred.','Spotify routes remain retained and their FluidMusic-owned implementation is explicitly included in this build.'),
        ("or implementing Spotify against the owner's deferral.",'or silently reducing the now-included Spotify scope.'),
        ('current Integrations','current Integrations'),
        ('do not launch/rebuild/restart Hermes or migrate Spotify.','do not launch/rebuild/restart Hermes or migrate live Spotify credentials during preparation.'),
        ('Do not launch/rebuild/restart Hermes or migrate Spotify.','Do not launch/rebuild/restart Hermes or migrate live Spotify credentials during preparation.'),
        ('explicit unavailable/deferred state','explicit unavailable/error state'),
        ('unavailable Spotify modules','unavailable optional-provider modules'),
        ('Spotify is visibly deferred rather than silently repaired through another plugin.','Spotify is included and must be repaired within FluidMusic, never silently supplied by another plugin.'),
        ('/sibling-Spotify/restart','/sibling-Spotify/restart'),
        ('Do not install, publish release/catalog, change host runtime or run doctor.','Do not install, publish release/catalog, change host runtime or run doctor.'),
        ('do not call the product fully accepted before that review.','do not call the product fully accepted before that review.')]
    def update(s):
        for old,new in replacements:s=s.replace(old,new)
        return s
    policy=update(policy)+'\n'+CONTRACT
    visual=update(visual).replace("Layout fits 320px width and a short ~220px body where supported:", "Audio-only layout targets 320px width and a short ~220px body; YouTube needs its documented video viewport plus controls, so target at least ~360px height or expand the same pane instead of shrinking the video below 200x200:")
    arch=update(arch)+'\n'+CONTRACT
    requirements['F29']='Spotify is INCLUDED; all providers live in FluidMusic, not other Hermes plugins/core provider implementations.'
    requirements.update({
      'F31':'Own Spotify PKCE/token refresh/client, account/device/capability and actual transport integration.',
      'F32':'Investigate real failing YouTube videos and classify embed/configuration/autoplay/account/content causes.',
      'F33':'Integrated legitimate first-party watch fallback for eligible embed-denied videos; no quiet external/plugin substitution.',
      'F34':'New queue Play next, multi-edit, undo and provenance actions with stable occurrence identity.',
      'F35':'Named resumable listening sessions with safe references and explicit replace/append restore.',
      'F36':'Eligible long-form resume/timestamp bookmarks and searchable history with retention controls.',
      'F37':'Source-aware sleep timer/end-of-item with visible state and cancellation.',
      'F38':'Bounded failure recovery, source-health diagnostics, backoff and actionable retry/skip.',
      'F39':'Public-SDK adapter, capability negotiation and upgrade resilience without private host patches.',
      'F40':'Data-safe migrations, reload/disposal/rollback, resource budgets and lightweight N/N+1 compatibility checks.'})
    updated=[]
    for card in cards[:17]:
        key,title,reqs,area,scope,accept=card
        updated.append((key,title,reqs,update(area),update(scope),[update(x) for x in accept]))
    extras=[
      ('X','Diagnose YouTube catalogue failures with a precise recovery matrix',['F13','F14','F15','F32','F38'],'YouTube adapter/diagnostic response shapes and targeted backend/embed fixtures.',
       'Investigate failing examples and distinguish documented error 2/5/100/101/150/153, autoplay blocking, consent/login, wrong video/origin/readiness and real unavailable content. Produce a sanitized reason/evidence -> remedy matrix. Reproduce only bounded authorized examples; preserve current successful path. No catch-all unavailable label, blind retry storm or invented current root cause. Read PROVIDER_RESEARCH.',
       ['A tiny deterministic matrix covers documented errors and stale/transient cases with correct distinct remediation.','Actual failed videos are only classified when evidence exists; otherwise the live evidence gate is precise and no all-videos promise is fabricated.']),
      ('X','Deliver in-plugin first-party YouTube fallback for eligible embed-denied playback',['F08','F13','F14','F17','F18','F19','F32','F33','F39'],
       'Plugin-owned media adapter plus VERIFIED public owned-first-party-view capability; exact capability gap review if unavailable.',
       'When normal authorized watch playback is possible but embedding is denied, switch the SAME FluidMusic player to an owned persistent first-party watch surface through supported capability negotiation. Keep cookie/account isolation, genuine provider login, shared control/state boundary, current queue occurrence/position and exactly one engine/history event. No focused-chat tab takeover, duplicate provider pane, borrowed cookie/credential proxy, DRM/entitlement bypass or hidden reduced-scope fallback. If no in-plugin view capability exists, report exact host contract required rather than secretly opening an external app.',
       ['Fixture proof fences embed->watch late events and preserves item/queue/history uniqueness with bounded attempts.','Real owner review separately proves the failing-but-watch-eligible video and controls; unavailable public host capability remains an explicit unresolved full-scope gate.']),
      ('X','Implement FluidMusic-owned Spotify OAuth, protected tokens and provider client',['F23','F25','F29','F30','F31'],
       'New narrowly scoped dashboard/provider Spotify client/token storage modules and current backend route bindings; no sibling/core provider imports.',
       'Own official Authorization Code+PKCE, state/redirect binding, refresh single-flight, protected per-profile credentials, scopes, status and logout. Retain compatible FluidMusic routes and prevent one provider import/auth failure from disabling others. Keep live existing credentials unmigrated until explicit owner sign-in/migration consent. Read PROVIDER_RESEARCH.',
       ['Bounded HTTP/token-store doubles exercise code/state/replay/expiry/refresh races/logout and profile isolation without real credentials.','Static dependency/route checks find no Hermes-core or sibling-plugin Spotify implementation import; missing login never becomes fake Connected.']),
      ('X','Implement Spotify devices, real transport and supported in-plugin playback capability',['F09','F10','F18','F19','F29','F31'],
       'Owned Spotify HTTP adapter/controller integration, current device/transport UI and optional official Web Playback SDK capability adapter.',
       'Implement devices/transfer/play/pause/seek/volume/shuffle/repeat/queue/error/rate behavior through the OWN client and common coordinator. Preserve context offsets and exact duplicates. Connect control is not proof of decoded audio inside FluidMusic: assess official SDK, Premium eligibility, encrypted-media, target browser/Electron capability and provider approval before claiming local streaming. No extra Hermes plugin or replacement pseudo-engine.',
       ['Small fixture checks prove actual outgoing provider payloads, idempotent refresh, no-device/forbidden/rate/transient distinctions and one active source.','Owner review identifies real Connect playback and, if supported, separate in-plugin streaming evidence; unsupported local runtime is not silently certified as full audio.']),
      ('X','Implement Spotify catalogue/library/playlist workflows inside FluidMusic',['F05','F15','F22','F29','F31'],
       'Owned provider API pagination/models, browse/library rows, provider-playlist and queue actions.',
       'Own search, albums/artists/tracks, user library/playlists and playlist item pages with supported official endpoints/scopes and provider restrictions. Keep playlist ownership with Spotify, local collections local and listening-session snapshots separate. Show unknown/unavailable/relinked entries honestly; exact occurrence offset for duplicate tracks. No invented success or surprise write to remote playlists.',
       ['Bounded fixtures prove page cursor/state, duplicate occurrence and unavailable-entry behavior, query cancellation and supported scope errors.','All actions reach the FluidMusic client, not another plugin; live account effects require owner consent and are listed separately.'])]
    features=[
      ('X','Add queue edit/undo/provenance and resumable listening sessions',['F19','F22','F24','F34','F35'],
       'Existing queue/controller model plus small namespaced listening-session persistence/use cases and contextual UI.',
       'Implement Play next/Add to end, multi-select remove/move, clear upcoming versus all, one-step undo and origin facts. Save named safe-reference snapshots; Restore previews unavailable items and asks Replace/Append within the interaction, not a routine agent continuation question. Keep snapshots distinct from writable mixed-provider playlists. Do not store capability URLs or autoplay on startup.',
       ['Small pure/SQLite fixtures retain occurrence identity and deterministic undo, safe snapshot roundtrip and filtered unavailable restore.','Keyboard/narrow UI uses contextual actions without adding permanent primary tabs or resetting the selected playing item unexpectedly.']),
      ('X','Add long-form bookmarks/resume, history filters and sleep timer',['F16','F24','F35','F36','F37'],
       'Profile-local SQLite safe-reference/bookmark/resume settings, shared player controller timer and Library/History contextual UI.',
       'Expose title/source/date history filters and retention, eligible timestamp bookmarks with edit/delete/jump, Resume/Start over, and 15/30/60/custom/end-of-item sleep controls. Live radio has no fake seek. Timer uses one monotonic controller owner, displays remaining/cancel and follows explicit source-change policy rather than taking over another device later.',
       ['Tiny controlled-clock/SQLite fixtures prove expiry/cancel/source-switch/reload behavior and safe position/bookmark persistence.','No promise of remote protected-media offline playback; deleting history/retention respects scope without touching media or credentials.']),
      ('X','Harden recovery, source health, retry bounds and data-safe restart',['F14','F18','F23','F26','F30','F38','F40'],
       'Shared adapter errors/schedulers/health projection, token/request coordination and existing persistence migrations.',
       'Provide one quiet recovery center with actionable Retry/Skip/sign-in and sanitized diagnostics. Bound retries/cooldowns and active-source observation; handle offline, DB busy, provider expiry and background throttling without double playback/history. Back up/migrate/rollback owned data, preserve raw legacy records, and clean handles/timers on disable/reload; no automatic unrequested startup playback.',
       ['Small fault-injection fixtures show bounded work, exact cleanup, migration rollback and no duplicate engines or data loss.','UI health reflects actual source capability and last evidence; no credentials/raw history in logs or fake all-online badge.']),
      ('X','Make Hermes-update compatibility explicit and remove fragile provider/host coupling',['F01','F25','F29','F30','F39','F40'],
       'One small public-SDK adapter/capability matrix, metadata, migration strategy and focused contract fixtures; no private Hermes patch.',
       'Eliminate private/deep Hermes and sibling provider imports, version-sensitive raw bridge/DOM dependence, and missing named-import startup traps. Feature-detect optional exports through supported namespace/capability doors and declare minimum host capabilities. Tiny current/next/absent capability fixtures preserve available sources, settings and data. Unknown arbitrary future breaking releases are not guaranteed; incompatible host state becomes precise recovery, not silent deletion or rewritten product scope.',
       ['Dependency audit and small N/N+1/absent-export fixtures prove the chosen adapter boundary and safe data-preserving degradation.','Actual packaged-host compatibility is distinguished from fixtures; unsupported integrated first-party view remains a named gate, never hidden behind another plugin.'])]
    all_cards=updated[:7]+extras+updated[7:15]+features+updated[15:17]
    assert len(all_cards)==26
    return requirements,policy,visual,arch,[(f'FM-{i:02}',*c[1:]) for i,c in enumerate(all_cards)]
