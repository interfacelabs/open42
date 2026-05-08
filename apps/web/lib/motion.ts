/**
 * Motion variants for Open42 — consumed by `motion`/`framer-motion` components.
 * Easings mirror the Tailwind tokens (`transitionTimingFunction.standard` /
 * `.exit` in tailwind.config.ts) so CSS-driven and JS-driven motion match.
 */

export const EASE_STANDARD: [number, number, number, number] = [0.2, 0.8, 0.2, 1];
export const EASE_ENTER: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const EASE_EXIT: [number, number, number, number] = [0.7, 0, 0.84, 0];

export const nameplateFlash = {
  initial: { scale: 1 },
  flash: {
    scale: [1, 1.025, 1],
    transition: { duration: 0.35, times: [0, 0.4, 1], ease: EASE_STANDARD },
  },
};

export const envelopeIn = {
  initial: { opacity: 0, y: -22, scale: 0.8 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.4, ease: EASE_STANDARD },
  },
};

export const envelopeOut = {
  exit: {
    opacity: 0,
    y: -14,
    scale: 0.85,
    transition: { duration: 0.25, ease: EASE_EXIT },
  },
};

export const editorialCrossFade = {
  initial: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: 0.32, ease: EASE_EXIT } },
};
