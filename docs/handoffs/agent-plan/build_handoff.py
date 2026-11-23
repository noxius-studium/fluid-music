#!/usr/bin/env python3
"""Build FluidMusic's cloud planning payloads; no services, installs or workers."""
from pathlib import Path
import hashlib
import json
import subprocess

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[2]
BASE='d6e2bf2df08ae455ac5b24a581c3f2212060afb0'
MODEL='qwen/qwen4-max:free'
REPOSITORY='noxius-studium/fluid-music'

def put(path,text):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(('\n'.join(line.rstrip() for line in text.splitlines())+'\n').encode('utf-8'))

def digest(data):return hashlib.sha256(data).hexdigest()

REQUIREMENTS={
'F01':'Continue the existing latest source, not the old main branch or a regenerated music app.',
'F02':'Hermes is the sole theme authority, including light/dark/glass/accent changes.',
'F03':'Retain the selected Night Radio hierarchy, Orbit object and compact Blackstage-style navigation without recreating the rejected website-sized shell.',
'F04':'Keep app-scale titles, dense metadata and useful content instead of oversized headings.',
'F05':'Retain Browse, Library, Queue and Settings and all applicable existing source workflows.',
'F06':'No redundant permanent sidebar row; plugin Settings, titlebar and existing route provide discovery.',
'F07':'Keep app-level titlebar discovery and usable quick-control popover.',
'F08':'Preserve optional dockable mini-player and one integrated YouTube surface, not a second provider pane.',
'F09':'Keep the SAME bottom-anchored transport bar across all active sources and relevant player surfaces.',
'F10':'Play/pause, previous/next, seek and volume must have real capability-correct effects and honest failure states.',
'F11':'Provide a usable volume slider, not the rejected tiny range or an embedded-player volume excuse.',
'F12':'Scale to real Electron pane bounds, short panes, narrow layouts and long text without clipping controls.',
'F13':'Preserve the working integrated YouTube embed route; do not restore focus-dependent Browser scripting or extra embedded-player chrome.',
'F14':'Protect the loopback capability host, allowed origins and messages; preserve single ownership and stale-transition fencing.',
'F15':'Provide YouTube song/video search and real safe titles/metadata with bounded errors, not invented results.',
'F16':'Keep durable profile-scoped SQLite playback history and truthful played-state semantics.',
'F17':'App-level controller identity, item, queue, source, playback and pane do not change with chat/session/route focus.',
'F18':'Exactly one active engine; all provider transitions go through one serialized coordinator.',
'F19':'Keep Up Next ordering, correct duplicate occurrences, restart-safe references and exactly-once completion.',
'F20':'Preserve internet radio discovery, pinned stations, direct playback and LIVE semantics.',
'F21':'Preserve approved-folder local indexing, stable SQLite IDs, safe seekable media and unavailable-file recovery.',
'F22':'Retain editable local-only collections and preserve read-only legacy mixes and unknown saved data.',
'F23':'Keep dedicated plugin settings, provider status and sanitized actionable diagnostics.',
'F24':'Consistent semantic SVG/host icons, keyboard/focus/ARIA and reduced-motion support on every touched surface.',
'F25':'Deliver the full unified backend/renderer package and declare real host SDK compatibility, not only a demo.',
'F26':'No Docker, heavyweight stacks, large installs or intensive test matrices; use small serial checks and SQLite/test doubles.',
'F27':'Cloud main and every delegated worker use exactly qwen/qwen4-max:free; provider verified from actual cloud profile.',
'F28':'Scoped commit then push then remote verification; callbacks; continue until done or genuine user review.',
'F29':'Spotify repair is deferred; later use FluidMusic-owned integration, not silent Hermes-core/sibling substitution.',
'F30':'Protect existing data, credentials, private media/history and live app; do not restart Hermes or mutate installation during preparation.'}

POLICY='''# Latest execution policy — FluidMusic / Hermes Cloud

This is a GitHub-accessible handoff for HERMES CLOUD, not instructions to manipulate the Windows desktop from a remote shell. It applies to FluidMusic ONLY. Do not work on Navigator or copy Grove/Composer product architecture.

## Model, delegation and resource rules

- Cloud main worker MUST use exactly `qwen/qwen4-max:free`. Every delegated worker MUST also use exactly `qwen/qwen4-max:free`. Verify configured/inherited child routes and child START receipts; no different-model reviewer, coding CLI or fallback.
- Determine the provider from the actual receiving cloud profile. Do not infer provider from the model namespace, assume a Windows profile alias, change credentials or reconfigure profiles. Agent model restrictions are not changes to FluidMusic media-provider capabilities.
- NO Docker, Compose, Testcontainers, container images, Kubernetes, PostgreSQL/Redis stacks, Electron farms, broad Playwright installs, large toolchain downloads, parallel heavyweight builds or load/soak tests. Use the existing tools and a small targeted serial suite. Inspect available memory before potentially heavy commands.
- SQLite is already FluidMusic's real persistence choice for its local library/history; use isolated temporary SQLite databases for lightweight DB tests. Do not add a database service or copy real user databases. Use clearly labelled bounded media/SDK/provider fixtures when actual Desktop is absent.
- A headless cloud fixture cannot prove real sound, YouTube playback/volume, packaged Electron SDK compatibility, local Windows filesystem access, personal media availability or live host rendering. Leave those checks explicitly unverified and deliver a reviewable artifact for the owner. Do not fake playback/provider results or use native controls as a substitute for requested custom controls.

## Git, callbacks and automatic continuation

- Every scoped implementation commit MUST be followed by a push to its authorized feature branch and a read-back proving the remote branch SHA equals the committed SHA. Use the personal GitHub identity Zero2 <deadtrix21@users.noreply.github.com>. Do not amend/rebase/force-push others' work or push main/tags/releases.
- After a verified slice, continue the already-authorized next slice without asking routine permission. Stop when done, at an actual owner visual/functional review gate, or at a real blocker requiring information/authority/access. Do not convert 'continue' into permission for paid calls, destructive actions, provider account changes or restarting the owner's Hermes.
- CALLBACK START before edits: task/scope, exact workspace/repository/branch/start SHA, actual profile/provider/model and delegation route, permissions, protected paths, test/resource budget.
- CALLBACK FINISH before completing/advancing: changed files, tests and actual results, fixture-vs-live limits, full commit SHA/parent/identity, pushed branch and VERIFIED remote SHA, remaining dirty work, unresolved acceptance, next existing card or precise review gate. A command banner is not push verification.
- CALLBACK BLOCKED: preserve partial work; commit+push scoped safe partial work when appropriate, state failure/attempts and exact missing input/evidence. Never mark incomplete acceptance done. Resume the SAME card, never create a duplicate graph.
- CALLBACK REVIEW: name the actual artifact/SHA, exact UI actions for the owner, expected outcomes, unverified live boundaries and what approval would authorize. Do not self-approve the review or start the deferred Spotify work.
- Use event-driven task callbacks/heartbeats. Inspect existing card/successor on notification; no transcript polling, duplicate dispatch, repeated 'can I continue?' or automatic graph recreation.

## Preparation versus implementation

The preparation/import phase leaves every card BLOCKED and starts no workers. The user's request here is a handoff like the previous two, not a request to run a cloud build now. Once implementation is separately started, unblock only the authorized CORE chain, letting dependencies serialize its single shared workspace. Continue core work through FM-16, then request owner review. FM-17 Spotify remains a separate explicit review/decision gate.

Do not install into the current Hermes profile, restart/repair Hermes or gateway, run Plugin Doctor, launch another Desktop, migrate user history or change optional-provider accounts just to validate the plan. Cloud workspace is an actual chosen absolute Linux/receiving-host path; all historical Windows paths are provenance, not runnable cloud paths. Push permission covers the task feature branch, not releases, deployment or catalog publication.
'''

VISUAL='''# Current design contract and conflict resolution

## Authority and deliberate retained character

The owner selected Night Radio's hierarchy with the Orbit circular artwork object and compact Blackstage-style navigation. Later corrections take precedence over the historical DESIGN.md and old screenshots: use Hermes themes, shrink website-sized headings, restore bottom controls for ALL sources, make volume usable, integrate YouTube into the existing player, and remove redundant sidebar discovery. Do NOT restore the old private navy/coral/violet palette, 'no green host theme' rule, 58px titles, 240px forced hero or 'never add a bottom bar' rule from older material.

Old PRODUCT.md/README/architecture still describe an owned Browser and old Spotify imports in places. Current source has a capability-protected backend loopback embed host, YouTube search/resolve and SQLite history. Preserve that working path. The owner's historical confirmation that YouTube played is evidence of that session, NOT fresh end-to-end acceptance on the cloud or this machine.

## Semantic role/state mapping — no private palette

| Role | Hermes authority / behavior |
|---|---|
| Page ground | Host pane; transparent plugin root, no private skin/background wash |
| Main text | `var(--ui-text-primary)` |
| Supporting metadata | `var(--ui-text-secondary)` |
| Placeholder/lesser detail | `var(--ui-text-tertiary)` |
| Quiet status | Actual state plus `var(--ui-text-quaternary)` where available; never color alone |
| Panel | `color-mix(in srgb, var(--ui-bg-secondary) 80%, transparent)`; match current source |
| Input | `var(--ui-bg-secondary)` plus semantic text/stroke |
| Elevated popover/dialog | Host elevated/secondary semantic surface, opaque enough for legible overlap; no fixed black |
| Hairlines | `var(--ui-stroke-secondary)` |
| Hover/selected | `color-mix(in srgb, var(--ui-accent) 9%, transparent)` and actual selected state |
| Focus | 2px `var(--ui-accent)` outline, 3px offset; never remove keyboard focus |
| Active source/live | Actual state text/icon plus host accent; do not infer playing merely from selected item |
| Disabled | Host Button/Range disabled behavior and explanatory label, not fake working opacity |
| Busy | Same geometry, short action-specific status, prevent duplicate command; never falsely advance history |
| Failure | Sanitized useful error + retry/corrective action; no tokens/raw provider HTML |

All values remain live to the chosen Hermes theme, including intentionally tinted themes. No font download, private theme switch or fixed hex fallback. Scope style changes to FluidMusic. Prefer existing SDK Buttons/Dialog/Popover/Tabs/Input/Slider where exported; verify runtime export compatibility before named imports. Avoid app-internal imports or another plugin dependency.

## Concrete desktop composition (target dimensions, not claims of measured approval)

- Root fills its actual pane: `height:100%`, `min-height:0`, `min-width:0`; body/player layout uses `grid-template-rows:minmax(0,1fr) auto`. Only the content body scrolls. Shared bottom transport never scrolls away, overlays rows or leaves dead space below it.
- Header is a compact 40–44px operational strip with small product mark and Browse, Library, Queue, Settings. Preserve source sub-tabs within the relevant destination. No extra permanent sidebar entry. Plugin Settings and titlebar remain discoverable.
- Body uses 14–18px padding and 12–18px section spacing, not a giant marketing hero. Page title 19–25px, section title 15–17px, body 12–13px, metadata 10–12px; long titles truncate with an accessible full name or wrap safely.
- Orbit remains an optional overview focal object: 160–200px where space exists, 96–120px in narrow overview; mini-player artwork 40–64px. Do not force it above controls in a short pane. No analyser/visualizer is reintroduced because a source filename contains 'visualizer'.
- Broad shared player bar: target 64–72px, 12px inline padding, three regions: selected item/art at left, centered transport/seek or LIVE, volume/source at right. Main play target 36–40px; secondary 28–32px; icons 16–18px, same stroke vocabulary across providers.
- Narrow shared bar: reflow to 96–112px in two rows, preserve play/pause, applicable skip, progress/LIVE and volume. Collapse decorative/source detail before dropping controls. The volume row prefers 150–170px of usable width or fills the row; do not retain the rejected hard 60px compact slider when the surface can reflow.
- Queue/list rows preserve stable identity and occurrence, 32–40px art, flexible title, provider/availability facts and explicit actions. In a narrow container move secondary actions to a second row; do not turn item text into horizontal root overflow.
- Primary icon vocabulary: play/pause, previous/next, speaker/mute, search, list/queue, folder/local, broadcast/radio, clock/history, gear/settings. Reuse common components, 16–18px nominal, 1.5–1.8 stroke, decorative icons hidden from assistive tech and all actionable icon-only controls named.

## Main Media workspace

Browse retains actual YouTube search/URL entry, radio discovery and the deferred state of Spotify. Results show actual title/source/artwork and distinguish resolving/loading/empty/network error. A play action goes through the shared coordinator; enqueue doesn't unexpectedly start another source. Library preserves approved local folders/tracks, local collections, legacy mixes, and playback history; Queue shows Up Next and current occurrence; Settings has actual connection, local-library, display and sanitized diagnostics controls. Audit existing source navigation and include every retained action, not just these headings.

## Titlebar popover and mini-player

- Titlebar: quiet current title/status and explicit play/pause, not an always-open page header. Closed popover does not stop polling/active playback. Source label may hide before actual transport.
- Popover width at most 390px and `calc(100vw - 24px)`; maximum height `min(680px, calc(100vh - 72px))`; compact summary, applicable controls, usable volume, short queue and Open Media/Queue. Escape/outside click close; restore trigger focus. Do not open Browser or steal pane focus on session switch.
- Mini-player is the existing dockable FluidMusic pane, not a dedicated YouTube pane. Layout fits 320px width and a short ~220px body where supported: compact summary/art/video region above the SAME bottom bar; prefer a smaller art/video region rather than clipping controls. Declare unavoidable physical minimum instead of pretending everything fits.
- YouTube video lives within that one existing player surface. No second 'YouTube Video Embedded player' card/window, duplicate native/custom controls, or the rejected permanent 'volume is controlled by the embedded player' notice. Native embed internals are not permission to claim custom volume works. Preserve provider policy/embedding restrictions; no download/DRM/ad bypass.

## Responsive and interaction review

Use container width/height, not global window width or screenshot pixels. Broad 1200–1440, medium 720–980, narrow 320–390, short mini-pane and open popover are representative checks run sequentially with existing tools/manual review, not a browser farm. Test long/unknown title, missing art, long source, busy/error/disabled/no selection, keyboard-only, live theme change, focus return and reduced motion. Report missing live evidence rather than fetching a large browser or launching full Electron on the cloud.
'''

ARCH='''# Source, state and security contract

- Verified source baseline: `d6e2bf2df08ae455ac5b24a581c3f2212060afb0`, the existing feature/clean-titlebar-redesign commit. Main `2aa67f2` is older. The preparation compared eight relevant backend/renderer files against the installed unified package and the watched renderer bundle; they matched. That is file provenance, not a fresh playback test.
- Canonical product is the unified `fluid-music` package. Renderer edits belong in the nine `desktop/src` fragments; regenerate `desktop/plugin.js` with the existing `scripts/build_desktop.py`. Backend ownership is `dashboard/plugin_api.py` and `dashboard/local_library.py`, not Hermes core or sibling plugin imports. Do not commit runtime installation, .env/auth/SQLite/media, caches or private screenshots.
- `00-runtime.js`: SDK/React imports/constants; `10-model.js`: pure normalized identity/capability/queue validation; `20-styles.js`: semantic CSS; `30-controller.js`: one registration-level controller and adapters; `40-ui.js`: shared controls/rows; `41-library.js`: browse/local/radio/history surfaces; `42-playlists.js`: collections/queue/import/export; `43-visualizer.js`: mini-player despite old filename; `44-workspace.js`: route/titlebar/settings/registration.
- One controller owns selected source/item/index/queue/transport. View-local selection/search/popover state may vary, but chat focus is not playback intent. Session atoms must not issue a media command, queue mutation, source change or Browser navigation. All starts, including titlebar/compact paths, use the SAME serialized transition coordinator and one active engine.
- Commands, readiness and completion are generation-bound. Pause/stop the prior engine before starting another. `open A -> open B -> late A ready/ended/error` must not settle or advance B. Duplicate completion and repeated UI commands do not double-advance or duplicate played-history records.
- Durable queue references are safe provider IDs/localTrackId and sanitized display metadata, never object URLs, raw local paths, OAuth credentials or live loopback capabilities. Do not persist handles. Preserve raw legacy collections/unknown nested fields/order during unrelated edits and startup.
- SQLite is profile-scoped under the actual runtime's HERMES_HOME/plugin-data/fluid-music. Cloud code work must use an isolated temporary DB. Windows desktop media roots are not cloud media roots; never scan the owner's filesystem or silently create a cloud-wide music catalogue. Mock media/fixtures are labelled, not presented as real user history.
- Approved-folder local scanning remains bounded and symlink-safe; preserve stable IDs, unambiguous fingerprint relink, unavailable rows and range-capable media resolution. Removing an index root is not deleting audio files. Remote/cloud API location may differ from desktop media ownership; document that boundary instead of pretending a cloud filesystem path is playable on Windows.
- Current YouTube backend owns a 127.0.0.1-only capability-token wrapper with Host/path checks and official embed/JS API command+state relay. The capability URL is ephemeral, not durable history or a public service endpoint. If the backend actually runs on a remote cloud host, its loopback URL is NOT directly reachable by the owner's Desktop: explicitly gate cross-host browser/media acceptance and design an authorized protected transport if required; never expose the wrapper on 0.0.0.0 as a shortcut.
- Validate provider URL, exact video ID, frame source/origin, request generation and command/state schema. Ignore foreign/stale player messages. Sensitive tokens cannot enter logs or exports. Preserve origin/Referer/embed readiness and truthful autoplay/provider restrictions.
- Existing backend routes include /config, /youtube/embed-host, /youtube/search, /youtube/resolve, /history GET/POST/DELETE, /local roots/rescan/tracks, /radio/search and /radio/click/{stationuuid}. Spotify routes remain retained but repair is explicitly deferred. Inventory exact request/response types in source rather than assuming archived API semantics.
- Preserve plugin-owned optional-provider boundaries: optional Spotify import/auth problems cannot break YouTube, radio, local or history mounting. Do not 'fix' by replacing it with a sibling/host service or implementing Spotify against the owner's deferral.
'''

# ID/title/requirements/write boundary/interaction and implementation detail/acceptance.
CARDS=[
('FM-00','Verify cloud workspace and preserve the real current baseline',['F01','F25','F26','F27','F28','F30'],'Read existing manifests, source/fragments, build and packaging scripts; write only baseline/parity/route receipt.',
 'Bind the actual existing cloud profile and absolute clone/worktree, verify exact Qwen primary/child model and source ancestry. Read EXECUTION_POLICY first and mark stale DESIGN/PRODUCT/README instructions as historical rather than redesign requirements. Inventory current actions across main view, titlebar, mini-player and settings. Protect unrelated work.',
 ['Actual clone contains the d6e2bf2 baseline and full backend/renderer source, not only copied Markdown.','START receipt states exact source SHA, profile/provider/model, RAM budget and protected work. No service/app/runtime install is started.']),
('FM-01','Reconcile current host SDK/backend compatibility without optional-provider breakage',['F13','F14','F25','F29','F30'],'SDK imports, dashboard/plugin_api.py optional-provider boundaries, manifest and accurate compatibility documentation.',
 'Preserve the currently integrated loopback player and verify named SDK exports against the intended packaged host when evidence is available. Backend mounts YouTube/radio/local/history independently of unavailable Spotify modules. Do not launch/rebuild/restart Hermes or migrate Spotify. Use explicit unavailable/deferred state and guarded optional import boundaries.',
 ['A lightweight import/route-contract check or a precise unavailable-host limitation is recorded; no fake packaged-host acceptance.','No eager sibling/core Spotify dependency can take down unrelated backend routes; no alternate playback architecture replaces the working embed.']),
('FM-02','Protect registration-level playback and focus-switch continuity',['F07','F08','F17','F18','F19'],'desktop/src/30-controller.js and registration/callers in 43/44, narrow model checks.',
 'One controller instance is created in register(ctx) and shared through route/pane/titlebar. View remount or session/tiles changes preserve source, selected exact queue occurrence, playback state and current media destination. An explicit user action alone changes playback or pane/browser selection.',
 ['A small focus-switch fixture holds controller identity/item/index/source stable across at least two sessions and a route remount.','No implicit media play, Browser navigation, queue increment, focus steal or duplicate controller appears.']),
('FM-03','Finish one-engine handoff and correct Up Next lifecycle',['F10','F17','F18','F19'],'Pure queue/transition helpers in 10-model.js, coordinator/adapters in 30-controller.js and queue callers.',
 'Route every start/pause/skip/continuation through the shared serialized coordinator; stop prior source, fence stale readiness/errors/ended events, keep duplicate occurrence identity and reconcile actual source state. Persist restart-safe queue metadata only. Do not add new saved cross-source collections.',
 ['Radio -> YouTube -> local fixture transitions do not overlap engines; late event A cannot mutate B.','Exactly one completion advance and one played event occur; queue reorder/removal, duplicate entries and restart restoration retain correct identity.']),
('FM-04','Preserve and finish integrated YouTube command/state bridge',['F08','F09','F10','F13','F14','F17'],'Current loopback handler/routes in dashboard/plugin_api.py, YouTube adapter and existing embedded component.',
 'Use the existing protected loopback wrapper and one embedded player in FluidMusic. Bind play/pause/seek/volume and acknowledgements to actual player readiness/generation. Remove duplicate visible embed headings/native-control substitute notices, not the player engine. Keep provider restrictions and cross-host loopback limitation explicit.',
 ['Bounded command/message fixtures reject wrong token/Host/source/origin/video/generation and clean owned resources.','Custom play/volume evidence is distinguished from issued messages; actual audible/video proof is reserved for owner Desktop review when unavailable in cloud.']),
('FM-05','Complete YouTube search, URL resolution and real titles',['F05','F13','F15'],'/youtube/search and /youtube/resolve, model URL validation, Browse fields/result rows/controller metadata.',
 'Keep direct validated URL entry and bounded song/video search. Present real safe title/artist/channel/art where returned, accurate loading/empty/error/quota/unavailable states, explicit Play versus Add to Up Next. Abort/ignore stale results. No invented search records or unauthorized provider scraping/downloading.',
 ['Bounded fixtures cover supported URL/ID, invalid URL, missing metadata, stale query and provider failure.','Selected video title reaches shared player and history safely; queue insertion is not confused with confirmed playback.']),
('FM-06','Finish profile-scoped SQLite played history and clear/replay UX',['F05','F15','F16','F19','F30'],'Existing SQLite repository/history schema and /history routes, history controller/list presentation.',
 'Reuse current SQLite ownership/schema migration discipline. Record actual played confirmation once per transition with safe title/source/reference/time; do not log paused/failed merely-selected items as played. Reopen across sessions/restarts, paginate/bound queries, offer replay and explicit scoped Clear confirmation. No credentials/capability URLs/raw private paths.',
 ['An isolated temporary SQLite DB proves persistence, duplicate suppression, stable ordering and bounded clear without touching user databases.','Two profile roots do not share history; failed/queued-only items are not falsely marked played and replay revalidates availability.']),
('FM-07','Unify working bottom transport and make volume usable everywhere',['F09','F10','F11','F12','F24'],'Shared Transport, VolumeControl and SeekBar in 40-ui.js plus existing main/pane/popover callers and scoped CSS.',
 'One component/control vocabulary serves all providers. Bottom anchors in main and mini surfaces retain aligned metadata, applicable previous/play/next, seek or LIVE, and meaningful volume. No separate provider copy. Commands are real adapter actions; disable busy actions intentionally and show truthful state. Replace unusably short ranges with fluid preferred 150–170px or a full row.',
 ['Source capability table is exercised with small fixtures: radio has no fake seek; YouTube/local effects map to current item; all surfaces share callbacks.','Short/narrow layouts retain controls and usable volume; no rejected embedded-volume notice replaces custom volume.']),
('FM-08','Complete compact Hermes-themed Media workspace and responsive body',['F02','F03','F04','F05','F06','F09','F12','F24'],'20-styles.js, PageHead/rows and 41/42/44 workspace composition; preserve existing source actions.',
 'Implement the detailed DESIGN_CONTRACT: host colors only, small app titles, compact four-destination navigation and source tabs, content scroll above persistent bottom bar, bounded Orbit, dense results and queue. No duplicate sidebar row or website hero. Retain all actual browse/library/history/local/queue/settings interactions.',
 ['Source/UI fixture checks or owner screenshots cover main layout, empty/error/long title and narrow/short panes with no root overflow.','Live theme propagation is tested where a host exists, otherwise accurately gated for owner review; no private palette or old never-bottom-bar rule returns.']),
('FM-09','Finish titlebar popover and dockable mini-player with no extra YouTube pane',['F02','F07','F08','F09','F11','F12','F17','F24'],'Existing 43-visualizer.js mini-player and 44-workspace.js titlebar/pane registration, shared controls/styles.',
 'Keep quiet shell trigger, actual selected title/state and explicit play; one viewport-safe popover with same transport, adequate volume and short queue. Dockable existing mini-pane adapts art/video to size above its bottom controls. Esc/outside dismissal restores trigger focus; close/popover/session changes do not stop durable playback. Do not introduce a new YouTube pane, visualizer or giant track header.',
 ['A narrow/short existing-browser fixture or review artifact shows controls fit; inaccessible host state is explicitly unverified.','Focus restoration, trigger labels and controller lifetime behave correctly; hidden popover is not a reason to stop active-source observation.']),
('FM-10','Preserve radio discovery, pins and source-honest LIVE behavior',['F05','F09','F10','F18','F20'],'Existing radio API validation, discovery/filter/pin rows and radio adapter.',
 'Retain actual Radio Browser search and pinned station workflow. Validate safe public credential-free stream URLs with current SSRF/input rules; direct provider streams are not a new backend proxy. LIVE has no fake progress/seek or station-content skip. Network/codec/CORS failure reports the real boundary while other sources remain usable.',
 ['Bounded fixtures prove validation, correct selection/enqueue/pin and failure cleanup without launching public streams.','Live station playback is not claimed from JSON metadata; source switching goes through coordinator and history records confirmed playback only.']),
('FM-11','Preserve approved local-library scanning, IDs and seekable playback',['F05','F09','F10','F16','F21','F30'],'dashboard/local_library.py and local routes, local-track normalization and library UI.',
 'Keep explicit approved roots, extension/scan bounds, no directory-symlink following, bounded fingerprints, unavailable rows and unambiguous move recovery. Resolve localTrackId to approved range-capable media at runtime; no raw filesystem authority in renderer. Cloud tests use tiny temporary audio files/directories, not the owner library or a large scan.',
 ['Temporary SQLite/file fixtures prove stable IDs, missing/relinked tracks, root confinement and no deletion of audio on root removal.','Remote filesystem versus owner Desktop media path is documented; no claim that a Linux cloud path is a Windows playable track.']),
('FM-12','Complete safe local collections, legacy mixes and import/export continuity',['F05','F19','F21','F22','F30'],'10-model.js persistence boundaries, 42-playlists.js and related controller/storage operations.',
 'Keep local-only editable collections, correct exact-occurrence reorder/selection, bounded import/export and unavailable tracks. Provider playlists stay provider-owned; preserve raw legacy v3 mixes as read-only play/enqueue/export including unknown nested fields and duplicate order. Do not normalize-and-persist on startup or erase data through unrelated settings edits.',
 ['A small round-trip fixture preserves legacy raw shape/order/unknown fields through initialization and an unrelated write.','New collection writes retain safe localTrackId metadata only; session file/object URLs and live capability secrets cannot persist.']),
('FM-13','Finish dedicated Settings, truthful status and sanitized diagnostics',['F02','F05','F06','F23','F29','F30'],'Existing Settings/diagnostics and plugin settings registration, backend config and preference ownership.',
 'Retain provider/connectivity/local-library/queue behavior settings without redundant global sidebar discovery. Status distinguishes selected source, backend available, provider ready and actual playing. Show bounded useful logs without tokens/private paths; explicit scope on clear/reset and retain unrelated legacy/user data. Spotify is visibly deferred rather than silently repaired through another plugin.',
 ['Settings actual effects and persistence are checked with bounded fixtures; no controls falsely claim support.','Diagnostics contain no OAuth/capability tokens or raw provider payloads, and a Spotify import failure cannot erase available source status.']),
('FM-14','Close keyboard, icon, error and disposal gaps across all surfaces',['F10','F12','F14','F17','F23','F24'],'Shared UI components, labels/focus/error handling and controller/relay cleanup; no broad rewrite.',
 'Use one semantic icon set and named icon-only controls. Verify keyboard transport/ranges, dialog/popover focus/escape, reduced motion and meaningful empty/busy/error states. Source observation remains bounded while playback is active and stops on actual disposal. Never blanket-catch programming defects into success or recreate expensive visualizer work.',
 ['A small fixture confirms cleanup of timers/listeners/object URLs/player ownership and ignores stale events after disposal.','Representative keyboard/focus/error evidence is recorded; no hidden action, inaccessible tiny slider or false playing state remains known.']),
('FM-15','Build a complete cloud-to-Desktop artifact and reconcile stale docs',['F01','F02','F09','F13','F25','F26','F28','F29','F30'],'Existing scripts/build_desktop.py and package.py, manifest/README/docs/limitations; small necessary packaging fixes only.',
 'Regenerate from canonical fragments and assemble full unified backend/renderer artifact with existing standard-library packaging. Include helpers required at runtime and accurate minimum SDK/support boundaries. Reconcile old private-palette/no-bottom-player/owned-Browser/sibling-Spotify/restart instructions. Document Linux cloud workspace versus local Desktop install, source SHA and hashes, not machine-specific absolute paths. Do not install, publish release/catalog, change host runtime or run doctor.',
 ['Generated runtime check, syntax and package-content/hash checks pass within memory budget, or report exact outstanding blocker.','Artifact contains current backend/renderer and no secrets, real DB/history/media/cache; provide owner-facing install/review instructions and remote verified commit.']),
('FM-16','Run final lean checks and request owner playback/theme review',['F01','F02','F07','F08','F09','F10','F11','F12','F13','F15','F16','F17','F18','F24','F25','F26','F27','F28','F30'],'Small existing checks, finish receipt and actual package/review manifest; do not start a full service stack.',
 'Run one small high-value serial set for changed risks, not every archived suite. Present exact artifact/commit/pushed branch/remote SHA, fixture versus live evidence and remaining limitations. Owner review checks actual YouTube play/pause/volume, another source transition, chat switch, titles/history, main/short mini/popover bottom controls and theme/narrow behavior. Use CALLBACK REVIEW and stop here for owner input; do not call the product fully accepted before that review.',
 ['All safe autonomous core slices have scoped pushed checkpoints and a precise final status; remaining gates are named honestly.','The owner gets an actual artifact and actionable review steps, not fabricated captures or another can-I-continue question.']),
('FM-17','Retain deferred Spotify ownership as a separate owner decision',['F25','F28','F29','F30'],'Planning/decision receipt only until separate authorization; do not modify Spotify authentication/client/provider integration.',
 'Respect the explicit leave-Spotify-for-later instruction. Preserve existing code/data and optional failure isolation. If the owner later authorizes repair, FluidMusic owns its integration rather than silently substituting Hermes core or a sibling plugin. Platform/API/account/Premium/device boundaries need actual supported implementation and consent, not a guessed adapter.',
 ['This card stays blocked at the user-review/decision gate; automatic core continuation does not start Spotify work.','Existing data/provider ownership is retained, not deleted or falsely certified, and deferred repair is clearly separated from completed core work.'])
]
from scope_update import extend
REQUIREMENTS,POLICY,VISUAL,ARCH,CARDS=extend(REQUIREMENTS,POLICY,VISUAL,ARCH,CARDS)
assert len(CARDS)==26
assert {r for c in CARDS for r in c[2]}==set(REQUIREMENTS)
put(ROOT/'EXECUTION_POLICY.md',POLICY)
put(ROOT/'DESIGN_CONTRACT.md',VISUAL)
put(ROOT/'ARCHITECTURE_CONTRACT.md',ARCH)
# Preserve exact source docs as historical material through relative references instead of copying private chats.
master='# FluidMusic complete agent-ready handoff\n\nRead EXECUTION_POLICY first. This is the current reconciliation of the owner-designated mixed-topic session; the owner explicitly selected FluidMusic, NOT Navigator.\n\n'+POLICY+'\n'+VISUAL+'\n'+ARCH+'\n# Complete requirement ledger\n\n'
for key,value in REQUIREMENTS.items():master+=f'- **{key}** — {value}\n'
master+='''
# Historical evidence versus current authority

The feature baseline already contains PRODUCT.md, DESIGN.md, README.md, docs/architecture.md, docs/limitations.md and `.impeccable` concepts/review images. Preserve those as source history, but later user corrections and EXECUTION_POLICY/DESIGN_CONTRACT override stale wording. In particular, do not reintroduce fixed palette, reject a user-tinted Hermes theme, remove the bottom bar, restore a dedicated YouTube surface, replace the included Spotify client with another plugin, or revive focused-chat Browser control because an old document says so. Existing tracked review images were inspected for obvious credentials/personal chat content; they show generic music fixtures, not fresh live playback or current UI approval.

The original Windows checkout and existing feature worktree are retained unchanged. GitHub branch includes the actual complete feature source baseline, not just these Markdown files. Source paths in this handoff are repository-relative; choose the actual absolute cloud workspace at import. Never copy auth/.env/user database/media/runtime state or private historical session dumps into this public repository.

# Source/API truth and acceptance

Use the current request/response and generated-fragment contracts in the source. Model identity pins are for the worker, not media providers. 'YouTube is working' was the owner's historical observation, not a fresh claim by this planning run. Plan validation proves hashes/coverage/guardrails only. Headless controller/SDK fixtures are useful but do not prove actual audio, provider consent/embed configuration, packaged Desktop rendering or Windows local playback. Owner review is the deliberate completion gate after the complete implementation chain, INCLUDING plugin-owned Spotify, expanded YouTube coverage, new features and update durability.
'''
put(ROOT/'MASTER_PLAN.md',master)
coverage='# Requirement coverage\n\nEvery original retained/explicit requirement below has at least one detailed card. Duplicate mappings indicate shared constraints, not extra features.\n\n| Requirement | Meaning | Cards |\n|---|---|---|\n'
manifest_cards=[]
for i,(key,title,requirements,areas,scope,acceptance) in enumerate(CARDS):
    previous=CARDS[i-1][0] if i else None
    body=f'# {key} — {title}\n\n**Initial state:** BLOCKED · **Previous:** {previous or "none"} · **Requirements:** '+', '.join(requirements)+'\n\n'
    body+='## Exact outcome and complete workflow\n\n'+scope+'\n\n## Intended source/write boundaries\n\n'+areas+'\n\n## Concrete acceptance scenarios\n\n'+'\n'.join('- [ ] '+a for a in acceptance)+'\n\n'
    body+=POLICY+'\n'+VISUAL+'\n'+ARCH
    body+='\n## Relevant source requirements\n\n'+'\n'.join('- **'+r+'** — '+REQUIREMENTS[r] for r in requirements)+'\n'
    body+='''
## Execution sequence and finish evidence

1. Read this entire card plus current policy/source and the existing predecessor finish receipt. CALLBACK START records exact cloud route, source/workspace, permissions and low-RAM budget. Discover actual SDK exports and existing script options; do not assume the Windows installation exists remotely.
2. Preserve approved behavior, source owners and saved data. Make minimal integrated changes in canonical fragments/modules. Do not replace the whole app or perform unapproved live provider/account effects. Required test fixtures are explicitly labelled and bounded.
3. Use one small serial risk-focused check set with existing tools. No Docker, full-stack/GUI farms, large installs, production account/media operations, or repeated exhaustive test passes. SQLite fixtures must be temporary and isolated. A test-only success cannot stand in for missing live acceptance.
4. Inspect diff and generated output, commit this scoped work with the correct personal identity, PUSH to the authorized feature branch and verify exact remote SHA. Preserve unrelated/partial work; do not amend others or force-push.
5. CALLBACK FINISH contains files, actual tests/results, fixture/live distinctions, commit/parent/author, pushed branch and verified remote SHA, remaining dirty work, precise next existing card or real blocker/review requirement.
6. Continue the already-authorized full chain without asking routine permission. Use event-driven callback routing and inspect existing successor state before dispatch, avoiding duplicate work. At FM-25 request actual owner review after the complete included-provider chain. Preparation/import starts none of this automatically.

## Required completion receipt

- Task/scope, actual cloud profile/provider/main/delegated models:
- Repository, absolute cloud workspace, branch, start SHA:
- Protected/unrelated work and exact changed files:
- Full scoped commit SHA(s), parent(s), author:
- Pushed branch and read-back verified remote SHA:
- Commands/checks and ACTUAL results:
- Fixture/mock/source evidence versus real provider/audio/host evidence:
- Artifact path/hash and source-SHA binding where applicable:
- Remaining acceptance, exact blocker or owner-review actions:
- Next existing linked task and whether continued or deliberately review-gated:
'''
    put(ROOT/'kanban'/f'{key}.md',body)
    payload=(ROOT/'kanban'/f'{key}.md').read_bytes()
    manifest_cards.append({'key':key,'title':title,'source_tasks':requirements,'body_file':f'kanban/{key}.md','body_sha256':digest(payload),'depends_on':[previous] if previous else [],'initial_status':'blocked','priority':100-i,'idempotency_key':'fluid-music-complete-handoff-v1:'+key,'goal_mode':False,'completion_contract':'local-only','max_runtime':'1h','max_retries':1,'model_override':MODEL,'provider_override':'verified receiving profile provider','per_slice_commit_required':True,'push_after_every_commit_required':True,'user_review_gate':key=='FM-25'})
for requirement,meaning in REQUIREMENTS.items():coverage+=f'| {requirement} | {meaning} | '+', '.join(c['key'] for c in manifest_cards if requirement in c['source_tasks'])+' |\n'
put(ROOT/'COVERAGE.md',coverage)
paths=['plugin.yaml','dashboard/manifest.json','dashboard/plugin_api.py','dashboard/local_library.py','desktop/plugin.js','desktop/src/00-runtime.js','desktop/src/10-model.js','desktop/src/20-styles.js','desktop/src/30-controller.js','desktop/src/40-ui.js','desktop/src/41-library.js','desktop/src/42-playlists.js','desktop/src/43-visualizer.js','desktop/src/44-workspace.js','scripts/build_desktop.py','scripts/package.py','PRODUCT.md','DESIGN.md','.impeccable/review/desktop.png','.impeccable/review/mobile.png','.impeccable/review/titlebar-popover.png']
assets=[{'path':p,'baseline_git_blob':subprocess.check_output(['git','-C',str(REPO),'rev-parse',BASE+':'+p],text=True).strip(),'already_in_repository':True} for p in paths]
manifest={'schema_version':1,'plan_id':'fluid-music-complete-handoff-v1','product':'FluidMusic','repository':REPOSITORY,'baseline_commit':BASE,'source_session':'local-d9859a03fbbea5223702e27fedd0b7801005041b53b6aff99812872364e6b326','specification':'MASTER_PLAN.md','specification_sha256':digest((ROOT/'MASTER_PLAN.md').read_bytes()),'original_task_ids':sorted(REQUIREMENTS),'source_assets':assets,'cards':manifest_cards,'start_workers':False,'preserve_existing_board':True,'worker_model':MODEL,'delegation_allowed':True,'delegation_model':MODEL,'route_policy':'Exact Qwen worker and child model; provider verified from actual cloud profile, no automatic model/provider fallback.','testing_policy':{'docker_allowed':False,'heavyweight_test_stacks_allowed':False,'parallel_heavy_checks_allowed':False,'database':'Existing profile-scoped SQLite; temporary isolated SQLite/test doubles for verification'},'git_policy':{'commit_each_slice':True,'push_each_commit':True,'verify_remote_sha':True,'continue_until_done_or_user_review':True,'main_release_push_authorized':False},'callback_policy':['START','FINISH','BLOCKED','REVIEW'],'cloud_handoff':True,'private_repository':False}
put(ROOT/'manifest.json',json.dumps(manifest,indent=2))
index='''# FluidMusic — Hermes Cloud Kanban handoff

Read [EXECUTION_POLICY.md](EXECUTION_POLICY.md) first, then [MASTER_PLAN.md](MASTER_PLAN.md) and [COVERAGE.md](COVERAGE.md). Latest user decisions override stale source design/README instructions.

- Repository: `noxius-studium/fluid-music`; branch: `docs/cloud-kanban-handoff`.
- Full feature source baseline: `d6e2bf2df08ae455ac5b24a581c3f2212060afb0`, not older main. Actual source/backend/renderer are IN THIS BRANCH.
- 26 detailed cards and 40 requirements. FM-00 through FM-25 includes plugin-owned Spotify, YouTube failure diagnosis/integrated fallback, new features and update durability. Continue once implementation is authorized, with real owner review at the end.
- Main and ALL delegated workers: exactly `qwen/qwen4-max:free`; provider verified from actual cloud profile. No alternate-model fallback.
- No Docker/heavy testing. Small serial checks, temporary SQLite, labelled fixtures; no local Windows runtime assumptions, browser downloads, restarts or live account operations.
- Every scoped commit -> push authorized feature branch -> verify remote SHA -> CALLBACK FINISH -> continue without routine permission questions, until done or real owner review. Never push main/tags/releases/catalog as a shortcut.
- Cloud cannot certify real Desktop audio/YouTube/volume/local paths merely by running mocks. Preserve that final review gate rather than weakening the product.

## Safe blocked import

1. Clone/fetch THIS branch on the actual receiving cloud host; bind an existing absolute workspace. Read actual profile config, not a connection display name.
2. Run `python docs/handoffs/agent-plan/import_kanban.py` for a no-write validation/dry-run.
3. Run `python docs/handoffs/agent-plan/test_import_kanban.py` for small helper integrity/guardrail tests. These are not application/audio tests.
4. Actual import needs `--apply --board <actual-board> --assignee <actual-existing-profile> --workspace <absolute-cloud-workspace> --profile-config <actual-config-file> --confirm-repository noxius-studium/fluid-music`. Do not copy these angle-bracket placeholders literally.
5. The importer uses full self-contained Markdown bodies, idempotency keys, exact Qwen/provider task pins, strict parent chain, BLOCKED initial state and read-back verification of bodies/route/parents/zero-runs. It preserves existing board content and writes a resumable local receipt. It does not invoke agents, change profile config, unblock, dispatch or touch the app.
6. Report exact target/card IDs and stop preparation. Start execution only when the user actually authorizes it; once started, continue through authorized slices via callbacks until completion/review, not another routine question after each commit.

## Cards

'''
for c in manifest_cards:index+=f'- [{c["key"]} — {c["title"]}]({c["body_file"]})\n'
put(ROOT/'KANBAN.md',index)
put(ROOT/'START_HERE.md','''# Start here — FluidMusic for Hermes Cloud

Use `noxius-studium/fluid-music`, branch `docs/cloud-kanban-handoff`. This is **FluidMusic**, NOT Navigator, Composer or Grove. Full actual feature source is included; historical Windows paths are not cloud workspace instructions.

Read [EXECUTION_POLICY.md](EXECUTION_POLICY.md), then [KANBAN.md](KANBAN.md), [MASTER_PLAN.md](MASTER_PLAN.md), [COVERAGE.md](COVERAGE.md) and [PROVIDER_RESEARCH.md](PROVIDER_RESEARCH.md).

Validate/import all 26 detailed linked cards as **BLOCKED**, preserving existing board content. No implementation or worker starts merely because this handoff was prepared. Use the actual cloud profile/provider and exactly `qwen/qwen4-max:free` for main and every delegated worker. No Docker/heavy tests; temporary SQLite and a small serial suite only. Do not restart Hermes, install into the owner's desktop or touch real history/media/credentials during preparation. Spotify IS included and must be implemented within FluidMusic, not via other Hermes plugins.

Once execution is separately authorized: CALLBACK START -> scoped changes/checks -> commit -> PUSH -> verify remote SHA -> CALLBACK FINISH -> continue the next authorized slice without asking routine permission. Stop at genuine owner review/completion or an actual blocker. FM-25 is the final owner audio/theme/UI review after all included Spotify, YouTube, feature and durability work.

Cloud fixtures are not proof of audible YouTube/volume, packaged Desktop rendering or Windows media access. Deliver the actual package/SHA and exact review steps; never invent live acceptance or publicize private user data.
''')
put(ROOT/'.gitattributes','*.md text eol=lf\n*.json text eol=lf\n*.py text eol=lf\n.gitattributes text eol=lf\n.gitignore text eol=lf')
put(ROOT/'.gitignore','__pycache__/\nimport-receipt.local.json\nimport-receipt.local-payloads/')
print(json.dumps({'cards':len(CARDS),'requirements':len(REQUIREMENTS),'verified_source_assets':len(assets),'body_bytes':sum((ROOT/c['body_file']).stat().st_size for c in manifest_cards),'model':MODEL,'child_model':MODEL,'push_each_commit':True,'callbacks':manifest['callback_policy'],'workers_started':False},indent=2))
