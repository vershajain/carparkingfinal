import { cva, type VariantProps } from 'class-variance-authority';
import { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const v = cva('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      slate: 'border-slate-200 bg-slate-100 text-slate-700', green: 'border-green-300 bg-green-50 text-green-800',
      red: 'border-red-300 bg-red-50 text-red-800', amber: 'border-amber-300 bg-amber-50 text-amber-900',
      gray: 'border-gray-300 bg-gray-200 text-gray-700', indigo: 'border-indigo-300 bg-indigo-50 text-indigo-800',
    },
  },
  defaultVariants: { tone: 'slate' },
});
export const Badge = ({ className, tone, ...p }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof v>) => <span className={cn(v({ tone }), className)} {...p} />;
