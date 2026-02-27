'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

// Pages where the chat bubble is hidden entirely
const HIDDEN_PAGES = ['/party-quote', '/kids-party-menu']

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $crisp: any[]
    CRISP_WEBSITE_ID: string
  }
}

function crispPush(cmd: string, ...args: unknown[]) {
  if (typeof window === 'undefined') return
  window.$crisp = window.$crisp || []
  window.$crisp.push([cmd, ...args])
}

export default function CrispChat() {
  const pathname = usePathname()
  const websiteId = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID
  const loaded = useRef(false)

  // Inject Crisp script once
  useEffect(() => {
    if (!websiteId || loaded.current || document.getElementById('crisp-js')) return
    loaded.current = true

    window.$crisp = []
    window.CRISP_WEBSITE_ID = websiteId

    const script = document.createElement('script')
    script.id = 'crisp-js'
    script.src = 'https://client.crisp.chat/l.js'
    script.async = true
    document.head.appendChild(script)
  }, [websiteId])

  // Show/hide based on current route
  useEffect(() => {
    if (!websiteId) return
    const hidden = HIDDEN_PAGES.some(p => pathname === p || pathname.startsWith(p + '/'))
    if (hidden) {
      crispPush('do', 'chat:hide')
    } else {
      crispPush('do', 'chat:show')
    }
  }, [pathname, websiteId])

  // Hide chat bubble when a contact form scrolls into view
  useEffect(() => {
    if (!websiteId) return
    const isHiddenPage = HIDDEN_PAGES.some(p => pathname === p || pathname.startsWith(p + '/'))
    if (isHiddenPage) return

    // Wait a tick so page DOM is ready
    const timeout = setTimeout(() => {
      const forms = Array.from(document.querySelectorAll<HTMLElement>('form, [data-hide-crisp]'))
      if (!forms.length) return

      const visibleForms = new Set<Element>()

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              visibleForms.add(entry.target)
            } else {
              visibleForms.delete(entry.target)
            }
          }
          if (visibleForms.size > 0) {
            crispPush('do', 'chat:hide')
          } else {
            crispPush('do', 'chat:show')
          }
        },
        { threshold: 0.15 }
      )

      forms.forEach(f => observer.observe(f))
      return () => observer.disconnect()
    }, 300)

    return () => clearTimeout(timeout)
  }, [pathname, websiteId])

  return null
}
