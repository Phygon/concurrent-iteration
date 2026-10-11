# Concurrent Iteration

> Run asynchronous tasks over iterable values with optional bounded concurrency.

Use `each` for side effects, `map` to transform values, and `filter` to select values. Returned arrays preserve input order.

After a callback error is recorded, no new callbacks are started.
Already-running callbacks are allowed to settle, then the returned promise rejects with the first recorded error.

## Table of contents

- [Usage](#usage)
- [API](#api)
  - [`each(values, iterator, options?)`](#eachvalues-iterator-options)
  - [`filter(values, predicate, options?)`](#filtervalues-predicate-options)
  - [`map(values, mapper, options?)`](#mapvalues-mapper-options)

## Usage

```ts
import { each, map, filter } from 'concurrent-iteration';

const doubled = await map(
    [1, 2, 3],
    async (value) => value * 2,
    { concurrency: 2 },
);
// doubled: [2, 4, 6]

const even = await filter(
    [1, 2, 3, 4],
    async (value) => value % 2 === 0,
    { concurrency: 2 },
);
// even: [2, 4]

const values = await each(
    ['alpha', 'beta'],
    (value, index, length) => {
        console.log(`${index + 1}/${length}: ${value}`);
    },
    { concurrency: 1 },
);
// values: ['alpha', 'beta']
```

Async iterables are also accepted:

```ts
async function* numbers() {
    yield 10;
    yield 20;
}

const results = await map(numbers(), (value) => value + 1);
// results: [11, 21]
```

## API

### `each(values, iterator, options?)`

```ts
each: <T>(
    values: Iterable<T> | AsyncIterable<T>,
    iterator: (value: T, index: number, length: number) => void | PromiseLike<void>,
    options?: { concurrency?: number /* = Infinity */ }
) => Promise<T[]>
```

Runs the iterator for every input value concurrently.

- `values` - A synchronous or asynchronous iterable.
- `iterator` - Receives the value, its zero-based input index, and the total number of values. Its return value is awaited and ignored.
- `options` - Optional settings. `concurrency` defaults to `Infinity`.

**Returns:** A promise for a new array containing the collected input values in input order. Object values are not cloned.

### `filter(values, predicate, options?)`

```ts
filter: <T>(
    values: Iterable<T> | AsyncIterable<T>,
    predicate: (value: T, index: number, length: number) => boolean | PromiseLike<boolean>,
    options?: { concurrency?: number /* = Infinity */ }
) => Promise<T[]>
```

Evaluates every predicate concurrently and returns matching input values in input order.

- `values` - A synchronous or asynchronous iterable.
- `predicate` - Receives the value, its zero-based input index, and the total number of values. Its awaited boolean result determines whether to keep the value.
- `options` - Optional settings. `concurrency` defaults to `Infinity`.

**Returns:** A promise for passing input values in input order.

### `map(values, mapper, options?)`

```ts
map: <T, R>(
    values: Iterable<T> | AsyncIterable<T>,
    mapper: (value: T, index: number, length: number) => R | PromiseLike<R>,
    options?: { concurrency?: number /* = Infinity */ }
) => Promise<R[]>
```

Maps every input value concurrently and returns the mapped results in input order.

- `values` - A synchronous or asynchronous iterable.
- `mapper` - Receives the value, its zero-based input index, and the total number of values. Its awaited result becomes the corresponding output value.
- `options` - Optional settings. `concurrency` defaults to `Infinity`.

**Returns:** A promise for the mapped results in input order.
