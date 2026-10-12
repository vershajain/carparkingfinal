import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      // Integration tests need a running MongoDB. The DB name MUST end with "_test" (it is wiped).
      MONGODB_URI: process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/os_parking_test',
      JWT_SECRET: 'test-secret-test-secret-test-secret',
    },
    testTimeout: 30000,
  },
});
