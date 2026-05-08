'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { 
  Plus, Trash2, CheckCircle2, Circle, LayoutDashboard, 
  LogOut, Calendar, Tag, User, Repeat, X, Check, AlertCircle, TrendingUp,
  Edit3
} from 'lucide-react'

export default function App() {
  const [user, setUser] = useState<any>(null)
  const [profiles, setProfiles] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingTask, setEditingTask] = useState<any>(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [dashFilter, setDashFilter] = useState<'HOJE' | 'SEMANAL'>('HOJE')

  // Estados de Interface
  const [activeTab, setActiveTab] = useState('HOJE')
  const categories = ['HOJE', 'ATRASADOS', 'Minhas', 'Todas', 'Trade', 'Reunião', 'DASHBOARD']

  // Estados de Criação
  const [taskTitle, setTaskTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [category, setCategory] = useState('Trade')
  const [repeatInterval, setRepeatInterval] = useState(1)
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  
  const weekDays = [
    { id: 'seg', label: 'S' }, { id: 'ter', label: 'T' }, 
    { id: 'qua', label: 'Q' }, { id: 'qui', label: 'Q' }, { id: 'sex', label: 'S' }
  ]

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
        setAssignedTo(session.user.id)
        fetchProfiles()
      }
    })
  }, [])

  useEffect(() => { if (user) fetchTasks() }, [user])

  async function fetchProfiles() {
    const { data } = await supabase.from('profiles').select('*')
    if (data) setProfiles(data)
  }
   // Adicione um novo estado no topo do App:
const [userRole, setUserRole] = useState('membro');

// Atualize o useEffect que verifica a sessão:
useEffect(() => {
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session?.user) {
      setUser(session.user);
      setAssignedTo(session.user.id);
      
      // BUSCAR O CARGO DO USUÁRIO
      supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single()
        .then(({ data }) => {
          if (data) setUserRole(data.role);
        });
        
      fetchProfiles();
    }
  });
}, []);

  async function fetchTasks() {
  const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
  if (data) {
    console.log("Tarefas carregadas do banco:", data.length); // Isso aparecerá no F12 do navegador
    setTasks(data);
  }
  if (error) {
    console.error("Erro ao carregar tarefas:", error);
  }
}

  async function updateProfile() {
    if (!newName) return alert("Digite um nome!");
    const { error } = await supabase.from('profiles').update({ full_name: newName }).eq('id', user.id);
    if (!error) { alert("Perfil atualizado!"); setShowProfileModal(false); setNewName(''); fetchProfiles(); }
  }

  async function addTask() {
    if (!taskTitle) return
    const isRecurring = selectedDays.length > 0;
    const { error } = await supabase.from('tasks').insert([{ 
        title: taskTitle.toUpperCase(), 
        assigned_to: assignedTo, 
        status: 'pendente', 
        category, 
        notes, 
        repeat_days: selectedDays.join(','),
        repeat_interval: repeatInterval,
        due_date: isRecurring ? null : new Date().toISOString().split('T')[0] 
    }])
    if (error) alert(error.message)
    else { setTaskTitle(''); setNotes(''); setSelectedDays([]); setRepeatInterval(1); fetchTasks(); }
  }

  async function toggleComplete(task: any) {
    const todayDate = new Date().toISOString().split('T')[0];
    const isCurrentlyDone = task.last_done_date === todayDate;
    const newDate = isCurrentlyDone ? null : todayDate;
    await supabase.from('tasks').update({ last_done_date: newDate, status: newDate ? 'concluido' : 'pendente' }).eq('id', task.id);
    fetchTasks();
  }

  async function updateTask() {
    if (!editingTask.title) return alert("O título não pode ser vazio!");
    const { error } = await supabase.from('tasks').update({ 
      title: editingTask.title.toUpperCase(),
      notes: editingTask.notes,
      assigned_to: editingTask.assigned_to,
      category: editingTask.category,
      repeat_days: editingTask.repeat_days,
      repeat_interval: editingTask.repeat_interval
    }).eq('id', editingTask.id);
    if (!error) { setShowEditModal(false); setEditingTask(null); fetchTasks(); }
  }

  const toggleDay = (day: string) => {
    setSelectedDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  const toggleDayInEdit = (day: string) => {
    if (!editingTask) return;
    const currentDays = editingTask.repeat_days ? editingTask.repeat_days.split(',') : [];
    const newDays = currentDays.includes(day) ? currentDays.filter((d:any) => d !== day) : [...currentDays, day];
    setEditingTask({ ...editingTask, repeat_days: newDays.join(',') });
  };

  // --- LÓGICA CENTRAL DE DATAS ---
  const today = new Date();
  today.setHours(0,0,0,0);
  const todayDate = today.toISOString().split('T')[0];
  const daysMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
  const todayTag = daysMap[today.getDay()];
  const todayIdx = today.getDay();

  const isCorrectWeek = (task: any) => {
    if (!task.created_at || task.repeat_interval <= 1) return true;
    const startDate = new Date(task.created_at);
    startDate.setHours(0,0,0,0);
    const startMonday = new Date(startDate);
    startMonday.setDate(startDate.getDate() - (startDate.getDay() === 0 ? 6 : startDate.getDay() - 1));
    const diffInWeeks = Math.floor((today.getTime() - startMonday.getTime()) / (1000 * 3600 * 24 * 7));
    return diffInWeeks % task.repeat_interval === 0;
  };

  // FILTRO GERAL
const filteredTasks = tasks.filter(task => {
  const isDoneToday = task.last_done_date === todayDate;
  const taskDays = task.repeat_days ? task.repeat_days.split(',') : [];
  const correctWeek = isCorrectWeek(task);
  
  // REGRA: Ela é pra hoje?
  const isScheduledForToday = (correctWeek && taskDays.includes(todayTag)) || task.due_date === todayDate;

  // Lógica de Atraso: Só é atrasada se:
  // NÃO foi feita hoje E NÃO é o dia dela (hoje) E algum dia dela já passou
  const isLate = !isDoneToday && !isScheduledForToday && (
    (task.due_date && task.due_date < todayDate) ||
    (correctWeek && taskDays.some((day: string) => {
      const dIdx = daysMap.indexOf(day);
      return dIdx > 0 && dIdx < todayIdx;
    }))
  );

  if (activeTab === 'ATRASADOS') return isLate;
  if (activeTab === 'HOJE') return isScheduledForToday && !isDoneToday;
  if (activeTab === 'Minhas') return task.assigned_to === user?.id;
  if (activeTab === 'Todas') return true;
  if (activeTab === 'DASHBOARD') return false;
  return task.category === activeTab;
});

  // STATS DASHBOARD
  const stats = (() => {
    const relevantTasks = tasks.filter(task => {
      const taskDays = task.repeat_days ? task.repeat_days.split(',') : [];
      if (dashFilter === 'HOJE') {
        return (taskDays.includes(todayTag) && isCorrectWeek(task)) || task.due_date === todayDate;
      } else {
        return (taskDays.length > 0 && isCorrectWeek(task)) || (task.due_date && task.due_date >= todayDate);
      }
    });
    const total = relevantTasks.length;
    const done = relevantTasks.filter(t => t.last_done_date === todayDate || (dashFilter === 'SEMANAL' && t.status === 'concluido')).length;
    return { total, concluidas: done, pendentes: total - done, porcentagem: total > 0 ? Math.round((done/total)*100) : 0 };
  })();

  if (!user) return <Login />

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 pb-20 font-sans">
      <nav className="bg-slate-900 text-white p-4 sticky top-0 z-30 shadow-2xl border-b-4 border-blue-600">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2"><LayoutDashboard className="text-blue-400" /><h1 className="text-xl font-black italic tracking-tighter">SETOR_PRO</h1></div>
          <div className="flex items-center gap-4">
             <button onClick={() => setShowProfileModal(true)} className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-xl border-2 border-slate-700 hover:border-blue-500 transition-all shadow-sm">
                <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-[10px] font-black uppercase">{profiles.find(p => p.id === user.id)?.full_name?.charAt(0) || 'U'}</div>
                <span className="text-xs font-black uppercase tracking-widest hidden md:block">{profiles.find(p => p.id === user.id)?.full_name || 'Meu Perfil'}</span>
             </button>
             <button onClick={() => supabase.auth.signOut().then(() => window.location.reload())} className="text-red-500 p-2"><LogOut size={20}/></button>
          </div>
        </div>
      </nav>

      <div className="bg-white border-b-4 border-slate-200 sticky top-[68px] z-20 overflow-x-auto no-scrollbar">
        <div className="max-w-4xl mx-auto flex">
          {categories.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`px-6 py-4 font-black text-xs uppercase tracking-tighter border-b-4 transition-all whitespace-nowrap ${activeTab === tab ? 'border-blue-600 text-blue-600 bg-blue-50' : 'border-transparent text-slate-400'}`}>{tab}</button>
          ))}
        </div>
      </div>

      <main className="max-w-4xl mx-auto p-4">
        {activeTab === 'DASHBOARD' ? (
          <div className="mt-6 space-y-6 animate-in fade-in duration-500">
            <div className="flex justify-between items-center">
              <h2 className="text-3xl font-black uppercase italic tracking-tighter flex items-center gap-2"><TrendingUp className="text-blue-600"/> Performance</h2>
              <div className="flex bg-slate-200 p-1 rounded-2xl border-2 border-slate-900 shadow-sm">
                <button onClick={() => setDashFilter('HOJE')} className={`px-6 py-2 rounded-xl font-black text-xs uppercase transition-all ${dashFilter === 'HOJE' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500'}`}>Hoje</button>
                <button onClick={() => setDashFilter('SEMANAL')} className={`px-6 py-2 rounded-xl font-black text-xs uppercase transition-all ${dashFilter === 'SEMANAL' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500'}`}>Semanal</button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <DashboardCard label={`Total ${dashFilter}`} val={stats.total} color="border-slate-900 bg-white" />
              <DashboardCard label="Concluídas" val={stats.concluidas} color="border-green-600 bg-green-50 text-green-700" />
              <DashboardCard label="Pendentes" val={stats.pendentes} color="border-blue-600 bg-blue-50 text-blue-700" />
            </div>
            <div className="bg-white p-10 rounded-[40px] border-4 border-slate-900 shadow-xl text-center">
               <h3 className="text-8xl font-black mb-6 tracking-tighter">{stats.porcentagem}%</h3>
               <div className="w-full bg-slate-100 h-12 rounded-2xl border-4 border-slate-900 overflow-hidden shadow-inner"><div className="bg-green-500 h-full transition-all duration-1000" style={{ width: `${stats.porcentagem}%` }} /></div>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-white p-6 rounded-3xl border-4 border-slate-900 shadow-xl mb-10 mt-4">
              <input className="w-full text-3xl font-black outline-none mb-2 border-b-4 border-slate-100 focus:border-blue-500 pb-2 text-slate-900 uppercase" placeholder="NOME DA TAREFA..." value={taskTitle} onChange={e => setTaskTitle(e.target.value)} />
              <textarea className="w-full mt-4 p-4 bg-slate-50 rounded-2xl font-bold text-slate-800 border-2 border-slate-200 outline-none" placeholder="Observações..." rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6 pt-6 border-t-2 border-slate-100">
                <div className="space-y-4">
                  <div className="flex flex-col"><label className="text-[10px] font-black uppercase text-slate-400">Responsável</label>
                  <select className="p-3 bg-slate-100 rounded-xl font-black border-2 border-slate-200" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id}>{p.full_name || p.id.slice(0,5)}</option>)}</select></div>
                  <div className="flex flex-col"><label className="text-[10px] font-black uppercase text-slate-400">Categoria</label>
                  <select className="p-3 bg-slate-100 rounded-xl font-black border-2 border-slate-200" value={category} onChange={e => setCategory(e.target.value)}><option>Trade</option><option>Reunião</option><option>Geral</option></select></div>
                </div>
                <div className="space-y-4">
                   <label className="text-[10px] font-black uppercase text-slate-400">Repetir nos Dias</label>
                   <div className="flex gap-1.5">{weekDays.map(day => (
                     <button key={day.id} type="button" onClick={() => toggleDay(day.id)} className={`w-9 h-9 rounded-xl font-black border-2 transition-all ${selectedDays.includes(day.id) ? 'bg-blue-600 border-blue-600 text-white scale-110' : 'bg-white border-slate-200 text-slate-400'}`}>{day.label}</button>
                   ))}</div>
                   <div className="flex flex-col"><label className="text-[10px] font-black uppercase text-slate-400">Intervalo (Semanas)</label>
                   <input type="number" min="1" className="p-3 bg-slate-100 rounded-xl font-black border-2 border-slate-200" value={repeatInterval} onChange={e => setRepeatInterval(parseInt(e.target.value) || 1)} /></div>
                </div>
                <button onClick={addTask} className="bg-blue-600 text-white rounded-[32px] font-black uppercase hover:bg-slate-900 transition-all flex flex-col items-center justify-center gap-2 py-6 shadow-xl active:scale-95"><Plus size={40}/> <span className="text-lg">Criar Tarefa</span></button>
              </div>
            </div>

            <div className="space-y-4">
              <h2 className="font-black uppercase text-slate-900 text-xs tracking-widest px-2">{activeTab} - {filteredTasks.length} ITENS</h2>
              {filteredTasks.map(task => {
  const isDoneToday = task.last_done_date === todayDate;
  const taskDays = task.repeat_days ? task.repeat_days.split(',') : [];
  const correctWeek = isCorrectWeek(task);
  
  // Mesma regra de prioridade
  const isScheduledForToday = (correctWeek && taskDays.includes(todayTag)) || task.due_date === todayDate;

  const isLate = !isDoneToday && !isScheduledForToday && (
    (task.due_date && task.due_date < todayDate) ||
    (correctWeek && taskDays.some((day: string) => daysMap.indexOf(day) > 0 && daysMap.indexOf(day) < todayIdx))
  );

  return (
    <TaskBox 
      key={task.id} 
      task={task} 
      profiles={profiles} 
      onUpdate={fetchTasks} 
      isLate={isLate} // AGORA VAI PASSAR "FALSE" SE HOJE FOR QUINTA
      isDoneToday={isDoneToday}
      onToggle={() => toggleComplete(task)}
      onEdit={(t: any) => { setEditingTask(t); setShowEditModal(true); }} 
    />
  )
})}
            </div>
          </>
        )}
      </main>

      {/* MODAL PERFIL */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white p-8 rounded-3xl w-full max-w-sm border-4 border-slate-900 shadow-2xl">
            <h2 className="text-2xl font-black uppercase mb-6">Meu Perfil</h2>
            <input className="w-full p-4 border-4 border-slate-100 rounded-2xl font-black mb-6 text-slate-900" placeholder="Nome Completo" value={newName} onChange={e => setNewName(e.target.value)} />
            <button onClick={updateProfile} className="w-full bg-blue-600 text-white p-4 rounded-2xl font-black uppercase">Salvar Dados</button>
            <button onClick={() => setShowProfileModal(false)} className="w-full mt-4 text-slate-400 font-bold uppercase text-xs">Cancelar</button>
          </div>
        </div>
      )}

      {/* MODAL EDIÇÃO */}
      {showEditModal && editingTask && (
        <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white p-8 rounded-[40px] w-full max-w-2xl border-4 border-slate-900 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center mb-6"><h2 className="text-2xl font-black uppercase tracking-tighter italic underline decoration-blue-600 text-slate-900">Editar Tarefa</h2><button onClick={() => setShowEditModal(false)}><X size={32}/></button></div>
            <div className="space-y-6">
              <div className="flex flex-col"><label className="text-[10px] font-black uppercase text-slate-400">Título</label><input className="w-full p-4 border-4 border-slate-100 rounded-2xl font-black text-slate-900" value={editingTask.title} onChange={e => setEditingTask({...editingTask, title: e.target.value})} /></div>
              <div className="flex flex-col"><label className="text-[10px] font-black uppercase text-slate-400">Observações</label><textarea className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-slate-800" rows={2} value={editingTask.notes || ''} onChange={e => setEditingTask({...editingTask, notes: e.target.value})} /></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col"><label className="text-[10px] font-black uppercase text-slate-400">Responsável</label><select className="p-3 bg-slate-100 rounded-xl font-black border-2 border-slate-200" value={editingTask.assigned_to} onChange={e => setEditingTask({...editingTask, assigned_to: e.target.value})}>{profiles.map(p => <option key={p.id} value={p.id}>{p.full_name || p.id.slice(0,5)}</option>)}</select></div>
                <div className="flex flex-col"><label className="text-[10px] font-black uppercase text-slate-400">Categoria</label><select className="p-3 bg-slate-100 rounded-xl font-black border-2 border-slate-200" value={editingTask.category} onChange={e => setEditingTask({...editingTask, category: e.target.value})}><option>Trade</option><option>Reunião</option><option>Geral</option></select></div>
              </div>
              <div className="space-y-2"><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Alterar Dias</label>
                <div className="flex gap-2">{weekDays.map(day => (<button key={day.id} type="button" onClick={() => toggleDayInEdit(day.id)} className={`w-12 h-12 rounded-xl font-black border-4 transition-all ${editingTask.repeat_days?.split(',').includes(day.id) ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-400'}`}>{day.label}</button>))}</div>
              </div>
              <button onClick={updateTask} className="w-full bg-slate-900 text-white p-5 rounded-3xl font-black uppercase text-xl shadow-xl hover:bg-blue-600 transition-all flex items-center justify-center gap-2"><Check size={28}/> Salvar Mudanças</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TaskBox({ task, profiles, onUpdate, onEdit, isLate, isDoneToday, onToggle }: any) {
  return (
    <div className={`p-6 rounded-[32px] border-4 shadow-lg transition-all flex items-center gap-4 relative group ${isDoneToday ? 'bg-green-50 border-green-600 opacity-60' : isLate ? 'bg-red-50 border-red-600 animate-pulse' : 'bg-white border-slate-900'}`}>
      {isLate && <AlertCircle className="absolute -top-3 -right-3 text-red-600 bg-white rounded-full shadow-sm" size={28} />}
      <button onClick={onToggle} className={`w-14 h-14 rounded-2xl border-4 flex items-center justify-center transition-all flex-shrink-0 ${isDoneToday ? 'bg-green-600 border-green-600 text-white' : isLate ? 'border-red-600 text-red-600' : 'border-slate-900 text-transparent'}`}><CheckCircle2 size={36} /></button>
      <div className="flex-1 min-w-0">
        <h3 className={`text-2xl font-black leading-tight tracking-tight truncate ${isDoneToday ? 'line-through text-slate-400' : 'text-slate-900'}`}>{task.title}</h3>
        {task.notes && <p className={`text-sm font-bold mt-1 line-clamp-2 ${isDoneToday ? 'text-green-700/50' : 'text-slate-600'}`}>{task.notes}</p>}
        <div className="flex flex-wrap gap-2 mt-3 font-black text-[9px] uppercase tracking-widest">
          <span className="bg-slate-900 text-white px-2 py-1 rounded-lg flex items-center gap-1 shadow-sm"><User size={10}/> {profiles.find((p: any) => p.id === task.assigned_to)?.full_name || 'Alocado'}</span>
          <span className="bg-blue-600 text-white px-2 py-1 rounded-lg flex items-center gap-1 border-2 border-blue-400 shadow-sm"><Calendar size={10}/> PRÓXIMA: {getNextOccurrence(task)}</span>
          <span className="bg-slate-100 text-slate-900 px-2 py-1 rounded-lg border border-slate-200">{task.category}</span>
        </div>
      </div>
      <div className="flex gap-1"><button onClick={() => onEdit(task)} className="text-slate-300 hover:text-blue-600 p-2"><Edit3 size={24}/></button>
      <button onClick={async () => { if(confirm('Deseja excluir?')) { await supabase.from('tasks').delete().eq('id', task.id); onUpdate(); } }} className="text-slate-200 hover:text-red-600 p-2"><Trash2 size={24}/></button></div>
    </div>
  )
}

function DashboardCard({ label, val, color }: any) {
  return (
    <div className={`p-6 rounded-[32px] border-4 shadow-xl text-center transition-transform hover:scale-105 ${color}`}><span className="text-[10px] font-black uppercase tracking-[0.2em] block mb-2">{label}</span><span className="text-5xl font-black tracking-tighter">{val}</span></div>
  )
}

const getNextOccurrence = (task: any) => {
  if (!task.repeat_days || task.repeat_days.length === 0) return task.due_date ? new Date(task.due_date).toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'}) : 'Sem data';
  const today = new Date(); today.setHours(0,0,0,0);
  const daysMap: any = { seg: 1, ter: 2, qua: 3, qui: 4, sex: 5 };
  const taskDays = task.repeat_days.split(',').map((d: string) => daysMap[d]);
  const startDate = new Date(task.created_at); startDate.setHours(0,0,0,0);
  const startMonday = new Date(startDate); startMonday.setDate(startDate.getDate() - (startDate.getDay() === 0 ? 6 : startDate.getDay() - 1));
  for (let w = 0; w < 52; w += (task.repeat_interval || 1)) {
    const currentWeekMonday = new Date(startMonday); currentWeekMonday.setDate(startMonday.getDate() + (w * 7));
    for (let dayOffset of taskDays) {
      const occurrence = new Date(currentWeekMonday); occurrence.setDate(currentWeekMonday.getDate() + (dayOffset - 1));
      if (occurrence >= today) return occurrence.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    }
  }
  return '--';
};

function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [isSignUp, setIsSignUp] = useState(false)
  const processAuth = async () => {
    const { error } = isSignUp ? await supabase.auth.signUp({ email, password, options: { data: { full_name: email.split('@')[0] } } }) : await supabase.auth.signInWithPassword({ email, password })
    if (error) alert(error.message); else window.location.reload()
  }
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white p-10 rounded-[48px] w-full max-w-sm border-b-[16px] border-blue-600 shadow-2xl">
        <h1 className="text-6xl font-black text-center mb-12 italic uppercase tracking-tighter text-slate-900">SETOR</h1>
        <div className="space-y-4">
          <input className="w-full p-5 border-4 border-slate-100 rounded-[24px] font-black text-slate-900 outline-none focus:border-blue-500" placeholder="E-MAIL" onChange={e => setEmail(e.target.value)} />
          <input className="w-full p-5 border-4 border-slate-100 rounded-[24px] font-black text-slate-900 outline-none focus:border-blue-500" type="password" placeholder="SENHA" onChange={e => setPassword(e.target.value)} />
          <button onClick={processAuth} className="w-full bg-slate-900 text-white p-6 rounded-[24px] font-black uppercase text-xl hover:bg-blue-600 transition-all shadow-xl"> {isSignUp ? 'Cadastrar' : 'Entrar'} </button>
          <button onClick={() => setIsSignUp(!isSignUp)} className="w-full text-[10px] font-black text-slate-400 uppercase tracking-widest text-center mt-4"> {isSignUp ? 'Já tenho conta' : 'Criar nova conta'} </button>
        </div>
      </div>
    </div>
  )
}