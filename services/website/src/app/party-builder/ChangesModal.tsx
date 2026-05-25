'use client'

import { X, Loader2, Save, AlertCircle } from 'lucide-react'
import type { ChangeRow } from './planDiff'

/**
 * Modal that shows the diff between the customer's current plan and the last
 * saved baseline before they hit save. Lets them confirm or back out.
 *
 * Also surfaces the live total delta (was X → now Y) so the customer sees the
 * pricing impact, not just the items added/removed.
 */
export default function ChangesModal({
  open,
  onClose,
  onConfirm,
  changes,
  oldTotalFormatted,
  newTotalFormatted,
  saving,
  error,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  changes: ChangeRow[]
  oldTotalFormatted: string
  newTotalFormatted: string
  saving: boolean
  error?: string
}) {
  if (!open) return null
  const totalChanged = oldTotalFormatted !== newTotalFormatted

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/40 px-2 sm:px-4 py-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-hampton-mauve/15">
          <h3 className="font-serif text-lg font-bold text-hampton-navy">Save Your Changes</h3>
          <button onClick={onClose} disabled={saving} className="text-hampton-navy/40 hover:text-hampton-navy p-1" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {changes.length === 0 ? (
            <div className="text-center py-8 text-sm text-hampton-navy/60">
              No changes to save.
            </div>
          ) : (
            <>
              <p className="text-xs text-hampton-navy/60 mb-4">
                Review what&apos;s changing, then confirm. We&apos;ll email you an updated quote.
              </p>
              <div className="space-y-2 mb-5">
                {changes.map((c, i) => (
                  <div key={i} className="bg-hampton-ivory/60 rounded-xl px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-hampton-navy/50 mb-1">{c.label}</p>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-hampton-navy/50 line-through truncate">{c.before}</span>
                      <span className="text-hampton-navy/30 shrink-0">→</span>
                      <span className="font-semibold text-hampton-navy truncate">{c.after}</span>
                    </div>
                  </div>
                ))}
              </div>

              {totalChanged && (
                <div className="bg-hampton-pink/10 border border-hampton-pink/20 rounded-xl px-4 py-3 mb-5 flex items-baseline justify-between text-sm">
                  <span className="font-bold text-hampton-navy">Estimated total</span>
                  <span>
                    <span className="text-hampton-navy/50 line-through mr-2">{oldTotalFormatted}</span>
                    <span className="font-serif font-black text-base text-hampton-navy">{newTotalFormatted}</span>
                  </span>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-xs text-red-700 mb-4 flex items-start gap-2">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-hampton-mauve/15 flex gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 py-2.5 rounded-full border-2 border-hampton-navy/20 text-hampton-navy text-sm font-semibold hover:bg-hampton-navy/5 disabled:opacity-40"
          >
            Keep Editing
          </button>
          <button
            onClick={onConfirm}
            disabled={saving || changes.length === 0}
            className="flex-1 py-2.5 rounded-full bg-hampton-navy text-white text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving
              ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
              : <><Save size={14} /> Save Changes</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}
