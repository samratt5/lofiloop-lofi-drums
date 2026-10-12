/**
 * Test helper: a Proxy standing in for a 2D canvas context that records every
 * call and flags non-finite numbers or NaN colours. Only used by tests.
 */
import type { Ctx2D } from './canvas';

export interface FakeContext {
  ctx: Ctx2D;
  calls: { name: string; args: unknown[] }[];
  problems: string[];
}

const FACTORIES = new Set(['createLinearGradient', 'createRadialGradient', 'createConicGradient']);

export function createFakeContext(): FakeContext {
  const calls: FakeContext['calls'] = [];
  const problems: string[] = [];
  const state: Record<string | symbol, unknown> = { font: '10px sans-serif', globalAlpha: 1 };

  const checkArgs = (name: string, args: unknown[]) => {
    args.forEach((a, i) => {
      if (typeof a === 'number' && !Number.isFinite(a)) problems.push(`${name} arg ${i} = ${a}`);
      if (typeof a === 'string' && /NaN|undefined|Infinity/.test(a)) problems.push(`${name} arg ${i} = "${a}"`);
    });
  };

  const gradient = (kind: string) => ({
    addColorStop(offset: number, color: string) {
      checkArgs(`${kind}.addColorStop`, [offset, color]);
      if (!(offset >= 0 && offset <= 1)) problems.push(`${kind}.addColorStop offset ${offset}`);
    },
  });

  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'symbol') return undefined;
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
        checkArgs(prop, args);
        if (FACTORIES.has(prop)) return gradient(prop);
        if (prop === 'createPattern') return {};
        if (prop === 'measureText') {
          const size = Number(/(\d+(?:\.\d+)?)px/.exec(String(target.font))?.[1] ?? 10);
          return { width: String(args[0]).length * size * 0.55 };
        }
        if (prop === 'getImageData' || prop === 'createImageData') return undefined;
        return undefined;
      };
    },
    set(target, prop, value) {
      if (typeof prop === 'string') checkArgs(`set ${prop}`, [value]);
      target[prop] = value;
      return true;
    },
  }) as unknown as Ctx2D;

  return { ctx, calls, problems };
}
