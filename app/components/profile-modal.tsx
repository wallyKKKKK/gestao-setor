"use client";

interface ProfileModalProps {
  newName: string;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function ProfileModal({ newName, onNameChange, onSave, onClose }: ProfileModalProps) {
  return (
    <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white p-10 rounded-[40px] w-full max-w-sm border-4 border-slate-900 shadow-2xl text-center">
        <h2 className="text-2xl font-black uppercase mb-6 tracking-tighter">Meu Perfil</h2>
        <input
          className="w-full p-4 border-4 border-slate-100 rounded-2xl font-black mb-6 text-slate-900 outline-none focus:border-blue-500 transition-all"
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
