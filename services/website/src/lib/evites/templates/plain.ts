/**
 * The `plain` template (spec §6): `glow` minus the `icon_strip` slot. Same art,
 * same fonts, same positions; the theme word comes from the facts, so a theme
 * with no artwork of its own ("SWEETS PARTY") still gets a finished invitation.
 */

import { GLOW_TEMPLATE } from '@/lib/evites/templates/glow'
import type { TemplateLayout } from '@/lib/evites/templates/types'

export const PLAIN_TEMPLATE: TemplateLayout = {
  ...GLOW_TEMPLATE,
  slug: 'plain',
  slots: GLOW_TEMPLATE.slots.filter((s) => s.id !== 'icon_strip'),
}
