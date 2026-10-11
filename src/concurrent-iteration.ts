/** Shared concurrency settings for `each`, `map`, and `filter`. */
export interface ConcurrencyOptions {
    /** Maximum in-flight callbacks; a positive safe integer or `Infinity` (default). */
    concurrency?: number;
}

/**
 * Runs the iterator for every input value concurrently.
 *
 * @param values - A synchronous or asynchronous iterable.
 * @param iterator - Receives the value, its zero-based input index, and the
 * total number of values. Its return value is awaited and ignored.
 * @param options - Optional settings. `concurrency` defaults to `Infinity`.
 * @returns A promise for a new array containing the collected input values in input order. Object values are not cloned.
 * @remarks On an error, the processing is stopped and the returned promise is
 * rejected with the first error.
 */
export async function each<T>(
  values: Iterable<T> | AsyncIterable<T>,
  iterator: (value: T, index: number, length: number) => void | PromiseLike<void>,
  options?: ConcurrencyOptions,
): Promise<T[]> {
    const items = await collectValues(values);

    await runConcurrent(
        items.length,
        index => iterator(items[index], index, items.length),
        options,
    );

    return items;
}

/**
 * Evaluates predicates for each input concurrently and returns the values for which the test passes in input order.
 *
 * @param values - A synchronous or asynchronous iterable.
 * @param predicate - Receives the value, its zero-based input index, and the
 * total number of values. Its awaited boolean result determines whether to keep the value.
 * @param options - Optional settings. `concurrency` defaults to `Infinity`.
 * @returns A promise for matching input values in their original order.
 * @remarks On an error, the processing is stopped and the returned promise is
 * rejected with the first error.
 */
export async function filter<T>(
  values: Iterable<T> | AsyncIterable<T>,
  predicate: (value: T, index: number, length: number) => boolean | PromiseLike<boolean>,
  options?: ConcurrencyOptions,
): Promise<T[]> {
    const items = await collectValues(values);
    const matches = new Array<boolean>(items.length);

    await runConcurrent(
        items.length,
        async index => {
            matches[index] = await predicate(items[index], index, items.length);
        },
        options,
    );

    return items.filter((_, index) => matches[index]);
}

/**
 * Maps every input value concurrently and returns the mapped results in input order.
 *
 * @param values - A synchronous or asynchronous iterable.
 * @param mapper - Receives the value, its zero-based input index, and the total
 * number of values. Its awaited result becomes the corresponding output value.
 * @param options - Optional settings. `concurrency` defaults to `Infinity`.
 * @returns A promise for the mapped results in input order.
 * @remarks On an error, the processing is stopped and the returned promise is
 * rejected with the first error.
 */
export async function map<T, R>(
  values: Iterable<T> | AsyncIterable<T>,
  mapper: (value: T, index: number, length: number) => R | PromiseLike<R>,
  options?: ConcurrencyOptions,
): Promise<R[]> {
    const items = await collectValues(values);
    const results = new Array<R>(items.length);

    await runConcurrent(
        items.length,
        async index => {
            results[index] = await mapper(items[index], index, items.length);
        },
        options,
    );

    return results;
}

// Runs indexed tasks with bounded concurrency and drains workers before rejecting.
async function runConcurrent(
    length: number,
    task: (index: number) => void | PromiseLike<void>,
    options?: ConcurrencyOptions,
): Promise<void> {
    const concurrency = validateConcurrency(options?.concurrency ?? Infinity);
    let nextIndex = 0;
    let firstError: { reason: unknown } | undefined;

    // Claims indices synchronously and stops taking work after the first error.
    async function worker(): Promise<void> {
        while (!firstError && nextIndex < length) {
            const index = nextIndex++;
            try {
                await task(index);
            } catch (reason) {
                firstError ??= { reason };
            }
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(concurrency, length) },
            () => worker(),
        ),
    );

    if (firstError) {
        throw firstError.reason;
    }
}

// Materializes the entire input so callbacks receive a stable index and length.
async function collectValues<T>(
  values: Iterable<T> | AsyncIterable<T>,
): Promise<T[]> {
    const items: T[] = [];
    for await (const value of values) {
        items.push(value);
    }
    return items;
}

// Accepts positive safe integers or Infinity; rejects every other limit.
function validateConcurrency(
  concurrency: number,
): number {
  if ((Number.isSafeInteger(concurrency) && concurrency > 0) || concurrency === Infinity) {
    return concurrency;
  }

  throw new RangeError("concurrency must be a positive integer or Infinity");
}
