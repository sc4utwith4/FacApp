import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PromptInput } from '../prompt-input';

function PromptInputHarness({ onSubmit }: { onSubmit: () => void }) {
  const [value, setValue] = useState('');

  return (
    <PromptInput value={value} onValueChange={setValue} onSubmit={onSubmit}>
      <PromptInput.Textarea placeholder="Mensagem" />
      <PromptInput.Actions>
        <button type="button">Enviar</button>
      </PromptInput.Actions>
    </PromptInput>
  );
}

describe('PromptInput', () => {
  it('dispara submit ao pressionar Enter sem Shift', () => {
    const onSubmit = vi.fn();
    render(<PromptInputHarness onSubmit={onSubmit} />);

    const textarea = screen.getByPlaceholderText('Mensagem');
    fireEvent.change(textarea, { target: { value: 'rodar matching' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('não dispara submit com Shift+Enter', () => {
    const onSubmit = vi.fn();
    render(<PromptInputHarness onSubmit={onSubmit} />);

    const textarea = screen.getByPlaceholderText('Mensagem');
    fireEvent.change(textarea, { target: { value: 'linha 1' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('dispara submit com Ctrl+Enter', () => {
    const onSubmit = vi.fn();
    render(<PromptInputHarness onSubmit={onSubmit} />);

    const textarea = screen.getByPlaceholderText('Mensagem');
    fireEvent.change(textarea, { target: { value: 'disparar IA' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('limpa o campo com Escape', () => {
    const onSubmit = vi.fn();
    render(<PromptInputHarness onSubmit={onSubmit} />);

    const textarea = screen.getByPlaceholderText('Mensagem') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'texto temporário' } });
    expect(textarea.value).toBe('texto temporário');

    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(textarea.value).toBe('');
  });
});

