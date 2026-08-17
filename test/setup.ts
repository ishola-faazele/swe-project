/**
 * Setup file for the jsdom (component) test project only — see vitest.config.ts.
 * Registers jest-dom's matchers on Vitest's `expect` and cleans up the DOM between tests so one
 * component test's render tree never leaks into the next.
 */
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
