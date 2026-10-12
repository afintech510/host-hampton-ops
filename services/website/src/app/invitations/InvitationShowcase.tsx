'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react'
import { InviteCanvas } from '@/components/evites/InviteCanvas'
import ScaledCanvas from '@/components/evites/ScaledCanvas'
import { templateFor } from '@/lib/evites/templates'
import type { ShowcaseCard, ShowcaseInput } from '@/lib/evites/showcase'

/**
 * The invitation look-book. Every design, drawn with what the visitor types.
 *
 * The cards arrive from the server as facts + measured sizes (`lib/evites/showcase.ts`)
 * and are DRAWN here with the client-safe `InviteCanvas`, against the same template the
 * sizes were measured with. Typing debounces into `POST /api/invitations/showcase` (a
 * body, never a query string, so a child's name stays out of the URL and analytics).
 *
 * The stage follows the attorney-site style selector Adam liked: a dark glass stage, a
 * zoomable grid (slider, +/- keys, Ctrl/Cmd + wheel), cards that rise into view, tilt
 * with the pointer and catch a glare, and a view transition when the column count
 * changes. Click a card for the full-size view, with arrow keys to step through.
 */

const ZOOM_KEY = 'hh.invites.zoom.v1'
const ZMIN = 150
const ZMAX = 520
const ZDEFAULT = 260
const DEBOUNCE_MS = 350

interface FormState {
  name: string
  age: string
  date: string
  time: string
}

function formOf(input: ShowcaseInput): FormState {
  return { name: input.name, age: input.age === null ? '' : String(input.age), date: input.date ?? '', time: input.time ?? '' }
}

function Canvas({ card }: { card: ShowcaseCard }) {
  return <InviteCanvas template={templateFor(card.slug)} facts={card.facts} sizes={card.sizes} mode="web" />
}

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => unknown }

export default function InvitationShowcase({ initialCards, initialInput }: { initialCards: ShowcaseCard[]; initialInput: ShowcaseInput }) {
  const [form, setForm] = useState<FormState>(() => formOf(initialInput))
  const [cards, setCards] = useState<ShowcaseCard[]>(initialCards)
  const [pending, setPending] = useState(false)
  const [note, setNote] = useState('')
  const [size, setSize] = useState(ZDEFAULT)
  const [seen, setSeen] = useState<Record<string, true>>({})
  const [armed, setArmed] = useState(false)
  const [open, setOpen] = useState<number | null>(null)

  const stageRef = useRef<HTMLElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef(ZDEFAULT)
  const firstRun = useRef(true)
  const lastFocus = useRef<HTMLElement | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // ---- redraw as the visitor types
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    const ctl = new AbortController()
    setPending(true)
    const timer = setTimeout(async () => {
      try {
        const r = await fetch('/api/invitations/showcase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name,
            age: form.age === '' ? null : Number(form.age),
            date: form.date || null,
            time: form.time || null,
          }),
          signal: ctl.signal,
        })
        if (r.status === 429) {
          setNote('That was a lot of changes at once. Give it a moment and try again.')
          return
        }
        const data = await r.json().catch(() => null)
        if (!r.ok || !data || !Array.isArray(data.cards)) throw new Error(`status ${r.status}`)
        setCards(data.cards as ShowcaseCard[])
        setNote('')
      } catch {
        if (!ctl.signal.aborted) setNote("We couldn't update the invitations just now. Try again in a moment.")
      } finally {
        if (!ctl.signal.aborted) setPending(false)
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctl.abort()
    }
  }, [form])

  // ---- zoom
  const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const colsAt = (w: number) => {
    const g = gridRef.current
    return g ? Math.max(1, Math.floor((g.clientWidth + 20) / (w + 20))) : 1
  }

  function zoomTo(next: number, animate = true) {
    const clamped = Math.round(Math.min(ZMAX, Math.max(ZMIN, next)))
    if (clamped === sizeRef.current) return
    const reflow = colsAt(clamped) !== colsAt(sizeRef.current)
    sizeRef.current = clamped
    try {
      localStorage.setItem(ZOOM_KEY, String(clamped))
    } catch {
      /* private mode */
    }
    const doc = document as ViewTransitionDoc
    // A column-count change reflows the grid; a view transition glides each card to its new slot.
    if (animate && reflow && !reduced() && typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(() => flushSync(() => setSize(clamped)))
    } else {
      setSize(clamped)
    }
  }

  useEffect(() => {
    let saved = NaN
    try {
      saved = Number(localStorage.getItem(ZOOM_KEY))
    } catch {
      /* private mode */
    }
    // A saved size wins; otherwise a phone starts at two cards a row, so there is something to scroll through.
    const start = Number.isFinite(saved) && saved >= ZMIN && saved <= ZMAX ? saved : window.innerWidth < 640 ? ZMIN : ZDEFAULT
    if (start !== sizeRef.current) {
      sizeRef.current = start
      setSize(start)
    }
  }, [])

  // Ctrl/Cmd + wheel (and trackpad pinch, which browsers report as ctrl + wheel). Passive: false to stop page zoom.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomTo(sizeRef.current * Math.exp(-e.deltaY * 0.004), false)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // +/- keys zoom; in the full-size view, arrows step and Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open !== null) {
        if (e.key === 'Escape') setOpen(null)
        else if (e.key === 'ArrowRight') setOpen((i) => (i === null ? i : (i + 1) % cards.length))
        else if (e.key === 'ArrowLeft') setOpen((i) => (i === null ? i : (i - 1 + cards.length) % cards.length))
        return
      }
      const t = e.target as HTMLElement | null
      if (t && t.matches('input, textarea, select')) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === '+' || e.key === '=') zoomTo(sizeRef.current * 1.2)
      else if (e.key === '-' || e.key === '_') zoomTo(sizeRef.current / 1.2)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cards.length])

  // ---- cards rise in as they scroll into view. Visible by default: the hidden starting pose is
  // ARMED only in a visible tab with an observer, so no-JS, a crawler or a background tab (where
  // the observer never fires) still sees every card.
  useEffect(() => {
    const g = gridRef.current
    if (!g) return
    if (typeof IntersectionObserver === 'undefined' || reduced() || document.visibilityState !== 'visible') return
    setArmed(true)
    const io = new IntersectionObserver(
      (entries) => {
        const hits = entries.filter((e) => e.isIntersecting).map((e) => (e.target as HTMLElement).dataset.slug as string)
        if (hits.length === 0) return
        setSeen((s) => ({ ...s, ...Object.fromEntries(hits.map((h) => [h, true as const])) }))
        entries.forEach((e) => e.isIntersecting && io.unobserve(e.target))
      },
      { rootMargin: '80px' },
    )
    g.querySelectorAll<HTMLElement>('[data-slug]').forEach((el) => io.observe(el))
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.map((c) => c.slug).join('|')])

  // ---- tilt + glare that follow the pointer
  function onPointerMove(e: React.PointerEvent) {
    if (e.pointerType === 'touch' || reduced()) return
    const card = (e.target as HTMLElement).closest<HTMLElement>('.hhsc-card')
    if (!card) return
    const r = card.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    card.style.setProperty('--rx', `${((0.5 - y) * 8).toFixed(2)}deg`)
    card.style.setProperty('--ry', `${((x - 0.5) * 10).toFixed(2)}deg`)
    card.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`)
    card.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`)
  }
  function onPointerOut(e: React.PointerEvent) {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.hhsc-card')
    if (card && !card.contains(e.relatedTarget as Node | null)) {
      card.style.removeProperty('--rx')
      card.style.removeProperty('--ry')
    }
  }

  // ---- full-size view: lock the page behind it, focus the close button, give focus back after
  useEffect(() => {
    if (open === null) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = prev
      lastFocus.current?.focus()
    }
  }, [open])

  function expand(i: number, from: HTMLElement) {
    lastFocus.current = from
    setOpen(i)
  }

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const current = open !== null ? cards[open] : null

  return (
    <section ref={stageRef} className="hhsc" aria-label="Invitation designs">
      <style dangerouslySetInnerHTML={{ __html: SHOWCASE_CSS }} />

      <header className="hhsc-bar">
        <div className="hhsc-title">
          <p className="hhsc-eyebrow">Host Hampton EVITE</p>
          <h1 className="font-serif">Invitation designs</h1>
          <p className="hhsc-sub">
            Type your child&apos;s details and every design updates. Click one to see it up close.{' '}
            <span className="hhsc-count">
              {cards.length} design{cards.length === 1 ? '' : 's'}
            </span>
          </p>
        </div>

        <form className="hhsc-form" onSubmit={(e) => e.preventDefault()} aria-label="Your party details">
          <label className="hhsc-field hhsc-field-name">
            <span>Name</span>
            <input value={form.name} onChange={set('name')} maxLength={20} placeholder="Child's first name" autoComplete="off" />
          </label>
          <label className="hhsc-field hhsc-field-age">
            <span>Turning</span>
            <input value={form.age} onChange={set('age')} type="number" inputMode="numeric" min={1} max={20} placeholder="7" />
          </label>
          <label className="hhsc-field">
            <span>Date</span>
            <input value={form.date} onChange={set('date')} type="date" />
          </label>
          <label className="hhsc-field">
            <span>Start time</span>
            <input value={form.time} onChange={set('time')} type="time" min="08:00" max="21:00" step={900} />
          </label>
        </form>

        <div className="hhsc-zoom" role="group" aria-label="Card size">
          <button type="button" className="hhsc-zbtn" onClick={() => zoomTo(sizeRef.current / 1.2)} aria-label="Smaller cards">
            &minus;
          </button>
          <input type="range" min={ZMIN} max={ZMAX} step={1} value={size} onChange={(e) => zoomTo(Number(e.target.value))} aria-label="Card size" />
          <button type="button" className="hhsc-zbtn" onClick={() => zoomTo(sizeRef.current * 1.2)} aria-label="Bigger cards">
            +
          </button>
        </div>

        <p className="hhsc-hint">
          Nothing you type here is saved. {pending ? <span className="hhsc-pending">Updating…</span> : null}
          {note ? <span className="hhsc-note" role="status">{note}</span> : null}
          <span className="hhsc-keys">
            Zoom: slider, <kbd>Ctrl</kbd> + scroll, or <kbd>+</kbd> / <kbd>&minus;</kbd>
          </span>
        </p>
      </header>

      <div
        ref={gridRef}
        className={`hhsc-grid${size < 230 ? ' dense' : ''}${pending ? ' busy' : ''}${armed ? ' armed' : ''}`}
        style={{ '--hhsc-col': `${size}px` } as CSSProperties}
        onPointerMove={onPointerMove}
        onPointerOut={onPointerOut}
      >
        {cards.map((card, i) => (
          <button
            key={card.slug}
            type="button"
            data-slug={card.slug}
            className={`hhsc-card${seen[card.slug] ? ' in' : ''}`}
            style={{ '--i': i % 12, viewTransitionName: `hhsc-${card.slug}` } as CSSProperties}
            onClick={(e) => expand(i, e.currentTarget)}
            aria-label={`${card.label}: see it full size`}
          >
            <span className="hhsc-media">
              <ScaledCanvas frameClassName="hhsc-frame" canvasClassName="hhsc-canvas" initialScale={ZDEFAULT / 1085}>
                <Canvas card={card} />
              </ScaledCanvas>
              <span className="hhsc-glare" aria-hidden="true" />
            </span>
            <span className="hhsc-meta">
              <span className="hhsc-name">{card.label}</span>
              <span className="hhsc-open" aria-hidden="true">
                <Maximize2 size={14} />
              </span>
            </span>
          </button>
        ))}
        {cards.length === 0 ? <p className="hhsc-empty">No designs to show right now.</p> : null}
      </div>

      <div className="hhsc-cta">
        <p>
          Every Host Hampton theme party comes with its own Host Hampton EVITE: one link to share, and RSVPs
          collected online.
        </p>
        <div className="hhsc-cta-btns">
          <Link href="/book" className="hhsc-btn hhsc-btn-primary">
            Reserve your date
          </Link>
          <Link href="/party-packages" className="hhsc-btn">
            See party packages
          </Link>
        </div>
      </div>

      {current && open !== null ? (
        <div
          className="hhsc-lb"
          role="dialog"
          aria-modal="true"
          aria-label={`${current.label} invitation`}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(null)
          }}
        >
          <button ref={closeRef} type="button" className="hhsc-lb-close" onClick={() => setOpen(null)} aria-label="Close">
            <X size={22} />
          </button>
          {cards.length > 1 ? (
            <button
              type="button"
              className="hhsc-lb-nav hhsc-lb-prev"
              onClick={() => setOpen((open - 1 + cards.length) % cards.length)}
              aria-label="Previous design"
            >
              <ChevronLeft size={28} />
            </button>
          ) : null}
          <figure className="hhsc-lb-fig">
            <div className="hhsc-lb-frame">
              <ScaledCanvas key={current.slug} frameClassName="hhsc-frame" canvasClassName="hhsc-canvas" initialScale={0.5}>
                <Canvas card={current} />
              </ScaledCanvas>
            </div>
            <figcaption>
              <strong>{current.label}</strong>
              <span>
                {open + 1} of {cards.length}
              </span>
            </figcaption>
          </figure>
          {cards.length > 1 ? (
            <button
              type="button"
              className="hhsc-lb-nav hhsc-lb-next"
              onClick={() => setOpen((open + 1) % cards.length)}
              aria-label="Next design"
            >
              <ChevronRight size={28} />
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/* Deliberately off the site's cream theme: a dark glass stage so the invitations glow. The site's
   own palette carries it - charcoal (#2F343B), dusty blue (#8FA8BF), gold (#C7A36B), ivory. */
const SHOWCASE_CSS = `
.hhsc{--bg:#16191e;--glass:rgba(255,255,255,.045);--edge:rgba(255,255,255,.10);--text:#f7f2e8;--dim:#aeb6c2;--gold:#c7a36b;--blue:#8fa8bf;
  position:relative;isolation:isolate;color:var(--text);padding:28px clamp(14px,3vw,44px) 64px;
  background:radial-gradient(900px 520px at 12% -8%,rgba(143,168,191,.22),transparent 60%),radial-gradient(760px 520px at 92% 4%,rgba(199,163,107,.20),transparent 60%),radial-gradient(1100px 700px at 50% 110%,rgba(47,52,59,.9),transparent 70%),var(--bg)}
.hhsc::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;opacity:.5;background-image:radial-gradient(rgba(255,255,255,.07) 1px,transparent 1px);background-size:22px 22px;-webkit-mask-image:linear-gradient(to bottom,#000,transparent 70%);mask-image:linear-gradient(to bottom,#000,transparent 70%)}
.hhsc-bar{position:relative;z-index:5;display:grid;gap:14px 24px;align-items:end;grid-template-columns:1fr;margin:0 auto 28px;max-width:1680px;padding:18px 20px;border-radius:20px;border:1px solid var(--edge);background:rgba(22,25,30,.72);-webkit-backdrop-filter:blur(18px) saturate(140%);backdrop-filter:blur(18px) saturate(140%);box-shadow:0 10px 40px rgba(0,0,0,.35)}
@media (min-width:1100px){.hhsc-bar{grid-template-columns:minmax(260px,1fr) auto auto;position:sticky;top:84px}}
.hhsc-title h1{margin:0;font-size:clamp(26px,3.4vw,40px);line-height:1.1;background:linear-gradient(92deg,#fff 10%,#d6e1eb 45%,#e7cf9f 90%);-webkit-background-clip:text;background-clip:text;color:transparent}
.hhsc-eyebrow{margin:0 0 4px;font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--gold)}
.hhsc-sub{margin:6px 0 0;color:var(--dim);font-size:14px}
.hhsc-count{color:var(--blue);font-weight:600}
.hhsc-form{display:flex;flex-wrap:wrap;gap:10px;align-items:end}
.hhsc-field{display:grid;gap:4px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}
.hhsc-field input{min-height:42px;min-width:0;width:150px;border-radius:12px;padding:8px 12px;font:500 15px/1.2 inherit;letter-spacing:0;text-transform:none;color:var(--text);background:rgba(255,255,255,.07);border:1px solid var(--edge);color-scheme:dark}
.hhsc-field-name input{width:170px}
.hhsc-field-age input{width:76px}
.hhsc-field input::placeholder{color:#7f8893}
.hhsc-field input:focus{border-color:var(--gold);outline:3px solid rgba(199,163,107,.25)}
.hhsc-zoom{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid var(--edge);justify-self:start}
.hhsc-zoom input[type=range]{width:clamp(110px,14vw,180px);accent-color:var(--gold)}
.hhsc-zbtn{height:34px;width:34px;border-radius:50%;font-size:20px;line-height:1;background:rgba(255,255,255,.08);border:1px solid var(--edge);color:var(--text)}
.hhsc-zbtn:hover{background:var(--gold);border-color:var(--gold);color:#16191e}
.hhsc-hint{grid-column:1/-1;margin:0;font-size:12px;color:#8a929c;display:flex;flex-wrap:wrap;gap:6px 14px}
.hhsc-keys{margin-left:auto}
.hhsc-hint kbd{font:700 11px inherit;padding:1px 6px;border-radius:5px;border:1px solid var(--edge);background:rgba(255,255,255,.06);color:var(--dim)}
.hhsc-pending{color:var(--gold)}
.hhsc-note{color:#f3b8a8}
@media (pointer:coarse){.hhsc-keys{display:none}}
.hhsc-grid{--hhsc-col:260px;display:grid;gap:clamp(14px,1.6vw,26px);max-width:1680px;margin:0 auto;grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--hhsc-col)),1fr));perspective:1400px;transition:opacity .25s ease}
.hhsc-grid.busy{opacity:.72}
.hhsc-card{--rx:0deg;--ry:0deg;--gx:50%;--gy:0%;position:relative;display:flex;flex-direction:column;text-align:left;color:inherit;padding:0;cursor:zoom-in;border-radius:18px;background:var(--glass);border:1px solid var(--edge);transform:rotateX(var(--rx)) rotateY(var(--ry)) translateY(0) scale(1);opacity:1;transition:transform .5s cubic-bezier(.2,.8,.2,1),opacity .6s ease,box-shadow .35s ease;transition-delay:calc(var(--i)*30ms),calc(var(--i)*30ms),0s;transform-style:preserve-3d;will-change:transform}
.hhsc-grid.armed .hhsc-card:not(.in){opacity:0;transform:rotateX(var(--rx)) rotateY(var(--ry)) translateY(18px) scale(.97)}
.hhsc-card::before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1px;pointer-events:none;opacity:0;background:linear-gradient(135deg,var(--blue),transparent 40%,transparent 60%,var(--gold));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;transition:opacity .35s ease}
.hhsc-card:hover,.hhsc-card:focus-visible{transition-delay:0s;transform:rotateX(var(--rx)) rotateY(var(--ry)) translateY(-6px) scale(1.015);box-shadow:0 24px 60px rgba(0,0,0,.45),0 0 60px -10px rgba(199,163,107,.35)}
.hhsc-card:hover::before,.hhsc-card:focus-visible::before{opacity:1}
.hhsc-card:focus-visible{outline:3px solid var(--gold);outline-offset:3px}
.hhsc-media{position:relative;display:block;padding:14px 14px 0;overflow:hidden;border-radius:17px 17px 0 0}
.hhsc-frame{position:relative;width:100%;aspect-ratio:1085/1530;overflow:hidden;border-radius:10px;background:#1b0630;box-shadow:0 14px 30px rgba(0,0,0,.45)}
.hhsc-canvas{position:absolute;left:0;top:0;transform-origin:0 0}
.hhsc-glare{position:absolute;inset:0;pointer-events:none;opacity:0;mix-blend-mode:soft-light;transition:opacity .3s ease;background:radial-gradient(420px circle at var(--gx) var(--gy),rgba(255,255,255,.55),transparent 45%)}
.hhsc-card:hover .hhsc-glare{opacity:1}
.hhsc-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 16px 14px}
.hhsc-name{font-weight:700;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.hhsc-open{color:var(--blue);transition:transform .3s ease}
.hhsc-card:hover .hhsc-open{transform:scale(1.15);color:var(--gold)}
.hhsc-grid.dense{gap:12px}
.hhsc-grid.dense .hhsc-media{padding:8px 8px 0}
.hhsc-grid.dense .hhsc-meta{padding:7px 10px 8px}
.hhsc-grid.dense .hhsc-name{font-size:12px}
.hhsc-empty{color:var(--dim)}
.hhsc-cta{max-width:900px;margin:48px auto 0;text-align:center;color:var(--dim);font-size:16px;line-height:1.6}
.hhsc-cta-btns{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:18px}
.hhsc-btn{display:inline-flex;align-items:center;padding:11px 22px;border-radius:999px;font-weight:600;font-size:14px;border:1px solid var(--edge);color:var(--text);background:rgba(255,255,255,.06);transition:background .2s ease}
.hhsc-btn:hover{background:rgba(255,255,255,.12)}
.hhsc-btn-primary{background:var(--gold);border-color:var(--gold);color:#16191e}
.hhsc-btn-primary:hover{background:#d4b47f}
.hhsc-lb{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;gap:clamp(6px,2vw,28px);padding:56px 12px 24px;background:rgba(10,12,15,.88);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);animation:hhsc-fade .25s ease}
.hhsc-lb-fig{margin:0;display:flex;flex-direction:column;align-items:center;gap:12px;color:var(--text)}
.hhsc-lb-frame{width:min(88vw,calc((100vh - 140px) * 1085 / 1530));animation:hhsc-pop .3s cubic-bezier(.2,.8,.2,1)}
.hhsc-lb-frame .hhsc-frame{box-shadow:0 30px 80px rgba(0,0,0,.6)}
.hhsc-lb-fig figcaption{display:flex;gap:12px;align-items:baseline;font-size:15px}
.hhsc-lb-fig figcaption span{color:var(--dim);font-size:13px}
.hhsc-lb-close{position:absolute;top:14px;right:14px;height:42px;width:42px;display:grid;place-items:center;border-radius:50%;background:rgba(255,255,255,.1);border:1px solid var(--edge);color:var(--text)}
.hhsc-lb-nav{flex:none;height:48px;width:48px;display:grid;place-items:center;border-radius:50%;background:rgba(255,255,255,.08);border:1px solid var(--edge);color:var(--text)}
.hhsc-lb-close:hover,.hhsc-lb-nav:hover{background:var(--gold);border-color:var(--gold);color:#16191e}
@media (max-width:640px){.hhsc-lb-nav{position:absolute;bottom:18px}.hhsc-lb-prev{left:18px}.hhsc-lb-next{right:18px}.hhsc-lb{padding-bottom:84px}.hhsc-lb-frame{width:min(92vw,calc((100vh - 190px) * 1085 / 1530))}}
@keyframes hhsc-fade{from{opacity:0}to{opacity:1}}
@keyframes hhsc-pop{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
::view-transition-group(*){animation-duration:.45s;animation-timing-function:cubic-bezier(.2,.8,.2,1)}
@media (prefers-reduced-motion:reduce){.hhsc-card,.hhsc-grid.armed .hhsc-card:not(.in){transition:none;transform:none;opacity:1}.hhsc-lb,.hhsc-lb-frame{animation:none}}
`
