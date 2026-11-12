export default async function setup(): Promise<void> {
  process.env.NODE_ENV = 'test';
  process.env.PORT = '4000';
  process.env.CLIENT_ORIGIN = 'http://localhost:5173';
  process.env.TRUST_PROXY = 'false';
  process.env.DB_HOST = '127.0.0.1';
  process.env.DB_PORT = '5433';
  process.env.DB_USER = 'bajogo_app';
  process.env.DB_PASSWORD = 'Bajogo_Test_Password_1';
  process.env.DB_NAME = 'bajogo_erp_test';
  process.env.DB_ADMIN_USER = 'bajogo_app';
  process.env.DB_ADMIN_PASSWORD = 'Bajogo_Test_Password_1';
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-must-be-long-enough-32b';
  process.env.JWT_ACCESS_TTL = '15m';
  process.env.JWT_REFRESH_TTL_DAYS = '7';
  process.env.BCRYPT_ROUNDS = '4';

  const database = await import('../src/database/migrate');
  await database.ensureDatabase();
  await database.migrate();
}
