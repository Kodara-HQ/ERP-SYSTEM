import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

export interface SessionUser {
  id: number;
  username: string;
  email: string | null;
  employeeId: number | null;
  employeeName: string | null;
  mustChangePassword: boolean;
  roles: string[];
  permissions: string[];
  workspaces: string[];
}

interface AuthState {
  user: SessionUser | null;
  ready: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  async function refreshUser(): Promise<void> {
    const response = await api<{ data: SessionUser }>('/v1/auth/me');
    setUser(response.data);
  }

  useEffect(() => {
    refreshUser()
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const value = useMemo<AuthState>(() => ({
    user,
    ready,
    async signIn(username: string, password: string) {
      await api('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      await refreshUser();
    },
    async signOut() {
      await api('/v1/auth/logout', { method: 'POST' });
      setUser(null);
    },
    refreshUser,
    can(permission: string) {
      return user?.permissions.includes(permission) ?? false;
    },
  }), [ready, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.');
  }
  return context;
}
