import { ReactNode, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { cn } from '@/lib/utils';
import { EASE_ENTER, EASE_EXIT } from '@/lib/motion';

/**
 * Reusable right-side slide-over. The same shape powers DocPanel (P4) and
 * SkillPanel (P6). Esc and backdrop click both close. Reduced-motion respected
 * via globals.css.
 */
export function SlideOver({
  open,
  onClose,
  width = 'md',
  children,
  ariaLabel,
}: {
  open: boolean;
  onClose: () => void;
  width?: 'md' | 'lg';
  children: ReactNode;
  ariaLabel?: string;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="slideover-root"
          className="fixed inset-0 z-30"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14, ease: EASE_ENTER }}
        >
          <div
            aria-hidden="true"
            onClick={onClose}
            className="absolute inset-0 bg-black/[0.04]"
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            className={cn(
              'absolute right-0 top-0 flex h-screen flex-col border-l border-border bg-white shadow-[-12px_0_32px_rgba(0,0,0,0.06)]',
              width === 'lg'
                ? 'w-[58vw] max-w-[860px]'
                : 'w-[44vw] max-w-[640px]',
            )}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.24, ease: EASE_ENTER }}
          >
            <motion.div
              className="flex h-full flex-col"
              exit={{ opacity: 0, transition: { duration: 0.12, ease: EASE_EXIT } }}
            >
              {children}
            </motion.div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
