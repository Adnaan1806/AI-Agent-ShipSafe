import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from './types';
import { api } from './api';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

function getStoredUser(): User | null {
  const raw = localStorage.getItem('shipsafe_user');
  return raw ? (JSON.parse(raw) as User) : null;
}

function storeAuth(token: string, user: User) {
  localStorage.setItem('shipsafe_token', token);
  localStorage.setItem('shipsafe_user', JSON.stringify(user));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = getStoredUser();
    const token = localStorage.getItem('shipsafe_token');
    if (stored && token) setUser(stored);
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    const { token, user } = await api.post<{ token: string; user: User }>(
      '/api/auth/login',
      { email, password },
    );
    storeAuth(token, user);
    setUser(user);
  };

  const register = async (email: string, password: string) => {
    const { token, user } = await api.post<{ token: string; user: User }>(
      '/api/auth/register',
      { email, password },
    );
    storeAuth(token, user);
    setUser(user);
  };

  const logout = () => {
    localStorage.removeItem('shipsafe_token');
    localStorage.removeItem('shipsafe_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
