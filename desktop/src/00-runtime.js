import * as HermesSDK from '@hermes/plugin-sdk'
import { createElement as h, useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

/* SDK_BOUNDARY_START */
const resolveSdk = namespace => {
  const sdk = namespace && typeof namespace === 'object' ? namespace : {}
  const required = ['atom', 'useValue', 'host', 'ROUTES_AREA', 'TITLEBAR_AREAS']
  const missing = required.filter(name => sdk[name] == null)
  return { sdk, missing, compatible: missing.length === 0 }
}
/* SDK_BOUNDARY_END */
// Namespace import + capability check before any export is referenced: a
// missing named ESM binding would abort the whole plugin at link time, while
// this boundary lets registration render an honest fallback instead. Button
// is optional (WorkspaceButton falls back to a plain button); the rest are
// required for the current surfaces. React bindings above are stable platform
// APIs, not optional host exports.
const { sdk: SDK, missing: SDK_MISSING, compatible: SDK_COMPATIBLE } = resolveSdk(HermesSDK)
const atom = SDK.atom
const useValue = SDK.useValue
const host = SDK.host
const ROUTES_AREA = SDK.ROUTES_AREA
const TITLEBAR_AREAS = SDK.TITLEBAR_AREAS
const Button = SDK.Button

const ID = 'fluid-music'
const ROUTE = '/media'
const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' }
