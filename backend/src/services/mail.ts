import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
};

let transporter: Transporter | null = null;

function transport(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.mail.host,
      port: env.mail.port,
      secure: env.mail.secure,
      auth: env.mail.user ? { user: env.mail.user, pass: env.mail.password } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  return transporter;
}

export function mailConfigured(): boolean {
  return env.mail.provider === 'smtp';
}

/** Sends one email. Returns false (and logs why) instead of throwing, so a mail problem never fails the request. */
export async function sendMail(message: MailMessage): Promise<boolean> {
  if (!mailConfigured()) {
    logger.info('Email (log provider, not sent)', { to: message.to, subject: message.subject });
    return false;
  }
  try {
    await transport().sendMail({ from: env.mail.from, ...message });
    return true;
  } catch (error) {
    logger.warn('Email send failed', { to: message.to, subject: message.subject, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}
