import { forwardRef, InputHTMLAttributes, LabelHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const field = 'h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm placeholder:text-slate-400 disabled:bg-slate-100';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn(field, className)} {...p} />);
Input.displayName = 'Input';
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cn(field, 'pr-8', className)} {...p} />);
Select.displayName = 'Select';
export const Label = ({ className, ...p }: LabelHTMLAttributes<HTMLLabelElement>) => <label className={cn('mb-1 block text-sm font-medium text-slate-700', className)} {...p} />;
