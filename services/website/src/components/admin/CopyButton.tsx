'use client'

import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { copyText } from '@/lib/copyText'

/**
 * A Copy button that does what every copy button does: when the text is on the
 * clipboard the label turns into a check and "Copied" for two seconds, then goes
 * back. If the browser refuses, it says so rather than showing a check it did not
 * earn.
 */
export default function CopyButton({
  text,
  label = 'Copy',
  className = 'text-xs border border-current rounded-full px-2 py-0.5',
}: {
  text: string
  label?: string
  className?: string
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function onClick() {
    const ok = await copyText(text)
    setState(ok ? 'copied' : 'failed')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2000)
  }

  return (
    <button type="button" onClick={onClick} className={className} aria-live="polite" data-copy-state={state}>
      {state === 'copied' ? (
        <span className="inline-flex items-center gap-1"><Check size={12} aria-hidden="true" /> Copied</span>
      ) : state === 'failed' ? (
        'Could not copy'
      ) : (
        label
      )}
    </button>
  )
}
