import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { checkDatabase } from './database/pool';
import { openApi } from './docs/openapi';
import { errorHandler } from './middleware/errorHandler';
import { approvalsRouter } from './modules/approvals/approval.routes';
import { authRouter } from './modules/auth/auth.routes';
import { companyRouter } from './modules/company/company.routes';
import { employeesRouter } from './modules/employees/employees.routes';
import { hrRouter } from './modules/hr/hr.routes';
import { inventoryRouter, procurementRouter } from './modules/supply/supply.routes';
import { financeRouter } from './modules/finance/finance.routes';
import { payrollRouter } from './modules/payroll/payroll.routes';
import { legalRouter } from './modules/legal/legal.routes';
import { operationsRouter } from './modules/operations/operations.routes';
import { executiveRouter } from './modules/executive/executive.routes';
import { organisationRouter } from './modules/organisation/organisation.routes';
import { rolesRouter } from './modules/roles/roles.routes';
import { auditRouter, dashboardRouter, notificationsRouter, searchRouter } from './modules/system/system.routes';
import { directoryRouter, usersRouter } from './modules/users/users.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { governanceRouter } from './modules/governance/governance.routes';
import { managementRouter } from './modules/management/management.routes';
import { registersRouter } from './modules/registers/registers.routes';
import { farmRouter } from './modules/farm/farm.routes';
import { websitePublicRouter, websiteRouter } from './modules/website/website.routes';

export function createApp() {
  const app = express();
  app.set('trust proxy', env.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({
    origin: env.clientOrigin,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-BAJOGO-Client'],
  }));
  const smallJson = express.json({ limit: '1mb' });
  const documentJson = express.json({ limit: '8mb' });
  app.use((req, res, next) => (/\/(documents|import|media)\/?$/.test(req.path) || /\/applications\/?$/.test(req.path) ? documentJson : smallJson)(req, res, next));
  app.use(cookieParser());

  if (!env.isTest) {
    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { message: 'Too many attempts. Try again later.', code: 'RATE_LIMITED' } },
    });
    app.use('/api/v1/auth/login', authLimiter);
  }

  app.get('/api/v1/health', async (_req, res, next) => {
    try {
      await checkDatabase();
      res.json({ data: { status: 'ok', database: 'up' } });
    } catch (error) {
      next(error);
    }
  });

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApi));
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/company', companyRouter);
  app.use('/api/v1/organisation', organisationRouter);
  app.use('/api/v1/employees', employeesRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/roles', rolesRouter);
  app.use('/api/v1/approvals', approvalsRouter);
  app.use('/api/v1/hr', hrRouter);
  app.use('/api/v1/procurement', procurementRouter);
  app.use('/api/v1/inventory', inventoryRouter);
  app.use('/api/v1/finance', financeRouter);
  app.use('/api/v1/payroll', payrollRouter);
  app.use('/api/v1/legal', legalRouter);
  app.use('/api/v1/operations', operationsRouter);
  app.use('/api/v1/executive', executiveRouter);
  app.use('/api/v1/audit', auditRouter);
  app.use('/api/v1/notifications', notificationsRouter);
  app.use('/api/v1/dashboard', dashboardRouter);
  app.use('/api/v1/search', searchRouter);
  app.use('/api/v1/directory', directoryRouter);
  app.use('/api/v1/reports', reportsRouter);
  app.use('/api/v1/governance', governanceRouter);
  app.use('/api/v1/management', managementRouter);
  app.use('/api/v1/registers', registersRouter);
  app.use('/api/v1/farm', farmRouter);
  app.use('/api/v1/public/website', websitePublicRouter);
  app.use('/api/v1/website', websiteRouter);

  app.use(errorHandler);
  return app;
}
