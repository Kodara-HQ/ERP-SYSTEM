export class ApiError extends Error {
  status: number;
  code?: string;
  details?: { path: string; message: string }[];

  constructor(status: number, message: string, code?: string, details?: { path: string; message: string }[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let refreshRequest: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  const response = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-BAJOGO-Client': 'web' },
  });
  return response.ok;
}

export async function api<T>(path: string, options: RequestInit = {}, allowRefresh = true): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('X-BAJOGO-Client', 'web');
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (response.status === 401 && allowRefresh && path !== '/v1/auth/login' && path !== '/v1/auth/refresh') {
    refreshRequest ??= refreshSession().finally(() => {
      refreshRequest = null;
    });
    if (await refreshRequest) {
      return api<T>(path, options, false);
    }
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.message ?? 'The request could not be completed.',
      payload?.error?.code,
      payload?.error?.details,
    );
  }
  return payload as T;
}
