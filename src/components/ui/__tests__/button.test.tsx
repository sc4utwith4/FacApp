import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Button } from '../button';
import { Loader2, Plus, ArrowRight } from 'lucide-react';

describe('Button Component', () => {
  describe('Rendering', () => {
    it('should render with default props', () => {
      render(<Button>Click me</Button>);
      
      const button = screen.getByRole('button', { name: /click me/i });
      expect(button).toBeInTheDocument();
      expect(button).toHaveClass('bg-primary', 'text-primary-foreground');
    });

    it('should render with different variants', () => {
      const { rerender } = render(<Button variant="secondary">Secondary</Button>);
      expect(screen.getByRole('button')).toHaveClass('bg-neutral-100', 'text-text');

      rerender(<Button variant="destructive">Destructive</Button>);
      expect(screen.getByRole('button')).toHaveClass('bg-destructive');

      rerender(<Button variant="ghost">Ghost</Button>);
      expect(screen.getByRole('button')).toHaveClass('hover:bg-neutral-50', 'text-text-secondary');

      rerender(<Button variant="outline">Outline</Button>);
      expect(screen.getByRole('button')).toHaveClass('border', 'border-border');
    });

    it('should render with different sizes', () => {
      const { rerender } = render(<Button size="sm">Small</Button>);
      expect(screen.getByRole('button')).toHaveClass('h-8', 'px-3', 'text-sm');

      rerender(<Button size="md">Medium</Button>);
      expect(screen.getByRole('button')).toHaveClass('h-9', 'px-4');

      rerender(<Button size="lg">Large</Button>);
      expect(screen.getByRole('button')).toHaveClass('h-10', 'px-6');
    });

    it('should render icon variants', () => {
      render(<Button size="icon"><Plus /></Button>);
      expect(screen.getByRole('button')).toHaveClass('size-9');
    });
  });

  describe('Loading State', () => {
    it('should show loading spinner when loading', () => {
      render(<Button loading>Loading</Button>);
      
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-disabled', 'true');
      
      // Check if Loader2 icon is present
      expect(button.querySelector('svg')).toBeInTheDocument();
    });

    it('should hide text content when loading', () => {
      render(<Button loading leftIcon={<Plus />}>Loading</Button>);
      
      const button = screen.getByRole('button');
      expect(button).toHaveTextContent('Loading');
      expect(button).not.toHaveTextContent('+'); // Plus icon should not be visible
    });
  });

  describe('Icon Support', () => {
    it('should render left icon', () => {
      render(<Button leftIcon={<Plus />}>Add Item</Button>);
      
      const button = screen.getByRole('button');
      const icon = button.querySelector('svg');
      expect(icon).toBeInTheDocument();
      expect(button).toHaveTextContent('Add Item');
    });

    it('should render right icon', () => {
      render(<Button rightIcon={<ArrowRight />}>Continue</Button>);
      
      const button = screen.getByRole('button');
      const icon = button.querySelector('svg');
      expect(icon).toBeInTheDocument();
      expect(button).toHaveTextContent('Continue');
    });

    it('should render both left and right icons', () => {
      render(
        <Button leftIcon={<Plus />} rightIcon={<ArrowRight />}>
          Add and Continue
        </Button>
      );
      
      const button = screen.getByRole('button');
      const icons = button.querySelectorAll('svg');
      expect(icons).toHaveLength(2);
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes when disabled', () => {
      render(<Button disabled>Disabled</Button>);
      
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-disabled', 'true');
    });

    it('should have proper ARIA attributes when loading', () => {
      render(<Button loading>Loading</Button>);
      
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-disabled', 'true');
    });

    it('should be focusable and keyboard accessible', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      
      render(<Button onClick={handleClick}>Clickable</Button>);
      
      const button = screen.getByRole('button');
      
      // Focus and press Enter
      await user.tab();
      expect(button).toHaveFocus();
      
      await user.keyboard('{Enter}');
      expect(handleClick).toHaveBeenCalledTimes(1);
      
      // Press Space
      await user.keyboard(' ');
      expect(handleClick).toHaveBeenCalledTimes(2);
    });
  });

  describe('Interactions', () => {
    it('should call onClick when clicked', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      
      render(<Button onClick={handleClick}>Click me</Button>);
      
      const button = screen.getByRole('button');
      await user.click(button);
      
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should not call onClick when disabled', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      
      render(<Button disabled onClick={handleClick}>Disabled</Button>);
      
      const button = screen.getByRole('button');
      await user.click(button);
      
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('should not call onClick when loading', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      
      render(<Button loading onClick={handleClick}>Loading</Button>);
      
      const button = screen.getByRole('button');
      await user.click(button);
      
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('should handle focus and blur events', async () => {
      const user = userEvent.setup();
      const handleFocus = vi.fn();
      const handleBlur = vi.fn();
      
      render(
        <Button onFocus={handleFocus} onBlur={handleBlur}>
          Focusable
        </Button>
      );
      
      const button = screen.getByRole('button');
      
      await user.click(button);
      expect(handleFocus).toHaveBeenCalledTimes(1);
      
      await user.tab();
      expect(handleBlur).toHaveBeenCalledTimes(1);
    });
  });

  describe('Custom Props', () => {
    it('should accept custom className', () => {
      render(<Button className="custom-class">Custom</Button>);
      
      const button = screen.getByRole('button');
      expect(button).toHaveClass('custom-class');
    });

    it('should accept custom data attributes', () => {
      render(<Button data-testid="custom-button">Custom</Button>);
      
      expect(screen.getByTestId('custom-button')).toBeInTheDocument();
    });

    it('should accept asChild prop', () => {
      render(
        <Button asChild>
          <a href="/test">Link Button</a>
        </Button>
      );
      
      const link = screen.getByRole('link');
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '/test');
    });
  });
});


