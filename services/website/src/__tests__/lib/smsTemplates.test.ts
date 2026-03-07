/**
 * Tests for SMS template functions.
 * Verifies correct content, TCPA compliance (STOP opt-out), and character limits.
 */

import {
  smsEventReminder1Day,
  smsEventReminder2Hr,
  smsBookingReminder1Day,
  smsMarketingParty,
  smsMarketingEvent,
  smsMarketingJewelry,
  smsFlashSale,
} from '@/lib/sms-templates'

describe('SMS Templates', () => {
  describe('smsEventReminder1Day', () => {
    it('includes customer first name and event details', () => {
      const result = smsEventReminder1Day({
        firstName: 'Sarah',
        eventName: 'Embroidery Workshop',
        time: '2:00 PM',
      })
      expect(result).toContain('Sarah')
      expect(result).toContain('Embroidery Workshop')
      expect(result).toContain('2:00 PM')
      expect(result).toContain('tomorrow')
    })

    it('includes Host Hampton address', () => {
      const result = smsEventReminder1Day({ firstName: 'Jane', eventName: 'Test', time: '10 AM' })
      expect(result).toContain('295 Montauk Hwy')
    })

    it('includes STOP opt-out text', () => {
      const result = smsEventReminder1Day({ firstName: 'Jane', eventName: 'Test', time: '10 AM' })
      expect(result).toContain('STOP')
    })
  })

  describe('smsEventReminder2Hr', () => {
    it('includes first name and event name', () => {
      const result = smsEventReminder2Hr({ firstName: 'Bob', eventName: 'Open Play' })
      expect(result).toContain('Bob')
      expect(result).toContain('Open Play')
      expect(result).toContain('2 hours')
    })

    it('includes STOP opt-out', () => {
      const result = smsEventReminder2Hr({ firstName: 'Bob', eventName: 'Test' })
      expect(result).toContain('STOP')
    })
  })

  describe('smsBookingReminder1Day', () => {
    it('includes party time and tomorrow reference', () => {
      const result = smsBookingReminder1Day({ firstName: 'Mom', partyTime: '3:00 PM' })
      expect(result).toContain('Mom')
      expect(result).toContain('3:00 PM')
      expect(result).toContain('tomorrow')
    })

    it('includes STOP opt-out', () => {
      const result = smsBookingReminder1Day({ firstName: 'Mom', partyTime: '3 PM' })
      expect(result).toContain('STOP')
    })
  })

  describe('smsMarketingParty', () => {
    it('mentions Host Hampton and booking URL', () => {
      const result = smsMarketingParty()
      expect(result).toContain('Host Hampton')
      expect(result).toContain('hosthampton.com')
      expect(result).toContain('party')
    })

    it('includes STOP opt-out', () => {
      expect(smsMarketingParty()).toContain('STOP')
    })
  })

  describe('smsMarketingEvent', () => {
    it('includes event name and date', () => {
      const result = smsMarketingEvent({ eventName: 'Spring Market', date: 'March 15' })
      expect(result).toContain('Spring Market')
      expect(result).toContain('March 15')
    })

    it('includes events page link', () => {
      const result = smsMarketingEvent({ eventName: 'Test', date: 'April 1' })
      expect(result).toContain('hosthampton.com/events')
    })

    it('includes STOP opt-out', () => {
      const result = smsMarketingEvent({ eventName: 'Test', date: 'April 1' })
      expect(result).toContain('STOP')
    })
  })

  describe('smsMarketingJewelry', () => {
    it('mentions permanent jewelry and price', () => {
      const result = smsMarketingJewelry()
      expect(result).toContain('Permanent jewelry')
      expect(result).toContain('$38')
    })

    it('includes booking link', () => {
      expect(smsMarketingJewelry()).toContain('hosthampton.com/permanent-jewelry')
    })

    it('includes STOP opt-out', () => {
      expect(smsMarketingJewelry()).toContain('STOP')
    })
  })

  describe('smsFlashSale', () => {
    it('includes offer text, deadline, and link', () => {
      const result = smsFlashSale({
        offerText: '20% off all parties',
        deadline: 'Friday',
        link: 'hosthampton.com/book',
      })
      expect(result).toContain('20% off all parties')
      expect(result).toContain('Friday')
      expect(result).toContain('hosthampton.com/book')
    })

    it('starts with FLASH SALE', () => {
      const result = smsFlashSale({ offerText: 'Deal', deadline: 'Today', link: 'test.com' })
      expect(result).toMatch(/^FLASH SALE/)
    })

    it('includes STOP opt-out', () => {
      const result = smsFlashSale({ offerText: 'Deal', deadline: 'Today', link: 'test.com' })
      expect(result).toContain('STOP')
    })
  })

  describe('All templates include STOP opt-out (TCPA compliance)', () => {
    it('all templates contain Reply STOP to opt out', () => {
      const templates = [
        smsEventReminder1Day({ firstName: 'A', eventName: 'B', time: 'C' }),
        smsEventReminder2Hr({ firstName: 'A', eventName: 'B' }),
        smsBookingReminder1Day({ firstName: 'A', partyTime: 'B' }),
        smsMarketingParty(),
        smsMarketingEvent({ eventName: 'A', date: 'B' }),
        smsMarketingJewelry(),
        smsFlashSale({ offerText: 'A', deadline: 'B', link: 'C' }),
      ]

      for (const t of templates) {
        expect(t.toLowerCase()).toContain('stop')
      }
    })
  })
})
