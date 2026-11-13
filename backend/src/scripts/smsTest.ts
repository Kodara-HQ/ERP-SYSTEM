import { env } from '../config/env';
import { normalizePhone, sendOne } from '../services/sms';

async function main() {
  const raw = process.argv[2];
  const to = normalizePhone(raw);
  if (!to) {
    console.error('Usage: npm run sms:test -w backend -- 0244123456');
    process.exit(1);
  }
  if (env.sms.provider === 'log') {
    console.error('SMS_PROVIDER is "log", so nothing would reach a phone. Set SMS_PROVIDER=arkesel in .env first.');
    process.exit(1);
  }
  const result = await sendOne(to, `BAJOGO ERP test message. SMS is working for ${env.sms.senderId}.`);
  if (result.ok) {
    console.log(`Sent to +${to} through ${env.sms.provider}. Provider message id: ${result.messageId ?? 'none'}`);
  } else {
    console.error(`Not sent: ${result.error}`);
    process.exit(1);
  }
}

void main();
