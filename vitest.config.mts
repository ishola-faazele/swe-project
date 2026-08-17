import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import 'dotenv/config'

// Shared with every project below: `@/*` mirrors tsconfig's path alias, and `next/cache` is
// aliased to a stub — see test/mocks/next-cache.ts for why.
const alias = {
  '@': path.resolve(import.meta.dirname, 'src'),
  'next/cache': path.resolve(import.meta.dirname, 'test/mocks/next-cache.ts'),
}

export default defineConfig({
  test: {
    projects: [
      // Unit + integration layers: pure logic and real-DB Server Action tests. No DOM needed,
      // and keeping these off jsdom avoids any chance of a browser-shaped global confusing the
      // Prisma/pg driver.
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      // Component layer: React Testing Library over jsdom.
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./test/setup.ts'],
        },
      },
    ],
  },
})
