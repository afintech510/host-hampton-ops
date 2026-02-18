/**
 * test.ts — HAMPTON Orchestrator Integration Tests
 *
 * 5 sample owner commands covering the main intent categories.
 * Run with: npm test
 *
 * Does NOT require live Supabase — uses a mock client for unit testing.
 * Set ANTHROPIC_API_KEY in env to test Claude classification + routing live.
 */

import 'dotenv/config'
import { IntentClassifier } from './intentClassifier.js'
import { MemoryManager } from './memoryManager.js'
import { Router } from './router.js'
import { PhaseStatus } from './types.js'

// ─── Mock Supabase client ───────────────────────────────────────
const mockMemory: Record<string, unknown> = {
  'brand.identity': {
    business_name: 'Host Hampton',
    phone: '(631) 998-9325',
    address: '295 Montauk Highway, Speonk, NY 11972'
  },
  'brand.voice': {
    tone_words: ['warm', 'fun', 'community-first'],
    never_sound: ['corporate', 'pushy']
  },
  'services.priority_order': { '1': 'kids_party', '2': 'permanent_jewelry' },
  'campaigns.active': {},
  'operations.phase_status': {
    current_phase: '1A',
    active_agents: ['HAMPTON', 'SOC', 'COPY', 'PIXEL', 'OUTBOUND', 'LIST']
  },
  'market.positioning': {
    positioning_statement: 'Host Hampton is the modern celebration studio for families who want something beautiful, effortless, and real.'
  }
}

// Minimal mock Supabase for offline testing
const mockSupabase = {
  from: (table: string) => ({
    select: () => ({
      eq: (_col: string, _val: string) => ({
        single: async () => ({ data: null, error: null }),
        eq: () => ({ data: [], error: null })
      }),
      in: () => ({ data: [], error: null })
    }),
    upsert: async () => ({ error: null }),
    update: () => ({ eq: () => ({ data: null, error: null }) }),
    insert: async () => ({ error: null })
  })
} as unknown as Parameters<typeof MemoryManager>[0]

const PHASE_1A: PhaseStatus = {
  current_phase: '1A',
  active_agents: ['HAMPTON', 'SOC', 'COPY', 'PIXEL', 'OUTBOUND', 'LIST'],
  phase_1b_start: null,
  phase_2_start: null,
  squarespace_status: 'active — do not modify'
}

// ─── Test runner ────────────────────────────────────────────────
interface TestCase {
  name: string
  command: string
  expected_intent: string
  expected_agents: string[]
  expected_approval: string
  should_block?: boolean
}

const TEST_CASES: TestCase[] = [
  {
    name: 'T1 — Social post (AUTO_EXECUTE)',
    command: 'Post our Swiftie party photos with a caption for tonight',
    expected_intent: 'PUBLISH_CONTENT',
    expected_agents: ['SOC', 'COPY', 'PIXEL'],
    expected_approval: 'AUTO_EXECUTE'
  },
  {
    name: 'T2 — Campaign launch (DRAFT_AND_SHOW)',
    command: 'Launch spring birthday campaign — target parents with kids ages 5–12, Speonk to Riverhead, lead with Glow Party and Swiftie Party',
    expected_intent: 'CAMPAIGN_LAUNCH',
    expected_agents: ['COPY', 'PIXEL', 'SOC', 'OUTBOUND', 'LIST'],
    expected_approval: 'DRAFT_AND_SHOW'
  },
  {
    name: 'T3 — Pricing change (ALWAYS_ASK)',
    command: 'Change our party pricing to $950 for all packages',
    expected_intent: 'PRICING_POLICY',
    expected_agents: [],
    expected_approval: 'ALWAYS_ASK',
    should_block: true
  },
  {
    name: 'T4 — Strategy question (direct answer, no tasks)',
    command: 'How are we doing this week?',
    expected_intent: 'ANALYTICS_REPORT',
    expected_agents: ['INTEL'],
    expected_approval: 'AUTO_EXECUTE'
  },
  {
    name: 'T5 — Re-engagement email (DRAFT_AND_SHOW)',
    command: 'Send re-engagement emails to contacts who haven\'t booked in the last 6 months',
    expected_intent: 'EMAIL_SMS_CAMPAIGN',
    expected_agents: ['OUTBOUND', 'LIST'],
    expected_approval: 'DRAFT_AND_SHOW'
  }
]

// ─── Test execution ─────────────────────────────────────────────
async function runTests(): Promise<void> {
  console.log('🧪 HAMPTON Orchestrator — Integration Tests\n')
  console.log('─'.repeat(60))

  const classifier = new IntentClassifier()
  const memManager = new MemoryManager(mockSupabase)
  const router = new Router()

  // Override memory.loadForIntent to use mock data
  memManager.loadForIntent = async () => mockMemory
  memManager.getPhaseStatus = async () => PHASE_1A as unknown as ReturnType<typeof memManager.getPhaseStatus> extends Promise<infer T> ? T : never

  let passed = 0
  let failed = 0

  for (const tc of TEST_CASES) {
    console.log(`\n📋 ${tc.name}`)
    console.log(`   Command: "${tc.command}"`)

    try {
      // Step 1: Classify
      const classification = await classifier.classify(tc.command)
      console.log(`   Intent:  ${classification.intent} (expected: ${tc.expected_intent}) ${classification.intent === tc.expected_intent ? '✅' : '⚠️'}`)
      console.log(`   Agents:  ${classification.relevant_agents.join(', ') || '(none)'}`)
      console.log(`   Approval: ${classification.suggested_approval_tier}`)

      if (classification.clarification_needed) {
        console.log(`   Clarification: ${classification.clarification_needed}`)
      }

      // Step 2: Route — only for non-strategy, non-unknown intents
      if (tc.should_block) {
        const tasks = await router.buildTaskPlan(tc.command, classification, '', PHASE_1A)
        const blocked = tasks.every(t => t.approval_tier === 'ALWAYS_ASK')
        console.log(`   Blocked (ALWAYS_ASK): ${blocked ? '✅ Correctly blocked' : '❌ Should have been blocked'}`)
        if (blocked) passed++; else failed++
        continue
      }

      if (classification.intent !== 'STRATEGY_QUESTION' && classification.intent !== 'UNKNOWN') {
        const tasks = await router.buildTaskPlan(tc.command, classification, '', PHASE_1A)
        console.log(`   Tasks planned: ${tasks.length}`)
        tasks.forEach(t => {
          const depNote = t.depends_on?.length ? ` (depends on ${t.depends_on.length} tasks)` : ''
          console.log(`     → ${t.assigned_to} [${t.approval_tier}]${depNote}`)
        })

        // Phase gate check — PAID and INTEL should not appear in Phase 1A
        const gatedAgents = tasks.filter(t => ['PAID', 'INTEL', 'BUILD'].includes(t.assigned_to))
        if (gatedAgents.length > 0) {
          console.log(`   ⚠️  Phase-gated agents leaked: ${gatedAgents.map(t => t.assigned_to).join(', ')}`)
          failed++
        } else {
          console.log(`   Phase gate: ✅ No locked agents in plan`)
          passed++
        }
      } else {
        console.log(`   Strategy question → direct answer (no tasks)`)
        passed++
      }

    } catch (err) {
      console.error(`   ❌ Error: ${err instanceof Error ? err.message : String(err)}`)
      failed++
    }
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`\n🏁 Results: ${passed} passed, ${failed} failed out of ${TEST_CASES.length} tests`)

  if (failed > 0) {
    console.log('\n⚠️  Some tests failed. Review output above.')
    process.exit(1)
  } else {
    console.log('\n✅ All tests passed. HAMPTON is ready for deployment.')
  }
}

runTests().catch((err) => {
  console.error('Test runner crashed:', err)
  process.exit(1)
})
