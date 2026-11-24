import { init } from '@paralleldrive/cuid2';

// Lazily initialized cuid2 generator to comply with Cloudflare Workers global scope restrictions
let _generator: (() => string) | null = null;

function getGenerator(): () => string {
  if (!_generator) {
    _generator = init({ length: 24 });
  }
  return _generator;
}

export const createId = (): string => getGenerator()();
export const newId = createId;


