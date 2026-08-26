#!/usr/bin/env node

import { resolveAdministration, ShopwareBridgeError } from './discovery.js';

interface CliOptions {
    administrationPath?: string;
    cwd?: string;
    json: boolean;
}

function parseArguments(args: string[]): CliOptions {
    const options: CliOptions = { json: false };

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];

        if (argument === '--json') {
            options.json = true;
        } else if (argument === '--admin-path') {
            options.administrationPath = args[++index];
        } else if (argument === '--cwd') {
            options.cwd = args[++index];
        } else if (argument !== 'doctor') {
            throw new Error(`Unknown argument: ${argument}`);
        }
    }

    return options;
}

function output(value: unknown, json: boolean): void {
    if (json) {
        process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
        return;
    }

    const result = value as Record<string, unknown>;
    for (const [key, entry] of Object.entries(result)) {
        process.stdout.write(`${key}: ${Array.isArray(entry) ? entry.join(', ') : String(entry)}\n`);
    }
}

try {
    const options = parseArguments(process.argv.slice(2));
    const administration = resolveAdministration(options);

    output({
        ok: true,
        administrationPath: administration.path,
        shopwareVersion: administration.version,
        nodeModulesPath: administration.nodeModulesPath,
    }, options.json);
} catch (error) {
    const bridgeError = error instanceof ShopwareBridgeError ? error : null;
    const result = {
        ok: false,
        code: bridgeError?.code ?? 'UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : String(error),
        ...(bridgeError?.details ?? {}),
    };

    output(result, process.argv.includes('--json'));
    process.exitCode = 1;
}

