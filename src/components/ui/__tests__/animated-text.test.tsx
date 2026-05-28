import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAnimatedText } from '../animated-text';

describe('useAnimatedText', () => {
  it('renderiza e aceita mudança de texto sem erro', () => {
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => useAnimatedText(text, ''),
      { initialProps: { text: 'Conciliação' } }
    );

    expect(typeof result.current).toBe('string');
    expect(() => rerender({ text: 'Conciliação Bancária' })).not.toThrow();
    expect(typeof result.current).toBe('string');
  });
});

