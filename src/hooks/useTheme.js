import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const THEME_KEY = 'jigsawmult-theme-preference'
const LEGACY_THEME_KEY = 'jigsawmult-theme'
const THEME_OPTIONS = new Set(['system', 'light', 'dark'])
const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)'

function readThemePreference() {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (THEME_OPTIONS.has(saved)) return saved
    return localStorage.getItem(LEGACY_THEME_KEY) === 'dark' ? 'dark' : 'system'
  } catch { return 'system' }
}

function readSystemTheme() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(COLOR_SCHEME_QUERY).matches
    : false
}

export function useTheme() {
  const [themePreference, setThemePreference] = useState(readThemePreference)
  const [systemIsDark, setSystemIsDark] = useState(readSystemTheme)
  const theme = themePreference === 'system' ? (systemIsDark ? 'dark' : 'light') : themePreference
  const appliedTheme = useRef(theme)
  const transitionTimer = useRef(null)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia(COLOR_SCHEME_QUERY)
    const handleChange = (event) => setSystemIsDark(event.matches)
    setSystemIsDark(query.matches)
    if (typeof query.addEventListener === 'function') query.addEventListener('change', handleChange)
    else query.addListener(handleChange)
    return () => {
      if (typeof query.removeEventListener === 'function') query.removeEventListener('change', handleChange)
      else query.removeListener(handleChange)
    }
  }, [])

  useLayoutEffect(() => {
    const root = document.documentElement
    if (appliedTheme.current !== theme) {
      const reducedMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (!reducedMotion) {
        root.classList.add('theme-transitioning')
        window.clearTimeout(transitionTimer.current)
        transitionTimer.current = window.setTimeout(() => {
          root.classList.remove('theme-transitioning')
          transitionTimer.current = null
        }, 520)
      }
      appliedTheme.current = theme
    }
    root.dataset.theme = theme
    root.style.colorScheme = theme
    try { localStorage.setItem(THEME_KEY, themePreference) } catch { /* keep the theme for this session */ }
  }, [theme, themePreference])

  useEffect(() => () => {
    window.clearTimeout(transitionTimer.current)
    document.documentElement.classList.remove('theme-transitioning')
  }, [])

  return { theme, themePreference, setThemePreference }
}
