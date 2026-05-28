'use client';

import { animate } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

/**
 * Hook que anima texto progressivamente (caractere, palavra ou chunk).
 * @param text - Texto completo a exibir
 * @param delimiter - "" = caractere, " " = palavra, "\n" = chunk
 * @returns Parte do texto já animada
 */
export function useAnimatedText(
  text: string,
  delimiter: string = ''
): string {
  const [cursor, setCursor] = useState(0);
  const prevTextRef = useRef(text);
  const cursorRef = useRef(0);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    const parts = text.split(delimiter);
    const shouldBypassAnimation =
      text.length >= 260 ||
      parts.length >= 80 ||
      text.includes('Ver detalhes técnicos');

    if (shouldBypassAnimation) {
      setCursor(parts.length);
      prevTextRef.current = text;
      return;
    }

    const previousText = prevTextRef.current;
    const startingCursor = text.startsWith(previousText)
      ? Math.min(cursorRef.current, parts.length)
      : 0;
    const duration =
      delimiter === ''
        ? Math.min(2.4, Math.max(0.45, parts.length * 0.02))
        : delimiter === ' '
          ? Math.min(1.1, Math.max(0.22, parts.length * 0.03))
          : Math.min(0.7, Math.max(0.18, parts.length * 0.04));

    setCursor(startingCursor);

    const controls = animate(startingCursor, parts.length, {
      duration,
      ease: 'linear', // Mudar para linear para ser mais previsível
      onUpdate(latest) {
        setCursor(Math.floor(latest));
      },
      onComplete() {
        setCursor(parts.length);
      },
    });

    prevTextRef.current = text;

    return () => controls.stop();
  }, [text, delimiter]);

  return text.split(delimiter).slice(0, cursor).join(delimiter);
}
