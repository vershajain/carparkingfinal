import { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export const Table = ({ className, ...p }: HTMLAttributes<HTMLTableElement>) => <div className="w-full overflow-x-auto"><table className={cn('w-full text-left text-sm', className)} {...p} /></div>;
export const THead = (p: HTMLAttributes<HTMLTableSectionElement>) => <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500" {...p} />;
export const TR = ({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) => <tr className={cn('border-b last:border-0', className)} {...p} />;
export const TH = ({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) => <th scope="col" className={cn('whitespace-nowrap px-3 py-2 font-medium', className)} {...p} />;
export const TD = ({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn('px-3 py-2 align-top', className)} {...p} />;
