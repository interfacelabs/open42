import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Nameplate, sizeForLength } from './Nameplate';

describe('sizeForLength', () => {
  it('returns 22 for empty (placeholder fallback)', () => {
    expect(sizeForLength(0)).toBe(22);
  });
  it('returns 26 for short names (<=14 chars)', () => {
    expect(sizeForLength(10)).toBe(26);
    expect(sizeForLength(14)).toBe(26);
  });
  it('returns 22 for medium (15-24)', () => {
    expect(sizeForLength(15)).toBe(22);
    expect(sizeForLength(24)).toBe(22);
  });
  it('returns 18 for long (25-36)', () => {
    expect(sizeForLength(30)).toBe(18);
  });
  it('returns 16 for very long (37+)', () => {
    expect(sizeForLength(50)).toBe(16);
  });
});

describe('Nameplate component', () => {
  it('renders the name in italic Newsreader', () => {
    const { getByText } = render(<Nameplate value="Speedrun Labs" />);
    const el = getByText('Speedrun Labs');
    expect(el.className).toContain('font-newsreader');
    expect(el.className).toContain('italic');
  });
  it('renders placeholder when value is empty', () => {
    const { getByText } = render(<Nameplate value="" />);
    expect(getByText('your brain')).toBeInTheDocument();
  });
});
