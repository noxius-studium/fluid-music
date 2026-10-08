import { atom, Button, host, ROUTES_AREA, SIDEBAR_NAV_AREA, STATUSBAR_AREAS, useValue } from '@hermes/plugin-sdk'
import { createElement as h, useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'fluid-music'
const ROUTE = '/media'
const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music' }
