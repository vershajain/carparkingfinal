import { factorLabels } from '../lib/format';

/** Shows the real factor values, weights and weighted contributions produced by the scheduling engine. */
export function FactorTable({ factors, weights, contributions, total }: { factors: any; weights: any; contributions: any; total?: number }) {
  const keys = Object.keys(factorLabels);
  const max = Math.max(...keys.map((k) => contributions[k] ?? 0), 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-1 pr-2">Factor</th><th className="pr-2">Value (0-1)</th><th className="pr-2">Weight</th><th className="pr-2">Contribution</th><th className="w-1/3" aria-hidden /></tr></thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k} className="border-t">
              <td className="py-1 pr-2">{factorLabels[k]}</td><td className="pr-2 font-mono">{factors[k]}</td><td className="pr-2 font-mono">{weights[k]}</td>
              <td className="pr-2 font-mono">{(contributions[k] ?? 0).toFixed(2)}</td>
              <td><div className="h-2 rounded bg-slate-100"><div className="h-2 rounded bg-indigo-500" style={{ width: `${((contributions[k] ?? 0) / max) * 100}%` }} /></div></td>
            </tr>
          ))}
          {total !== undefined && <tr className="border-t font-semibold"><td colSpan={3} className="py-1">PriorityScore = 100 x sum(weight x value)</td><td className="font-mono">{total.toFixed(2)}</td><td /></tr>}
        </tbody>
      </table>
    </div>
  );
}
