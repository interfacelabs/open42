import { useEffect, useRef } from 'react';

interface EnvelopeStageProps {
  lines: string[];
  isValid: (line: string) => boolean;
}

interface EnvState {
  el: HTMLDivElement;
  rotation: number;
  y: number;
}

function deterministicForIndex(idx: number): { rot: number; y: number } {
  const rot = ((idx * 7919 + 3) % 21) - 10;
  const y = ((idx * 1031 + 11) % 17) - 8;
  return { rot, y };
}

function spreadForCount(n: number): number {
  if (n <= 3) return 86;
  if (n <= 5) return 60;
  if (n <= 7) return 44;
  if (n <= 9) return 32;
  return 24;
}

export function EnvelopeStage({ lines, isValid }: EnvelopeStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const envEls = useRef<EnvState[]>([]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const n = lines.length;
    const spread = spreadForCount(Math.max(1, n));

    while (envEls.current.length < n) {
      const idx = envEls.current.length;
      const el = document.createElement('div');
      el.className = 'env-pos absolute top-1/2 left-1/2';
      el.setAttribute('data-env', '');
      el.style.width = '80px';
      el.style.height = '56px';
      el.style.marginLeft = '-40px';
      el.style.marginTop = '-28px';
      el.style.transition = 'transform 0.35s cubic-bezier(.2,.8,.2,1)';
      el.innerHTML = realisticEnvelopeSVG();
      const inner = el.firstElementChild as HTMLElement;
      inner.classList.add('env-anim-in');
      inner.style.filter = 'drop-shadow(0 4px 14px rgba(29,77,255,0.10))';
      stage.appendChild(el);
      const { rot, y } = deterministicForIndex(idx);
      envEls.current.push({ el, rotation: rot, y });
    }

    while (envEls.current.length > n) {
      const last = envEls.current.pop()!;
      last.el.setAttribute('data-removing', '');
      const inner = last.el.firstElementChild as HTMLElement | null;
      if (inner) inner.classList.add('env-anim-out');
      let removed = false;
      const cleanup = () => {
        if (removed) return;
        removed = true;
        last.el.remove();
      };
      if (inner) {
        inner.addEventListener('animationend', cleanup, { once: true });
      }
      setTimeout(cleanup, 280);
    }

    envEls.current.forEach((env, i) => {
      const offsetX = (i - (n - 1) / 2) * spread;
      env.el.style.transform = `translate(${offsetX}px, ${env.y}px) rotate(${env.rotation}deg)`;
      env.el.style.zIndex = String(i + 1);
      const inner = env.el.firstElementChild as HTMLElement | null;
      const valid = isValid(lines[i] ?? '');
      env.el.setAttribute('data-valid', valid ? 'true' : 'false');
      if (inner) {
        inner.style.opacity = valid ? '1' : '0.55';
        // Dashed outline when invalid — toggles the SVG's body stroke pattern.
        const body = inner.querySelector('[data-env-body]') as SVGRectElement | null;
        if (body) {
          body.style.strokeDasharray = valid ? '' : '3 2';
        }
      }
    });
  }, [lines, isValid]);

  return (
    <div className="flex items-center justify-center min-h-[240px] w-full">
      <div ref={stageRef} className="relative" style={{ width: 360, height: 200 }} />
    </div>
  );
}

/**
 * Tiny mail-envelope SVG used as each token in the invite stage.
 * Matches the OTP-screen Envelope shape (back-flap V) and adds a stamp,
 * return-address dashes, and a subtle "to" line so it reads like a real
 * piece of mail rather than a plain rectangle.
 *
 * Returned as a string because the stage spawns elements imperatively via
 * innerHTML for cheap animation. Stays in sync with the OTP illustration.
 */
function realisticEnvelopeSVG(): string {
  return [
    '<svg viewBox="0 0 80 56" width="80" height="56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
    '  <g stroke="#1d4dff" stroke-width="1.1" fill="none" stroke-linecap="round" stroke-linejoin="round">',
    '    <rect data-env-body x="2" y="6" width="76" height="44" rx="2" fill="#ffffff" />',
    '    <path d="M 2 6 L 40 32 L 78 6" />',
    '    <path d="M 2 6 L 40 32 L 78 6" stroke="#1d4dff" stroke-opacity="0.18" stroke-width="2" />',
    '    <rect x="58" y="9" width="14" height="10" rx="0.8" fill="#ffffff" stroke-dasharray="1.2 1" />',
    '    <circle cx="65" cy="14" r="1.5" fill="#1d4dff" stroke="none" />',
    '    <line x1="8" y1="12" x2="22" y2="12" stroke-opacity="0.5" />',
    '    <line x1="8" y1="15.5" x2="18" y2="15.5" stroke-opacity="0.5" />',
    '    <line x1="22" y1="44" x2="58" y2="44" stroke-opacity="0.35" stroke-width="0.7" />',
    '  </g>',
    '</svg>',
  ].join('');
}
