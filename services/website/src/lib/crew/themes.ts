/**
 * Looks for the crew app (`/crew`). A theme is a set of CSS variables on
 * `.crew-root[data-theme="<id>"]`; every colour in the crew stylesheet comes
 * from one of them, so a theme can never leave a piece of the app behind.
 *
 * Which one a person sees is their own choice, kept in a cookie scoped to
 * `/crew` (picker: Profile → Appearance). It decides colours only, never what
 * the app says or does. `DEFAULT_THEME` is what everyone sees until they pick.
 */

export const THEME_COOKIE = 'hh_crew_theme'

export type ThemeId = 'clean' | 'classic' | 'ocean' | 'midnight' | 'warm'

export const DEFAULT_THEME: ThemeId = 'clean'

interface Tokens {
  bg: string; surface: string; surface2: string; text: string; muted: string; line: string
  accent: string; accentHover: string; onAccent: string; accentSoft: string; accentInk: string
  ok: string; okInk: string; warn: string; warnInk: string; alert: string; alertInk: string
  info: string; infoInk: string; gold: string; goldInk: string
  rate: string; rateInk: string; rateLink: string
  shadow: string; scrim: string
}

export interface CrewTheme {
  id: ThemeId
  label: string
  blurb: string
  tokens: Tokens
}

const LIGHT_STATUS = {
  ok: '#DCFCE7', okInk: '#166534', warn: '#FEF3C7', warnInk: '#92400E', alert: '#FEE2E2', alertInk: '#991B1B',
  gold: '#FDE68A', goldInk: '#78350F',
}

export const THEMES: CrewTheme[] = [
  {
    id: 'clean',
    label: 'Clean',
    blurb: 'Quiet greys, one indigo accent, soft shadows.',
    tokens: {
      bg: '#F6F7F9', surface: '#FFFFFF', surface2: '#F0F2F5', text: '#0F172A', muted: '#586579', line: '#E2E8F0',
      accent: '#4F46E5', accentHover: '#4338CA', onAccent: '#FFFFFF', accentSoft: '#EEF2FF', accentInk: '#3730A3',
      ...LIGHT_STATUS, info: '#E0E7FF', infoInk: '#3730A3',
      rate: '#0F172A', rateInk: '#FFFFFF', rateLink: '#A5B4FC',
      shadow: '0 1px 2px rgba(15,23,42,.05), 0 4px 14px rgba(15,23,42,.05)', scrim: 'rgba(15,23,42,.5)',
    },
  },
  {
    id: 'classic',
    label: 'Classic',
    blurb: 'The original Host Hampton pink and navy.',
    tokens: {
      bg: '#F5F3FA', surface: '#FFFFFF', surface2: '#F5F3FA', text: '#1E1B3A', muted: '#5B5873', line: '#E6E3EF',
      accent: '#C2185B', accentHover: '#8E1043', onAccent: '#FFFFFF', accentSoft: '#FCE4EE', accentInk: '#C2185B',
      ok: '#E3F4EA', okInk: '#145236', warn: '#FFF1DB', warnInk: '#6E3C00', alert: '#FCE4EE', alertInk: '#8E1043',
      info: '#E8EEFF', infoInk: '#1D3F9E', gold: '#F4B740', goldInk: '#1E1B3A',
      rate: '#1E1B3A', rateInk: '#FFFFFF', rateLink: '#F4B740',
      shadow: 'none', scrim: 'rgba(30,27,58,.55)',
    },
  },
  {
    id: 'ocean',
    label: 'Ocean',
    blurb: 'Cool blues and white, like the shore.',
    tokens: {
      bg: '#F1F7FB', surface: '#FFFFFF', surface2: '#E8F1F7', text: '#0B2239', muted: '#51677D', line: '#D6E4EE',
      accent: '#0A7EA4', accentHover: '#086485', onAccent: '#FFFFFF', accentSoft: '#DDF1F9', accentInk: '#075E7B',
      ...LIGHT_STATUS, info: '#DDF1F9', infoInk: '#075E7B',
      rate: '#0B2239', rateInk: '#FFFFFF', rateLink: '#7DD3FC',
      shadow: '0 1px 2px rgba(11,34,57,.05), 0 4px 14px rgba(11,34,57,.06)', scrim: 'rgba(11,34,57,.55)',
    },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    blurb: 'Dark, easy on the eyes at a party.',
    tokens: {
      bg: '#0E1117', surface: '#171B24', surface2: '#202636', text: '#E8EAF0', muted: '#9AA3B5', line: '#2A3040',
      accent: '#F472B6', accentHover: '#EC4899', onAccent: '#1A0B14', accentSoft: '#3A1D2E', accentInk: '#F9A8D4',
      ok: '#12301F', okInk: '#86EFAC', warn: '#3B2A0B', warnInk: '#FCD34D', alert: '#3D1620', alertInk: '#FDA4AF',
      info: '#1B2748', infoInk: '#A5B4FC', gold: '#FBBF24', goldInk: '#1F1500',
      rate: '#202636', rateInk: '#FFFFFF', rateLink: '#FBBF24',
      shadow: 'none', scrim: 'rgba(0,0,0,.65)',
    },
  },
  {
    id: 'warm',
    label: 'Warm',
    blurb: 'Cream and terracotta, friendly and soft.',
    tokens: {
      bg: '#FBF7F1', surface: '#FFFFFF', surface2: '#F5EDE1', text: '#2B2118', muted: '#7A6A5B', line: '#EADFCF',
      accent: '#C2410C', accentHover: '#9A3412', onAccent: '#FFFFFF', accentSoft: '#FFEDD5', accentInk: '#9A3412',
      ...LIGHT_STATUS, info: '#E0ECFF', infoInk: '#1D3F9E',
      rate: '#2B2118', rateInk: '#FFFFFF', rateLink: '#FDBA74',
      shadow: '0 1px 2px rgba(43,33,24,.05), 0 4px 14px rgba(43,33,24,.06)', scrim: 'rgba(43,33,24,.5)',
    },
  },
]

export const THEME_IDS: ThemeId[] = THEMES.map(t => t.id)

/** A cookie value that is not a known theme is the default, never an error. */
export function themeFromCookie(value: string | undefined | null): ThemeId {
  return THEME_IDS.find(id => id === value) ?? DEFAULT_THEME
}

const VAR_NAMES: Record<keyof Tokens, string> = {
  bg: '--c-bg', surface: '--c-surface', surface2: '--c-surface2', text: '--c-text', muted: '--c-muted', line: '--c-line',
  accent: '--c-accent', accentHover: '--c-accent-hover', onAccent: '--c-on-accent', accentSoft: '--c-accent-soft', accentInk: '--c-accent-ink',
  ok: '--c-ok', okInk: '--c-ok-ink', warn: '--c-warn', warnInk: '--c-warn-ink', alert: '--c-alert', alertInk: '--c-alert-ink',
  info: '--c-info', infoInk: '--c-info-ink', gold: '--c-gold', goldInk: '--c-gold-ink',
  rate: '--c-rate', rateInk: '--c-rate-ink', rateLink: '--c-rate-link', shadow: '--c-shadow', scrim: '--c-scrim',
}

/** One rule per theme: the variables on the app, and the page background behind it (so an overscroll matches). */
export function themeCss(): string {
  return THEMES.map(t => {
    const vars = (Object.keys(VAR_NAMES) as (keyof Tokens)[]).map(k => `${VAR_NAMES[k]}:${t.tokens[k]}`).join(';')
    return `.crew-root[data-theme="${t.id}"]{${vars}}body:has(.crew-root[data-theme="${t.id}"]){background:${t.tokens.bg} !important}`
  }).join('\n')
}
