import * as HermesSDK from '@hermes/plugin-sdk'
import { createElement as h, useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

/* SDK_BOUNDARY_START */
const HOST_CONTRACT = {
  contractVersion: 1,
  sdk: '@hermes/plugin-sdk',
  required: ['atom', 'useValue', 'host', 'ROUTES_AREA', 'TITLEBAR_AREAS'],
  optional: {
    Button: 'plain-button fallback with the same actions',
    'host.navigate': 'navigation shortcuts degrade; in-pane view switching still works',
    'TITLEBAR_AREAS.right': 'titlebar surface skipped; route and mini-player remain',
    OwnedMediaView: 'first-party YouTube watch fallback reports unavailable',
    'host.mediaSession': 'first-party YouTube watch fallback reports unavailable',
    'window.hermesDesktop.getEmbedHostOrigin': 'direct embed URL fallback',
    'window.Spotify.Player': 'in-plugin Spotify audio assessed as unsupported; Connect control remains',
  },
  minimum: 'Namespace SDK exposing atom, useValue, host, ROUTES_AREA and TITLEBAR_AREAS; React createElement/hooks are stable platform imports, not optional host exports.',
  policy: 'Current/next/absent capability fixtures guard the declared doors. Unknown arbitrary future breaking releases are not guaranteed; an incompatible host gets a precise recovery surface, never silent data deletion or rewritten product scope.',
}
const resolveSdk = namespace => {
  const sdk = namespace && typeof namespace === 'object' ? namespace : {}
  const missing = HOST_CONTRACT.required.filter(name => sdk[name] == null)
  const optional = {
    button: typeof sdk.Button === 'function',
    navigate: typeof sdk.host?.navigate === 'function',
    titlebarRight: sdk.TITLEBAR_AREAS?.right != null,
  }
  return { sdk, missing, compatible: missing.length === 0, optional }
}
/* SDK_BOUNDARY_END */
// Namespace import + capability check before any export is referenced: a
// missing named ESM binding would abort the whole plugin at link time, while
// this boundary lets registration render an honest fallback instead. Button
// is optional (WorkspaceButton and the titlebar summary fall back to a plain
// button); the rest are required for the current surfaces. React bindings
// above are stable platform APIs, not optional host exports.
const { sdk: SDK, missing: SDK_MISSING, compatible: SDK_COMPATIBLE, optional: SDK_OPTIONAL } = resolveSdk(HermesSDK)
const atom = SDK.atom
const useValue = SDK.useValue
const host = SDK.host
const ROUTES_AREA = SDK.ROUTES_AREA
const TITLEBAR_AREAS = SDK.TITLEBAR_AREAS
const Button = SDK.Button
const HOST_NAVIGATE = SDK_OPTIONAL.navigate ? SDK.host.navigate.bind(SDK.host) : null
const TITLEBAR_RIGHT = SDK_OPTIONAL.titlebarRight ? SDK.TITLEBAR_AREAS.right : null

const ID = 'fluid-music'
const ROUTE = '/media'
const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' }
