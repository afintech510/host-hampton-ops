import type { Metadata } from 'next'
import { NOINDEX } from '@/lib/seo'
import UnsubscribeForm from './UnsubscribeForm'

export const dynamic = 'force-dynamic'

/**
 * The confirmation page for an unsubscribe link.
 *
 * This page NEVER unsubscribes anybody. Mail scanners and link previewers GET
 * every URL in a message, so acting on a GET would opt out people who never
 * clicked. The button POSTs to `/api/unsubscribe`, which is also the RFC 8058
 * one-click endpoint Gmail and Apple Mail call directly.
 */
export const metadata: Metadata = {
  title: 'Email preferences',
  robots: NOINDEX,
}

export default function UnsubscribePage({
  searchParams,
}: {
  searchParams: { t?: string }
}) {
  const token = typeof searchParams?.t === 'string' ? searchParams.t : ''

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center px-6 py-16">
      <h1 className="font-serif text-3xl text-[#2f3e46]">Email preferences</h1>
      {token ? (
        <>
          <p className="mt-4 text-[#5b6670]">
            Click below and we&apos;ll stop sending you automated emails about events and
            party planning. You&apos;ll still get replies to anything you write to us, and
            anything about a booking you already have.
          </p>
          <UnsubscribeForm token={token} />
        </>
      ) : (
        <p className="mt-4 text-[#5b6670]">
          This link is missing its code. Please use the Unsubscribe link at the bottom of
          the email you received, or write to us at{' '}
          <a className="underline" href="mailto:info@hosthampton.com">
            info@hosthampton.com
          </a>{' '}
          and we&apos;ll take care of it.
        </p>
      )}
    </main>
  )
}
