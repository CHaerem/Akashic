import { createContext, useContext, useEffect, type ReactNode } from 'react'

/**
 * Theme context - Liquid Glass design is dark-mode only
 * This context is kept for API compatibility but always returns 'dark'
 */

interface ThemeContextType {
  theme: 'dark'
  resolvedTheme: 'dark'
  setTheme: (theme: 'dark') => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  // Apply dark theme class to document root on mount
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('light')
    root.classList.add('dark')

    // Set dark mode body styles
    document.body.style.backgroundColor = '#0a0a0f'
    document.body.style.color = 'rgba(255, 255, 255, 0.95)'
  }, [])

  // No-op setTheme - dark mode only
  const setTheme = () => {}

  return (
    <ThemeContext.Provider value={{ theme: 'dark', resolvedTheme: 'dark', setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
