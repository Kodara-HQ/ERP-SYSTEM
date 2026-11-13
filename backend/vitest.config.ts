import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    globalSetup: './tests/globalSetup.ts',
    hookTimeout: 60000,
    testTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      PORT: '4000',
      CLIENT_ORIGIN: 'http://localhost:5173',
      TRUST_PROXY: 'false',
      DB_HOST: '127.0.0.1',
      DB_PORT: '5433',
      DB_USER: 'bajogo_app',
      DB_PASSWORD: 'Bajogo_Test_Password_1',
      DB_NAME: 'bajogo_erp_test',
      DB_ADMIN_USER: 'bajogo_app',
      DB_ADMIN_PASSWORD: 'Bajogo_Test_Password_1',
      JWT_ACCESS_SECRET: 'test-access-secret-must-be-long-enough-32b',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL_DAYS: '7',
      BCRYPT_ROUNDS: '4',
    },
  },
});
