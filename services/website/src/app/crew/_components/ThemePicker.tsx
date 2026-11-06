'use client'

import { useState } from 'react'
import { THEMES, THEME_COOKIE, type ThemeId } from '@/lib/crew/themes'

/**
 * Choose how the crew app looks. It applies at once (the theme is an attribute
 * on the app's root) and is remembered on this device in a cookie scoped to
 * `/crew`, so the next page is already painted in it.
 */
export default function ThemePicker({ current }: { current: ThemeId }) {
  const [theme, setTheme] = useState<ThemeId>(current)

  function pick(id: ThemeId) {
    setTheme(id)
    document.querySelector('.crew-root')?.setAttribute('data-theme', id)
    document.cookie = `${THEME_COOKIE}=${id}; path=/crew; max-age=${60 * 60 * 24 * 365}; samesite=lax`
  }

  return (
    <div className="crew-grid" role="group" aria-label="Appearance">
      {THEMES.map(t => (
        <button key={t.id} type="button" className="crew-pick" aria-pressed={theme === t.id} onClick={() => pick(t.id)}>
          <span className="crew-swatch" aria-hidden="true">
            <span style={{ background: t.tokens.bg }} />
            <span style={{ background: t.tokens.surface }} />
            <span style={{ background: t.tokens.accent }} />
            <span style={{ background: t.tokens.text }} />
          </span>
          <strong style={{ display: 'block' }}>{t.label}{theme === t.id ? ' ✓' : ''}</strong>
          <span className="crew-muted crew-small">{t.blurb}</span>
        </button>
      ))}
    </div>
  )
}
