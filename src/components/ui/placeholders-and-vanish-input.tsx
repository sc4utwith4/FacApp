import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ParticlePoint {
  x: number;
  y: number;
  r: number;
  color: string;
}

export function PlaceholdersAndVanishInput({
  placeholders,
  onChange,
  onSubmit,
  disabled,
}: {
  placeholders: string[];
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  disabled?: boolean;
}) {
  const [currentPlaceholder, setCurrentPlaceholder] = useState(0);
  const [value, setValue] = useState("");
  const [animating, setAnimating] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const newDataRef = useRef<ParticlePoint[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const clearPlaceholderInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startAnimation = useCallback(() => {
    clearPlaceholderInterval();
    if (placeholders.length <= 1) return;

    intervalRef.current = setInterval(() => {
      setCurrentPlaceholder((prev) => (prev + 1) % placeholders.length);
    }, 3000);
  }, [clearPlaceholderInterval, placeholders.length]);

  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState !== "visible") {
      clearPlaceholderInterval();
      return;
    }
    startAnimation();
  }, [clearPlaceholderInterval, startAnimation]);

  useEffect(() => {
    startAnimation();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearPlaceholderInterval();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [clearPlaceholderInterval, handleVisibilityChange, startAnimation]);

  const draw = useCallback(() => {
    if (!inputRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    canvas.width = 800;
    canvas.height = 800;
    ctx.clearRect(0, 0, 800, 800);
    const computedStyles = getComputedStyle(inputRef.current);

    const fontSize = parseFloat(computedStyles.getPropertyValue("font-size"));
    ctx.font = `${fontSize * 2}px ${computedStyles.fontFamily}`;
    ctx.fillStyle = "#FFF";
    ctx.fillText(value, 16, 40);

    const imageData = ctx.getImageData(0, 0, 800, 800);
    const pixelData = imageData.data;
    const newData: Array<{ x: number; y: number; color: [number, number, number, number] }> = [];

    for (let t = 0; t < 800; t += 1) {
      const rowOffset = 4 * t * 800;
      for (let n = 0; n < 800; n += 1) {
        const pixelOffset = rowOffset + 4 * n;
        if (
          pixelData[pixelOffset] !== 0 &&
          pixelData[pixelOffset + 1] !== 0 &&
          pixelData[pixelOffset + 2] !== 0
        ) {
          newData.push({
            x: n,
            y: t,
            color: [
              pixelData[pixelOffset],
              pixelData[pixelOffset + 1],
              pixelData[pixelOffset + 2],
              pixelData[pixelOffset + 3],
            ],
          });
        }
      }
    }

    newDataRef.current = newData.map(({ x, y, color }) => ({
      x,
      y,
      r: 1,
      color: `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3]})`,
    }));
  }, [value]);

  useEffect(() => {
    draw();
  }, [draw, value]);

  const animate = useCallback((start: number) => {
    const animateFrame = (pos: number = 0) => {
      requestAnimationFrame(() => {
        const updated: ParticlePoint[] = [];
        for (const current of newDataRef.current) {
          if (current.x < pos) {
            updated.push(current);
            continue;
          }

          if (current.r <= 0) {
            continue;
          }

          updated.push({
            ...current,
            x: current.x + (Math.random() > 0.5 ? 1 : -1),
            y: current.y + (Math.random() > 0.5 ? 1 : -1),
            r: current.r - 0.05 * Math.random(),
          });
        }

        newDataRef.current = updated;
        const ctx = canvasRef.current?.getContext("2d", { willReadFrequently: true });

        if (ctx) {
          ctx.clearRect(pos, 0, 800, 800);
          for (const point of newDataRef.current) {
            if (point.x <= pos) continue;
            ctx.beginPath();
            ctx.rect(point.x, point.y, point.r, point.r);
            ctx.fillStyle = point.color;
            ctx.strokeStyle = point.color;
            ctx.stroke();
          }
        }

        if (newDataRef.current.length > 0) {
          animateFrame(pos - 8);
          return;
        }

        setValue("");
        setAnimating(false);
      });
    };

    animateFrame(start);
  }, []);

  const vanishAndSubmit = useCallback(() => {
    setAnimating(true);
    draw();

    const currentValue = inputRef.current?.value || "";
    if (!currentValue || !inputRef.current) return;

    const maxX = newDataRef.current.reduce((prev, current) => (current.x > prev ? current.x : prev), 0);
    animate(maxX);
  }, [animate, draw]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (disabled || animating) return;

    const question = value.trim();
    if (!question) return;

    onSubmit(e);
    vanishAndSubmit();
  };

  return (
    <form
      className={cn(
        "w-full relative max-w-xl mx-auto bg-background dark:bg-zinc-800 h-12 rounded-full overflow-hidden shadow-[0px_2px_3px_-1px_rgba(0,0,0,0.1),_0px_1px_0px_0px_rgba(25,28,33,0.02),_0px_0px_0px_1px_rgba(25,28,33,0.08)] transition duration-200 border border-border",
        value && "bg-muted/50"
      )}
      onSubmit={handleSubmit}
    >
      <canvas
        className={cn(
          "absolute pointer-events-none text-base transform scale-50 top-[20%] left-2 sm:left-8 origin-top-left filter invert dark:invert-0 pr-20",
          !animating ? "opacity-0" : "opacity-100"
        )}
        ref={canvasRef}
      />
      <input
        name="question"
        onChange={(e) => {
          if (!animating && !disabled) {
            setValue(e.target.value);
            onChange(e);
          }
        }}
        ref={inputRef}
        value={value}
        type="text"
        disabled={disabled || animating}
        className={cn(
          "w-full relative text-sm sm:text-base z-50 border-none dark:text-foreground bg-transparent text-foreground h-full rounded-full focus:outline-none focus:ring-0 pl-4 sm:pl-10 pr-20",
          animating && "text-transparent dark:text-transparent",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      />

      <button
        disabled={!value || disabled || animating}
        type="submit"
        className="absolute right-2 top-1/2 z-50 -translate-y-1/2 h-8 w-8 rounded-full disabled:bg-muted bg-primary dark:bg-primary dark:disabled:bg-muted transition duration-200 flex items-center justify-center"
      >
        <motion.svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-gray-300 h-4 w-4"
        >
          <path stroke="none" d="M0 0h24v24H0z" fill="none" />
          <motion.path
            d="M5 12l14 0"
            initial={{
              strokeDasharray: "50%",
              strokeDashoffset: "50%",
            }}
            animate={{
              strokeDashoffset: value ? 0 : "50%",
            }}
            transition={{
              duration: 0.3,
              ease: "linear",
            }}
          />
          <path d="M13 18l6 -6" />
          <path d="M13 6l6 6" />
        </motion.svg>
      </button>

      <div className="absolute inset-0 flex items-center rounded-full pointer-events-none">
        <AnimatePresence initial={false} mode="sync">
          {!value ? (
            <motion.p
              key={`current-placeholder-${currentPlaceholder}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: "linear" }}
              className="dark:text-muted-foreground text-sm sm:text-base font-normal text-muted-foreground pl-4 sm:pl-12 text-left w-[calc(100%-2rem)] truncate"
            >
              {placeholders[currentPlaceholder]}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>
    </form>
  );
}

