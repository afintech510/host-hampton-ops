import {
  ticketConfirmationHtml,
  ticketPurchaseNotifyHtml,
  ticketRefundHtml,
  fundraiserInquiryAutoReplyHtml,
  fundraiserInquiryNotifyHtml,
} from '@/lib/emailTemplates'

describe('ticketConfirmationHtml', () => {
  const baseData = {
    customerName: 'Jane Smith',
    eventTitle: 'Embroidery Workshop',
    eventDate: 'Saturday, March 15, 2026',
    eventTime: '2:00 PM',
    location: 'Host Hampton, 295 Montauk Hwy Suite 7, Speonk NY',
    quantity: 2,
    totalFormatted: '$90.00',
    ticketRef: 'HH-EVT-0001',
    isFree: false,
  }

  it('generates valid HTML with all required fields', () => {
    const html = ticketConfirmationHtml(baseData)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Jane') // first name
    expect(html).toContain('Embroidery Workshop')
    expect(html).toContain('Saturday, March 15, 2026')
    expect(html).toContain('2:00 PM')
    expect(html).toContain('HH-EVT-0001')
    expect(html).toContain('$90.00')
    expect(html).toContain('295 Montauk')
  })

  it('uses first name only in greeting', () => {
    const html = ticketConfirmationHtml(baseData)
    expect(html).toContain('Hi Jane,')
    expect(html).not.toContain('Hi Jane Smith,')
  })

  it('falls back to "there" for single-word names', () => {
    const html = ticketConfirmationHtml({ ...baseData, customerName: '' })
    expect(html).toContain('Hi there,')
  })

  it('shows variant label when provided', () => {
    const html = ticketConfirmationHtml({ ...baseData, variantLabel: 'Baseball Hat' })
    expect(html).toContain('Baseball Hat')
    expect(html).toContain('Option')
  })

  it('omits variant row when not provided', () => {
    const html = ticketConfirmationHtml(baseData)
    expect(html).not.toContain('Option')
  })

  it('shows FREE badge for free events', () => {
    const html = ticketConfirmationHtml({ ...baseData, isFree: true, totalFormatted: 'Free' })
    expect(html).toContain('FREE')
    expect(html).toContain('RSVP')
  })

  it('shows paid confirmation for paid events', () => {
    const html = ticketConfirmationHtml(baseData)
    expect(html).toContain('$90.00')
    expect(html).toContain("tickets are")
  })

  it('includes contact information', () => {
    const html = ticketConfirmationHtml(baseData)
    expect(html).toContain('(631) 998-9325')
    expect(html).toContain('hosthampton295@gmail.com')
  })

  it('includes brand styling', () => {
    const html = ticketConfirmationHtml(baseData)
    expect(html).toContain('#1a2744') // navy
    expect(html).toContain('#A1B5C8') // dusty blue
    expect(html).toContain('Host Hampton')
  })

  it('displays quantity', () => {
    const html = ticketConfirmationHtml({ ...baseData, quantity: 3 })
    expect(html).toContain('>3<')
  })
})

describe('ticketPurchaseNotifyHtml', () => {
  const baseData = {
    ticketRef: 'HH-EVT-0001',
    customerName: 'Jane Smith',
    customerEmail: 'jane@example.com',
    eventTitle: 'Embroidery Workshop',
    eventDate: 'Saturday, March 15, 2026',
    eventTime: '2:00 PM',
    quantity: 2,
    totalFormatted: '$90.00',
    isFree: false,
  }

  it('generates valid owner notification HTML', () => {
    const html = ticketPurchaseNotifyHtml(baseData)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('New Ticket Purchase')
    expect(html).toContain('Jane Smith')
    expect(html).toContain('jane@example.com')
    expect(html).toContain('HH-EVT-0001')
  })

  it('shows RSVP label for free events', () => {
    const html = ticketPurchaseNotifyHtml({ ...baseData, isFree: true })
    expect(html).toContain('New RSVP')
  })

  it('includes phone when provided', () => {
    const html = ticketPurchaseNotifyHtml({ ...baseData, customerPhone: '555-123-4567' })
    expect(html).toContain('555-123-4567')
  })

  it('shows dash when phone not provided', () => {
    const html = ticketPurchaseNotifyHtml(baseData)
    // When no phone, shows em dash
    expect(html).toMatch(/Phone<\/td><td[^>]*>—/)
  })

  it('shows variant when provided', () => {
    const html = ticketPurchaseNotifyHtml({ ...baseData, variantLabel: 'Tote Bag' })
    expect(html).toContain('Tote Bag')
    expect(html).toContain('Option')
  })

  it('omits variant row when not provided', () => {
    const html = ticketPurchaseNotifyHtml(baseData)
    expect(html).not.toContain('Option')
  })

  it('shows Stripe PI when provided', () => {
    const html = ticketPurchaseNotifyHtml({ ...baseData, stripePI: 'pi_test_123' })
    expect(html).toContain('pi_test_123')
    expect(html).toContain('Stripe PI')
  })
})

describe('ticketRefundHtml', () => {
  const baseData = {
    customerName: 'Jane Smith',
    eventTitle: 'Embroidery Workshop',
    ticketRef: 'HH-EVT-0001',
    refundAmount: '$90.00',
  }

  it('generates valid refund email HTML', () => {
    const html = ticketRefundHtml(baseData)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Refund Processed')
    expect(html).toContain('$90.00')
    expect(html).toContain('Embroidery Workshop')
    expect(html).toContain('HH-EVT-0001')
  })

  it('uses first name in greeting', () => {
    const html = ticketRefundHtml(baseData)
    expect(html).toContain('Hi Jane,')
  })

  it('includes refund reason when provided', () => {
    const html = ticketRefundHtml({ ...baseData, reason: 'Event cancelled' })
    expect(html).toContain('Event cancelled')
    expect(html).toContain('Reason:')
  })

  it('omits reason when not provided', () => {
    const html = ticketRefundHtml(baseData)
    expect(html).not.toContain('Reason:')
  })

  it('mentions 5-10 business days timeline', () => {
    const html = ticketRefundHtml(baseData)
    expect(html).toContain('5–10 business days')
  })
})

describe('fundraiserInquiryAutoReplyHtml', () => {
  const baseData = {
    contactName: 'Sarah Jones',
    organizationName: 'Lincoln Elementary PTA',
    estimatedQuantity: '50–99',
    organizationType: 'school',
  }

  it('generates valid HTML with all required fields', () => {
    const html = fundraiserInquiryAutoReplyHtml(baseData)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Lincoln Elementary PTA')
    expect(html).toContain('Sarah Jones')
    expect(html).toContain('Fundraiser Request Received')
    expect(html).toContain('mockup')
  })

  it('uses first name only in greeting', () => {
    const html = fundraiserInquiryAutoReplyHtml(baseData)
    expect(html).toContain('Hi Sarah,')
    expect(html).not.toContain('Hi Sarah Jones,')
  })

  it('falls back to "there" for empty name', () => {
    const html = fundraiserInquiryAutoReplyHtml({ ...baseData, contactName: '' })
    expect(html).toContain('Hi there,')
  })

  it('includes estimated quantity when provided', () => {
    const html = fundraiserInquiryAutoReplyHtml(baseData)
    expect(html).toContain('50–99')
    expect(html).toContain('Est. Quantity')
  })

  it('omits quantity section when not provided', () => {
    const html = fundraiserInquiryAutoReplyHtml({
      contactName: 'Sarah Jones',
      organizationName: 'Test Org',
    })
    expect(html).not.toContain('Est. Quantity')
  })

  it('includes brand styling', () => {
    const html = fundraiserInquiryAutoReplyHtml(baseData)
    expect(html).toContain('#1a2744')
    expect(html).toContain('#A1B5C8')
    expect(html).toContain('Host Hampton')
  })

  it('includes contact information', () => {
    const html = fundraiserInquiryAutoReplyHtml(baseData)
    expect(html).toContain('(631) 998-9325')
    expect(html).toContain('hosthampton295@gmail.com')
  })
})

describe('fundraiserInquiryNotifyHtml', () => {
  const baseData = {
    contactName: 'Sarah Jones',
    organizationName: 'Lincoln Elementary PTA',
    email: 'sarah@lincoln.edu',
    phone: '631-555-1234',
    organizationType: 'school',
    estimatedQuantity: '50–99',
    message: 'We need hats for spring fundraiser',
  }

  it('generates valid owner notification HTML', () => {
    const html = fundraiserInquiryNotifyHtml(baseData)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('New Fundraiser Lead')
    expect(html).toContain('Lincoln Elementary PTA')
    expect(html).toContain('sarah@lincoln.edu')
    expect(html).toContain('Sarah Jones')
  })

  it('shows phone when provided', () => {
    const html = fundraiserInquiryNotifyHtml(baseData)
    expect(html).toContain('631-555-1234')
  })

  it('shows dash when phone not provided', () => {
    const html = fundraiserInquiryNotifyHtml({ ...baseData, phone: undefined })
    expect(html).toMatch(/Phone<\/td><td[^>]*>—/)
  })

  it('includes message when provided', () => {
    const html = fundraiserInquiryNotifyHtml(baseData)
    expect(html).toContain('We need hats for spring fundraiser')
    expect(html).toContain('Message:')
  })

  it('omits message row when not provided', () => {
    const html = fundraiserInquiryNotifyHtml({ ...baseData, message: undefined })
    expect(html).not.toContain('Message:')
  })

  it('includes organization type', () => {
    const html = fundraiserInquiryNotifyHtml(baseData)
    expect(html).toContain('School / PTA')
  })
})
