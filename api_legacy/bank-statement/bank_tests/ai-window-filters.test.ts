import { describe, expect, it, vi } from 'vitest';
import { applyPendingSuggestionsWindowFilter } from '../ai/pending';
import { applySuggestionDedupeWindowFilter } from '../ai/suggest';

describe('ai pending/suggest execution window filters', () => {
  it('applies created_at gte on pending query only when sinceIso is provided', () => {
    const query = {
      gte: vi.fn(function gte() {
        return query;
      }),
    };

    const noWindowResult = applyPendingSuggestionsWindowFilter(query, null);
    expect(noWindowResult).toBe(query);
    expect(query.gte).not.toHaveBeenCalled();

    const withWindowResult = applyPendingSuggestionsWindowFilter(query, '2026-02-27T21:00:00.000Z');
    expect(withWindowResult).toBe(query);
    expect(query.gte).toHaveBeenCalledWith('created_at', '2026-02-27T21:00:00.000Z');
  });

  it('applies created_at gte on suggest dedupe query only when sinceIso is provided', () => {
    const query = {
      gte: vi.fn(function gte() {
        return query;
      }),
    };

    const noWindowResult = applySuggestionDedupeWindowFilter(query, null);
    expect(noWindowResult).toBe(query);
    expect(query.gte).not.toHaveBeenCalled();

    const withWindowResult = applySuggestionDedupeWindowFilter(query, '2026-02-27T21:05:00.000Z');
    expect(withWindowResult).toBe(query);
    expect(query.gte).toHaveBeenCalledWith('created_at', '2026-02-27T21:05:00.000Z');
  });
});
