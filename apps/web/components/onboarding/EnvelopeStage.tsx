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
      el.innerHTML = '<div class="env-inner"></div>';
      const inner = el.firstElementChild as HTMLElement;
      inner.className =
        'w-full h-full bg-white border border-accent rounded-sm relative env-anim-in';
      inner.style.boxShadow = '0 4px 14px rgba(29,77,255,0.10)';
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
        inner.style.borderStyle = valid ? 'solid' : 'dashed';
        inner.style.opacity = valid ? '1' : '0.6';
      }
    });
  }, [lines, isValid]);

  return (
    <div className="flex items-center justify-center min-h-[240px] w-full">
      <div ref={stageRef} className="relative" style={{ width: 360, height: 200 }} />
    </div>
  );
}
