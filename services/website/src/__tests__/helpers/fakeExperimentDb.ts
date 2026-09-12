/**
 * Table specs for Phase 5's A/B tables, on top of `fakeReminderDb`'s engine.
 *
 * The ENGINE is imported, not copied. `makeFakeDb` already models column types
 * (uuid answering 22P02 on a non-uuid), CHECK constraints (23514), unique and
 * partial-unique indexes (23505), `update … where` returning only the rows it
 * really updated, and `.eq()` being case-SENSITIVE while `.ilike()` is not.
 * Writing a second fake would be a second implementation of the one thing these
 * tests exist to be honest about — and the reason the reminder engine shipped
 * dead with a green suite is that its mock was
 * `insert = jest.fn(() => ({ error: null }))`, which could not disagree with
 * anything (hard-won rule 8, third form).
 *
 * Every constraint below is copied from `starting_plan/migration_045_content_experiments.sql`
 * and re-read out of `pg_constraint` / `pg_indexes` in production on 2026-09-12.
 */

import { makeFakeDb, type TableSpec, type FakeDb } from './fakeReminderDb'

export function contentExperimentsSpec(): TableSpec {
  return {
    columns: {
      id: 'uuid',
      name: 'text',
      surface: 'text',
      target_key: 'text',
      metric: 'text',
      min_per_arm: 'int',
      alpha: 'text', // numeric; the engine has no numeric type and int would reject 0.05
      hypothesis: 'text',
      status: 'text',
      outcome: 'text',
      outcome_note: 'text',
      winning_variant: 'uuid',
      concluded_at: 'timestamptz',
      created_by: 'text',
      activated_by: 'text',
      activated_at: 'timestamptz',
      created_at: 'timestamptz',
      updated_at: 'timestamptz',
    },
    // `status` DEFAULTS to 'draft' — the safety property, modelled as a default
    // so a test that omits it proves the default and not the writer.
    defaults: { status: 'draft', metric: 'clicked', min_per_arm: 30, alpha: 0.05 },
    checks: [
      { name: 'content_experiments_surface_check', column: 'surface', allowed: ['sequence_step', 'campaign_subject'] },
      { name: 'content_experiments_metric_check', column: 'metric', allowed: ['clicked', 'converted', 'replied'] },
      {
        name: 'content_experiments_status_check',
        column: 'status',
        allowed: ['draft', 'active', 'paused', 'concluded', 'archived'],
      },
      {
        name: 'content_experiments_outcome_check',
        column: 'outcome',
        allowed: ['winner', 'no_difference', 'not_enough_data', 'unavailable'],
      },
    ],
    uniques: [{ name: 'idx_content_experiments_name_uniq', columns: ['name'] }],
  }
}

export function contentVariantsSpec(): TableSpec {
  return {
    columns: {
      id: 'uuid',
      experiment_id: 'uuid',
      label: 'text',
      is_control: 'bool',
      subject: 'text',
      body_html: 'text',
      body_text: 'text',
      screen_notes: 'text',
      generation_meta: 'text',
      created_by: 'text',
      created_at: 'timestamptz',
    },
    defaults: { is_control: false, screen_notes: [] },
    uniques: [
      { name: 'idx_content_variants_label_uniq', columns: ['experiment_id', 'label'] },
      // Partial: at most one control per experiment.
      { name: 'idx_content_variants_one_control', columns: ['experiment_id'], where: r => r.is_control === true },
    ],
  }
}

export function variantAssignmentsSpec(): TableSpec {
  return {
    columns: {
      id: 'uuid',
      experiment_id: 'uuid',
      variant_id: 'uuid',
      contact_id: 'uuid',
      context: 'text',
      assigned_by: 'text',
      assigned_at: 'timestamptz',
    },
    // THE guarantee: one arm per person per experiment.
    uniques: [{ name: 'idx_variant_assignments_once', columns: ['experiment_id', 'contact_id'] }],
  }
}

export function variantEventsSpec(): TableSpec {
  return {
    columns: {
      id: 'uuid',
      assignment_id: 'uuid',
      event_type: 'text',
      detail: 'text',
      meta: 'text',
      occurred_at: 'timestamptz',
    },
    checks: [
      {
        name: 'variant_events_event_type_check',
        column: 'event_type',
        // NOTE the absence of 'opened'. See lib/experiments/types.ts.
        allowed: ['sent', 'clicked', 'replied', 'converted', 'unsubscribed', 'bounced'],
      },
    ],
    uniques: [{ name: 'idx_variant_events_once', columns: ['assignment_id', 'event_type'] }],
  }
}

export function unattributedSignalsSpec(): TableSpec {
  return {
    columns: { id: 'uuid', kind: 'text', reason: 'text', meta: 'text', created_at: 'timestamptz' },
  }
}

export function bookingsSpecForAttribution(): TableSpec {
  return {
    columns: { id: 'uuid', contact_id: 'uuid', created_at: 'timestamptz', status: 'text' },
  }
}

/** All five Phase 5 tables plus the bookings columns the attribution reads. */
export function makeExperimentDb(seed: Record<string, Record<string, any>[]> = {}): FakeDb {
  return makeFakeDb(
    {
      content_experiments: contentExperimentsSpec(),
      content_variants: contentVariantsSpec(),
      variant_assignments: variantAssignmentsSpec(),
      variant_events: variantEventsSpec(),
      unattributed_signals: unattributedSignalsSpec(),
      bookings: bookingsSpecForAttribution(),
    },
    seed
  )
}

/** A valid-looking uuid for a fixture. The engine really does reject non-uuids. */
export function uuid(n: number): string {
  return `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`
}
