const SECRET_KEYS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'currentPassword',
  'newPassword',
  'temporaryPassword',
  'accessToken',
  'refreshToken',
  'nationalId',
  'national_id',
]);

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry));
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEYS.has(key) ? '[redacted]' : redact(entry);
    }
    return output;
  }
  return value;
}
