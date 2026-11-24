import { defineConfig, mergeConfig } from 'vitest/config';
import unitConfig from './vitest.config.js';

export default mergeConfig(unitConfig, defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.integration.spec.ts'],
    hookTimeout: 30000,
    testTimeout: 15000,
    fileParallelism: false,
  },
}));
