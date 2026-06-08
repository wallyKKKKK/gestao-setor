export function DashboardCard({ label, val, color }: { label: string; val: number; color: string }) {
  return (
    <div className={`rounded-[28px] border-2 p-6 text-center shadow-sm transition-transform hover:-translate-y-0.5 ${color}`}>
      <span className="text-[10px] font-black uppercase tracking-[0.2em] block mb-2 opacity-40">{label}</span>
      <span className="text-6xl font-black tracking-tighter">{val}</span>
    </div>
  );
}
