import type { Metadata } from 'next'

export const metadata: Metadata = {
  // The root layout appends ' | Host Hampton'; naming it here rendered it twice.
  title: 'Join the Party — 10% Off Your First Booking',
  description: 'Sign up for the Host Hampton mailing list and get 10% off your first party booking.',
}

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
