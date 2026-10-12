import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { ReactNode } from 'react';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export function DialogContent({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <D.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[95vw] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <D.Title className="text-lg font-semibold">{title}</D.Title>
        <D.Description className="mb-3 text-sm text-slate-500">{description ?? ' '}</D.Description>
        {children}
        <D.Close className="absolute right-3 top-3 rounded p-1 hover:bg-slate-100" aria-label="Close"><X className="h-4 w-4" /></D.Close>
      </D.Content>
    </D.Portal>
  );
}
