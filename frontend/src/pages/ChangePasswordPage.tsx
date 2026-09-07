import { useState } from 'react';
import { Lock } from 'lucide-react';
import api from '@/api/client';
import { PasswordChangeForm } from '@/components/PasswordChangeForm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/stores/authStore';

export function ChangePasswordPage() {
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const credentialChangePending = useAuthStore((state) => state.credentialChangePending);
  const signOut = async () => {
    if (loggingOut || useAuthStore.getState().logoutPending || useAuthStore.getState().credentialChangePending) return;
    useAuthStore.getState().setLogoutPending(true);
    setLoggingOut(true);
    setError(null);
    try {
      const response = await api.post('/auth/logout');
      if (!response.success) {
        setError(response.error?.message || 'Could not sign out. Please try again.');
        return;
      }
      api.invalidateCsrfToken();
      useAuthStore.getState().logout();
    } finally {
      useAuthStore.getState().setLogoutPending(false);
      setLoggingOut(false);
    }
  };

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Lock className="h-5 w-5" />Change your password</CardTitle>
          <CardDescription>Your account requires a new password before you can access the security console.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <PasswordChangeForm />
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <Button variant="outline" onClick={signOut} disabled={loggingOut || credentialChangePending}>
            {loggingOut ? 'Signing out...' : 'Sign out'}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
