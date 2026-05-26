export function DashboardCard({ label, val, color }: { label: string; val: number; color: string }) {
  return (
    <div className={`p-8 rounded-[40px] border-4 shadow-[10px_10px_0px_0px_rgba(15,23,42,1)] text-center transition-transform hover:scale-105 ${color}`}>
      <span className="text-[10px] font-black uppercase tracking-[0.2em] block mb-2 opacity-40">{label}</span>
      <span className="text-6xl font-black tracking-tighter">{val}</span>
    </div>
  );
}
