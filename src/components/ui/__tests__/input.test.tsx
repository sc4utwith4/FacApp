import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Input } from '../input';
import { Search, Eye, EyeOff } from 'lucide-react';

describe('Input Component', () => {
  describe('Basic Rendering', () => {
    it('should render with default props', () => {
      render(<Input placeholder="Enter text" />);
      
      const input = screen.getByPlaceholderText('Enter text');
      expect(input).toBeInTheDocument();
      expect(input).toHaveClass('flex', 'h-9', 'w-full', 'rounded-md');
    });

    it('should render with label', () => {
      render(<Input label="Username" placeholder="Enter username" />);
      
      const label = screen.getByText('Username');
      const input = screen.getByLabelText('Username');
      
      expect(label).toBeInTheDocument();
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('id');
    });

    it('should show required asterisk when required', () => {
      render(<Input label="Required Field" required />);
      
      const asterisk = screen.getByText('*');
      expect(asterisk).toBeInTheDocument();
      expect(asterisk).toHaveClass('text-destructive');
    });
  });

  describe('Validation States', () => {
    it('should render with error state', () => {
      render(<Input error="This field is required" />);
      
      const input = screen.getByRole('textbox');
      const errorMessage = screen.getByText('This field is required');
      
      expect(input).toHaveClass('border-destructive', 'focus-visible:ring-destructive');
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(errorMessage).toBeInTheDocument();
      expect(errorMessage).toHaveClass('text-destructive');
    });

    it('should render helper text when no error', () => {
      render(<Input helperText="This is helpful information" />);
      
      const helperText = screen.getByText('This is helpful information');
      expect(helperText).toBeInTheDocument();
      expect(helperText).toHaveClass('text-muted-foreground');
    });

    it('should not show helper text when error is present', () => {
      render(
        <Input 
          error="This field is required"
          helperText="This should not show"
        />
      );
      
      expect(screen.getByText('This field is required')).toBeInTheDocument();
      expect(screen.queryByText('This should not show')).not.toBeInTheDocument();
    });

    it('should have proper ARIA attributes for validation', () => {
      render(
        <Input 
          label="Test Input"
          error="Error message"
          helperText="Helper text"
        />
      );
      
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAttribute('aria-describedby');
    });
  });

  describe('Icon Support', () => {
    it('should render with left icon', () => {
      render(<Input leftIcon={<Search />} placeholder="Search..." />);
      
      const input = screen.getByPlaceholderText('Search...');
      const icon = input.parentElement?.querySelector('svg');
      
      expect(input).toHaveClass('pl-10');
      expect(icon).toBeInTheDocument();
    });

    it('should render with right icon', () => {
      render(<Input rightIcon={<Search />} placeholder="Search..." />);
      
      const input = screen.getByPlaceholderText('Search...');
      const icon = input.parentElement?.querySelector('svg');
      
      expect(input).toHaveClass('pr-10');
      expect(icon).toBeInTheDocument();
    });

    it('should render with both left and right icons', () => {
      render(
        <Input 
          leftIcon={<Search />} 
          rightIcon={<Eye />}
          placeholder="Search..."
        />
      );
      
      const input = screen.getByPlaceholderText('Search...');
      const icons = input.parentElement?.querySelectorAll('svg');
      
      expect(input).toHaveClass('pl-10', 'pr-10');
      expect(icons).toHaveLength(2);
    });

    it('should show error icon when error is present', () => {
      render(<Input error="Error message" />);
      
      const input = screen.getByRole('textbox');
      const errorIcon = input.parentElement?.querySelector('svg');
      
      expect(errorIcon).toBeInTheDocument();
      expect(errorIcon).toHaveClass('text-destructive');
    });
  });

  describe('Input Types', () => {
    it('should render as password input', () => {
      render(<Input type="password" />);
      
      const input = screen.getByDisplayValue('');
      expect(input).toHaveAttribute('type', 'password');
    });

    it('should render as email input', () => {
      render(<Input type="email" />);
      
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('type', 'email');
    });

    it('should render as number input', () => {
      render(<Input type="number" />);
      
      const input = screen.getByRole('spinbutton');
      expect(input).toHaveAttribute('type', 'number');
    });
  });

  describe('User Interactions', () => {
    it('should handle input changes', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();
      
      render(<Input onChange={handleChange} />);
      
      const input = screen.getByRole('textbox');
      await user.type(input, 'Hello World');
      
      expect(input).toHaveValue('Hello World');
      expect(handleChange).toHaveBeenCalled();
    });

    it('should handle focus and blur events', async () => {
      const user = userEvent.setup();
      const handleFocus = vi.fn();
      const handleBlur = vi.fn();
      
      render(
        <Input 
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
      );
      
      const input = screen.getByRole('textbox');
      
      await user.click(input);
      expect(handleFocus).toHaveBeenCalledTimes(1);
      
      await user.tab();
      expect(handleBlur).toHaveBeenCalledTimes(1);
    });

    it('should be disabled when disabled prop is set', () => {
      render(<Input disabled />);
      
      const input = screen.getByRole('textbox');
      expect(input).toBeDisabled();
      expect(input).toHaveClass('disabled:cursor-not-allowed', 'disabled:opacity-50');
    });

    it('should not be editable when readOnly prop is set', () => {
      render(<Input readOnly />);
      
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('readOnly');
    });
  });

  describe('Accessibility', () => {
    it('should have proper label association', () => {
      render(<Input label="Username" id="username-input" />);
      
      const label = screen.getByText('Username');
      const input = screen.getByRole('textbox');
      
      expect(label).toHaveAttribute('for', 'username-input');
      expect(input).toHaveAttribute('id', 'username-input');
    });

    it('should generate unique IDs when not provided', () => {
      render(<Input label="Field 1" />);
      render(<Input label="Field 2" />);
      
      const input1 = screen.getByLabelText('Field 1');
      const input2 = screen.getByLabelText('Field 2');
      
      expect(input1).toHaveAttribute('id');
      expect(input2).toHaveAttribute('id');
      expect(input1.id).not.toBe(input2.id);
    });

    it('should have proper ARIA describedby for error and helper text', () => {
      render(
        <Input 
          label="Test Input"
          error="Error message"
          helperText="Helper text"
        />
      );
      
      const input = screen.getByRole('textbox');
      const describedBy = input.getAttribute('aria-describedby');
      
      expect(describedBy).toContain('error');
      expect(describedBy).toContain('helper');
    });

    it('should be keyboard accessible', async () => {
      const user = userEvent.setup();
      
      render(<Input />);
      
      const input = screen.getByRole('textbox');
      
      await user.tab();
      expect(input).toHaveFocus();
      
      await user.keyboard('Test input');
      expect(input).toHaveValue('Test input');
    });
  });

  describe('Custom Props', () => {
    it('should accept custom className', () => {
      render(<Input className="custom-input" />);
      
      const input = screen.getByRole('textbox');
      expect(input).toHaveClass('custom-input');
    });

    it('should accept custom data attributes', () => {
      render(<Input data-testid="custom-input" />);
      
      expect(screen.getByTestId('custom-input')).toBeInTheDocument();
    });

    it('should forward ref correctly', () => {
      const ref = vi.fn();
      
      render(<Input ref={ref} />);
      
      expect(ref).toHaveBeenCalledWith(expect.any(HTMLInputElement));
    });

    it('should accept all standard input props', () => {
      render(
        <Input 
          placeholder="Enter text"
          maxLength={10}
          autoComplete="username"
          autoFocus
        />
      );
      
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('placeholder', 'Enter text');
      expect(input).toHaveAttribute('maxLength', '10');
      expect(input).toHaveAttribute('autocomplete', 'username');
      expect(input).toHaveFocus();
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle error state with icons', () => {
      render(
        <Input 
          leftIcon={<Search />}
          error="Search failed"
          placeholder="Search..."
        />
      );
      
      const input = screen.getByPlaceholderText('Search...');
      const errorIcon = input.parentElement?.querySelector('svg.text-destructive');
      
      expect(input).toHaveClass('pl-10', 'border-destructive');
      expect(errorIcon).toHaveClass('text-destructive');
      expect(screen.getByText('Search failed')).toBeInTheDocument();
    });

    it('should handle all states together', () => {
      render(
        <Input 
          label="Complex Input"
          leftIcon={<Search />}
          rightIcon={<Eye />}
          error="Error message"
          helperText="Helper text"
          required
        />
      );
      
      const input = screen.getByRole('textbox');
      
      expect(input).toHaveClass('pl-10', 'pr-10', 'border-destructive');
      expect(screen.getByText('Complex Input')).toBeInTheDocument();
      expect(screen.getByText('*')).toBeInTheDocument();
      expect(screen.getByText('Error message')).toBeInTheDocument();
      expect(screen.queryByText('Helper text')).not.toBeInTheDocument();
    });
  });
});




