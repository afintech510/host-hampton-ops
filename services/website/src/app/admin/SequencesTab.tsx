'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2, Edit2, Save, X, Power, Mail, Users as UsersIcon, Clock } from 'lucide-react'

/* ─── Interfaces ─────────────────────────────────────── */

interface SequenceStep {
  id: string
  step_number: number
  delay_days: number
  delay_reference: string
  subject: string
  body_html: string
  cta_text: string | null
  cta_url: string | null
}

interface Enrollment {
  id: string
  contact_id: string
  status: string
  current_step: number
  enrolled_at: string
  last_sent_at: string | null
  contacts: { first_name: string; last_name: string; email: string } | null
}

interface Sequence {
  id: string
  name: string
  trigger_event: string
  service_filter: string | null
  is_active: boolean
  total_emails: number
  created_at: string
  updated_at: string
  step_count?: number
  active_enrollments?: number
  completed_enrollments?: number
}

/* ─── Helpers ────────────────────────────────────────── */

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function triggerLabel(t: string) {
  switch (t) {
    case 'new_inquiry': return 'Lead Inquiry'
    case 'booking_confirmed': return 'Booking Confirmed'
    case 'event_completed': return 'Event Completed'
    case 'dormant_6_months': return '6-Month Dormant'
    case 'birthday_60_days': return 'Birthday 60 Days'
    default: return t
  }
}

function delayLabel(days: number, ref: string) {
  const d = days === 1 ? '1 day' : `${days} days`
  return ref === 'event_date' ? `${d} after event` : `${d} after prev step`
}

/* ─── Sequences Tab ──────────────────────────────────── */

export default function SequencesTab({ headers, onLogout }: { headers: Record<string, string>; onLogout: () => void }) {
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)

  const fetchSequences = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/sequences', { headers })
      if (res.status === 401) { onLogout(); return }
      const data = await res.json()
      setSequences(data.sequences || [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [headers, onLogout])

  useEffect(() => { fetchSequences() }, [fetchSequences])

  const toggleActive = async (seq: Sequence) => {
    await fetch(`/api/admin/sequences/${seq.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ is_active: !seq.is_active }),
    })
    setSequences(prev => prev.map(s => s.id === seq.id ? { ...s, is_active: !s.is_active } : s))
  }

  const deleteSequence = async (id: string) => {
    if (!confirm('Delete this sequence and all its steps?')) return
    await fetch(`/api/admin/sequences/${id}`, { method: 'DELETE', headers })
    setSequences(prev => prev.filter(s => s.id !== id))
  }

  const activeCount = sequences.filter(s => s.is_active).length
  const totalEnrollments = sequences.reduce((sum, s) => sum + (s.active_enrollments || 0), 0)
  const totalCompleted = sequences.reduce((sum, s) => sum + (s.completed_enrollments || 0), 0)

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Active Sequences', value: activeCount, icon: Mail },
          { label: 'Active Enrollments', value: totalEnrollments, icon: UsersIcon },
          { label: 'Completed', value: totalCompleted, icon: Clock },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-white rounded-xl border border-hampton-pink/20 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Icon className="w-4 h-4 text-hampton-blue" />
              <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
            </div>
            <p className="text-2xl font-serif text-hampton-navy">{value}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-serif text-lg text-hampton-navy">Email Sequences</h2>
        <button
          onClick={() => setShowNewForm(true)}
          className="btn-primary text-sm py-1.5 px-4 flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> New Sequence
        </button>
      </div>

      {/* New Sequence Form */}
      {showNewForm && (
        <NewSequenceForm
          headers={headers}
          onCreated={() => { setShowNewForm(false); fetchSequences() }}
          onCancel={() => setShowNewForm(false)}
        />
      )}

      {/* Sequence List */}
      {loading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin text-hampton-blue mx-auto" /></div>
      ) : sequences.length === 0 ? (
        <p className="text-center text-gray-400 py-12">No sequences yet</p>
      ) : (
        <div className="space-y-3">
          {sequences.map(seq => (
            <div key={seq.id} className="bg-white rounded-xl border border-hampton-pink/20 overflow-hidden">
              {/* Header row */}
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-hampton-ivory/50 transition-colors"
                onClick={() => setExpandedId(expandedId === seq.id ? null : seq.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className={`font-medium text-hampton-navy truncate ${!seq.is_active ? 'opacity-50' : ''}`}>{seq.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${seq.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'}`}>
                      {seq.is_active ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {triggerLabel(seq.trigger_event)}
                    {seq.service_filter && ` · ${seq.service_filter.replace(/_/g, ' ')}`}
                    {' · '}{seq.total_emails} email{seq.total_emails !== 1 ? 's' : ''}
                    {' · '}{seq.active_enrollments || 0} active
                  </p>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); toggleActive(seq) }}
                  className={`p-1.5 rounded transition-colors ${seq.is_active ? 'text-emerald-600 hover:bg-emerald-50' : 'text-gray-400 hover:bg-gray-50'}`}
                  title={seq.is_active ? 'Pause sequence' : 'Activate sequence'}
                >
                  <Power className="w-4 h-4" />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); deleteSequence(seq.id) }}
                  className="p-1.5 rounded text-red-400 hover:bg-red-50 transition-colors"
                  title="Delete sequence"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                {expandedId === seq.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </div>

              {/* Expanded detail */}
              {expandedId === seq.id && (
                <SequenceDetail seqId={seq.id} headers={headers} onLogout={onLogout} onUpdate={fetchSequences} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── New Sequence Form ──────────────────────────────── */

function NewSequenceForm({ headers, onCreated, onCancel }: {
  headers: Record<string, string>
  onCreated: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [trigger, setTrigger] = useState('new_inquiry')
  const [serviceFilter, setServiceFilter] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    await fetch('/api/admin/sequences', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, trigger_event: trigger, service_filter: serviceFilter || null }),
    })
    setSaving(false)
    onCreated()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-hampton-pink/20 p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-hampton-navy">New Sequence</h3>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <input
          value={name} onChange={e => setName(e.target.value)}
          placeholder="Sequence name" className="form-input" required
        />
        <select value={trigger} onChange={e => setTrigger(e.target.value)} className="form-input">
          <option value="new_inquiry">Lead Inquiry</option>
          <option value="booking_confirmed">Booking Confirmed</option>
        </select>
        <select value={serviceFilter} onChange={e => setServiceFilter(e.target.value)} className="form-input">
          <option value="">All services</option>
          <option value="kids_party">Kids Party</option>
          <option value="room_rental">Room Rental</option>
          <option value="permanent_jewelry">Permanent Jewelry</option>
          <option value="trucker_hat_bar">Trucker Hat Bar</option>
          <option value="fundraiser">Fundraiser</option>
          <option value="event">Event</option>
        </select>
      </div>
      <div className="flex justify-end mt-3">
        <button type="submit" disabled={!name || saving} className="btn-primary text-sm py-1.5 px-4 flex items-center gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Create
        </button>
      </div>
    </form>
  )
}

/* ─── Sequence Detail (Steps + Enrollments) ──────────── */

function SequenceDetail({ seqId, headers, onLogout, onUpdate }: {
  seqId: string; headers: Record<string, string>; onLogout: () => void; onUpdate: () => void
}) {
  const [steps, setSteps] = useState<SequenceStep[]>([])
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddStep, setShowAddStep] = useState(false)
  const [editingStepId, setEditingStepId] = useState<string | null>(null)

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/sequences/${seqId}`, { headers })
      if (res.status === 401) { onLogout(); return }
      const data = await res.json()
      setSteps(data.steps || [])
      setEnrollments(data.enrollments || [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [seqId, headers, onLogout])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  const deleteStep = async (stepId: string) => {
    if (!confirm('Delete this step?')) return
    await fetch(`/api/admin/sequences/${seqId}/steps/${stepId}`, { method: 'DELETE', headers })
    fetchDetail()
    onUpdate()
  }

  if (loading) return <div className="px-4 py-6 text-center"><Loader2 className="w-5 h-5 animate-spin text-hampton-blue mx-auto" /></div>

  return (
    <div className="border-t border-hampton-pink/10 px-4 py-4">
      {/* Steps section */}
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-hampton-navy">Steps ({steps.length})</h4>
        <button
          onClick={() => setShowAddStep(true)}
          className="text-xs text-hampton-blue hover:text-hampton-navy flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add Step
        </button>
      </div>

      {steps.length === 0 && !showAddStep && (
        <p className="text-sm text-gray-400 mb-4">No steps yet — add one to get started</p>
      )}

      <div className="space-y-2 mb-4">
        {steps.map(step => (
          editingStepId === step.id ? (
            <StepEditor
              key={step.id}
              seqId={seqId}
              step={step}
              headers={headers}
              onSaved={() => { setEditingStepId(null); fetchDetail(); onUpdate() }}
              onCancel={() => setEditingStepId(null)}
            />
          ) : (
            <div key={step.id} className="bg-hampton-ivory/50 rounded-lg p-3 text-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="bg-hampton-navy text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-medium">
                    {step.step_number}
                  </span>
                  <span className="font-medium text-hampton-navy">{step.subject}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500 mr-2">{delayLabel(step.delay_days, step.delay_reference)}</span>
                  <button onClick={() => setEditingStepId(step.id)} className="p-1 text-gray-400 hover:text-hampton-navy"><Edit2 className="w-3.5 h-3.5" /></button>
                  <button onClick={() => deleteStep(step.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              {step.cta_text && (
                <p className="text-xs text-gray-500 mt-1 ml-7">CTA: {step.cta_text}</p>
              )}
            </div>
          )
        ))}
      </div>

      {showAddStep && (
        <StepEditor
          seqId={seqId}
          headers={headers}
          onSaved={() => { setShowAddStep(false); fetchDetail(); onUpdate() }}
          onCancel={() => setShowAddStep(false)}
        />
      )}

      {/* Enrollments section */}
      {enrollments.length > 0 && (
        <>
          <h4 className="text-sm font-medium text-hampton-navy mt-4 mb-2">Recent Enrollments</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="pb-1 font-medium">Contact</th>
                  <th className="pb-1 font-medium">Status</th>
                  <th className="pb-1 font-medium">Step</th>
                  <th className="pb-1 font-medium">Enrolled</th>
                  <th className="pb-1 font-medium">Last Sent</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map(en => (
                  <tr key={en.id} className="border-b border-gray-50">
                    <td className="py-1.5">
                      {en.contacts ? `${en.contacts.first_name || ''} ${en.contacts.last_name || ''}`.trim() || en.contacts.email : 'Unknown'}
                    </td>
                    <td>
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        en.status === 'active' ? 'bg-emerald-100 text-emerald-800'
                          : en.status === 'completed' ? 'bg-blue-100 text-blue-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}>{en.status}</span>
                    </td>
                    <td>{en.current_step}</td>
                    <td>{formatDate(en.enrolled_at)}</td>
                    <td>{en.last_sent_at ? formatDate(en.last_sent_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

/* ─── Step Editor (Add / Edit) ───────────────────────── */

function StepEditor({ seqId, step, headers, onSaved, onCancel }: {
  seqId: string
  step?: SequenceStep
  headers: Record<string, string>
  onSaved: () => void
  onCancel: () => void
}) {
  const isEdit = !!step
  const [subject, setSubject] = useState(step?.subject || '')
  const [delayDays, setDelayDays] = useState(step?.delay_days ?? 1)
  const [delayRef, setDelayRef] = useState(step?.delay_reference || 'previous_step')
  const [bodyHtml, setBodyHtml] = useState(step?.body_html || '')
  const [ctaText, setCtaText] = useState(step?.cta_text || '')
  const [ctaUrl, setCtaUrl] = useState(step?.cta_url || '')
  const [stepNumber, setStepNumber] = useState(step?.step_number ?? 1)
  const [saving, setSaving] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    const body = { subject, delay_days: delayDays, delay_reference: delayRef, body_html: bodyHtml, cta_text: ctaText || null, cta_url: ctaUrl || null }

    if (isEdit) {
      await fetch(`/api/admin/sequences/${seqId}/steps/${step!.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify(body),
      })
    } else {
      await fetch(`/api/admin/sequences/${seqId}/steps`, {
        method: 'POST', headers,
        body: JSON.stringify({ ...body, step_number: stepNumber }),
      })
    }

    setSaving(false)
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-hampton-blue/20 rounded-lg p-4 mb-2">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-hampton-navy">{isEdit ? 'Edit Step' : 'Add Step'}</h4>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-3">
        {!isEdit && (
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Step #</label>
            <input type="number" min={1} value={stepNumber} onChange={e => setStepNumber(+e.target.value)} className="form-input" />
          </div>
        )}
        <div className={isEdit ? 'sm:col-span-2' : ''}>
          <label className="text-xs text-gray-500 mb-1 block">Delay (days)</label>
          <input type="number" min={0} value={delayDays} onChange={e => setDelayDays(+e.target.value)} className="form-input" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Delay from</label>
          <select value={delayRef} onChange={e => setDelayRef(e.target.value)} className="form-input">
            <option value="previous_step">Previous step</option>
            <option value="event_date">Event date</option>
          </select>
        </div>
      </div>

      <div className="mb-3">
        <label className="text-xs text-gray-500 mb-1 block">Subject</label>
        <input value={subject} onChange={e => setSubject(e.target.value)} className="form-input" required placeholder="Email subject line" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">CTA Text</label>
          <input value={ctaText} onChange={e => setCtaText(e.target.value)} className="form-input" placeholder="e.g. Book Now" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">CTA URL</label>
          <input value={ctaUrl} onChange={e => setCtaUrl(e.target.value)} className="form-input" placeholder="https://..." />
        </div>
      </div>

      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-gray-500">Email HTML</label>
          <button type="button" onClick={() => setShowPreview(!showPreview)} className="text-xs text-hampton-blue hover:underline">
            {showPreview ? 'Edit' : 'Preview'}
          </button>
        </div>
        {showPreview ? (
          <div className="border border-gray-200 rounded-lg overflow-hidden" style={{ height: 300 }}>
            <iframe srcDoc={bodyHtml} className="w-full h-full" sandbox="" title="Email preview" />
          </div>
        ) : (
          <textarea
            value={bodyHtml} onChange={e => setBodyHtml(e.target.value)}
            className="form-input font-mono text-xs" rows={8}
            placeholder="Paste HTML email content here..."
          />
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancel</button>
        <button type="submit" disabled={!subject || saving} className="btn-primary text-sm py-1.5 px-4 flex items-center gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {isEdit ? 'Save' : 'Add Step'}
        </button>
      </div>
    </form>
  )
}
