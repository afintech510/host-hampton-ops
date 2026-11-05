/**
 * The launch switches, for tests. At launch the pay ladder and every dollar
 * figure are OFF (`CREW_PAY_LADDER`, `CREW_SHOW_PAY`), and `stepAfter` answers
 * "no change" for every event. A test of the step arithmetic, of a rate in
 * dollars, or of anything that depends on a step moving has to say so by using
 * LADDER_ON; a test of the launch behaviour uses DEFAULT_SETTINGS.
 */
import { DEFAULT_SETTINGS, type CrewSettings } from '@/lib/crew/rules'

export const LADDER_ON: CrewSettings = { ...DEFAULT_SETTINGS, ladderEnabled: true, payVisible: true }

/** Pay figures shown, ladder still off: the CREW_SHOW_PAY=true, CREW_PAY_LADDER=false middle. */
export const PAY_SHOWN_LADDER_OFF: CrewSettings = { ...DEFAULT_SETTINGS, ladderEnabled: false, payVisible: true }
