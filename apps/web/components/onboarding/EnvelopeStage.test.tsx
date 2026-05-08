import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EnvelopeStage } from './EnvelopeStage';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValid = (s: string) => EMAIL_RE.test(s.trim());

describe('EnvelopeStage', () => {
  it('renders one envelope per non-empty line', () => {
    const { container } = render(
      <EnvelopeStage lines={['a@x.com', 'b@x.com']} isValid={isValid} />,
    );
    expect(container.querySelectorAll('[data-env]')).toHaveLength(2);
  });

  it('preserves DOM identity when a line content changes (typing)', () => {
    const { container, rerender } = render(
      <EnvelopeStage lines={['a@x.com', 'b@x.com']} isValid={isValid} />,
    );
    const before = container.querySelectorAll('[data-env]')[0];
    rerender(<EnvelopeStage lines={['ab@x.com', 'b@x.com']} isValid={isValid} />);
    const after = container.querySelectorAll('[data-env]')[0];
    expect(after).toBe(before);
  });

  it('deletion of a middle line removes the LAST DOM node, not the middle', () => {
    const { container, rerender } = render(
      <EnvelopeStage
        lines={['a@x.com', 'b@x.com', 'c@x.com']}
        isValid={isValid}
      />,
    );
    const nodes = Array.from(container.querySelectorAll('[data-env]'));
    const [n0, n1] = nodes;
    rerender(<EnvelopeStage lines={['a@x.com', 'c@x.com']} isValid={isValid} />);
    const after = container.querySelectorAll('[data-env]:not([data-removing])');
    expect(after.length).toBe(2);
    expect(after[0]).toBe(n0);
    expect(after[1]).toBe(n1);
  });

  it('toggles data-valid based on line content', () => {
    const { container, rerender } = render(
      <EnvelopeStage lines={['typing']} isValid={isValid} />,
    );
    const env = container.querySelector('[data-env]')!;
    expect(env.getAttribute('data-valid')).toBe('false');
    rerender(<EnvelopeStage lines={['typing@x.com']} isValid={isValid} />);
    expect(env.getAttribute('data-valid')).toBe('true');
  });
});
