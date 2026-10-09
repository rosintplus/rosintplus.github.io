/**
 * SSR shim for React.
 *
 * Aliased in by scripts/render-smoke.mjs. The app's i18n store calls
 * `useSyncExternalStore(subscribe, getSnapshot)` with no third argument, which
 * React requires only for server rendering — in a browser it uses the client
 * snapshot. Supplying a server snapshot here lets the render smoke test
 * exercise the real render path without changing app code.
 *
 * Real React is loaded with createRequire so the `react` alias above does not
 * resolve this module back to itself.
 */
import { createRequire } from 'node:module';

const React = createRequire(import.meta.url)('react');

export const {
  useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef,
  useContext, createContext, memo, forwardRef, lazy, Suspense, Fragment,
  Children, isValidElement, cloneElement, startTransition, useTransition,
  useDeferredValue, useId, useImperativeHandle, useDebugValue, use,
  createElement, Component, PureComponent, StrictMode, useReducer,
} = React;

export function useSyncExternalStore(subscribe, getSnapshot) {
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export default React;
