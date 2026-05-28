import { describe, expect, it } from 'vitest';
import { resolveRunDailyStatefulReroute } from '../orchestrator';

describe('resolveRunDailyStatefulReroute', () => {
  it('keeps preview flow when no plan exists even if state says processing/timeout', () => {
    const decision = resolveRunDailyStatefulReroute({
      shouldApplyStatefulReroute: true,
      latestPlanTotal: 0,
      shouldTreatAsIaStillProcessing: true,
    });

    expect(decision).toBe('allow_preview');
  });

  it('reroutes to apply plan when there is a pending plan', () => {
    const decision = resolveRunDailyStatefulReroute({
      shouldApplyStatefulReroute: true,
      latestPlanTotal: 3,
      shouldTreatAsIaStillProcessing: true,
    });

    expect(decision).toBe('apply_reconciliation_plan');
  });
});

