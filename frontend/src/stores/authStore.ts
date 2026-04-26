import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  mustChangePassword: boolean;
  setUser: (user: User | null) => void;
  setMustChangePassword: (must: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      mustChangePassword: false,
      setUser: (user) =>
        set({
          user,
          isAuthenticated: !!user,
        }),
      setMustChangePassword: (must) => set({ mustChangePassword: must }),
      logout: () =>
        set({
          user: null,
          isAuthenticated: false,
          mustChangePassword: false,
        }),
    }),
    {
      name: 'auth-storage',
    }
  )
);
