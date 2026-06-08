"use client";

interface ProfileModalProps {
  newName: string;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function ProfileModal({ newName, onNameChange, onSave, onClose }: ProfileModalProps) {
  return (
    <div className="fixed inset-0 bg-slate-900/16 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-sm rounded-[30px] border border-slate-200 bg-white p-8 text-center shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
        <h2 className="text-2xl font-black uppercase mb-6 tracking-tighter">Meu Perfil</h2>
        <input
          className="mb-6 w-full rounded-2xl border-2 border-slate-100 bg-slate-50 p-4 font-black text-slate-900 outline-none transition-all focus:border-blue-500 focus:bg-white"
          placeholder="Nome Completo"
          value={newName}
          onChange={e => onNameChange(e.target.value)}
        />
        <button onClick={onSave} className="w-full bg-blue-600 text-white p-5 rounded-3xl font-black uppercase text-lg shadow-lg hover:bg-slate-900 transition-all">
          Salvar Dados
        </button>
        <button onClick={onClose} className="w-full mt-4 text-slate-400 font-bold uppercase text-[10px] tracking-widest">
          Fechar
        </button>
      </div>
    </div>
  );
}
