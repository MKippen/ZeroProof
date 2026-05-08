import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, Shield, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/useToast';
import { useAuthStore } from '@/stores/authStore';
import api from '@/api/client';

const MIN_PASSWORD_LENGTH = 12;

export function SetupPage() {
  // Default to "admin" so the form is immediately submittable once both
  // password fields are filled. Users who want a different username can
  // still edit the field; defaulting matches what 99% of installs end up
  // with anyway and avoids the dead-button trap when "admin" looks
  // pre-filled (it was just a placeholder before).
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { setUser, setMustChangePassword } = useAuthStore();

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const passwordsMismatch =
    confirmPassword.length > 0 && password !== confirmPassword;
  const usernameInvalid =
    username.length > 0 && !/^[A-Za-z0-9._-]{3,64}$/.test(username);

  const canSubmit =
    !!username &&
    !usernameInvalid &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password === confirmPassword &&
    !submitting;

  // What's blocking submit, in priority order. Surfaced beneath the button
  // when it's disabled so the user isn't left guessing which field is wrong.
  const submitBlocker = !username
    ? 'Enter a username to continue.'
    : usernameInvalid
      ? '3–64 characters: letters, numbers, dot, underscore, hyphen.'
      : password.length === 0
        ? 'Choose a password.'
        : passwordTooShort
          ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
          : confirmPassword.length === 0
            ? 'Confirm your password.'
            : passwordsMismatch
              ? 'Passwords do not match.'
              : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);

    const response = await api.post<{ user: { id: number; username: string } }>(
      '/auth/setup',
      { username, password }
    );

    setSubmitting(false);

    if (response.success && response.data) {
      // The backend stamped the session on a successful /setup, so we're
      // already logged in. Drop the cached CSRF token (session id rotated)
      // and route straight to the dashboard — no /login bounce.
      api.invalidateCsrfToken();
      setUser(response.data.user);
      setMustChangePassword(false);
      toast({
        title: 'Admin account created',
        description: `Welcome, ${response.data.user.username}.`,
      });
      navigate('/dashboard');
    } else if (response.error?.code === 'ALREADY_INITIALIZED') {
      toast({
        title: 'Already set up',
        description: 'An admin already exists. Sign in instead.',
      });
      navigate('/login');
    } else {
      toast({
        variant: 'destructive',
        title: 'Setup failed',
        description: response.error?.message || 'Could not complete setup',
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-950/30 via-background to-background relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-orange-500/10 rounded-full blur-3xl animate-pulse-slow" />
        <div
          className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-yellow-500/10 rounded-full blur-3xl animate-pulse-slow"
          style={{ animationDelay: '1s' }}
        />
      </div>

      <div className="absolute inset-0 bg-grid-pattern opacity-30 pointer-events-none" />

      <div className="relative w-full max-w-md px-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-orange-500/15 mb-4">
            <Shield className="h-6 w-6 text-orange-400" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">
            <span className="text-foreground">Welcome to </span>
            <span className="text-orange-400">ZeroProof</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            Create your administrator account to begin.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-border/50 bg-background/40 backdrop-blur-md p-6"
        >
          <div className="space-y-2">
            <Label htmlFor="setup-username">Username</Label>
            <Input
              id="setup-username"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              className="font-mono"
            />
            {usernameInvalid && (
              <p className="text-xs text-red-400">
                3-64 characters, letters/numbers/dot/underscore/hyphen only.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="setup-password">Password</Label>
            <div className="relative">
              <Input
                id="setup-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
            {passwordTooShort && (
              <p className="text-xs text-red-400">
                Use at least {MIN_PASSWORD_LENGTH} characters.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="setup-password-confirm">Confirm password</Label>
            <Input
              id="setup-password-confirm"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            {passwordsMismatch && (
              <p className="text-xs text-red-400">Passwords don&apos;t match.</p>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-md bg-muted/30 border border-border/50 p-3 text-xs text-muted-foreground">
            <Lock className="h-4 w-4 text-orange-400 flex-shrink-0 mt-0.5" />
            <span>
              ZeroProof never ships with a default password. The credentials you
              choose here are stored as a bcrypt hash and used only on this
              machine.
            </span>
          </div>

          <Button
            type="submit"
            disabled={!canSubmit}
            className="w-full bg-orange-600 hover:bg-orange-500"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            {submitting ? 'Creating account…' : 'Create administrator account'}
          </Button>
          {submitBlocker && (
            <p
              className="text-xs text-muted-foreground text-center"
              aria-live="polite"
            >
              {submitBlocker}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
