import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Join the Party — 10% Off Your First Booking | Host Hampton',
  description: 'Sign up for the Host Hampton mailing list and get 10% off your first party booking.',
}

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
