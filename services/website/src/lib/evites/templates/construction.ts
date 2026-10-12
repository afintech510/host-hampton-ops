/**
 * The Construction Zone template, from Adam's Canva design "Copy of BSP2402 05M
 * Construction Birthday Invitation" (DAGgy5a3rH0, 480x672).
 *
 * The background is that design with every text element and the four thin rules
 * that bracketed the month and the time deleted (working copy DAHXvkHI7qQ,
 * exported 2186x3060, scaled to 1093x1530 and cropped 4 px each side). The
 * watercolour diggers, trucks, tools, bricks and the STOP sign are art.
 *
 * Canva's geometry x 2.277 (glyph centres measured off the Canva thumbnail,
 * because Canva's line boxes for this face are taller than its ink):
 *
 *   STOP THE TRAFFIC / CLOSE THE ROAD   160.6, 17.5 -> 40 (2 lines)  -> 388 / 433
 *   Archie                              186.4 / h 116, 97.1 -> 221   -> 550
 *   IS TURNING                          289.7, 28.0 -> 64            -> 687
 *   Four years old                      317.6, 28.0 -> 64            -> 754
 *   SATURDAY (arched)                   366.2, 16.1 -> 37            -> 858
 *   April | 12 | 10am-12pm              397.9, 20.0 / 40.7 / 14.6 -> 46 / 93 / 33  -> 925
 *   Host Hampton / address / Speonk     441.8, 17.5 -> 40 (3 lines)  -> 1025..1120
 *   RSVP TO <mom> / AT <phone>          510.2, 17.4 -> 40 (2 lines)  -> 1165..1246
 *
 * Fonts: Canva's chunky outlined display face -> Luckiest Guy, white with a grey
 * outline and a grey offset shadow; its rounded caps -> Fredoka 600 for the
 * yellow lines and Poppins for the small grey ones. The name is set smaller
 * than Canva's 221 (183) because Luckiest is wider and the excavator and the
 * loader leave ~620 px at that height.
 *
 * What changed, and why:
 *   - "SATURDAY" was set on an arc above the date; the renderer sets text
 *     straight, so it is a straight `weekdayText` line in the same place.
 *   - The rules above and below the month and time are gone: they were sized to
 *     "APRIL" and "10AM-12PM", and fixed art cannot follow "SEPTEMBER".
 *   - "Four years old" is a row: `ageWords` + `yearsOld` (upper-cased, so age 1
 *     reads "ONE YEAR OLD"), under a static "IS TURNING"; with no age both go
 *     and the card reads "IS HAVING A PARTY!".
 *   - The date row is month, day, time; a preview (all pieces '') shows
 *     `dateLine` ("Pick your date") instead, and the weekday hides itself.
 *   - Canva's three place lines are one `placeLine`; the two RSVP lines are one
 *     `hostContactLine` (guests RSVP online; the line names Allie).
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { TemplateLayout } from '@/lib/evites/templates/types'

const GREY = '#575757'
const YELLOW = '#e8b324'

export const CONSTRUCTION_TEMPLATE: TemplateLayout = {
  slug: 'construction',
  label: 'Construction Zone',
  source: { canvaDesignId: 'DAGgy5a3rH0', canvaArtCopyId: 'DAHXvkHI7qQ' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/construction/background.webp', raster: '/evites/construction/background.jpg' },
  backgroundColor: '#ffffff',
  layers: [],
  slots: [
    {
      id: 'slogan_1',
      type: 'text',
      staticText: 'STOP THE TRAFFIC',
      top: 365,
      font: 'poppins400',
      size: 38,
      lineHeight: 1.2,
      letterSpacingEm: 0.03,
      color: GREY,
    },
    {
      id: 'slogan_2',
      type: 'text',
      staticText: 'CLOSE THE ROAD',
      top: 410,
      font: 'poppins400',
      size: 38,
      lineHeight: 1.2,
      letterSpacingEm: 0.03,
      color: GREY,
    },
    {
      id: 'honoree',
      type: 'text',
      bind: 'honoreeDisplay',
      uppercase: true,
      top: 477,
      font: 'luckiest',
      size: 183,
      minSize: 70,
      maxWidth: 620,
      lineHeight: 1.1,
      color: '#ffffff',
      stroke: { width: 6, color: GREY },
      shadow: { x: 9, y: 9, color: GREY },
    },
    {
      id: 'turning_word',
      type: 'text',
      staticText: 'IS TURNING',
      top: 647,
      font: 'fredoka600',
      size: 64,
      lineHeight: 1.2,
      color: YELLOW,
      showWhen: 'ageWords',
    },
    {
      id: 'age_row',
      type: 'row',
      top: 716,
      gap: 18,
      maxWidth: 580,
      align: 'baseline',
      boxHeight: 77,
      showWhen: 'ageWords',
      children: [
        { id: 'age_words', type: 'text', bind: 'ageWords', uppercase: true, top: 0, font: 'fredoka600', size: 64, minSize: 34, lineHeight: 1.2, color: YELLOW },
        { id: 'years_old', type: 'text', bind: 'yearsOld', uppercase: true, top: 0, font: 'fredoka600', size: 64, minSize: 34, lineHeight: 1.2, color: YELLOW },
      ],
    },
    {
      id: 'party_no_age',
      type: 'text',
      staticText: 'IS HAVING A PARTY!',
      top: 682,
      font: 'fredoka600',
      size: 64,
      minSize: 34,
      maxWidth: 580,
      lineHeight: 1.2,
      color: YELLOW,
      showWhen: '!ageWords',
    },
    {
      id: 'date_weekday',
      type: 'text',
      bind: 'weekdayText',
      uppercase: true,
      top: 832,
      font: 'poppins400',
      size: 34,
      minSize: 22,
      maxWidth: 500,
      lineHeight: 1.4,
      letterSpacingEm: 0.1,
      color: GREY,
      showWhen: 'dayText',
    },
    {
      id: 'date_row',
      type: 'row',
      top: 855,
      gap: 40,
      maxWidth: 680,
      align: 'center',
      boxHeight: 140,
      showWhen: 'dayText',
      children: [
        { id: 'date_month', type: 'text', bind: 'monthText', uppercase: true, top: 0, font: 'poppins400', size: 46, minSize: 22, lineHeight: 1.4, letterSpacingEm: 0.04, color: GREY },
        { id: 'date_day', type: 'text', bind: 'dayText', top: 0, font: 'poppins400', size: 100, minSize: 48, lineHeight: 1.4, color: GREY },
        { id: 'date_time', type: 'text', bind: 'timeText', uppercase: true, top: 0, font: 'poppins400', size: 36, minSize: 18, lineHeight: 1.4, color: GREY, showWhen: 'timeText' },
      ],
    },
    {
      // A preview has no date pieces: "Pick your date" where the row would be.
      id: 'date_line',
      type: 'text',
      bind: 'dateLine',
      uppercase: true,
      top: 897,
      font: 'poppins400',
      size: 40,
      minSize: 22,
      maxWidth: 680,
      lineHeight: 1.4,
      letterSpacingEm: 0.04,
      color: GREY,
      showWhen: '!dayText',
    },
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      uppercase: true,
      top: 1012,
      font: 'poppins600',
      size: 34,
      minSize: 18,
      maxWidth: 640,
      lineHeight: 1.4,
      color: GREY,
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      uppercase: true,
      top: 1080,
      font: 'poppins400',
      size: 30,
      minSize: 18,
      maxWidth: 570,
      lineHeight: 1.4,
      letterSpacingEm: 0.03,
      color: GREY,
      showWhen: 'hostContactLine',
    },
  ],
  ogCard: {
    portraitHeight: 560,
    radius: 14,
    titleFont: 'luckiest',
    titleSize: 74,
    titleColor: '#ffffff',
    glow: { stops: [{ color: '#ffffff', radius: 4 }] },
    ctaText: 'Tap to RSVP',
    ctaBg: YELLOW,
    ctaColor: '#2b2b2b',
    titleStroke: { width: 3, color: GREY },
    titleShadow: { x: 4, y: 4, color: GREY },
    textColor: '#3d3d3d',
    hostColor: '#9a7412',
    backdrop: 'linear-gradient(135deg, #fff3cc 0%, #ffffff 55%, #ececec 100%)',
    portraitShadow: '0 10px 30px #57575755',
  },
}
