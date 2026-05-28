import '@testing-library/jest-dom';
import { expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
};

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
};

// Mock matchMedia / scrollTo (jsdom only — testes @vitest-environment node não têm window)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });

  Object.defineProperty(window, 'scrollTo', {
    writable: true,
    value: () => {},
  });
}

const originalConsoleWarn = console.warn;
const originalRequestSubmit =
  typeof HTMLFormElement !== 'undefined' ? HTMLFormElement.prototype.requestSubmit : undefined;

beforeAll(() => {
  if (typeof HTMLFormElement === 'undefined') {
    return;
  }
  Object.defineProperty(HTMLFormElement.prototype, 'requestSubmit', {
    configurable: true,
    value: function requestSubmitPolyfill(submitter?: HTMLElement) {
      if (submitter) {
        submitter.click();
        return;
      }

      this.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    },
  });

  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    const message = args.map((arg) => String(arg)).join(' ');
    if (message.includes('React Router Future Flag Warning')) {
      return;
    }

    originalConsoleWarn(...(args as Parameters<typeof console.warn>));
  });
});

afterAll(() => {
  const warnMock = console.warn as unknown as { mockRestore?: () => void };
  warnMock.mockRestore?.();

  if (typeof HTMLFormElement !== 'undefined' && originalRequestSubmit) {
    Object.defineProperty(HTMLFormElement.prototype, 'requestSubmit', {
      configurable: true,
      value: originalRequestSubmit,
    });
  }
});



