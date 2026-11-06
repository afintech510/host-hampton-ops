'use client'

import { useState } from 'react'
import { THEMES, THEME_COOKIE, type CrewTheme, type ThemeId } from '@/lib/crew/themes'

/**
 * A small sketch of a look drawn from its own tokens: where the tabs sit (top or
 * bottom, bar or floating pill), what the date block is, how round a button is,
 * and its colours, so looks can be compared by structure and not just by colour.
 */
function Sketch({ t }: { t: CrewTheme }) {
  const k = t.tokens
  const topTabs = t.id === 'editorial'
  const pillBar = t.id === 'clean' || t.id === 'pop'
  const dateStyle: React.CSSProperties =
    t.id === 'pop' ? { borderRadius: '50%', background: k.accent, width: 26, height: 26 }
    : t.id === 'bold' ? { background: k.accentSoft, border: `2px solid ${k.text}`, borderRadius: 4, width: 26, height: 26 }
    : t.id === 'midnight' ? { background: k.surface2, borderRight: `2px dashed ${k.line}`, width: 26, height: 30, borderRadius: 0 }
    : { width: 20, height: 26 }
  const dateInk = t.id === 'pop' ? k.onAccent : t.id === 'bold' ? k.text : k.accent
  const cardStyle: React.CSSProperties =
    t.id === 'bold' ? { border: `2px solid ${k.text}`, boxShadow: `3px 3px 0 ${k.text}`, background: k.surface, borderRadius: 6 }
    : t.id === 'midnight' ? { borderLeft: `4px solid ${k.accent}`, background: k.surface, borderRadius: 6 }
    : t.id === 'pop' ? { background: k.surface, borderRadius: 14, boxShadow: '0 4px 10px rgba(0,0,0,.08)' }
    : t.id === 'editorial' ? { borderTop: `2px solid ${k.text}`, borderRadius: 0 }
    : { borderBottom: `1px solid ${k.line}` }
  return (
    <span aria-hidden="true" style={{ display: 'block', position: 'relative', height: 104, background: k.bg, borderRadius: 10, border: `1px solid ${k.line}`, overflow: 'hidden', marginBottom: '.5rem' }}>
      {topTabs && (
        <span style={{ display: 'flex', gap: 8, padding: '5px 8px', borderBottom: `1px solid ${k.line}` }}>
          <span style={{ width: 18, height: 4, background: k.text }} />
          <span style={{ width: 18, height: 4, background: k.line }} />
          <span style={{ width: 18, height: 4, background: k.line }} />
        </span>
      )}
      <span style={{ display: 'flex', gap: 7, alignItems: 'center', margin: topTabs ? '8px 8px 0' : '12px 8px 0', padding: 6, ...cardStyle }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', fontSize: 11, fontWeight: 800, color: dateInk, ...dateStyle }}>7</span>
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block', height: 5, width: '70%', background: k.text, borderRadius: 3, marginBottom: 4 }} />
          <span style={{ display: 'block', height: 4, width: '45%', background: k.muted, opacity: 0.5, borderRadius: 3 }} />
        </span>
        <span style={{
          flex: 'none', height: 14, width: 32, borderRadius: Math.min(parseInt(k.radiusBtn, 10) || 0, 7),
          background: t.id === 'midnight' ? 'transparent' : k.accent, border: t.id === 'midnight' ? `1.5px solid ${k.accent}` : t.id === 'bold' ? `2px solid ${k.text}` : 'none',
        }} />
      </span>
      {!topTabs && (
        <span style={{
          position: 'absolute', bottom: pillBar ? 6 : 0, left: pillBar ? 10 : 0, right: pillBar ? 10 : 0, height: 14,
          background: t.id === 'bold' ? k.text : k.surface, borderRadius: pillBar ? 99 : 0,
          borderTop: pillBar ? 'none' : `2px solid ${t.id === 'midnight' ? k.accent : k.line}`,
          boxShadow: pillBar ? '0 3px 8px rgba(0,0,0,.15)' : 'none', display: 'flex', justifyContent: 'space-around', alignItems: 'center',
        }}>
          <span style={{ width: 12, height: 4, borderRadius: 2, background: t.id === 'bold' ? k.accentSoft : k.accent }} />
          <span style={{ width: 12, height: 4, borderRadius: 2, background: t.id === 'bold' ? k.muted : k.line }} />
          <span style={{ width: 12, height: 4, borderRadius: 2, background: t.id === 'bold' ? k.muted : k.line }} />
        </span>
      )}
    </span>
  )
}

/**
 * Choose how the crew app looks. It applies at once (the look is an attribute
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
          <Sketch t={t} />
          <strong style={{ display: 'block' }}>{t.label}{theme === t.id ? ' ✓' : ''}</strong>
          <span className="crew-muted crew-small">{t.blurb}</span>
        </button>
      ))}
    </div>
  )
}
