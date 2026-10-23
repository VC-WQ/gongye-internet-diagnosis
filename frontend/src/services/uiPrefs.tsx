import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type UiTheme = 'light' | 'dark'

interface UiPreferencesValue {
  theme: UiTheme
  setTheme: (theme: UiTheme) => void
  toggleTheme: () => void
  reducedMotion: boolean
}

const UiPreferencesContext = createContext<UiPreferencesValue | null>(null)

export function readTheme(): UiTheme {
  try {
    return localStorage.getItem('ui:theme') === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<UiTheme>(readTheme)
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  )

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const changed = () => setReducedMotion(media.matches)
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('ui:theme', theme)
    } catch {
      /* 隐私模式下忽略存储失败 */
    }
  }, [theme])

  const value = useMemo<UiPreferencesValue>(
    () => ({
      theme,
      reducedMotion,
      setTheme: setThemeState,
      toggleTheme: () =>
        setThemeState((current) => (current === 'dark' ? 'light' : 'dark')),
    }),
    [theme, reducedMotion],
  )

  return (
    <UiPreferencesContext.Provider value={value}>
      {children}
    </UiPreferencesContext.Provider>
  )
}

export function useUiPreferences(): UiPreferencesValue {
  const value = useContext(UiPreferencesContext)
  if (!value) throw new Error('useUiPreferences must be used inside UiPreferencesProvider')
  return value
}
