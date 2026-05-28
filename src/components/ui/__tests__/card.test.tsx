import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Card, CardHeader, CardContent, CardFooter, CardTitle, CardDescription } from '../card';

describe('Card Component', () => {
  describe('Basic Rendering', () => {
    it('should render with default props', () => {
      render(<Card>Card content</Card>);
      
      const card = screen.getByText('Card content').closest('div');
      expect(card).toBeInTheDocument();
      expect(card).toHaveClass('rounded-lg', 'border', 'bg-background');
    });

    it('should render with different variants', () => {
      const { rerender } = render(<Card variant="elevated">Elevated</Card>);
      expect(screen.getByText('Elevated').closest('div')).toHaveClass('shadow-sm', 'hover:shadow-md');

      rerender(<Card variant="muted">Muted</Card>);
      expect(screen.getByText('Muted').closest('div')).toHaveClass('border-transparent', 'bg-background-secondary');
    });

    it('should render as interactive when specified', () => {
      render(<Card interactive>Interactive Card</Card>);
      
      const card = screen.getByText('Interactive Card').closest('div');
      expect(card).toHaveClass('cursor-pointer', 'hover:shadow-md');
    });

    it('should render as selected when specified', () => {
      render(<Card selected>Selected Card</Card>);
      
      const card = screen.getByText('Selected Card').closest('div');
      expect(card).toHaveClass('border-primary', 'shadow-md');
    });
  });

  describe('Card Structure', () => {
    it('should render complete card structure', () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Card Title</CardTitle>
            <CardDescription>Card Description</CardDescription>
          </CardHeader>
          <CardContent>Card Content</CardContent>
          <CardFooter>Card Footer</CardFooter>
        </Card>
      );

      expect(screen.getByText('Card Title')).toBeInTheDocument();
      expect(screen.getByText('Card Description')).toBeInTheDocument();
      expect(screen.getByText('Card Content')).toBeInTheDocument();
      expect(screen.getByText('Card Footer')).toBeInTheDocument();
    });

    it('should apply correct classes to card parts', () => {
      render(
        <Card>
          <CardHeader className="custom-header">Header</CardHeader>
          <CardContent className="custom-content">Content</CardContent>
          <CardFooter className="custom-footer">Footer</CardFooter>
        </Card>
      );

      expect(screen.getByText('Header').closest('div')).toHaveClass('custom-header', 'px-6', 'py-4');
      expect(screen.getByText('Content')).toHaveClass('custom-content', 'px-6', 'py-5');
      expect(screen.getByText('Footer')).toHaveClass('custom-footer', 'p-6', 'pt-0');
    });
  });

  describe('Card Title and Description', () => {
    it('should render CardTitle with correct heading level', () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Test Title</CardTitle>
          </CardHeader>
        </Card>
      );

      const title = screen.getByRole('heading', { level: 3 });
      expect(title).toBeInTheDocument();
      expect(title).toHaveTextContent('Test Title');
      expect(title).toHaveClass('text-xl', 'font-semibold');
    });

    it('should render CardDescription with muted styling', () => {
      render(
        <Card>
          <CardHeader>
            <CardDescription>Test Description</CardDescription>
          </CardHeader>
        </Card>
      );

      const description = screen.getByText('Test Description');
      expect(description).toBeInTheDocument();
      expect(description).toHaveClass('text-sm', 'text-muted-foreground/80');
    });
  });

  describe('Interactive Behavior', () => {
    it('should handle click events when interactive', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      
      render(<Card interactive onClick={handleClick}>Clickable Card</Card>);
      
      const card = screen.getByText('Clickable Card').closest('div');
      await user.click(card!);
      
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should not handle click events when not interactive', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      
      render(<Card onClick={handleClick}>Non-interactive Card</Card>);
      
      const card = screen.getByText('Non-interactive Card').closest('div');
      await user.click(card!);
      
      // Click event should still fire, but cursor won't be pointer
      expect(handleClick).toHaveBeenCalledTimes(1);
      expect(card).not.toHaveClass('cursor-pointer');
    });

    it('should handle keyboard events when interactive', async () => {
      const user = userEvent.setup();
      const handleKeyDown = vi.fn();
      
      render(
        <Card 
          interactive 
          onKeyDown={handleKeyDown}
          tabIndex={0}
        >
          Keyboard Card
        </Card>
      );
      
      const card = screen.getByText('Keyboard Card').closest('div');
      card!.focus();
      
      await user.keyboard('{Enter}');
      expect(handleKeyDown).toHaveBeenCalledTimes(1);
    });
  });

  describe('Accessibility', () => {
    it('should be accessible with proper ARIA attributes', () => {
      render(
        <Card role="article" aria-label="Test Card">
          <CardHeader>
            <CardTitle>Accessible Card</CardTitle>
          </CardHeader>
          <CardContent>Card content for screen readers</CardContent>
        </Card>
      );

      const card = screen.getByRole('article');
      expect(card).toHaveAttribute('aria-label', 'Test Card');
      expect(card).toHaveAccessibleName('Test Card');
    });

    it('should have proper heading hierarchy', () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Main Title</CardTitle>
            <CardDescription>Subtitle</CardDescription>
          </CardHeader>
          <CardContent>
            <h4>Content Heading</h4>
          </CardContent>
        </Card>
      );

      const mainTitle = screen.getByRole('heading', { level: 3 });
      const contentHeading = screen.getByRole('heading', { level: 4 });
      
      expect(mainTitle).toHaveTextContent('Main Title');
      expect(contentHeading).toHaveTextContent('Content Heading');
    });
  });

  describe('Custom Props', () => {
    it('should accept custom className', () => {
      render(<Card className="custom-card">Custom Card</Card>);
      
      const card = screen.getByText('Custom Card').closest('div');
      expect(card).toHaveClass('custom-card');
    });

    it('should accept custom data attributes', () => {
      render(<Card data-testid="test-card">Test Card</Card>);
      
      expect(screen.getByTestId('test-card')).toBeInTheDocument();
    });

    it('should forward ref correctly', () => {
      const ref = vi.fn();
      
      render(<Card ref={ref}>Ref Card</Card>);
      
      expect(ref).toHaveBeenCalledWith(expect.any(HTMLDivElement));
    });
  });

  describe('State Combinations', () => {
    it('should handle interactive and selected states together', () => {
      render(<Card interactive selected>Interactive Selected</Card>);
      
      const card = screen.getByText('Interactive Selected').closest('div');
      expect(card).toHaveClass('cursor-pointer', 'border-primary', 'shadow-md');
    });

    it('should handle elevated variant with interactive state', () => {
      render(<Card variant="elevated" interactive>Elevated Interactive</Card>);
      
      const card = screen.getByText('Elevated Interactive').closest('div');
      expect(card).toHaveClass('shadow-sm', 'cursor-pointer', 'hover:shadow-md');
    });

    it('should handle muted variant with selected state', () => {
      render(<Card variant="muted" selected>Muted Selected</Card>);
      
      const card = screen.getByText('Muted Selected').closest('div');
      expect(card).toHaveClass('bg-background-secondary', 'border-primary', 'shadow-md');
    });
  });
});




