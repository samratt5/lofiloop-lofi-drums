// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Knob } from './Knob';

afterEach(cleanup);

describe('Knob', () => {
  it('is an accessible slider with a readable value', () => {
    render(<Knob label="Cutoff" value={0.5} min={0} max={1} onChange={() => {}} format={(v) => `${v * 100}%`} />);
    const knob = screen.getByRole('slider', { name: 'Cutoff' });
    expect(knob.getAttribute('aria-valuenow')).toBe('0.5');
    expect(knob.getAttribute('aria-valuetext')).toBe('50%');
  });

  it('moves with the keyboard and resets on double click', () => {
    const onChange = vi.fn();
    render(<Knob label="Drive" value={0.5} min={0} max={1} defaultValue={0.25} onChange={onChange} />);
    const knob = screen.getByRole('slider', { name: 'Drive' });
    fireEvent.keyDown(knob, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(0.51);
    fireEvent.keyDown(knob, { key: 'PageDown' });
    expect(onChange).toHaveBeenLastCalledWith(0.4);
    fireEvent.keyDown(knob, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.doubleClick(knob);
    expect(onChange).toHaveBeenLastCalledWith(0.25);
  });

  it('always moves at least one step for coarse ranges', () => {
    const onChange = vi.fn();
    render(<Knob label="Steps" value={4} min={1} max={16} step={1} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Steps' }), { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(3);
  });

  it('ignores input when disabled', () => {
    const onChange = vi.fn();
    render(<Knob label="Off" value={0.5} min={0} max={1} onChange={onChange} disabled />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Off' }), { key: 'ArrowUp' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
