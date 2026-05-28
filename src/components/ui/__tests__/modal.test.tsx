import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  Modal, 
  ModalContent, 
  ModalHeader, 
  ModalTitle, 
  ModalFooter, 
  ModalCloseButton 
} from '../modal';
import { Button } from '../button';

// Mock createPortal
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (children: React.ReactNode) => children,
  };
});

describe('Modal Component', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    children: <ModalContent>Modal content</ModalContent>,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Reset body overflow
    document.body.style.overflow = 'unset';
  });

  describe('Basic Rendering', () => {
    it('should render when open', () => {
      render(<Modal {...defaultProps} />);
      
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Modal content')).toBeInTheDocument();
    });

    it('should not render when closed', () => {
      render(<Modal {...defaultProps} open={false} />);
      
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should render with different sizes', () => {
      const { rerender } = render(<Modal {...defaultProps} size="sm" />);
      expect(screen.getByRole('dialog')).toHaveClass('max-w-sm');

      rerender(<Modal {...defaultProps} size="md" />);
      expect(screen.getByRole('dialog')).toHaveClass('max-w-md');

      rerender(<Modal {...defaultProps} size="lg" />);
      expect(screen.getByRole('dialog')).toHaveClass('max-w-lg');

      rerender(<Modal {...defaultProps} size="xl" />);
      expect(screen.getByRole('dialog')).toHaveClass('max-w-xl');
    });
  });

  describe('Modal Structure', () => {
    it('should render complete modal structure', () => {
      render(
        <Modal {...defaultProps}>
          <ModalHeader>
            <ModalTitle>Modal Title</ModalTitle>
            <ModalCloseButton onClose={() => defaultProps.onOpenChange(false)} />
          </ModalHeader>
          <ModalContent>Modal Content</ModalContent>
          <ModalFooter>
            <Button>Save</Button>
          </ModalFooter>
        </Modal>
      );

      expect(screen.getByText('Modal Title')).toBeInTheDocument();
      expect(screen.getByText('Modal Content')).toBeInTheDocument();
      expect(screen.getByText('Save')).toBeInTheDocument();
    });

    it('should apply correct classes to modal parts', () => {
      render(
        <Modal {...defaultProps}>
          <ModalHeader className="custom-header">
            <ModalTitle>Title</ModalTitle>
          </ModalHeader>
          <ModalContent className="custom-content">Content</ModalContent>
          <ModalFooter className="custom-footer">Footer</ModalFooter>
        </Modal>
      );

      const header = screen.getByText('Title').closest('div');
      expect(header).toHaveClass('custom-header');
      expect(screen.getByText('Content')).toHaveClass('custom-content');
      expect(screen.getByText('Footer')).toHaveClass('custom-footer');
    });
  });

  describe('Modal Interactions', () => {
    it('should close when backdrop is clicked', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      
      render(<Modal open={true} onOpenChange={onOpenChange}>Content</Modal>);
      
      const backdrop = screen.getByRole('dialog').parentElement?.firstChild;
      await user.click(backdrop as Element);
      
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('should close when escape key is pressed', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      
      render(<Modal open={true} onOpenChange={onOpenChange}>Content</Modal>);
      
      await user.keyboard('{Escape}');
      
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('should close when close button is clicked', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      
      render(
        <Modal open={true} onOpenChange={onOpenChange}>
          <ModalHeader>
            <ModalTitle>Title</ModalTitle>
            <ModalCloseButton onClose={() => onOpenChange(false)} />
          </ModalHeader>
        </Modal>
      );
      
      const closeButton = screen.getByLabelText('Fechar modal');
      await user.click(closeButton);
      
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('should not close when modal content is clicked', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      
      render(<Modal open={true} onOpenChange={onOpenChange}>Content</Modal>);
      
      const modal = screen.getByRole('dialog');
      await user.click(modal);
      
      expect(onOpenChange).not.toHaveBeenCalled();
    });
  });

  describe('Focus Management', () => {
    it('should trap focus within modal', async () => {
      const user = userEvent.setup();
      
      render(
        <Modal open={true} onOpenChange={vi.fn()}>
          <ModalContent>
            <Button>First Button</Button>
            <Button>Second Button</Button>
            <Button>Third Button</Button>
          </ModalContent>
        </Modal>
      );
      
      const firstButton = screen.getByText('First Button');
      const secondButton = screen.getByText('Second Button');
      const thirdButton = screen.getByText('Third Button');
      
      // First button should be focused initially
      await waitFor(() => {
        expect(firstButton).toHaveFocus();
      });
      
      // Tab should move to second button
      await user.tab();
      expect(secondButton).toHaveFocus();
      
      // Tab should move to third button
      await user.tab();
      expect(thirdButton).toHaveFocus();
      
      // Tab should wrap back to first button
      await user.tab();
      expect(firstButton).toHaveFocus();
      
      // Shift+Tab should move backwards
      await user.keyboard('{Shift>}{Tab}{/Shift}');
      expect(thirdButton).toHaveFocus();
    });

    it('should restore focus when modal closes', async () => {
      const user = userEvent.setup();
      
      render(
        <div>
          <Button>Trigger Button</Button>
          <Modal open={true} onOpenChange={vi.fn()}>
            <ModalContent>
              <Button>Modal Button</Button>
            </ModalContent>
          </Modal>
        </div>
      );
      
      const triggerButton = screen.getByText('Trigger Button');
      triggerButton.focus();
      
      expect(triggerButton).toHaveFocus();
    });
  });

  describe('Body Scroll Lock', () => {
    it('should prevent body scroll when modal is open', () => {
      render(<Modal open={true} onOpenChange={vi.fn()}>Content</Modal>);
      
      expect(document.body.style.overflow).toBe('hidden');
    });

    it('should restore body scroll when modal is closed', () => {
      const { rerender } = render(<Modal open={true} onOpenChange={vi.fn()}>Content</Modal>);
      
      expect(document.body.style.overflow).toBe('hidden');
      
      rerender(<Modal open={false} onOpenChange={vi.fn()}>Content</Modal>);
      
      expect(document.body.style.overflow).toBe('unset');
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes', () => {
      render(<Modal open={true} onOpenChange={vi.fn()}>Content</Modal>);
      
      const modal = screen.getByRole('dialog');
      expect(modal).toHaveAttribute('aria-modal', 'true');
    });

    it('should have accessible title', () => {
      render(
        <Modal open={true} onOpenChange={vi.fn()}>
          <ModalHeader>
            <ModalTitle>Accessible Title</ModalTitle>
          </ModalHeader>
          <ModalContent>Content</ModalContent>
        </Modal>
      );
      
      const modal = screen.getByRole('dialog');
      const title = screen.getByText('Accessible Title');
      
      expect(title).toBeInTheDocument();
      expect(modal).toHaveAccessibleName('Accessible Title');
    });

    it('should announce modal to screen readers', () => {
      render(
        <Modal open={true} onOpenChange={vi.fn()}>
          <ModalContent>
            <p>Important modal content</p>
          </ModalContent>
        </Modal>
      );
      
      const modal = screen.getByRole('dialog');
      expect(modal).toBeInTheDocument();
    });
  });

  describe('Custom Props', () => {
    it('should accept custom className', () => {
      render(<Modal {...defaultProps} className="custom-modal">Content</Modal>);
      
      const modal = screen.getByRole('dialog');
      expect(modal).toHaveClass('custom-modal');
    });

    it('should accept custom data attributes', () => {
      render(<Modal {...defaultProps} data-testid="custom-modal">Content</Modal>);
      
      expect(screen.getByTestId('custom-modal')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid open/close cycles', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      
      const { rerender } = render(<Modal open={false} onOpenChange={onOpenChange}>Content</Modal>);
      
      // Rapidly open and close
      rerender(<Modal open={true} onOpenChange={onOpenChange}>Content</Modal>);
      rerender(<Modal open={false} onOpenChange={onOpenChange}>Content</Modal>);
      rerender(<Modal open={true} onOpenChange={onOpenChange}>Content</Modal>);
      
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should handle modal without content', () => {
      render(<Modal open={true} onOpenChange={vi.fn()} />);
      
      const modal = screen.getByRole('dialog');
      expect(modal).toBeInTheDocument();
    });

    it('should handle multiple modals (only one should be rendered)', () => {
      render(
        <div>
          <Modal open={true} onOpenChange={vi.fn()}>First Modal</Modal>
          <Modal open={false} onOpenChange={vi.fn()}>Second Modal</Modal>
        </div>
      );
      
      expect(screen.getByText('First Modal')).toBeInTheDocument();
      expect(screen.queryByText('Second Modal')).not.toBeInTheDocument();
    });
  });

  describe('Integration Tests', () => {
    it('should work with form elements', async () => {
      const user = userEvent.setup();
      const handleSubmit = vi.fn();
      
      render(
        <Modal open={true} onOpenChange={vi.fn()}>
          <form onSubmit={handleSubmit}>
            <ModalHeader>
              <ModalTitle>Form Modal</ModalTitle>
            </ModalHeader>
            <ModalContent>
              <input type="text" placeholder="Enter name" />
            </ModalContent>
            <ModalFooter>
              <Button type="submit">Submit</Button>
            </ModalFooter>
          </form>
        </Modal>
      );
      
      const input = screen.getByPlaceholderText('Enter name');
      const form = screen.getByRole('dialog').querySelector('form');
      
      await user.type(input, 'John Doe');
      expect(form).toBeInstanceOf(HTMLFormElement);

      fireEvent.submit(form as HTMLFormElement);
      
      expect(handleSubmit).toHaveBeenCalled();
    });

    it('should handle keyboard navigation in complex content', async () => {
      const user = userEvent.setup();
      
      render(
        <Modal open={true} onOpenChange={vi.fn()}>
          <ModalContent>
            <input type="text" placeholder="Input 1" />
            <Button>Button 1</Button>
            <input type="text" placeholder="Input 2" />
            <Button>Button 2</Button>
          </ModalContent>
        </Modal>
      );
      
      const input1 = screen.getByPlaceholderText('Input 1');
      const button1 = screen.getByText('Button 1');
      const input2 = screen.getByPlaceholderText('Input 2');
      const button2 = screen.getByText('Button 2');
      
      // Focus should start on first focusable element
      await waitFor(() => {
        expect(input1).toHaveFocus();
      });
      
      // Tab through all elements
      await user.tab();
      expect(button1).toHaveFocus();
      
      await user.tab();
      expect(input2).toHaveFocus();
      
      await user.tab();
      expect(button2).toHaveFocus();
      
      // Tab should wrap to beginning
      await user.tab();
      expect(input1).toHaveFocus();
    });
  });
});



