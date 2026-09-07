import { create } from 'zustand';
import type { User } from '@/types';

type VerificationStatus = 'checking' | 'ready' | 'error';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  mustChangePassword: boolean;
  initialized: boolean | null;
  verificationStatus: VerificationStatus;
  verificationError: string | null;
  // Invalidates responses/cache work that belonged to an earlier account state.
  sessionVersion: number;
  credentialChangePending: boolean;
  beginCredentialChange: () => void;
  finishCredentialChange: () => void;
  beginVerification: () => void;
  failVerification: (message: string) => void;
  setUser: (user: User | null) => void;
  setAnonymous: (initialized: boolean) => void;
  setInitialized: (initialized: boolean) => void;
  setMustChangePassword: (must: boolean) => void;
  logout: () => void;
}

// Authentication is intentionally memory-only. The server's httpOnly session
// cookie is verified on each application boot; browser storage grants no access.
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  mustChangePassword: false,
  initialized: null,
  verificationStatus: 'checking',
  verificationError: null,
  sessionVersion: 0,
  credentialChangePending: false,
  beginCredentialChange: () => set((state) => ({ credentialChangePending: true, sessionVersion: state.sessionVersion + 1 })),
  finishCredentialChange: () => set({ credentialChangePending: false }),
  beginVerification: () => set({ verificationStatus: 'checking', verificationError: null }),
  failVerification: (message) => set({ verificationStatus: 'error', verificationError: message }),
  setUser: (user) => set((state) => ({
    user,
    isAuthenticated: !!user,
    mustChangePassword: user?.mustChangePassword ?? false,
    initialized: user ? true : state.initialized,
    verificationStatus: 'ready',
    verificationError: null,
    credentialChangePending: false,
    sessionVersion: state.sessionVersion + 1,
  })),
  setAnonymous: (initialized) => set((state) => ({
    user: null,
    isAuthenticated: false,
    mustChangePassword: false,
    initialized,
    verificationStatus: 'ready',
    verificationError: null,
    credentialChangePending: false,
    sessionVersion: state.sessionVersion + 1,
  })),
  setInitialized: (initialized) => set({ initialized }),
  setMustChangePassword: (must) => set((state) => state.mustChangePassword === must ? state : ({
    mustChangePassword: must,
    user: state.user ? { ...state.user, mustChangePassword: must } : null,
    sessionVersion: state.sessionVersion + 1,
  })),
  logout: () => set((state) => ({
    user: null,
    isAuthenticated: false,
    mustChangePassword: false,
    initialized: true,
    verificationStatus: 'ready',
    verificationError: null,
    credentialChangePending: false,
    sessionVersion: state.sessionVersion + 1,
  })),
}));
