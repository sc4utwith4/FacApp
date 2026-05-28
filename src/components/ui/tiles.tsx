'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface TilesProps {
  className?: string;
  rows?: number;
  cols?: number;
  tileClassName?: string;
  tileSize?: 'sm' | 'md' | 'lg';
}

const tileSizes = {
  sm: 'w-8 h-8',
  md: 'w-9 h-9 md:w-12 md:h-12',
  lg: 'w-12 h-12 md:w-16 md:h-16',
};

export function Tiles({
  className,
  rows = 100,
  cols = 10,
  tileClassName,
  tileSize = 'md',
}: TilesProps) {
  const rowsArray = new Array(rows).fill(1);
  const colsArray = new Array(cols).fill(1);

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-0 flex w-full justify-center overflow-hidden',
        className
      )}
    >
      <div className="flex flex-col">
        {rowsArray.map((_, i) => (
          <div key={`row-${i}`} className="flex">
            {colsArray.map((_, j) => (
              <motion.div
                key={`col-${j}`}
                whileHover={{
                  backgroundColor: 'var(--muted)',
                  transition: { duration: 0 },
                }}
                className={cn(
                  tileSizes[tileSize],
                  'border-r border-b border-neutral-200',
                  tileClassName
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
