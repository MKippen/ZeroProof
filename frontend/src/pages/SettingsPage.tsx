import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  Settings,
  Lock,
  Database,
  FileJson,
  FileText,
  Wand2,
  Network,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import api from '@/api/client';
import { useToast } from '@/hooks/useToast';
import { useAuthStore } from '@/stores/authStore';
import { ConfigContent } from './ConfigPage';
import { WizardContent } from './NetworkWizardPage';
import { RulesContent } from './RulesPage';
import { DnsProxyConnectionForm } from '@/components/DnsProxyConnectionForm';

const TAB_VALUES = ['general', 'configuration', 'dns-proxy', 'wizard', 'rules'] as const;
type TabValue = (typeof TAB_VALUES)[number];

function tabFromHash(hash: string): TabValue {
  const stripped = hash.replace(/^#/, '');
  return (TAB_VALUES as readonly string[]).includes(stripped) ? (stripped as TabValue) : 'general';
}

export function SettingsPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { toast } = useToast();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<TabValue>(() => tabFromHash(location.hash));
  useEffect(() => {
    setActiveTab(tabFromHash(location.hash));
  }, [location.hash]);
  const { mustChangePassword, setMustChangePassword } = useAuthStore();
  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirmPassword) {
        throw new Error('Passwords do not match');
      }
      if (newPassword.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }
      const response = await api.post('/auth/change-password', {
        currentPassword,
        newPassword,
      });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to change password');
      }
    },
    onSuccess: () => {
      toast({ title: 'Password changed successfully' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMustChangePassword(false);
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your account and application settings</p>
      </div>

      {mustChangePassword && (
        <Card className="border-yellow-500/50 bg-yellow-500/10">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-yellow-400">
              <Lock className="h-5 w-5" />
              <span className="font-medium">Please change your password</span>
            </div>
            <p className="text-sm text-yellow-400/80 mt-1">
              You are using the default password. Please change it for security.
            </p>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabValue)} className="space-y-4">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="general" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            General
          </TabsTrigger>
          <TabsTrigger value="configuration" className="flex items-center gap-2">
            <FileJson className="h-4 w-4" />
            UniFi Configuration
          </TabsTrigger>
          <TabsTrigger value="dns-proxy" className="flex items-center gap-2">
            <Network className="h-4 w-4" />
            DNS Proxy
          </TabsTrigger>
          <TabsTrigger value="wizard" className="flex items-center gap-2">
            <Wand2 className="h-4 w-4" />
            Security Wizard
          </TabsTrigger>
          <TabsTrigger value="rules" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Rules
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
      {/* Change Password */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Change Password
          </CardTitle>
          <CardDescription>Update your account password</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              changePasswordMutation.mutate();
            }}
            className="space-y-4 max-w-md"
          >
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current Password</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
              <p className="text-xs text-muted-foreground">Minimum 8 characters</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={changePasswordMutation.isPending}>
              {changePasswordMutation.isPending ? 'Changing...' : 'Change Password'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* System Info */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            System Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Version</span>
              <span className="font-mono">1.0.0</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">API Endpoint</span>
              <span className="font-mono text-xs">/api/v1</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Data Storage</span>
              <span className="text-emerald-400">100% Local</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Telemetry</span>
              <span className="text-emerald-400">None</span>
            </div>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="configuration" className="space-y-6">
          <ConfigContent />

        </TabsContent>

        <TabsContent value="dns-proxy" className="space-y-6">
          <DnsProxyConnectionForm />
        </TabsContent>

        <TabsContent value="wizard">
          <WizardContent />
        </TabsContent>

        <TabsContent value="rules">
          <RulesContent />
        </TabsContent>
      </Tabs>
    </div>
  );
}
