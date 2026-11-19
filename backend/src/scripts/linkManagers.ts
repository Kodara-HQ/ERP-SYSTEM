import { pool } from '../database/pool';
import { ensureAllManagerEmployees } from '../services/managerEmployees';

/** Places every manager login that is not yet an employee in its department. Safe to run again. */
ensureAllManagerEmployees(pool)
  .then(async (count) => {
    console.log(`Placed ${count} manager account(s) as employees in their departments.`);
    await pool.end();
  })
  .catch(async (error: unknown) => {
    console.error('Linking managers failed.', error);
    await pool.end();
    process.exit(1);
  });
