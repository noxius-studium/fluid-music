import React, { useSyncExternalStore } from 'react'
export const atom = (initial) => {
  let value = initial
  const listeners = new Set()
  return {
    get: () => value,
    set: (next) => {
      value = next
      listeners.forEach((fn) => fn())
    },
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
export const useValue = (store) => useSyncExternalStore(store.subscribe, store.get, store.get)
export const Button = ({ children, variant, size, ...props }) =>
  React.createElement(
    'button',
    {
      ...props,
      className: `test-button ${props.className || ''}`,
      'data-variant': variant,
      'data-size': size,
    },
    children,
  )
export const SandboxedFrame = ({ src, title, className, style }) =>
  React.createElement('iframe', { src, title, className, style, sandbox: 'allow-scripts allow-presentation' })
export const host = {
  navigate: (path) => {
    window.lastNavigation = path
  },
}
export const ROUTES_AREA = 'routes'
export const SIDEBAR_NAV_AREA = 'sidebar.nav'
export const TITLEBAR_AREAS = { right: 'titleBar.right' }
