import { render, RenderOptions } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ 
        data: { user: { id: 'test-user', email: 'test@example.com' } } 
      }),
      signOut: vi.fn().mockResolvedValue({}),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ 
            data: { nome_completo: 'Test User' } 
          }),
        }),
      }),
    }),
  },
}));

// Mock react-router-dom
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/' }),
  };
});

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  initialEntries?: string[];
  queryClient?: QueryClient;
}

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

const AllTheProviders = ({ 
  children, 
  initialEntries = ['/'],
  queryClient = createTestQueryClient()
}: { 
  children: React.ReactNode;
  initialEntries?: string[];
  queryClient?: QueryClient;
}) => {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </BrowserRouter>
  );
};

const customRender = (
  ui: React.ReactElement,
  options: CustomRenderOptions = {}
) => {
  const { initialEntries, queryClient, ...renderOptions } = options;
  
  return render(ui, {
    wrapper: ({ children }) => (
      <AllTheProviders 
        initialEntries={initialEntries}
        queryClient={queryClient}
      >
        {children}
      </AllTheProviders>
    ),
    ...renderOptions,
  });
};

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

// Mock matchMedia
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

// Mock scrollTo
Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: () => {},
});

// Mock getComputedStyle
Object.defineProperty(window, 'getComputedStyle', {
  value: () => ({
    getPropertyValue: () => '',
  }),
});

export * from '@testing-library/react';
export { customRender as render };

// Helper functions for testing
export const createMockUser = () => ({
  id: 'test-user-id',
  email: 'test@example.com',
  nome_completo: 'Test User',
});

export const createMockMetric = (overrides = {}) => ({
  title: 'Test Metric',
  value: '100',
  change: { value: '+10%', type: 'increase' },
  icon: <span>📊</span>,
  ...overrides,
});

export const createMockActivity = (overrides = {}) => ({
  id: 'test-activity-1',
  message: 'Test activity message',
  timestamp: 'Há 1 hora',
  type: 'info' as const,
  ...overrides,
});

// Accessibility testing helpers
export const checkA11yViolations = (container: HTMLElement) => {
  // Check for missing alt text on images
  const images = container.querySelectorAll('img');
  images.forEach(img => {
    expect(img.getAttribute('alt')).toBeTruthy();
  });

  // Check for proper heading hierarchy
  const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
  let lastLevel = 0;
  headings.forEach(heading => {
    const level = parseInt(heading.tagName.charAt(1));
    expect(level).toBeGreaterThanOrEqual(lastLevel);
    expect(level - lastLevel).toBeLessThanOrEqual(1);
    lastLevel = level;
  });

  // Check for proper form labels
  const inputs = container.querySelectorAll('input, textarea, select');
  inputs.forEach(input => {
    const id = input.getAttribute('id');
    if (id) {
      const label = container.querySelector(`label[for="${id}"]`);
      const ariaLabel = input.getAttribute('aria-label');
      const ariaLabelledBy = input.getAttribute('aria-labelledby');
      
      expect(label || ariaLabel || ariaLabelledBy).toBeTruthy();
    }
  });

  // Check for proper button labels
  const buttons = container.querySelectorAll('button');
  buttons.forEach(button => {
    const ariaLabel = button.getAttribute('aria-label');
    const textContent = button.textContent?.trim();
    
    expect(ariaLabel || textContent).toBeTruthy();
  });
};

// Performance testing helpers
export const measureRenderTime = async (renderFn: () => void) => {
  const start = performance.now();
  renderFn();
  const end = performance.now();
  return end - start;
};

// Mock data generators
export const generateMockMetrics = (count: number) => 
  Array.from({ length: count }, (_, i) => createMockMetric({
    title: `Metric ${i + 1}`,
    value: `${(i + 1) * 100}`,
    change: { 
      value: `+${(i + 1) * 5}%`, 
      type: i % 2 === 0 ? 'increase' : 'decrease' 
    },
  }));

export const generateMockActivities = (count: number) =>
  Array.from({ length: count }, (_, i) => createMockActivity({
    id: `activity-${i + 1}`,
    message: `Activity message ${i + 1}`,
    timestamp: `Há ${i + 1} horas`,
    type: ['info', 'success', 'warning', 'error'][i % 4] as any,
  }));
























