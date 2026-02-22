/**
 * Shared test fixtures for event ticketing system tests.
 */

export const sampleEvent = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  slug: 'embroidery-workshop',
  title: 'Embroidery Workshop',
  description: 'Learn embroidery basics.',
  short_description: 'A fun embroidery class.',
  category: 'workshop',
  price_cents: 4500,
  sibling_price_cents: null,
  has_variants: true,
  variants: [
    { label: 'Baseball Hat', priceCents: 4500 },
    { label: 'Tote Bag', priceCents: 5500 },
  ],
  event_date: '2026-03-15',
  event_time: '2:00 PM',
  event_end_time: '4:00 PM',
  location: 'Host Hampton, 295 Montauk Hwy Suite 7, Speonk NY',
  max_tickets: 12,
  available_tickets: 8,
  has_sessions: false,
  is_active: true,
  is_featured: false,
  image_url: null,
  google_calendar_event_id: null,
  created_at: '2026-02-20T00:00:00Z',
}

export const sampleFreeEvent = {
  ...sampleEvent,
  id: '550e8400-e29b-41d4-a716-446655440002',
  slug: 'spring-market',
  title: 'Spring Market',
  description: 'Free spring market with local vendors.',
  category: 'market',
  price_cents: 0,
  has_variants: false,
  variants: [],
  max_tickets: 100,
  available_tickets: 80,
}

export const sampleSessionEvent = {
  ...sampleEvent,
  id: '550e8400-e29b-41d4-a716-446655440003',
  slug: 'open-soft-play',
  title: 'Open Soft Play',
  category: 'class',
  price_cents: 2000,
  has_variants: false,
  variants: [],
  has_sessions: true,
  max_tickets: 15,
  available_tickets: 15,
}

export const sampleSession = {
  id: '660e8400-e29b-41d4-a716-446655440001',
  event_id: sampleSessionEvent.id,
  session_date: '2026-03-04',
  session_time: '10:00 AM',
  price_cents: null,
  max_tickets: 15,
  available_tickets: 10,
  is_active: true,
}

export const sampleTicket = {
  id: '770e8400-e29b-41d4-a716-446655440001',
  ticket_ref: 'HH-EVT-0001',
  event_id: sampleEvent.id,
  session_id: null,
  customer_name: 'Jane Smith',
  customer_email: 'jane@example.com',
  customer_phone: '555-123-4567',
  quantity: 2,
  variant_label: 'Baseball Hat',
  unit_price_cents: 4500,
  total_cents: 9000,
  stripe_payment_intent_id: 'pi_test_123',
  stripe_session_id: 'cs_test_123',
  status: 'confirmed',
  refund_amount_cents: null,
  refund_reason: null,
  created_at: '2026-02-20T12:00:00Z',
}

export const sampleFreeTicket = {
  ...sampleTicket,
  id: '770e8400-e29b-41d4-a716-446655440002',
  ticket_ref: 'HH-EVT-0002',
  event_id: sampleFreeEvent.id,
  variant_label: null,
  unit_price_cents: 0,
  total_cents: 0,
  stripe_payment_intent_id: null,
  stripe_session_id: null,
  quantity: 1,
}

export const sampleCheckoutBody = {
  eventId: sampleEvent.id,
  quantity: 2,
  variantLabel: 'Baseball Hat',
  customerName: 'Jane Smith',
  customerEmail: 'jane@example.com',
  customerPhone: '555-123-4567',
}

export const sampleFreeCheckoutBody = {
  eventId: sampleFreeEvent.id,
  quantity: 1,
  customerName: 'John Doe',
  customerEmail: 'john@example.com',
  customerPhone: '555-987-6543',
}
