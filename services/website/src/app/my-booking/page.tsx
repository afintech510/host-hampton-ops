import { Metadata } from 'next'
import MyBookingContent from './MyBookingContent'

export const metadata: Metadata = {
  title: 'My Booking — Host Hampton',
  description: 'View and manage your Host Hampton booking.',
}

export default function MyBookingPage() {
  return <MyBookingContent />
}
