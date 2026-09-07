import { useEffect, useState } from 'react';
import { PasswordChangeForm } from '@/components/PasswordChangeForm';
import { useLocation } from 'react-router-dom';
import {
  Settings,
  Lock,
  Database,
  FileJson,
  FileText,
  ShieldCheck,
  Wand2,
  Network,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfigContent } from './ConfigPage';
import { WizardContent } from './NetworkWizardPage';
import { RulesContent } from './RulesPage';
import { DnsProxyConnectionForm } from '@/components/DnsProxyConnectionForm';
import { DnsAllowlistSettings } from '@/components/DnsAllowlistSettings';
import { SystemUpdateCard } from '@/components/SystemUpdateCard';

const TAB_VALUES = [
  'general',
  'configuration',
  'dns-proxy',
  'allowlist',
  'wizard',
  'rules',
] as const;
type TabValue = (typeof TAB_VALUES)[number];

function tabFromHash(hash: string): TabValue {
  const stripped = hash.replace(/^#/, '');
  return (TAB_VALUES as readonly string[]).includes(stripped) ? (stripped as TabValue) : 'general';
}

export function SettingsPage() {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<TabValue>(() => tabFromHash(location.hash));
  useEffect(() => {
    setActiveTab(tabFromHash(location.hash));
  }, [location.hash]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your account and application settings</p>
      </div>

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
          <TabsTrigger value="allowlist" className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            DNS Allowlist
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
          <PasswordChangeForm />
        </CardContent>
      </Card>

      {/* Updates */}
      <SystemUpdateCard />

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

        <TabsContent value="allowlist" className="space-y-6">
          <DnsAllowlistSettings />
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
