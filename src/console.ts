export type GuardedConsoleMethod = 'warn' | 'error';
export type ConsoleMessagePattern = string | RegExp;

interface AllowedMessage {
    method: GuardedConsoleMethod | 'both';
    pattern: ConsoleMessagePattern;
}

interface UnexpectedMessage {
    method: GuardedConsoleMethod;
    text: string;
}

export interface ConsoleGuard {
    allow(pattern: ConsoleMessagePattern, method?: GuardedConsoleMethod | 'both'): void;
    assert(): void;
    reset(): void;
    stop(): void;
}

function matches(pattern: ConsoleMessagePattern, text: string): boolean {
    if (typeof pattern === 'string') {
        return text.includes(pattern);
    }

    pattern.lastIndex = 0;
    return pattern.test(text);
}

/**
 * Installs a small, framework-independent strict-console guard. It is exported
 * for unit testing; consumers normally enable it through `runtime.strictConsole`
 * and use `allowConsoleMessage()` for deliberate output.
 */
export function createConsoleGuard(target: Console = console, passthrough = true): ConsoleGuard {
    const originals = {
        warn: target.warn.bind(target),
        error: target.error.bind(target),
    };
    const allowed: AllowedMessage[] = [];
    const unexpected: UnexpectedMessage[] = [];

    const intercept = (method: GuardedConsoleMethod) => (...args: unknown[]) => {
        const text = args.map((argument) => {
            if (argument instanceof Error) {
                return argument.message;
            }
            return typeof argument === 'string' ? argument : String(argument);
        }).join(' ');
        const isAllowed = allowed.some((entry) =>
            (entry.method === 'both' || entry.method === method) && matches(entry.pattern, text));

        if (!isAllowed) {
            unexpected.push({ method, text });
        }

        if (passthrough) {
            originals[method](...args);
        }
    };

    target.warn = intercept('warn');
    target.error = intercept('error');

    return {
        allow(pattern, method = 'both') {
            allowed.push({ pattern, method });
        },
        assert() {
            if (unexpected.length === 0) {
                return;
            }

            const messages = unexpected.map(({ method, text }) => `console.${method}: ${text}`).join('\n');
            throw new Error(`Unexpected console output:\n${messages}`);
        },
        reset() {
            allowed.length = 0;
            unexpected.length = 0;
        },
        stop() {
            target.warn = originals.warn;
            target.error = originals.error;
            allowed.length = 0;
            unexpected.length = 0;
        },
    };
}
