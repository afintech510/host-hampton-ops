/**
 * Looks for the crew app (`/crew`). A theme is a set of CSS variables on
 * `.crew-root[data-theme="<id>"]`: its colours, its typefaces, and the shape
 * and size of its modules (card corners, button shape, spacing, headline size).
 * Every colour, face and radius in the crew stylesheet comes from one of them,
 * so a theme can never leave a piece of the app behind.
 *
 * Which one a person sees is their own choice, kept in a cookie scoped to
 * `/crew` (picker: Profile → Appearance). It decides looks only, never what
 * the app says or does. `DEFAULT_THEME` is what everyone sees until they pick.
 *
 * The CREW wordmark is NOT themed: navy lettering with a dusty-blue border is
 * the brand, on every theme.
 */

export const THEME_COOKIE = 'hh_crew_theme'

export type ThemeId = 'clean' | 'classic' | 'ocean' | 'midnight' | 'warm'

export const DEFAULT_THEME: ThemeId = 'clean'

/** The faces the layout loads (`app/crew/layout.tsx`), as the CSS variables next/font defines. */
const FACE = {
  manrope: "var(--crew-f-manrope), system-ui, sans-serif",
  inter: "var(--crew-f-inter), system-ui, sans-serif",
  sora: "var(--crew-f-sora), system-ui, sans-serif",
  dmSans: "var(--crew-f-dmsans), system-ui, sans-serif",
  space: "var(--crew-f-space), system-ui, sans-serif",
  fraunces: "var(--crew-f-fraunces), Georgia, serif",
  nunito: "var(--crew-f-nunito), system-ui, sans-serif",
  bricolage: "var(--crew-font-display), system-ui, sans-serif",
  jakarta: "var(--crew-font-body), system-ui, sans-serif",
}

interface Tokens {
  bg: string; surface: string; surface2: string; text: string; muted: string; line: string
  accent: string; accentHover: string; onAccent: string; accentSoft: string; accentInk: string
  ok: string; okInk: string; warn: string; warnInk: string; alert: string; alertInk: string
  info: string; infoInk: string; gold: string; goldInk: string
  rate: string; rateInk: string; rateLink: string
  shadow: string; scrim: string
  /** The black Host Hampton logo, turned white on a dark theme. */
  logoFilter: string
  /** Typefaces. */
  fontDisplay: string; fontBody: string
  /** Shape and size of the modules. */
  radiusCard: string; radiusBtn: string; radiusInput: string; radiusChip: string; radiusNav: string; radiusModal: string
  padCard: string; gapCard: string; btnHeight: string; btnPad: string
  h1Size: string; h1Weight: string; h2Size: string; h2Transform: string; h2Spacing: string
  cardBorder: string
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
    blurb: 'Manrope and Inter, soft corners, quiet greys and one indigo accent.',
    tokens: {
      bg: '#F6F7F9', surface: '#FFFFFF', surface2: '#F0F2F5', text: '#0F172A', muted: '#586579', line: '#E2E8F0',
      accent: '#4F46E5', accentHover: '#4338CA', onAccent: '#FFFFFF', accentSoft: '#EEF2FF', accentInk: '#3730A3',
      ...LIGHT_STATUS, info: '#E0E7FF', infoInk: '#3730A3',
      rate: '#0F172A', rateInk: '#FFFFFF', rateLink: '#A5B4FC',
      shadow: '0 1px 2px rgba(15,23,42,.05), 0 4px 14px rgba(15,23,42,.05)', scrim: 'rgba(15,23,42,.5)',
      logoFilter: 'none',
      fontDisplay: FACE.manrope, fontBody: FACE.inter,
      radiusCard: '14px', radiusBtn: '10px', radiusInput: '10px', radiusChip: '999px', radiusNav: '10px', radiusModal: '18px',
      padCard: '1rem 1.1rem', gapCard: '.75rem', btnHeight: '44px', btnPad: '.55rem 1.1rem',
      h1Size: '1.75rem', h1Weight: '800', h2Size: '1.1rem', h2Transform: 'none', h2Spacing: '-.01em',
      cardBorder: '1px solid var(--c-line)',
    },
  },
  {
    id: 'classic',
    label: 'Classic',
    blurb: 'The original: Bricolage Grotesque, pink and navy, rounded cards.',
    tokens: {
      bg: '#F5F3FA', surface: '#FFFFFF', surface2: '#F5F3FA', text: '#1E1B3A', muted: '#5B5873', line: '#E6E3EF',
      accent: '#C2185B', accentHover: '#8E1043', onAccent: '#FFFFFF', accentSoft: '#FCE4EE', accentInk: '#C2185B',
      ok: '#E3F4EA', okInk: '#145236', warn: '#FFF1DB', warnInk: '#6E3C00', alert: '#FCE4EE', alertInk: '#8E1043',
      info: '#E8EEFF', infoInk: '#1D3F9E', gold: '#F4B740', goldInk: '#1E1B3A',
      rate: '#1E1B3A', rateInk: '#FFFFFF', rateLink: '#F4B740',
      shadow: 'none', scrim: 'rgba(30,27,58,.55)',
      logoFilter: 'none',
      fontDisplay: FACE.bricolage, fontBody: FACE.jakarta,
      radiusCard: '16px', radiusBtn: '12px', radiusInput: '12px', radiusChip: '999px', radiusNav: '12px', radiusModal: '20px',
      padCard: '1rem', gapCard: '.75rem', btnHeight: '44px', btnPad: '.55rem 1rem',
      h1Size: '1.6rem', h1Weight: '800', h2Size: '1.15rem', h2Transform: 'none', h2Spacing: '0',
      cardBorder: '1px solid var(--c-line)',
    },
  },
  {
    id: 'ocean',
    label: 'Ocean',
    blurb: 'Sora and DM Sans, pill buttons, big airy cards, cool blues.',
    tokens: {
      bg: '#F1F7FB', surface: '#FFFFFF', surface2: '#E8F1F7', text: '#0B2239', muted: '#51677D', line: '#D6E4EE',
      accent: '#0A7EA4', accentHover: '#086485', onAccent: '#FFFFFF', accentSoft: '#DDF1F9', accentInk: '#075E7B',
      ...LIGHT_STATUS, info: '#DDF1F9', infoInk: '#075E7B',
      rate: '#0B2239', rateInk: '#FFFFFF', rateLink: '#7DD3FC',
      shadow: '0 1px 2px rgba(11,34,57,.05), 0 8px 24px rgba(11,34,57,.07)', scrim: 'rgba(11,34,57,.55)',
      logoFilter: 'none',
      fontDisplay: FACE.sora, fontBody: FACE.dmSans,
      radiusCard: '24px', radiusBtn: '999px', radiusInput: '16px', radiusChip: '999px', radiusNav: '999px', radiusModal: '28px',
      padCard: '1.2rem 1.3rem', gapCard: '.9rem', btnHeight: '48px', btnPad: '.6rem 1.4rem',
      h1Size: '1.85rem', h1Weight: '700', h2Size: '1.15rem', h2Transform: 'none', h2Spacing: '-.01em',
      cardBorder: '1px solid transparent',
    },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    blurb: 'Space Grotesk, dark, sharp corners and tight spacing.',
    tokens: {
      bg: '#0E1117', surface: '#171B24', surface2: '#202636', text: '#E8EAF0', muted: '#9AA3B5', line: '#2A3040',
      accent: '#F472B6', accentHover: '#EC4899', onAccent: '#1A0B14', accentSoft: '#3A1D2E', accentInk: '#F9A8D4',
      ok: '#12301F', okInk: '#86EFAC', warn: '#3B2A0B', warnInk: '#FCD34D', alert: '#3D1620', alertInk: '#FDA4AF',
      info: '#1B2748', infoInk: '#A5B4FC', gold: '#FBBF24', goldInk: '#1F1500',
      rate: '#202636', rateInk: '#FFFFFF', rateLink: '#FBBF24',
      shadow: 'none', scrim: 'rgba(0,0,0,.65)',
      logoFilter: 'invert(1)',
      fontDisplay: FACE.space, fontBody: FACE.space,
      radiusCard: '6px', radiusBtn: '6px', radiusInput: '6px', radiusChip: '6px', radiusNav: '6px', radiusModal: '10px',
      padCard: '.85rem 1rem', gapCard: '.6rem', btnHeight: '44px', btnPad: '.5rem .95rem',
      h1Size: '1.6rem', h1Weight: '700', h2Size: '.85rem', h2Transform: 'uppercase', h2Spacing: '.09em',
      cardBorder: '1px solid var(--c-line)',
    },
  },
  {
    id: 'warm',
    label: 'Warm',
    blurb: 'Fraunces serif and Nunito, pill buttons, roomy cream cards.',
    tokens: {
      bg: '#FBF7F1', surface: '#FFFFFF', surface2: '#F5EDE1', text: '#2B2118', muted: '#7A6A5B', line: '#EADFCF',
      accent: '#C2410C', accentHover: '#9A3412', onAccent: '#FFFFFF', accentSoft: '#FFEDD5', accentInk: '#9A3412',
      ...LIGHT_STATUS, info: '#E0ECFF', infoInk: '#1D3F9E',
      rate: '#2B2118', rateInk: '#FFFFFF', rateLink: '#FDBA74',
      shadow: '0 1px 2px rgba(43,33,24,.05), 0 6px 20px rgba(43,33,24,.07)', scrim: 'rgba(43,33,24,.5)',
      logoFilter: 'none',
      fontDisplay: FACE.fraunces, fontBody: FACE.nunito,
      radiusCard: '28px', radiusBtn: '999px', radiusInput: '18px', radiusChip: '999px', radiusNav: '999px', radiusModal: '30px',
      padCard: '1.25rem 1.35rem', gapCard: '1rem', btnHeight: '48px', btnPad: '.6rem 1.5rem',
      h1Size: '1.9rem', h1Weight: '700', h2Size: '1.2rem', h2Transform: 'none', h2Spacing: '0',
      cardBorder: '1px solid var(--c-line)',
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
  logoFilter: '--c-logo-filter',
  fontDisplay: '--f-display', fontBody: '--f-body',
  radiusCard: '--r-card', radiusBtn: '--r-btn', radiusInput: '--r-input', radiusChip: '--r-chip', radiusNav: '--r-nav', radiusModal: '--r-modal',
  padCard: '--pad-card', gapCard: '--gap-card', btnHeight: '--btn-h', btnPad: '--btn-pad',
  h1Size: '--h1-size', h1Weight: '--h1-weight', h2Size: '--h2-size', h2Transform: '--h2-transform', h2Spacing: '--h2-spacing',
  cardBorder: '--card-border',
}

/** One rule per theme: the variables on the app, and the page background behind it (so an overscroll matches). */
export function themeCss(): string {
  return THEMES.map(t => {
    const vars = (Object.keys(VAR_NAMES) as (keyof Tokens)[]).map(k => `${VAR_NAMES[k]}:${t.tokens[k]}`).join(';')
    return `.crew-root[data-theme="${t.id}"]{${vars}}body:has(.crew-root[data-theme="${t.id}"]){background:${t.tokens.bg} !important}`
  }).join('\n')
}
