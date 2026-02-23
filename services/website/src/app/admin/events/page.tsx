'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminEventsRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/admin') }, [router])
  return (
    <div className="min-h-screen bg-hampton-ivory flex items-center justify-center">
      <p className="text-hampton-mauve text-sm">Redirecting to admin dashboard...</p>
    </div>
  )
}
