import { Metadata } from 'next'
import SummaryContent from './SummaryContent'
import { NOINDEX } from '@/lib/seo'

export const metadata: Metadata = {
  robots: NOINDEX,
  title: 'Review Your Party — Host Hampton',
  description: 'Review your party selections, pick your payment method, and place your deposit.',
}

export default function SummaryPage() {
  return <SummaryContent />
}
