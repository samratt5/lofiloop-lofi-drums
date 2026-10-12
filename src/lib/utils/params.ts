import type { ParamDef } from '@/lib/project/instruments';

export function formatParam(def: Pick<ParamDef, 'unit'>, value: number): string {
  switch (def.unit) {
    case 'hz':
      return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${Math.round(value)} Hz`;
    case 's':
      return value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`;
    case 'percent':
      return `${Math.round(value * 100)}%`;
    default:
      return value.toFixed(2);
  }
}

export function formatPan(value: number): string {
  if (Math.abs(value) < 0.02) return 'C';
  return `${value < 0 ? 'L' : 'R'}${Math.round(Math.abs(value) * 100)}`;
}
