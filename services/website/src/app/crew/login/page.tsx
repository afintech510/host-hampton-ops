import { notFound, redirect } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'
import { currentCrewMember } from '@/lib/crew/auth'
import { crewAppOpen, crewTestLoginEnabled, loadCrewSettings } from '@/lib/crew/settings'
import { listTestMembers } from '@/lib/crew/db'
import { testPickView, type TestPickView } from '@/lib/crew/view'
import LoginForm from '../_components/LoginForm'
import TestPicker from '../_components/TestPicker'

export const dynamic = 'force-dynamic'

/**
 * `/crew/login`: email → code. While CREW_TEST_LOGIN is on, also the test
 * picker: the active `is_test` members only, as `testPickView` (first name,
 * last name, rate, can-lead) — never an email or a phone.
 */
export default async function CrewLoginPage() {
  if (!crewAppOpen()) notFound()
  const session = await currentCrewMember()
  if (session.kind === 'ok') redirect('/crew')

  let picks: TestPickView[] | null = null
  let pickError = false
  if (crewTestLoginEnabled()) {
    const sb = getSupabase()
    const [rows, settings] = await Promise.all([listTestMembers(sb), loadCrewSettings(sb)])
    if (rows.kind === 'ok' && settings.kind === 'ok') picks = testPickView(rows.data, settings.settings)
    else pickError = true
  }

  return (
    <main className="crew-wrap">
      <div className="crew-top"><span className="crew-brand">Host Hampton Crew</span></div>
      <h1>Sign in</h1>
      <p className="crew-muted" style={{ marginTop: 0 }}>We&apos;ll email you a 6-digit code. No password to remember.</p>
      <LoginForm />
      {picks && <TestPicker members={picks} />}
      {pickError && <p className="crew-note crew-warn">The test crew list didn&apos;t load. Refresh to try again.</p>}
    </main>
  )
}
