/**
 * Looks for the crew app (`/crew`). A "look" is more than a palette: each one is
 * a set of CSS variables on `.crew-root[data-theme="<id>"]` (colours, typefaces,
 * corner radii, spacing) PLUS a block of structural CSS (`css`) that changes how
 * the screens are laid out: where the tabs sit, whether a party is a boxed card,
 * a flat list row or a ticket stub, what a date looks like, what a button and a
 * pill are shaped like, and which icon set the tabs use.
 *
 * Every colour, face and radius in the crew stylesheet comes from a variable, so
 * a look can never leave a piece of the app behind. Which look a person sees is
 * their own choice, kept in a cookie scoped to `/crew` (Profile → Appearance);
 * it decides looks only, never what the app says or does. `DEFAULT_THEME` is what
 * everyone sees until they pick.
 *
 * The CREW wordmark is NOT themed: navy lettering with a dusty-blue border is
 * the brand, on every look.
 */

export const THEME_COOKIE = 'hh_crew_theme'

export type ThemeId = 'bold' | 'clean' | 'pop' | 'midnight' | 'editorial'

export const DEFAULT_THEME: ThemeId = 'bold'

/** The faces the layout loads (`app/crew/layout.tsx`), as the CSS variables next/font defines. */
const FACE = {
  archivoBlack: "var(--crew-f-archivoblack), Impact, 'Arial Black', sans-serif",
  archivo: "var(--crew-f-archivo), system-ui, sans-serif",
  manrope: "var(--crew-f-manrope), system-ui, sans-serif",
  inter: "var(--crew-f-inter), system-ui, sans-serif",
  unbounded: "var(--crew-f-unbounded), system-ui, sans-serif",
  outfit: "var(--crew-f-outfit), system-ui, sans-serif",
  space: "var(--crew-f-space), system-ui, sans-serif",
  fraunces: "var(--crew-f-fraunces), Georgia, serif",
}

interface Tokens {
  bg: string; surface: string; surface2: string; text: string; muted: string; line: string
  accent: string; accentHover: string; onAccent: string; accentSoft: string; accentInk: string
  ok: string; okInk: string; warn: string; warnInk: string; alert: string; alertInk: string
  info: string; infoInk: string; gold: string; goldInk: string
  rate: string; rateInk: string; rateLink: string
  shadow: string; scrim: string
  /** The black Host Hampton logo, turned white on a dark look. */
  logoFilter: string
  /** Typefaces. */
  fontDisplay: string; fontBody: string
  /** Shape and size of the modules. */
  radiusCard: string; radiusBtn: string; radiusInput: string; radiusChip: string; radiusNav: string; radiusModal: string
  padCard: string; gapCard: string; btnHeight: string; btnPad: string
  h1Size: string; h1Weight: string; h2Size: string; h2Transform: string; h2Spacing: string
  cardBorder: string
  /** The date block on a party: `flex` or `none`. */
  dateTile: string
  /** Which tab icons show: the emoji, or the outline icons (`inline-block` or `none`). */
  navEmoji: string; navLine: string
}

export interface CrewTheme {
  id: ThemeId
  label: string
  /** What is different about it, in a line, for the picker. */
  blurb: string
  tokens: Tokens
  /** Structural CSS. `&` stands for this look's root, `.crew-root[data-theme="<id>"]`. */
  css: string
}

const LIGHT_STATUS = {
  ok: '#DCFCE7', okInk: '#166534', warn: '#FEF3C7', warnInk: '#92400E', alert: '#FEE2E2', alertInk: '#991B1B',
  gold: '#FDE68A', goldInk: '#78350F',
}

export const THEMES: CrewTheme[] = [
  // ── BOLD: poster. Hard black outlines and offset shadows, yellow date tiles, a black tab bar.
  {
    id: 'bold',
    label: 'Bold',
    blurb: 'Poster style: Archivo Black, thick outlines, hard shadows, yellow date tiles, a black tab bar.',
    tokens: {
      bg: '#FFF6DA', surface: '#FFFFFF', surface2: '#FFEFB8', text: '#0B0B0F', muted: '#4A4A55', line: '#0B0B0F',
      accent: '#2B4EFF', accentHover: '#1A37D6', onAccent: '#FFFFFF', accentSoft: '#FFD60A', accentInk: '#0B0B0F',
      ok: '#C7F9CC', okInk: '#064E1F', warn: '#FFE08A', warnInk: '#5C3A00', alert: '#FFC2C2', alertInk: '#7A0A0A',
      info: '#C9D4FF', infoInk: '#14238F', gold: '#FFD60A', goldInk: '#0B0B0F',
      rate: '#0B0B0F', rateInk: '#FFFFFF', rateLink: '#FFD60A',
      shadow: '5px 5px 0 #0B0B0F', scrim: 'rgba(11,11,15,.6)',
      logoFilter: 'none',
      fontDisplay: FACE.archivoBlack, fontBody: FACE.archivo,
      radiusCard: '10px', radiusBtn: '8px', radiusInput: '8px', radiusChip: '6px', radiusNav: '8px', radiusModal: '14px',
      padCard: '1rem 1.1rem', gapCard: '1rem', btnHeight: '48px', btnPad: '.55rem 1.1rem',
      h1Size: '2.2rem', h1Weight: '400', h2Size: '1.05rem', h2Transform: 'uppercase', h2Spacing: '.04em',
      cardBorder: '3px solid var(--c-line)',
      dateTile: 'flex', navEmoji: 'none', navLine: 'inline-block',
    },
    css: `
& h1{text-transform:uppercase;line-height:.95;letter-spacing:-.01em}
& h2{border-bottom:3px solid var(--c-text);padding-bottom:.4rem}
& .crew-party{padding:.9rem;gap:1rem}
& .crew-date{background:var(--c-accent-soft);border:3px solid var(--c-text);border-radius:8px;padding:.55rem .35rem;min-width:3.9rem;box-shadow:3px 3px 0 var(--c-text);color:var(--c-text)}
& .crew-date-mon,& .crew-date-dow{color:var(--c-text)}
& .crew-date-day{font-size:2.2rem;font-weight:400;color:var(--c-text)}
& .crew-btn{border:3px solid var(--c-text);box-shadow:3px 3px 0 var(--c-text);text-transform:uppercase;letter-spacing:.05em;font-weight:800;font-size:.85rem}
& .crew-btn:active{transform:translate(3px,3px);box-shadow:none}
& .crew-btn-ghost{background:var(--c-surface);color:var(--c-text)}
& .crew-top .crew-btn{box-shadow:2px 2px 0 var(--c-text);border-width:2px}
& .crew-chip,& .crew-kind{border:2px solid var(--c-text)}
& .crew-kind{background:var(--c-accent-soft);color:var(--c-accent-ink)}
& .crew-input{border:3px solid var(--c-text)}
& .crew-team li{border:2px solid var(--c-text);background:var(--c-surface)}
& .crew-nav{background:var(--c-text);border-top:3px solid var(--c-text);gap:.4rem}
& .crew-nav a{color:var(--c-surface);text-transform:uppercase;letter-spacing:.06em;font-size:.7rem}
& .crew-nav a[aria-current="page"]{background:var(--c-accent-soft);color:var(--c-text)}
& .crew-meta{color:var(--c-text);font-weight:600}
`,
  },

  // ── CLEAN: modern minimal. No boxes around parties: flat list rows. A floating pill tab bar.
  {
    id: 'clean',
    label: 'Clean',
    blurb: 'Modern and quiet: Manrope, flat list rows instead of boxes, a floating pill tab bar.',
    tokens: {
      bg: '#F7F7F8', surface: '#FFFFFF', surface2: '#EFF0F3', text: '#111827', muted: '#555F70', line: '#E4E6EB',
      accent: '#4F46E5', accentHover: '#4338CA', onAccent: '#FFFFFF', accentSoft: '#EEF2FF', accentInk: '#3730A3',
      ...LIGHT_STATUS, info: '#E0E7FF', infoInk: '#3730A3',
      rate: '#111827', rateInk: '#FFFFFF', rateLink: '#A5B4FC',
      shadow: 'none', scrim: 'rgba(17,24,39,.5)',
      logoFilter: 'none',
      fontDisplay: FACE.manrope, fontBody: FACE.inter,
      radiusCard: '14px', radiusBtn: '999px', radiusInput: '12px', radiusChip: '999px', radiusNav: '999px', radiusModal: '20px',
      padCard: '1rem 1.1rem', gapCard: '.75rem', btnHeight: '44px', btnPad: '.5rem 1.2rem',
      h1Size: '1.9rem', h1Weight: '800', h2Size: '.78rem', h2Transform: 'uppercase', h2Spacing: '.1em',
      cardBorder: '1px solid var(--c-line)',
      dateTile: 'flex', navEmoji: 'none', navLine: 'inline-block',
    },
    css: `
& h2{color:var(--c-muted)}
& .crew-party{background:transparent;border:0;border-bottom:1px solid var(--c-line);border-radius:0;padding:1.1rem 0;margin-bottom:0}
& .crew-date{min-width:2.8rem;padding-top:.1rem}
& .crew-date-mon,& .crew-date-dow{color:var(--c-muted)}
& .crew-date-day{font-size:2rem;color:var(--c-text)}
& .crew-btn{font-weight:700;min-height:40px}
& .crew-meta{margin-top:.2rem}
& .crew-nav{left:14px;right:14px;bottom:calc(12px + env(safe-area-inset-bottom));border:1px solid var(--c-line);border-radius:999px;padding:.3rem;box-shadow:0 10px 32px rgba(17,24,39,.16)}
& .crew-nav a{min-height:50px;font-size:.7rem}
& .crew-nav a[aria-current="page"]{background:var(--c-text);color:var(--c-surface)}
`,
  },

  // ── POP: playful. Everything is a pill or a bubble: gradient date circles, chip-shaped details, emoji tabs.
  {
    id: 'pop',
    label: 'Pop',
    blurb: 'Playful and bubbly: Unbounded type, gradient date circles, pill chips, a floating emoji tab bar.',
    tokens: {
      bg: '#F5F0FF', surface: '#FFFFFF', surface2: '#EDE5FF', text: '#1B1033', muted: '#5C4F7A', line: '#E3D9FA',
      accent: '#7C3AED', accentHover: '#6D28D9', onAccent: '#FFFFFF', accentSoft: '#EDE5FF', accentInk: '#5B21B6',
      ...LIGHT_STATUS, info: '#E0E7FF', infoInk: '#3730A3',
      rate: '#1B1033', rateInk: '#FFFFFF', rateLink: '#F0ABFC',
      shadow: '0 8px 24px rgba(124,58,237,.12)', scrim: 'rgba(27,16,51,.55)',
      logoFilter: 'none',
      fontDisplay: FACE.unbounded, fontBody: FACE.outfit,
      radiusCard: '30px', radiusBtn: '999px', radiusInput: '18px', radiusChip: '999px', radiusNav: '999px', radiusModal: '32px',
      padCard: '1.25rem 1.3rem', gapCard: '1rem', btnHeight: '52px', btnPad: '.6rem 1.5rem',
      h1Size: '1.55rem', h1Weight: '800', h2Size: '1rem', h2Transform: 'none', h2Spacing: '0',
      cardBorder: '1px solid transparent',
      dateTile: 'flex', navEmoji: 'inline-block', navLine: 'none',
    },
    css: `
& .crew-date{background:linear-gradient(145deg,#7C3AED,#EC4899);color:#fff;border-radius:50%;width:4.3rem;height:4.3rem;min-width:4.3rem;gap:.1rem;box-shadow:0 6px 16px rgba(124,58,237,.3)}
& .crew-date-mon,& .crew-date-day{color:#fff}
& .crew-date-day{font-size:1.5rem}
& .crew-date-dow{display:none}
& .crew-meta{gap:.4rem}
& .crew-m{background:var(--c-surface2);color:var(--c-text);border-radius:999px;padding:.2rem .7rem;font-size:.82rem;font-weight:600}
& .crew-btn{background:linear-gradient(135deg,#7C3AED,#EC4899);border:0;box-shadow:0 6px 16px rgba(124,58,237,.35);font-size:1rem}
& .crew-btn:hover{background:linear-gradient(135deg,#6D28D9,#DB2777)}
& .crew-btn-ghost{background:var(--c-surface2);color:var(--c-accent-ink);box-shadow:none}
& .crew-btn-ghost:hover{background:var(--c-line)}
& .crew-top .crew-btn{min-height:40px;box-shadow:none}
& .crew-nav{left:14px;right:14px;bottom:calc(12px + env(safe-area-inset-bottom));border:0;border-radius:999px;padding:.35rem;box-shadow:0 12px 36px rgba(124,58,237,.25)}
& .crew-nav a{min-height:54px;font-size:.7rem}
& .crew-nav a[aria-current="page"]{background:linear-gradient(135deg,#7C3AED,#EC4899);color:#fff}
`,
  },

  // ── MIDNIGHT: dark ticket stubs. A tear-off date stub, a lime stripe, mono details, outline buttons.
  {
    id: 'midnight',
    label: 'Midnight',
    blurb: 'Dark ticket stubs: a dashed tear-off date, a lime stripe, Space Grotesk and mono, outline buttons.',
    tokens: {
      bg: '#0B0E14', surface: '#151922', surface2: '#1E2430', text: '#E8EAF0', muted: '#9AA3B5', line: '#2A3141',
      accent: '#B6FF3C', accentHover: '#9BE81F', onAccent: '#0B1200', accentSoft: '#243012', accentInk: '#D4FF7A',
      ok: '#12301F', okInk: '#86EFAC', warn: '#3B2A0B', warnInk: '#FCD34D', alert: '#3D1620', alertInk: '#FDA4AF',
      info: '#1B2748', infoInk: '#A5B4FC', gold: '#FBBF24', goldInk: '#1F1500',
      rate: '#1E2430', rateInk: '#FFFFFF', rateLink: '#B6FF3C',
      shadow: 'none', scrim: 'rgba(0,0,0,.7)',
      logoFilter: 'invert(1)',
      fontDisplay: FACE.space, fontBody: FACE.space,
      radiusCard: '10px', radiusBtn: '6px', radiusInput: '6px', radiusChip: '4px', radiusNav: '4px', radiusModal: '12px',
      padCard: '.9rem 1rem', gapCard: '.7rem', btnHeight: '44px', btnPad: '.5rem 1rem',
      h1Size: '1.7rem', h1Weight: '700', h2Size: '.8rem', h2Transform: 'uppercase', h2Spacing: '.12em',
      cardBorder: '1px solid var(--c-line)',
      dateTile: 'flex', navEmoji: 'none', navLine: 'inline-block',
    },
    css: `
& .crew-party{border-left:6px solid var(--c-accent);padding:0;gap:0;align-items:stretch;overflow:hidden}
& .crew-date{background:var(--c-surface2);border-right:2px dashed var(--c-line);padding:1rem .9rem;min-width:4.4rem;border-radius:0}
& .crew-date-mon,& .crew-date-dow{font-family:var(--crew-f-spacemono),ui-monospace,monospace;color:var(--c-muted)}
& .crew-date-day{font-family:var(--crew-f-spacemono),ui-monospace,monospace;font-size:2rem;color:var(--c-accent)}
& .crew-party-main{padding:1rem}
& .crew-meta,& .crew-chip,& .crew-kind{font-family:var(--crew-f-spacemono),ui-monospace,monospace}
& .crew-btn{background:transparent;color:var(--c-accent);border:2px solid var(--c-accent);text-transform:uppercase;letter-spacing:.08em;font-size:.8rem}
& .crew-btn:hover{background:var(--c-accent);color:var(--c-on-accent)}
& .crew-btn-ghost{color:var(--c-text);border-color:var(--c-line)}
& .crew-btn-ghost:hover{background:var(--c-surface2);color:var(--c-text);border-color:var(--c-text)}
& .crew-nav{border-top:2px solid var(--c-accent);gap:.2rem}
& .crew-nav a{text-transform:uppercase;letter-spacing:.1em;font-size:.66rem;font-family:var(--crew-f-spacemono),ui-monospace,monospace}
& .crew-nav a[aria-current="page"]{background:transparent;color:var(--c-accent);box-shadow:inset 0 2px 0 var(--c-accent)}
`,
  },

  // ── EDITORIAL: print. Big serif type, ruled sections with no boxes, text tabs across the TOP of the page.
  {
    id: 'editorial',
    label: 'Editorial',
    blurb: 'Magazine style: Fraunces serif, ruled sections with no boxes, text tabs at the top instead of a bottom bar.',
    tokens: {
      bg: '#FAF7F0', surface: '#FFFFFF', surface2: '#F0EBDD', text: '#171412', muted: '#6B6258', line: '#D9D1BF',
      accent: '#8A1C2B', accentHover: '#6E1522', onAccent: '#FFFFFF', accentSoft: '#F3E1E3', accentInk: '#8A1C2B',
      ...LIGHT_STATUS, info: '#E4ECFA', infoInk: '#1D3F9E',
      rate: '#171412', rateInk: '#FFFFFF', rateLink: '#F2C9CE',
      shadow: 'none', scrim: 'rgba(23,20,18,.5)',
      logoFilter: 'none',
      fontDisplay: FACE.fraunces, fontBody: FACE.inter,
      radiusCard: '2px', radiusBtn: '2px', radiusInput: '2px', radiusChip: '2px', radiusNav: '0', radiusModal: '4px',
      padCard: '1rem 0', gapCard: '.5rem', btnHeight: '44px', btnPad: '.5rem 1.2rem',
      h1Size: '2.5rem', h1Weight: '600', h2Size: '1.4rem', h2Transform: 'none', h2Spacing: '-.01em',
      cardBorder: '1px solid var(--c-line)',
      dateTile: 'flex', navEmoji: 'none', navLine: 'none',
    },
    css: `
& .crew-wrap{padding-bottom:3rem}
& h1{line-height:1;letter-spacing:-.02em}
& h2{font-style:italic}
& .crew-top{padding-bottom:.9rem;border-bottom:2px solid var(--c-text)}
& .crew-nav{position:sticky;top:0;bottom:auto;left:auto;right:auto;z-index:30;background:var(--c-bg);border:0;border-bottom:1px solid var(--c-line);justify-content:flex-start;gap:1.6rem;padding:0;margin:0 0 1rem}
& .crew-nav a{flex:0 0 auto;min-height:46px;flex-direction:row;font-size:.95rem;border-radius:0;color:var(--c-muted);border-bottom:3px solid transparent;padding:0 .1rem}
& .crew-nav a[aria-current="page"]{background:transparent;color:var(--c-text);border-bottom-color:var(--c-accent)}
& .crew-party{background:transparent;border:0;border-top:2px solid var(--c-text);box-shadow:none;margin-bottom:0;padding:1rem 0 1.3rem}
& .crew-date{align-items:flex-start;min-width:3.2rem}
& .crew-date-day{font-size:2.8rem;font-weight:600;color:var(--c-accent)}
& .crew-date-mon,& .crew-date-dow{color:var(--c-muted);letter-spacing:.16em}
& .crew-btn{text-transform:uppercase;letter-spacing:.1em;font-size:.75rem;font-weight:700}
& .crew-btn-ghost{background:transparent;border-color:var(--c-text)}
& .crew-kind,& .crew-chip{text-transform:uppercase;letter-spacing:.08em;font-size:.66rem}
& .crew-meta{font-variant-numeric:tabular-nums}
`,
  },
]

export const THEME_IDS: ThemeId[] = THEMES.map(t => t.id)

/** A cookie value that is not a known look is the default, never an error (an old "ocean" or "warm" is the default too). */
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
  dateTile: '--date-tile', navEmoji: '--nav-emoji', navLine: '--nav-line',
}

/** One block per look: its variables, the page background behind it (so an overscroll matches), and its structural CSS. */
export function themeCss(): string {
  return THEMES.map(t => {
    const root = `.crew-root[data-theme="${t.id}"]`
    const vars = (Object.keys(VAR_NAMES) as (keyof Tokens)[]).map(k => `${VAR_NAMES[k]}:${t.tokens[k]}`).join(';')
    const structure = t.css.trim().split('\n').map(rule => rule.replace(/&/g, root)).join('\n')
    return `${root}{${vars}}body:has(${root}){background:${t.tokens.bg} !important}\n${structure}`
  }).join('\n')
}
