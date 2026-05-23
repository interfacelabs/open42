'use client';

import { motion, type Variants } from 'framer-motion';
import { ChevronRight } from '@/components/icons';

const EASE = [0.22, 1, 0.36, 1] as const;

const card: Variants = {
  hidden: { opacity: 0, y: 32 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: EASE, when: 'beforeChildren' },
  },
};

const body: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.35 } },
};

const line: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
};

const word: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
};

const headingContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

const chip: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.94 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, ease: EASE, delay: 1.85 },
  },
};

const HEADING_WORDS = ['How', 'do', 'refunds', 'work?'];

export function MarkdownAnswerCard() {
  return (
    <div className="relative mx-auto w-full max-w-[680px]">
      <motion.div
        variants={card}
        initial="hidden"
        animate="show"
        className="relative overflow-hidden rounded-[22px] border border-line bg-surface shadow-[0_30px_60px_-30px_rgba(31,31,31,0.18),0_8px_20px_-8px_rgba(31,31,31,0.08)] md:rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-line bg-page/60 px-4 py-2 font-mono text-[10px] text-muted-ink md:px-6 md:py-3 md:text-[12px]">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            refund-policy.answer.md
          </span>
          <span className="hidden opacity-70 sm:inline">workspace acme · brain</span>
        </div>

        <div
          className="absolute right-0 top-9 h-10 w-10"
          aria-hidden="true"
          style={{
            background: 'linear-gradient(225deg, rgba(0,0,0,0.06) 0%, rgba(0,0,0,0) 60%)',
            clipPath: 'polygon(100% 0, 0 0, 100% 100%)',
          }}
        />

        <motion.pre
          variants={body}
          className="m-0 overflow-hidden whitespace-pre-wrap break-words p-5 pb-16 font-mono text-[11px] leading-[20px] text-muted-ink md:p-10 md:pb-24 md:text-[14px] md:leading-[26px]"
        >
          <motion.span variants={headingContainer} className="inline">
            <span className="text-emerald-600">#</span>{' '}
            {HEADING_WORDS.map((w, i) => (
              <motion.span key={i} variants={word} className="inline-block text-ink">
                {w}
                {i < HEADING_WORDS.length - 1 ? '\u00A0' : ''}
              </motion.span>
            ))}
          </motion.span>
          {'\n'}
          <motion.span variants={line} className="inline">
            <span className="text-indigo-500">##</span>{' '}
            <span className="text-ink">Annual plans · enterprise exceptions</span>
          </motion.span>
          {'\n\n'}
          <motion.span variants={line} className="inline">
            Yes — within 30 days of purchase, unless the account has an enterprise exception flagged
            by legal.
          </motion.span>
          {'\n\n'}
          <motion.span variants={line} className="inline">
            <span className="text-pink-500">1.</span> refund window is 30 days from invoice
          </motion.span>
          {'\n'}
          <motion.span variants={line} className="inline">
            <span className="text-pink-500">2.</span> enterprise tier overrides require legal
            approval
          </motion.span>
          {'\n'}
          <motion.span variants={line} className="inline">
            <span className="text-pink-500">3.</span> renewal clause: see section 8 of the MSA
          </motion.span>
          {'\n\n'}
          <motion.span variants={line} className="inline">
            <span className="text-purple-600">***</span>
            <span className="italic text-purple-700">Cited from your brain — not generated.</span>
            <span className="text-purple-600">***</span>
          </motion.span>
          {'\n\n'}
          <motion.span variants={line} className="inline">
            <span className="text-emerald-600">[1]:</span>{' '}
            <span className="text-blue-600">refund-policy.md</span>
            {'   '}
            <span className="opacity-60">updated 2d ago</span>
          </motion.span>
          {'\n'}
          <motion.span variants={line} className="inline">
            <span className="text-emerald-600">[2]:</span>{' '}
            <span className="text-blue-600">sales-exceptions.md</span>
            {'   '}
            <span className="opacity-60">version 14</span>
          </motion.span>
        </motion.pre>

        {/* Chip docked inside the card at the bottom-right. The pre's extra
            bottom padding above reserves room so it doesn't overlap the
            citations. */}
        <motion.div
          variants={chip}
          initial="hidden"
          animate="show"
          className="pointer-events-none absolute bottom-4 right-4 md:bottom-6 md:right-10"
        >
          <div className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 font-mono text-[11px] text-white shadow-[0_10px_24px_-8px_rgba(31,31,31,0.45)] md:text-[12px]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span>Save as Skill</span>
            <ChevronRight className="h-3 w-3" />
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
