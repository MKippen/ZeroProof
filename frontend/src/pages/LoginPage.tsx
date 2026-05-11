import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, Shield, CheckCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/hooks/useToast';
import api from '@/api/client';

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setUser, setMustChangePassword } = useAuthStore();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const response = await api.post<{ user: { id: number }; mustChangePassword: boolean }>(
      '/auth/login',
      { password }
    );

    setLoading(false);

    if (response.success && response.data) {
      // Session ID rotates after login — drop the cached CSRF token so the
      // next mutating request lazily fetches a fresh one for the new session.
      api.invalidateCsrfToken();
      setUser(response.data.user);
      setMustChangePassword(response.data.mustChangePassword);

      toast({
        title: "It's fine. (We checked.)",
        description: 'Welcome back.',
      });

      navigate('/dashboard');
    } else {
      toast({
        variant: 'destructive',
        title: 'Access denied',
        description: response.error?.message || 'Invalid password',
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-950/30 via-background to-background relative overflow-hidden">
      {/* Animated fire glow background - spans full page */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-orange-500/10 rounded-full blur-3xl animate-pulse-slow" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-yellow-500/10 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 w-[300px] h-[300px] bg-red-500/5 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '2s' }} />
      </div>

      {/* Grid pattern overlay - spans full page */}
      <div className="absolute inset-0 bg-grid-pattern opacity-30 pointer-events-none" />

      {/* Centered content container */}
      <div className="relative flex flex-col lg:flex-row items-center lg:items-end lg:justify-center gap-8 lg:gap-20 px-4 py-6 sm:p-6 max-w-7xl mx-auto w-full">
        {/* Left side - Branding */}
        <div className="hidden lg:flex flex-col items-center">
          {/* Wordmark */}
          <h1 className="text-5xl xl:text-6xl font-bold tracking-tight mb-2">
            <span className="text-foreground">Zero</span>
            <span className="text-orange-400">Proof</span>
          </h1>

          {/* Primary Tagline */}
          <p className="text-2xl font-semibold text-orange-400/90 mb-2 tracking-wide">
            Trust nothing. Validate everything.
          </p>

          {/* Descriptor */}
          <p className="text-lg text-muted-foreground mb-8 text-center whitespace-nowrap">
            Network security validation for UniFi environments
          </p>

          {/* Bottom tagline */}
          <p className="text-sm text-muted-foreground/80 font-mono italic">
            "Because configs lie."
          </p>
          <p className="mt-2 mb-8 text-xs text-muted-foreground/50 font-mono">
            100% Local  •  Zero Telemetry  •  Your Network, Your Data
          </p>

          {/* Terminal-style validation display */}
          <div className="bg-card/50 backdrop-blur-sm border border-border/50 rounded-lg p-6 w-[28rem] font-mono text-sm">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border/50">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="ml-2 text-muted-foreground text-xs">zeroproof --validate</span>
            </div>
            <div className="space-y-2 text-muted-foreground">
              <p className="flex items-center gap-2">
                <Shield className="h-3.5 w-3.5 text-orange-400" />
                <span className="text-green-400">validate</span> firewall_policies
                <CheckCircle className="h-3.5 w-3.5 text-emerald-400 ml-auto" />
              </p>
              <p className="flex items-center gap-2">
                <Shield className="h-3.5 w-3.5 text-orange-400" />
                <span className="text-green-400">validate</span> vlan_segmentation
                <CheckCircle className="h-3.5 w-3.5 text-emerald-400 ml-auto" />
              </p>
              <p className="flex items-center gap-2">
                <Shield className="h-3.5 w-3.5 text-orange-400" />
                <span className="text-green-400">validate</span> wireless_security
                <CheckCircle className="h-3.5 w-3.5 text-emerald-400 ml-auto" />
              </p>
              <p className="flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />
                <span className="text-yellow-400">warning</span> upnp_enabled
                <span className="text-yellow-400 ml-auto text-xs">REVIEW</span>
              </p>
              <div className="pt-3 mt-2 border-t border-border/50">
                <p className="text-emerald-400 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  It's fine. (We checked.)
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right side - Login form */}
        <div className="w-full max-w-[28rem]">
          {/* Mobile logo */}
          <div className="lg:hidden flex flex-col items-center mb-8">
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="text-foreground">Zero</span>
              <span className="text-orange-400">Proof</span>
            </h1>
            <p className="text-sm text-orange-400/80 mt-1 font-medium">Trust nothing. Validate everything.</p>
            <p className="text-xs text-muted-foreground mt-1">Network security validation for UniFi</p>
          </div>

          {/* Login card */}
          <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-5 sm:p-8 shadow-glow-orange">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold mb-2">Welcome back</h2>
              <p className="text-muted-foreground text-sm">
                Sign in to access the security console
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5 text-orange-500" />
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    required
                    autoComplete="current-password"
                    autoFocus
                    className="bg-background/50 border-border/50 focus:border-orange-500/50 focus:ring-orange-500/20 font-mono pr-10 h-11"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground hover:text-orange-400 transition-colors" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground hover:text-orange-400 transition-colors" />
                    )}
                  </Button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-orange-600 hover:bg-orange-500 text-white font-medium transition-all duration-200 shadow-glow-orange hover:shadow-[0_0_30px_rgba(249,115,22,0.4)] h-11"
                disabled={loading}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Validating...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    Sign In
                  </span>
                )}
              </Button>
            </form>

          </div>

        </div>
      </div>
    </div>
  );
}
