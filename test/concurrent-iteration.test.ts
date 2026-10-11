import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import {
    each,
    map,
    filter,
    type ConcurrencyOptions,
} from '../src/concurrent-iteration.ts';

// Advance the event loop to let promise reactions drain, without arbitrary sleeps.
// Run these tests with real timers.
type Task = (value: number, index: number, length: number) => Promise<void>;
type Operation = (
    values: Iterable<number> | AsyncIterable<number>,
    task: Task,
    options?: ConcurrencyOptions,
) => Promise<unknown[]>;

const operations: { name: string; run: Operation }[] = [
    { name: 'each', run: each },
    { name: 'map', run: map },
    {
        name: 'filter',
        run: (values, task, options) => filter(
            values,
            async (value, index, length) => {
                await task(value, index, length);
                return true;
            },
            options,
        ),
    },
];

const invalidConcurrency = [
    0,
    -1,
    0.5,
    1.5,
    NaN,
    -Infinity,
    Number.MAX_SAFE_INTEGER + 1,
];

const limits: [string, ConcurrencyOptions | undefined, number][] = [
    ['omitted options', undefined, 4],
    ['empty options', {}, 4],
    ['undefined concurrency', { concurrency: undefined }, 4],
    ['Infinity', { concurrency: Infinity }, 4],
    ['one worker', { concurrency: 1 }, 1],
    ['two workers', { concurrency: 2 }, 2],
    ['more workers than inputs', { concurrency: 10 }, 4],
    ['maximum safe integer', { concurrency: Number.MAX_SAFE_INTEGER }, 4],
];

describe.each(operations)('$name: shared behavior', ({ run }) => {
    it('handles empty input without invoking the callback', async () => {
        const task = vi.fn(async () => {});

        await expect(run([], task)).resolves.toEqual([]);
        expect(task).not.toHaveBeenCalled();
    });

    it('accepts a synchronous iterable and passes value, index, and length', async () => {
        const task = vi.fn(async () => {});

        await run(new Set([10, 20, 30]), task);

        expect(task.mock.calls).toEqual([
            [10, 0, 3],
            [20, 1, 3],
            [30, 2, 3],
        ]);
    });

    it('fully collects an async iterable before invoking callbacks', async () => {
        const events: string[] = [];
        async function* values() {
            events.push('yield 10');
            yield 10;
            events.push('yield 20');
            yield 20;
            events.push('collection complete');
        }

        await run(values(), async (value, index, length) => {
            events.push(`callback ${value}/${index}/${length}`);
        });

        expect(events).toEqual([
            'yield 10',
            'yield 20',
            'collection complete',
            'callback 10/0/2',
            'callback 20/1/2',
        ]);
    });

    it.each(limits)('respects concurrency: %s', async (_label, options, expectedMaximum) => {
        const gate = Promise.withResolvers<void>();
        let active = 0;
        let maximum = 0;
        const started: number[] = [];

        const result = run([1, 2, 3, 4], async (value) => {
            started.push(value);
            maximum = Math.max(maximum, ++active);
            try {
                await gate.promise;
                // Keep subsequent callbacks overlapping for the limit check.
                await nextTurn();
            } finally {
                active--;
            }
        }, options);

        try {
            await nextTurn();
            expect(started).toEqual([1, 2, 3, 4].slice(0, expectedMaximum));
            expect(active).toBe(expectedMaximum);
        } finally {
            gate.resolve();
            await result;
        }

        expect(started).toEqual([1, 2, 3, 4]);
        expect(maximum).toBe(expectedMaximum);
        expect(active).toBe(0);
    });

    it.each(invalidConcurrency)('rejects invalid concurrency %s, even for empty input', async (concurrency) => {
        const task = vi.fn(async () => {});
        const result = run([], task, { concurrency });

        await expect(result).rejects.toBeInstanceOf(RangeError);
        await expect(result).rejects.toHaveProperty(
            'message',
            'concurrency must be a positive integer or Infinity',
        );
        expect(task).not.toHaveBeenCalled();
    });

    it.each(['sync', 'async'])('rejects %s input collection failures before callbacks run', async (kind) => {
        const error = new Error('collection failed');
        const task = vi.fn(async () => {});
        function* syncValues() {
            yield 1;
            throw error;
        }
        async function* asyncValues() {
            yield 1;
            throw error;
        }
        const values = kind === 'sync' ? syncValues() : asyncValues();

        // Collection errors take precedence over invalid concurrency.
        await expect(run(values, task, { concurrency: 0 })).rejects.toBe(error);
        expect(task).not.toHaveBeenCalled();
    });

    it.each([undefined, null, false, 0, ''])('preserves a falsy rejection reason: %s', async (reason) => {
        await expect(run([1], async () => {
            throw reason;
        })).rejects.toBe(reason);
    });

    it('waits for all in-flight callbacks, stops new work, and preserves the first error', async () => {
        const firstError = new Error('first failure');
        const laterError = new Error('later failure');
        const secondWorker = Promise.withResolvers<void>();
        const thirdWorker = Promise.withResolvers<void>();
        const task = vi.fn(async (_value: number, index: number) => {
            if (index === 0) throw firstError;
            if (index === 1) {
                await secondWorker.promise;
                throw laterError;
            }
            await thirdWorker.promise;
        });
        const result = run([1, 2, 3, 4], task, { concurrency: 3 });
        const settled = result.then(
            () => ({ status: 'fulfilled' as const }),
            (reason: unknown) => ({ status: 'rejected' as const, reason }),
        );

        try {
            await nextTurn();
            secondWorker.resolve();
            const interim = await Promise.race([
                settled,
                nextTurn().then(() => ({ status: 'pending' as const })),
            ]);
            expect(interim).toEqual({ status: 'pending' });
            expect(task).toHaveBeenCalledTimes(3);
        } finally {
            secondWorker.resolve();
            thirdWorker.resolve();
        }

        await expect(settled).resolves.toEqual({
            status: 'rejected',
            reason: firstError,
        });
        expect(task).toHaveBeenCalledTimes(3);
    });
});

describe('each', () => {
    it('returns a new array containing the original values and object references', async () => {
        const input = [{ id: 1 }, { id: 2 }];
        const result = await each(input, () => {});

        expect(result).toEqual(input);
        expect(result).not.toBe(input);
        expect(result[0]).toBe(input[0]);
        expect(result[1]).toBe(input[1]);
    });

    it('preserves input order when callbacks complete in reverse order', async () => {
        const gates = [0, 1, 2].map(() => Promise.withResolvers<void>());
        const completed: number[] = [];
        const result = each([10, 20, 30], async (value, index) => {
            await gates[index].promise;
            completed.push(value);
        });

        await nextTurn();
        for (const index of [2, 1, 0]) {
            gates[index].resolve();
            await nextTurn();
        }

        await expect(result).resolves.toEqual([10, 20, 30]);
        expect(completed).toEqual([30, 20, 10]);
    });

    it('rejects synchronous callback throws', async () => {
        const error = new Error('iterator failed');
        await expect(each([1], () => { throw error; })).rejects.toBe(error);
    });
});

describe('filter', () => {
    it('selects values using a synchronous predicate without mutating the input', async () => {
        const input = [1, 2, 3, 4];
        const result = await filter(input, value => value % 2 === 0);
        expect(result).toEqual([2, 4]);
        expect(input).toEqual([1, 2, 3, 4]);
    });

    it('preserves input order when predicates complete in reverse order', async () => {
        const gates = [0, 1, 2, 3].map(() => Promise.withResolvers<void>());
        const completed: number[] = [];
        const result = filter([1, 2, 3, 4], async (value, index) => {
            await gates[index].promise;
            completed.push(value);
            return value % 2 === 0;
        });

        await nextTurn();
        for (const index of [3, 2, 1, 0]) {
            gates[index].resolve();
            await nextTurn();
        }

        await expect(result).resolves.toEqual([2, 4]);
        expect(completed).toEqual([4, 3, 2, 1]);
    });

    it('retains matching falsy values, duplicates, and object references', async () => {
        const object = { id: 1 };
        const input = [undefined, null, false, 0, '', 0, object, object];
        const result = await filter(input, () => true);

        expect(result).toEqual(input);
        expect(result).not.toBe(input);
        expect(result[6]).toBe(object);
        expect(result[7]).toBe(object);
    });

    it('returns an empty array when no values match', async () => {
        await expect(filter([1, 2, 3], () => false)).resolves.toEqual([]);
    });

    it('rejects synchronous predicate throws', async () => {
        const error = new Error('predicate failed');
        await expect(filter([1], () => { throw error; })).rejects.toBe(error);
    });
});

describe('map', () => {
    it('maps synchronous results without mutating the input', async () => {
        const input = [1, 2, 3];
        await expect(map(input, value => value * 2)).resolves.toEqual([2, 4, 6]);
        expect(input).toEqual([1, 2, 3]);
    });

    it('preserves input order when mappers complete in reverse order', async () => {
        const gates = [0, 1, 2].map(() => Promise.withResolvers<void>());
        const completed: number[] = [];
        const result = map([10, 20, 30], async (value, index) => {
            await gates[index].promise;
            completed.push(value);
            return value * 2;
        });

        await nextTurn();
        for (const index of [2, 1, 0]) {
            gates[index].resolve();
            await nextTurn();
        }

        await expect(result).resolves.toEqual([20, 40, 60]);
        expect(completed).toEqual([30, 20, 10]);
    });

    it('retains undefined results as actual array entries', async () => {
        const result = await map([1, 2], () => undefined);
        expect(result).toEqual([undefined, undefined]);
        expect(Object.keys(result)).toEqual(['0', '1']);
    });

    it('rejects synchronous mapper throws', async () => {
        const error = new Error('mapper failed');
        await expect(map([1], () => { throw error; })).rejects.toBe(error);
    });
});

