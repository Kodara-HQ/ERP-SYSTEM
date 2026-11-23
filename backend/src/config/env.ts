import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value.trim();
}

function optional(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined ? fallback : value.trim();
}

function origin(name: string, fallback: string): string {
  const value = optional(name, fallback).replace(/\/$/, '');
  if (!/^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?$/i.test(value)) {
    throw new Error(`${name} must be an origin such as ${fallback}.`);
  }
  return value;
}

function ttlToSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    throw new Error('JWT_ACCESS_TTL must look like 15m, 30s, 1h, or 7d.');
  }
  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const factors = { s: 1, m: 60, h: 3600, d: 86400 };
  return amount * factors[unit];
}

const nodeEnv = optional('NODE_ENV', 'development');
if (!['development', 'test', 'production'].includes(nodeEnv)) {
  throw new Error('NODE_ENV must be development, test, or production.');
}

const dbName = required('DB_NAME');
if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
  throw new Error('DB_NAME may contain only letters, numbers, and underscores.');
}

const accessTtl = optional('JWT_ACCESS_TTL', '15m');

const smsProvider = (nodeEnv === 'test' ? 'log' : optional('SMS_PROVIDER', 'log').toLowerCase()) as 'log' | 'arkesel' | 'hubtel';
if (!['log', 'arkesel', 'hubtel'].includes(smsProvider)) {
  throw new Error('SMS_PROVIDER must be log, arkesel, or hubtel.');
}

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: Number(optional('PORT', '4000')),
  // Set HOST=127.0.0.1 behind a reverse proxy so the API is not reachable directly from outside.
  host: optional('HOST', '0.0.0.0') || '0.0.0.0',
  clientOrigin: optional('CLIENT_ORIGIN', 'http://localhost:5173'),
  erpPublicUrl: origin('ERP_PUBLIC_URL', 'http://127.0.0.1:5173'),
  websitePublicUrl: origin('WEBSITE_PUBLIC_URL', 'http://127.0.0.1:5174'),
  trustProxy: optional('TRUST_PROXY', 'false') === 'true',
  db: {
    host: optional('DB_HOST', '127.0.0.1'),
    port: Number(optional('DB_PORT', '5432')),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    name: dbName,
    adminUser: optional('DB_ADMIN_USER', 'root'),
    adminPassword: optional('DB_ADMIN_PASSWORD', ''),
  },
  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    accessTtl,
    accessTtlSeconds: ttlToSeconds(accessTtl),
    refreshTtlDays: Number(optional('JWT_REFRESH_TTL_DAYS', '7')),
  },
  sms: {
    provider: smsProvider,
    senderId: optional('SMS_SENDER_ID', 'BAJOGO'),
    arkeselApiKey: optional('ARKESEL_API_KEY'),
    hubtelClientId: optional('HUBTEL_SMS_CLIENT_ID'),
    hubtelClientSecret: optional('HUBTEL_SMS_CLIENT_SECRET'),
  },
  // Email. With SMTP_HOST set, mail is sent through that server; otherwise it is only written to the log.
  mail: {
    provider: (nodeEnv !== 'test' && optional('SMTP_HOST') ? 'smtp' : 'log') as 'smtp' | 'log',
    host: optional('SMTP_HOST'),
    port: Number(optional('SMTP_PORT', '587')),
    secure: optional('SMTP_SECURE', optional('SMTP_PORT', '587') === '465' ? 'true' : 'false') === 'true',
    user: optional('SMTP_USER'),
    password: optional('SMTP_PASSWORD'),
    from: optional('MAIL_FROM'),
    // Where new website enquiries are reported. Falls back to the email in Website settings.
    enquiryNotifyTo: optional('ENQUIRY_NOTIFY_EMAIL'),
  },
  bcryptRounds: Number(optional('BCRYPT_ROUNDS', nodeEnv === 'test' ? '4' : '12')),
  seed: {
    adminUsername: optional('SEED_ADMIN_USERNAME', 'sysadmin').toLowerCase(),
    adminEmail: optional('SEED_ADMIN_EMAIL', 'sysadmin@bajogo.local').toLowerCase(),
    adminPassword: optional('SEED_ADMIN_PASSWORD', ''),
  },
};

if (env.jwt.accessSecret.length < 32) {
  throw new Error('JWT_ACCESS_SECRET must be at least 32 characters.');
}

if (env.sms.provider === 'arkesel' && !env.sms.arkeselApiKey) {
  throw new Error('ARKESEL_API_KEY is required when SMS_PROVIDER is arkesel.');
}

if (env.sms.provider === 'hubtel' && (!env.sms.hubtelClientId || !env.sms.hubtelClientSecret)) {
  throw new Error('HUBTEL_SMS_CLIENT_ID and HUBTEL_SMS_CLIENT_SECRET are required when SMS_PROVIDER is hubtel.');
}

if (env.mail.provider === 'smtp' && !env.mail.from) {
  throw new Error('MAIL_FROM is required when SMTP_HOST is set, for example "BAJOGO ENTERPRISE <info@bajogoenterprise.com>".');
}

if (!/^[A-Za-z0-9 ]{1,11}$/.test(env.sms.senderId)) {
  throw new Error('SMS_SENDER_ID must be 1 to 11 letters, numbers, or spaces.');
}

if (!Number.isFinite(env.port) || env.port <= 0) {
  throw new Error('PORT must be a positive number.');
}
