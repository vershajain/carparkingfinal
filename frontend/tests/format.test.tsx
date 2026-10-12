import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatCard, StatusBadge } from '../src/components/common';
import { fmtMinutes, fmtNum, fmtPct, toLocalInput } from '../src/lib/format';
import { CarFront } from 'lucide-react';

describe('number formatting never invents data', () => {
  it('null / undefined show "No data yet", not 0', () => {
    expect(fmtNum(null)).toBe('No data yet');
    expect(fmtNum(undefined, 'min')).toBe('No data yet');
    expect(fmtMinutes(null)).toBe('No data yet');
    expect(fmtNum(0, 'min')).toBe('0 min');
  });
  it('formats improvements with sign and handles undefined results', () => {
    expect(fmtPct(12.5)).toBe('+12.50%');
    expect(fmtPct(-3)).toBe('-3.00%');
    expect(fmtPct(null)).toBe('n/a');
  });
  it('formats minutes and local datetime input values', () => {
    expect(fmtMinutes(45)).toBe('45 min');
    expect(fmtMinutes(125)).toBe('2 h 5 min');
    expect(toLocalInput(new Date(2026, 9, 12, 9, 5))).toBe('2026-10-12T09:05');
  });
});

describe('status is conveyed by text and icon, not colour alone', () => {
  it.each([['available', 'Available'], ['occupied', 'Occupied'], ['reserved', 'Reserved'], ['unavailable', 'Unavailable']])('%s badge has a text label and an icon', (status, label) => {
    const html = renderToStaticMarkup(<StatusBadge status={status} />);
    expect(html).toContain(label);
    expect(html).toContain('<svg');
  });
  it('stat cards render label, value and an icon', () => {
    const html = renderToStaticMarkup(<StatCard label="Occupied" value={7} Icon={CarFront} />);
    expect(html).toContain('Occupied'); expect(html).toContain('>7<'); expect(html).toContain('<svg');
  });
});
