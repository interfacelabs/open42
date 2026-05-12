"use client";

import { useState } from "react";
import { FAQ } from "@/lib/content";
import { SectionEyebrow } from "@/components/SectionEyebrow";
import { ChevronDown, QuestionMark } from "@/components/icons";

export function FaqSection() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="relative bg-page">
      <div className="page-frame mx-auto w-full max-w-[1320px] px-6 pt-24 pb-24">
        <div className="flex flex-col items-center text-center">
          <SectionEyebrow icon={<QuestionMark className="h-3.5 w-3.5" />}>
            {FAQ.eyebrow}
          </SectionEyebrow>

          <h2 className="mt-6 max-w-[860px] font-sans text-[40px] font-medium leading-[1.0] tracking-[-0.025em] text-ink md:text-[56px]">
            {FAQ.heading}
          </h2>

          <p className="mt-5 max-w-[620px] font-mono text-[16px] leading-[24px] text-muted-ink">
            {FAQ.subhead}
          </p>
        </div>

        <ul className="mx-auto mt-12 max-w-[760px] divide-y divide-line border-y border-line">
          {FAQ.items.map((item, i) => {
            const isOpen = open === i;
            return (
              <li key={item.q}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-6 py-5 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="font-mono text-[15px] text-ink">
                    {item.q}
                  </span>
                  <ChevronDown
                    className={
                      "h-4 w-4 shrink-0 text-ink transition-transform duration-200 " +
                      (isOpen ? "rotate-180" : "")
                    }
                  />
                </button>
                <div
                  className={
                    "grid overflow-hidden transition-[grid-template-rows] duration-300 " +
                    (isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")
                  }
                >
                  <div className="min-h-0">
                    <p className="pb-5 pr-10 font-mono text-[14px] leading-[22px] text-muted-ink">
                      {item.a}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
