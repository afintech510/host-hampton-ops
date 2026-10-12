'use client'

/**
 * The /join-the-team application form. Mobile-first, one page, role first.
 *
 * Every option list comes from lib/careers.ts, the same lists the server screens
 * against (lib/jobApplication.ts) — the browser validates for the applicant's
 * convenience, the server decides.
 *
 * Deliberately NOT here: `trackContact()` or any other ad conversion. A job
 * application is not a party lead, and counting one as a conversion would teach
 * Google Ads to buy job seekers with the party budget.
 */

import { useState } from 'react'
import { CheckCircle } from 'lucide-react'
import { getAttribution } from '@/lib/utm'
import {
  ROLES,
  payLabel,
  roleInterestLabel,
  asksLead,
  asksHelper,
  WEEKEND_OPTIONS,
  WEEKDAY_OPTIONS,
  YES_SOME_NO,
  JOB_HEARD_ABOUT,
  HELPER_SKILLS,
  type Choice,
  type RoleInterest,
} from '@/lib/careers'

type Form = Record<string, string | number | boolean | null>

const INPUT =
  'w-full border-2 border-hampton-pink/30 rounded-xl px-4 py-3 text-base text-hampton-navy bg-white outline-none focus:border-hampton-navy'
const LABEL = 'block text-hampton-navy font-semibold text-sm mb-2'

export default function JoinTheTeamForm() {
  const [form, setForm] = useState<Form>({ role_interest: null, is_18_plus: null, has_car: null, will_learn_beauty: false })
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const set = (field: string, value: string | number | boolean | null) => setForm(prev => ({ ...prev, [field]: value }))
  const text = (field: string) => ({
    value: (form[field] as string) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(field, e.target.value),
  })

  const role = form.role_interest as RoleInterest | null
  const under18 = form.is_18_plus === false

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (under18 || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/careers/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, attribution: getAttribution() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
      setDone(true)
      window.scrollTo({ top: document.getElementById('apply')?.offsetTop ?? 0, behavior: 'smooth' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
        <CheckCircle size={44} className="mx-auto text-green-500 mb-3" />
        <h3 className="font-serif text-2xl text-hampton-navy mb-2">Application sent!</h3>
        <p className="text-hampton-navy/70 text-base">
          Thanks, {String(form.name ?? '').trim().split(/\s+/)[0]}! We&rsquo;ve emailed you a copy. If it looks like a
          good fit, we&rsquo;ll call or text you to set up a time to meet.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl p-5 sm:p-8 shadow-sm space-y-8">
      {/* Honeypot: invisible to people, irresistible to bots. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" {...text('website')} />
        </label>
      </div>

      {/* ── Role ── */}
      <fieldset>
        <legend className={LABEL}>Which role are you applying for?</legend>
        <div className="grid gap-3">
          {(['lead', 'helper'] as const).map(k => (
            <TapCard
              key={k}
              selected={role === k}
              onClick={() => set('role_interest', k)}
              title={ROLES[k].title}
              aside={payLabel(k)}
              sub={ROLES[k].blurb}
            />
          ))}
          <TapCard
            selected={role === 'either'}
            onClick={() => set('role_interest', 'either')}
            title="Either role"
            aside={`${payLabel('helper')} – ${payLabel('lead')}`}
            sub="Happy to start where you need me."
          />
        </div>
      </fieldset>

      {/* ── 18+ ── */}
      <fieldset>
        <legend className={LABEL}>I am 18 or older</legend>
        <Pills
          options={[
            { value: 'yes', label: "Yes, I'm 18+" },
            { value: 'no', label: 'No' },
          ]}
          value={form.is_18_plus === null ? null : form.is_18_plus ? 'yes' : 'no'}
          onChange={v => set('is_18_plus', v === 'yes')}
        />
        {under18 && (
          <p className="mt-4 bg-[#F6F1EB] text-hampton-navy rounded-xl px-4 py-3 text-sm leading-relaxed">
            Thanks so much for your interest! We&rsquo;re only hiring people 18 and older right now — please check
            back with us in the future.
          </p>
        )}
      </fieldset>

      {!under18 && (
        <>
          {/* ── About you ── */}
          <div className="grid gap-4">
            <div>
              <label className={LABEL} htmlFor="ja-name">Your name</label>
              <input id="ja-name" required autoComplete="name" className={INPUT} {...text('name')} />
            </div>
            <div>
              <label className={LABEL} htmlFor="ja-email">Email</label>
              <input id="ja-email" type="email" required autoComplete="email" className={INPUT} {...text('email')} />
            </div>
            <div>
              <label className={LABEL} htmlFor="ja-phone">Phone</label>
              <input id="ja-phone" type="tel" required autoComplete="tel" className={INPUT} {...text('phone')} />
            </div>
          </div>

          <fieldset>
            <legend className={LABEL}>Weekend availability</legend>
            <Pills options={WEEKEND_OPTIONS} value={form.weekend_availability as string} onChange={v => set('weekend_availability', v)} />
          </fieldset>

          <fieldset>
            <legend className={LABEL}>Weekday afternoons / evenings?</legend>
            <Pills options={WEEKDAY_OPTIONS} value={form.weekday_availability as string} onChange={v => set('weekday_availability', v)} />
          </fieldset>

          <fieldset>
            <legend className={LABEL}>Do you have a car and a driver&rsquo;s license?</legend>
            <Pills
              options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
              value={form.has_car === null ? null : form.has_car ? 'yes' : 'no'}
              onChange={v => set('has_car', v === 'yes')}
            />
          </fieldset>

          {/* ── Lead ── */}
          {role && asksLead(role) && (
            <Section title="For Party Leads">
              <div>
                <label className={LABEL} htmlFor="ja-hosp">Hospitality, events, retail or team-lead experience</label>
                <textarea id="ja-hosp" rows={3} className={INPUT} {...text('hospitality_experience')} />
              </div>
              <Rating
                label="How comfortable are you managing parents and directing a small team?"
                value={form.lead_comfort_rating as number | null}
                onChange={n => set('lead_comfort_rating', n)}
              />
              <div>
                <label className={LABEL} htmlFor="ja-deco">Decorating or design experience — and do you enjoy it?</label>
                <textarea id="ja-deco" rows={3} className={INPUT} {...text('decorating_experience')} />
              </div>
              <fieldset>
                <legend className={LABEL}>Balloon arch / garland experience?</legend>
                <Pills options={YES_SOME_NO} value={form.balloon_experience as string} onChange={v => set('balloon_experience', v)} />
              </fieldset>
              <div>
                <label className={LABEL} htmlFor="ja-portfolio">
                  Portfolio or photos of your work <span className="font-normal text-hampton-navy/50">(optional)</span>
                </label>
                <input id="ja-portfolio" inputMode="url" placeholder="instagram.com/yourwork" className={INPUT} {...text('portfolio_url')} />
              </div>
            </Section>
          )}

          {/* ── Helper ── */}
          {role && asksHelper(role) && (
            <Section title="For Party Helpers">
              <div>
                <label className={LABEL} htmlFor="ja-kids">Experience with kids — childcare, babysitting, camp, anything</label>
                <textarea id="ja-kids" rows={3} className={INPUT} {...text('kids_experience')} />
              </div>
              <Rating
                label="How comfortable are you leading a group activity for a room of kids?"
                value={form.activity_comfort_rating as number | null}
                onChange={n => set('activity_comfort_rating', n)}
              />
              {HELPER_SKILLS.map(s => (
                <fieldset key={s.field}>
                  <legend className={LABEL}>{s.label} — experience?</legend>
                  <Pills options={YES_SOME_NO} value={form[s.field] as string} onChange={v => set(s.field, v)} />
                </fieldset>
              ))}
              <label className="flex gap-3 items-start bg-[#F6F1EB] rounded-xl p-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.will_learn_beauty === true}
                  onChange={e => set('will_learn_beauty', e.target.checked)}
                  className="mt-1 h-5 w-5 shrink-0 accent-hampton-navy"
                />
                <span className="text-hampton-navy text-sm leading-relaxed">
                  <strong>I&rsquo;m willing to learn hair tinsel, braiding and nail painting.</strong> Every party has
                  them — we&rsquo;ll teach you. <span className="text-hampton-navy/60">(Required)</span>
                </span>
              </label>
            </Section>
          )}

          {/* ── Everyone ── */}
          <div>
            <label className={LABEL} htmlFor="ja-why">Why do you want to work with us?</label>
            <textarea id="ja-why" rows={4} className={INPUT} {...text('why_us')} />
          </div>

          <div>
            <label className={LABEL} htmlFor="ja-heard">How did you hear about this job?</label>
            <select
              id="ja-heard"
              className={INPUT}
              value={(form.heard_about as string) ?? ''}
              onChange={e => set('heard_about', e.target.value)}
            >
              <option value="" disabled>Choose one</option>
              {JOB_HEARD_ABOUT.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {form.heard_about === 'other' && (
              <input placeholder="Where?" className={`${INPUT} mt-3`} {...text('heard_about_detail')} />
            )}
          </div>

          {error && <p className="bg-red-50 text-red-700 text-sm rounded-xl px-4 py-3">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !role}
            className="w-full bg-hampton-navy text-[#F6F1EB] font-bold text-lg py-4 rounded-full disabled:opacity-50"
          >
            {submitting ? 'Sending…' : role ? `Apply — ${roleInterestLabel(role)}` : 'Choose a role above'}
          </button>
        </>
      )}
    </form>
  )
}

function TapCard({ selected, onClick, title, aside, sub }: { selected: boolean; onClick: () => void; title: string; aside: string; sub: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`w-full text-left rounded-2xl border-2 px-5 py-4 transition-colors ${
        selected ? 'border-hampton-navy bg-hampton-navy text-[#F6F1EB]' : 'border-hampton-pink/40 bg-white text-hampton-navy'
      }`}
    >
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-bold text-lg">{title}</span>
        <span className="font-semibold">{aside}</span>
      </span>
      <span className={`block text-sm mt-1 ${selected ? 'text-[#F6F1EB]/80' : 'text-hampton-navy/60'}`}>{sub}</span>
    </button>
  )
}

function Pills({ options, value, onChange }: { options: readonly Choice[]; value: string | null | undefined; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`min-h-[48px] px-5 rounded-full border-2 text-base font-semibold transition-colors ${
            value === o.value ? 'border-hampton-navy bg-hampton-navy text-[#F6F1EB]' : 'border-hampton-pink/40 bg-white text-hampton-navy'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** 1–5 as five big tap targets, not a slider (plan: mobile-first). */
function Rating({ label, value, onChange }: { label: string; value: number | null; onChange: (n: number) => void }) {
  return (
    <fieldset>
      <legend className={LABEL}>{label}</legend>
      <div className="grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-pressed={value === n}
            aria-label={`${n} of 5`}
            className={`h-14 rounded-xl border-2 text-xl font-bold transition-colors ${
              value === n ? 'border-hampton-navy bg-hampton-navy text-[#F6F1EB]' : 'border-hampton-pink/40 bg-white text-hampton-navy'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-xs text-hampton-navy/50 mt-1 px-1">
        <span>Not yet</span>
        <span>Very</span>
      </div>
    </fieldset>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t-2 border-hampton-pink/20 pt-6 space-y-6">
      <h3 className="font-serif text-xl text-hampton-navy">{title}</h3>
      {children}
    </div>
  )
}
