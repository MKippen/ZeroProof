import { useRef, useState } from 'react';
import api from '@/api/client';
import { verifySession } from '@/auth/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/useToast';
import { useAuthStore } from '@/stores/authStore';

export function PasswordChangeForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const { toast } = useToast();
  const logoutPending = useAuthStore((state) => state.logoutPending);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || useAuthStore.getState().logoutPending) return;
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    if (new TextEncoder().encode(newPassword).length > 72) {
      setError('Your password is too long. Use fewer characters.');
      return;
    }
    if (currentPassword === newPassword) {
      setError('Choose a different password from your current password.');
      return;
    }
    submitting.current = true;
    setPending(true);
    useAuthStore.getState().beginCredentialChange();
    try {
      const response = await api.post('/auth/change-password', { currentPassword, newPassword });
      if (!response.success) {
        if (response.error?.code === 'PASSWORD_CHANGED_SESSION_EXPIRED') {
          toast({ title: 'Password changed', description: 'Sign in with your new password.' });
          return;
        }
        setError(response.error?.message || 'Could not change your password. Please try again.');
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      api.invalidateCsrfToken();
      toast({ title: 'Password changed successfully' });
      // Rotation invalidates the old session. Only /me can clear the account
      // restriction; if verification fails the boundary offers a read-only retry.
      await verifySession();
    } finally {
      useAuthStore.getState().finishCredentialChange();
      submitting.current = false;
      setPending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md" aria-busy={pending || logoutPending}>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="space-y-2">
        <Label htmlFor="currentPassword">Current Password</Label>
        <Input id="currentPassword" type="password" autoComplete="current-password" value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)} required disabled={pending || logoutPending} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="newPassword">New Password</Label>
        <Input id="newPassword" type="password" autoComplete="new-password" value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)} required minLength={8} maxLength={100}
          aria-describedby="new-password-help" disabled={pending || logoutPending} />
        <p id="new-password-help" className="text-xs text-muted-foreground">Minimum 8 characters. Use a different password from your current password.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm New Password</Label>
        <Input id="confirmPassword" type="password" autoComplete="new-password" value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)} required disabled={pending || logoutPending} />
      </div>
      <Button type="submit" disabled={pending || logoutPending}>{pending ? 'Changing...' : 'Change Password'}</Button>
    </form>
  );
}
