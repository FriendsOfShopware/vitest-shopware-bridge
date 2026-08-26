import { describe, expect, it, vi } from 'vitest';
import { createConsoleGuard } from '../../src/console.js';

describe('strict console guard', () => {
    it('fails for unexpected warnings and permits an explicit allowance', () => {
        const target = {
            warn: vi.fn(),
            error: vi.fn(),
        } as unknown as Console;
        const guard = createConsoleGuard(target, false);

        target.warn('unexpected warning');
        expect(() => guard.assert()).toThrow('console.warn: unexpected warning');

        guard.reset();
        guard.allow(/expected/, 'warn');
        target.warn('expected warning');
        expect(() => guard.assert()).not.toThrow();
        guard.stop();
    });
});
