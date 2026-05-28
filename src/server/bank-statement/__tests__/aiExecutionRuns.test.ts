import { describe, expect, it } from 'vitest';
import {
  resolveBankAiExecutionRunCountsUpdate,
  resolveBankAiExecutionRunStatusTransition,
} from '../aiExecutionRuns';

describe('resolveBankAiExecutionRunStatusTransition', () => {
  it('keeps failed as terminal-dominant against completed/no_pending', () => {
    expect(resolveBankAiExecutionRunStatusTransition('failed', 'completed')).toMatchObject({
      nextStatus: 'failed',
      ignoredRequestedStatus: 'completed',
      ignoredReason: 'failed_terminal_dominant',
    });
    expect(resolveBankAiExecutionRunStatusTransition('failed', 'no_pending')).toMatchObject({
      nextStatus: 'failed',
      ignoredRequestedStatus: 'no_pending',
      ignoredReason: 'failed_terminal_dominant',
    });
  });

  it('allows failed to override terminal statuses', () => {
    expect(resolveBankAiExecutionRunStatusTransition('completed', 'failed')).toMatchObject({
      nextStatus: 'failed',
      ignoredRequestedStatus: null,
    });
    expect(resolveBankAiExecutionRunStatusTransition('no_pending', 'failed')).toMatchObject({
      nextStatus: 'failed',
      ignoredRequestedStatus: null,
    });
  });

  it('does not reopen terminal completed/no_pending with processing/triggered', () => {
    expect(resolveBankAiExecutionRunStatusTransition('completed', 'processing')).toMatchObject({
      nextStatus: 'completed',
      ignoredRequestedStatus: 'processing',
      ignoredReason: 'terminal_status_locked',
    });
    expect(resolveBankAiExecutionRunStatusTransition('no_pending', 'triggered')).toMatchObject({
      nextStatus: 'no_pending',
      ignoredRequestedStatus: 'triggered',
      ignoredReason: 'terminal_status_locked',
    });
  });

  it('allows timeout to be corrected by later callbacks but blocks regression to triggered', () => {
    expect(resolveBankAiExecutionRunStatusTransition('timeout', 'processing')).toMatchObject({
      nextStatus: 'processing',
      ignoredRequestedStatus: null,
    });
    expect(resolveBankAiExecutionRunStatusTransition('timeout', 'completed')).toMatchObject({
      nextStatus: 'completed',
      ignoredRequestedStatus: null,
    });
    expect(resolveBankAiExecutionRunStatusTransition('timeout', 'triggered')).toMatchObject({
      nextStatus: 'timeout',
      ignoredRequestedStatus: 'triggered',
      ignoredReason: 'cannot_regress_to_triggered',
    });
  });
});

describe('resolveBankAiExecutionRunCountsUpdate', () => {
  it('does not let ignored terminal callbacks zero-out existing counts', () => {
    const result = resolveBankAiExecutionRunCountsUpdate({
      existing: {
        sugestoes_total: 7,
        match_existing_count: 3,
        create_new_count: 2,
        ignore_count: 1,
        needs_review_count: 1,
      },
      incoming: {
        sugestoes_total: 0,
        match_existing_count: 0,
        create_new_count: 0,
        ignore_count: 0,
        needs_review_count: 0,
      },
      ignoredTerminalTransition: true,
    });

    expect(result).toEqual({
      sugestoes_total: 7,
      match_existing_count: 3,
      create_new_count: 2,
      ignore_count: 1,
      needs_review_count: 1,
    });
  });

  it('allows ignored terminal callbacks to improve counts using max merge', () => {
    const result = resolveBankAiExecutionRunCountsUpdate({
      existing: {
        sugestoes_total: 4,
        match_existing_count: 1,
        create_new_count: 1,
        ignore_count: 1,
        needs_review_count: 1,
      },
      incoming: {
        sugestoes_total: 6,
        match_existing_count: 2,
        create_new_count: 1,
        ignore_count: 1,
        needs_review_count: 2,
      },
      ignoredTerminalTransition: true,
    });

    expect(result).toEqual({
      sugestoes_total: 6,
      match_existing_count: 2,
      create_new_count: 1,
      ignore_count: 1,
      needs_review_count: 2,
    });
  });
});
