import type { TenantConfig } from './types'

/**
 * Host Hampton — tenant #1, and the live site.
 *
 * Every value here is the one production already served before this file
 * existed; moving it here changed no output.
 */
export const HOST_HAMPTON: TenantConfig = {
  id: 'hosthampton',

  business: {
    name: 'Host Hampton',
    oneLiner:
      'Private, fully hosted kids and teen party studio in Speonk, NY, plus mobile craft parties at your home across Long Island.',
    siteUrl: 'https://www.hosthampton.com',
    apexHost: 'hosthampton.com',
  },

  contact: {
    phoneDisplay: '(631) 998-9325',
    phoneE164: '+16319989325',
    phoneDigits: '6319989325',
    email: 'hosthampton295@gmail.com',
    infoEmail: 'info@hosthampton.com',
  },

  payments: {
    phoneDisplay: '631-599-2469',
    venmoHandle: 'HostHampton',
  },

  location: {
    street: '295 Montauk Hwy',
    town: 'Speonk',
    region: 'NY',
    postalCode: '11972',
    country: 'US',
    latitude: 40.8432,
    longitude: -72.6823,
    timeZone: 'America/New_York',
  },

  social: {
    instagram: 'https://www.instagram.com/hosthampton',
    facebook: 'https://www.facebook.com/hosthampton',
    googleBusiness: 'https://maps.app.goo.gl/LFAKi3WzCNmcDsNV9',
  },

  people: {
    customerSignoff: 'Allie',
  },

  email: {
    noReplyFrom: 'noReply@mail.hosthampton.com',
    ownerNotifyDefault: 'hosthampton295@gmail.com',
  },

  brand: {
    logo: '/images/host-hampton-logo_300.png',
    logoLarge: '/images/host-hampton-logo.png',
    colors: {
      navy: '#1a2744',
      ivory: '#F6F1EB',
      blue: '#A1B5C8',
      pink: '#E8C7CB',
      footer: '#BCCDEB',
    },
  },

  features: {
    managerAssistant: true,
    publicMcp: true,
    publicMcpInquiry: true,
  },
}
