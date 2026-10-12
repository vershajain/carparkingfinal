import { useState } from 'react';
import { toast } from 'sonner';
import { errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';
import { Input, Label } from './ui/input';

export function LoginDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { login } = useAuth();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await login(u, p); toast.success(`Logged in as ${u}`); onOpenChange(false); setP(''); }
    catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Staff login" description="Operators verify priority, manage slots, sessions and reservations. Admins also change configuration.">
        <div className="space-y-3" onKeyDown={(e) => e.key === 'Enter' && submit()}>
          <div><Label htmlFor="lu">Username</Label><Input id="lu" value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" /></div>
          <div><Label htmlFor="lp">Password</Label><Input id="lp" type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" /></div>
          <Button onClick={submit} disabled={busy || !u || !p} className="w-full">Log in</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
