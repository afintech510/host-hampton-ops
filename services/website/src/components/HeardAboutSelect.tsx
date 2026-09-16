'use client'

import { HEARD_ABOUT_OPTIONS, type HeardAboutValue } from '@/lib/attribution'

/**
 * "How did you hear about us?" — one field, one option list, every form.
 *
 * The options live in `lib/attribution.ts` beside the mapping that turns them
 * into a `lead_source`, so a form cannot offer an answer the server would
 * refuse (rule 11). Adding an option is one edit, in the place that already
 * knows what the option MEANS.
 *
 * Deliberately optional and deliberately last in the form: it is our question,
 * not theirs, and a required field here costs real inquiries.
 */
export default function HeardAboutSelect({
  value,
  note,
  onChange,
  onNoteChange,
  className = '',
  variant = 'inline',
}: {
  value: string
  note: string
  onChange: (value: HeardAboutValue | '') => void
  onNoteChange: (note: string) => void
  className?: string
  /**
   * Which of the two field styles this site already uses. `inline` is the
   * hand-rolled one in the standalone form components; `form` is the
   * `form-input`/`form-label` pair the page-level builders use. Neither is
   * introduced here — the field just has to look like the fields above it.
   */
  variant?: 'inline' | 'form'
}) {
  const inputClass =
    variant === 'form'
      ? 'form-input'
      : 'w-full border border-hampton-pink/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-pink/40'
  const labelClass =
    variant === 'form'
      ? 'form-label'
      : 'block text-xs font-medium text-hampton-navy uppercase tracking-wide mb-1'

  return (
    <div className={className}>
      <label className={labelClass}>How did you hear about us?</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value as HeardAboutValue | '')}
        className={`${inputClass} bg-white`}
      >
        <option value="">Select one (optional)</option>
        {HEARD_ABOUT_OPTIONS.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {value === 'something_else' && (
        <input
          type="text"
          value={note}
          onChange={e => onNoteChange(e.target.value)}
          placeholder="Where did you find us?"
          maxLength={300}
          className={`${inputClass} mt-2`}
        />
      )}
    </div>
  )
}

/**
 * The two pieces of state every form needs, and the two body fields every
 * intake route reads. Kept here so a form cannot post `heardAbout` under a
 * name the server does not look for — the failure would be silent and would
 * look exactly like "nobody answers that question".
 */
export function heardAboutFields(value: string, note: string) {
  if (!value) return {}
  return { heardAbout: value, ...(value === 'something_else' && note ? { heardAboutOther: note } : {}) }
}
