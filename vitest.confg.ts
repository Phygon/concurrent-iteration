import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['test/**/*.{test,spec}.ts?(x)'],
        exclude: ['**/node_modules/**', '**/dist/**'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts?(x)'],
            exclude: ['**/*.d.ts', '**/node_modules/**', '**/dist/**'],
            reporter: ['text', 'json', 'html']
        },
    },
});
