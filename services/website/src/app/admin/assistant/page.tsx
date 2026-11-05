'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import AssistantChat from '@/components/admin/AssistantChat'

/**
 * /admin/assistant — the Manager chat, full screen.
 *
 * The chat itself is `components/admin/AssistantChat.tsx`, the same component
 * the slide-over drawer wraps, so there is one chat UI to maintain. This page
 * only owns the sign-in check and the way back to the dashboard.
 */

const TOKEN_KEY = 'hh_admin_token'

export default function AssistantPage() {
  const [checking, setChecking] = useState(true)
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    fetch('/api/admin/auth/session')
      .then(r => r.json())
      .then(d => setSignedIn(!!d?.authenticated || !!localStorage.getItem(TOKEN_KEY)))
      .catch(() => setSignedIn(!!localStorage.getItem(TOKEN_KEY)))
      .finally(() => setChecking(false))
  }, [])

  if (checking) {
    return <div className="min-h-screen flex items-center justify-center text-hampton-navy/60">Loading…</div>
  }

  if (!signedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-4">
          <p className="text-hampton-navy">Sign in to the admin dashboard first.</p>
          <Link href="/admin" className="inline-block bg-hampton-navy text-white px-5 py-2 rounded-full text-sm font-bold">
            Go to admin
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="bg-white border-b border-hampton-mauve/30">
        <div className="max-w-3xl mx-auto px-4 py-2">
          <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-hampton-navy/60 hover:text-hampton-navy">
            <ArrowLeft size={16} /> Back to admin
          </Link>
        </div>
      </div>
      <AssistantChat context={{ page: 'assistant', bookingRef: null }} variant="full" />
    </div>
  )
}
