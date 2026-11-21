import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'
type ResolvedTheme = Exclude<Theme, 'system'>

type ThemeContextValue = {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
  themes: Theme[]
}

const STORAGE_KEY = 'theme'
const MEDIA_QUERY = '(prefers-color-scheme: dark)'
const ThemeContext = createContext<ThemeContextValue | null>(null)

const systemTheme = (): ResolvedTheme =>
  typeof window !== 'undefined' && window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light'

const storedTheme = (fallback: Theme): Theme => {
  if (typeof window === 'undefined') return fallback
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : fallback
}

export function ThemeProvider({ children, defaultTheme = 'system', enableSystem = true }: {
  children: React.ReactNode
  attribute?: 'class'
  defaultTheme?: Theme
  enableSystem?: boolean
}) {
  const [theme, setThemeState] = useState<Theme>(() => storedTheme(defaultTheme))
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)
  const resolvedTheme = theme === 'system' && enableSystem ? system : theme === 'system' ? 'light' : theme

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }, [])

  useLayoutEffect(() => {
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add(resolvedTheme)
    document.documentElement.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  useEffect(() => {
    if (!enableSystem) return
    const media = window.matchMedia(MEDIA_QUERY)
    const update = () => setSystem(media.matches ? 'dark' : 'light')
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [enableSystem])

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme, themes: ['light', 'dark', 'system'] as Theme[] }), [theme, resolvedTheme, setTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext) ?? {
    theme: 'system',
    resolvedTheme: systemTheme(),
    setTheme: () => {},
    themes: ['light', 'dark', 'system'],
  }
}
