'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { 
  Plus, Trash2, CheckCircle2, LayoutDashboard, LogOut, Calendar, Tag, User, 
  Repeat, X, Check, AlertCircle, TrendingUp, Edit3, FileText, ChevronRight, 
  Activity, Clock, ListChecks, Users, Search, Moon, Sun, Megaphone, Send, ChevronDown, ChevronUp
} from 'lucide-react'

// --- UTILITÁRIOS DE DATA ---
const getTodayStr = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().split('T')[0];
};

const getLastOccurrence = (task: any) => {
  const todayStr = getTodayStr();
  const daysMap: any = { seg: 1, ter: 2, qua: 3, qui: 4, sex: 5 };
  if (!task.repeat_days || task.repeat_days === "") return task.due_date || '1970-01-01';
  const taskDays = task.repeat_days.split(',').map((d: string) => daysMap[d]);
  const startDate = new Date(task.created_at);
  const startMonday = new Date(startDate);
  startMonday.setDate(startDate.getDate() - (startDate.getDay() === 0 ? 6 : startDate.getDay() - 1));
  let lastDateStr = '1970-01-01';
  for (let w = 0; w < 52; w++) {
    if (w % (task.repeat_interval || 1) === 0) {
      const curr = new Date(startMonday); curr.setDate(startMonday.getDate() + (w * 7));
      for (let dayOffset of taskDays) {
        const occ = new Date(curr); occ.setDate(curr.getDate() + (dayOffset - 1));
        const s = occ.toISOString().split('T')[0];
        if (s <= todayStr && s > lastDateStr) lastDateStr = s;
      }
    }
    const nextW = new Date(startMonday); nextW.setDate(startMonday.getDate() + ((w + 1) * 7));
    if (nextW.toISOString().split('T')[0] > todayStr) break;
  }
  return lastDateStr;
};

const getNextOccurrence = (task: any) => {
  const todayStr = getTodayStr();
  const daysMap: any = { seg: 1, ter: 2, qua: 3, qui: 4, sex: 5 };
  if (!task.repeat_days || task.repeat_days === "") return task.due_date ? task.due_date.split('-').reverse().slice(0,2).join('/') : '--/--';
  const taskDays = task.repeat_days.split(',').map((d: string) => daysMap[d]);
  const startDate = new Date(task.created_at);
  const startMonday = new Date(startDate);
  startMonday.setDate(startDate.getDate() - (startDate.getDay() === 0 ? 6 : startDate.getDay() - 1));
  for (let w = 0; w < 52; w += (task.repeat_interval || 1)) {
    const curr = new Date(startMonday); curr.setDate(startMonday.getDate() + (w * 7));
    for (let dayOffset of taskDays) {
      const occ = new Date(curr); occ.setDate(curr.getDate() + (dayOffset - 1));
      const s = occ.toISOString().split('T')[0];
      if (s >= todayStr) { const [y, m, d] = s.split('-'); return `${d}/${m}`; }
    }
  }
  return '--/--';
};

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState('membro');
  const [profiles, setProfiles] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('HOJE');
  const [dashFilter, setDashFilter] = useState<'HOJE' | 'SEMANAL'>('HOJE');
  const [filterUser, setFilterUser] = useState('Todos');
  const [showCreateBox, setShowCreateBox] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingTask, setEditingTask] = useState<any>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [category, setCategory] = useState('Trade');
  const [isPontual, setIsPontual] = useState(false);
  const [repeatInterval, setRepeatInterval] = useState(1);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [tempSubtasks, setTempSubtasks] = useState<any[]>([]);
  const [newAnnounce, setNewAnnounce] = useState({ title: '', content: '' });

  const categories = ['HOJE', 'ATRASADOS', 'Minhas', 'Todas', 'Trade', 'Reunião', 'COMUNICADOS', 'HISTÓRICO', 'DASHBOARD'];
  const weekDays = [{ id: 'seg', label: 'S' }, { id: 'ter', label: 'T' }, { id: 'qua', label: 'Q' }, { id: 'qui', label: 'Q' }, { id: 'sex', label: 'S' }];

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        setAssignedTo(session.user.id);
        supabase.from('profiles').select('role, full_name').eq('id', session.user.id).single().then(({ data }) => {
          if (data) { setUserRole(data.role || 'membro'); setNewName(data.full_name || ''); }
        });
        fetchProfiles(); fetchTasks(); fetchHistory(); fetchAnnouncements();
      }
    });
  }, []);

  const fetchProfiles = async () => { const { data } = await supabase.from('profiles').select('*'); if (data) setProfiles(data); }
  const fetchTasks = async () => { const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending: false }); if (data) setTasks(data); }
  const fetchHistory = async () => { const { data } = await supabase.from('task_history').select('*').order('created_at', { ascending: false }).limit(50); if (data) setHistory(data); }
  const fetchAnnouncements = async () => { const { data } = await supabase.from('announcements').select('*').order('created_at', { ascending: false }); if (data) setAnnouncements(data); }

  async function updateProfile() {
    await supabase.from('profiles').update({ full_name: newName }).eq('id', user.id);
    setShowProfileModal(false); fetchProfiles();
  }

  async function addTask() {
    if (!taskTitle) return;
    const isRecurring = selectedDays.length > 0;
    const { error } = await supabase.from('tasks').insert([{ 
        title: taskTitle.toUpperCase(), assigned_to: assignedTo, status: 'pendente', category, notes, 
        repeat_days: isPontual ? "" : selectedDays.join(','), repeat_interval: isPontual ? 1 : repeatInterval,
        subtasks: tempSubtasks, due_date: isPontual ? getTodayStr() : null 
    }]);
    if (!error) { setShowCreateBox(false); setTaskTitle(''); setNotes(''); setTempSubtasks([]); setSelectedDays([]); fetchTasks(); }
  }

  async function toggleComplete(task: any) {
    const todayStr = getTodayStr(); const lS = getLastOccurrence(task); const lD = task.last_done_date || '1970-01-01';
    const isDone = lD >= lS; const newDate = isDone ? null : todayStr;
    if (!isDone) {
      const profile = profiles.find(p => p.id === user.id);
      await supabase.from('task_history').insert([{ task_id: task.id, task_title: task.title, user_name: profile?.full_name || user.email, user_id: user.id, category: task.category }]);
    }
    await supabase.from('tasks').update({ last_done_date: newDate, status: newDate ? 'concluido' : 'pendente' }).eq('id', task.id);
    fetchTasks(); fetchHistory();
  }

  const filteredTasks = tasks.filter(task => {
    const todayStr = getTodayStr(); const lS = getLastOccurrence(task); const lD = task.last_done_date || '1970-01-01';
    const isDone = lD >= lS; const isDueToday = lS === todayStr; const isLate = !isDone && lS < todayStr;
    if (searchTerm && !task.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (filterUser !== 'Todos' && task.assigned_to !== filterUser) return false;
    if (activeTab === 'ATRASADOS') return isLate;
    if (activeTab === 'HOJE') return isDueToday && !isDone;
    if (activeTab === 'Minhas') return task.assigned_to === user?.id;
    if (activeTab === 'Todas') return true;
    return task.category === activeTab;
  });

  const stats = (() => {
    const base = tasks.filter(t => filterUser === 'Todos' || t.assigned_to === filterUser);
    const relevant = base.filter(t => dashFilter === 'HOJE' ? getLastOccurrence(t) === getTodayStr() : true);
    const done = relevant.filter(t => (t.last_done_date || '1970-01-01') >= getLastOccurrence(t)).length;
    return { total: relevant.length, concluidas: done, pendentes: relevant.length - done, porcentagem: relevant.length > 0 ? Math.round((done/relevant.length)*100) : 0 }
  })();

  const toggleDay = (day: string) => setSelectedDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  const toggleDayInEdit = (day: string) => {
    const currentDays = editingTask.repeat_days ? editingTask.repeat_days.split(',') : [];
    const newDays = currentDays.includes(day) ? currentDays.filter((d:any) => d !== day) : [...currentDays, day];
    setEditingTask({ ...editingTask, repeat_days: newDays.join(',') });
  };

  async function updateTask() {
    const { error } = await supabase.from('tasks').update({ 
      title: editingTask.title.toUpperCase(), notes: editingTask.notes, assigned_to: editingTask.assigned_to,
      category: editingTask.category, repeat_days: editingTask.repeat_days, repeat_interval: editingTask.repeat_interval, subtasks: editingTask.subtasks
    }).eq('id', editingTask.id);
    if (!error) { setShowEditModal(false); setEditingTask(null); fetchTasks(); }
  }

  if (!user) return <Login />;

  return (
    <div className={`min-h-screen transition-colors duration-500 ${isDarkMode ? 'bg-[#0F111A] text-slate-100' : 'bg-[#F9FAFB] text-slate-900'} pb-20 font-sans overflow-x-hidden w-full`}>
      
      {/* NAVBAR HIGH-END */}
      <nav className={`sticky top-0 z-50 backdrop-blur-xl border-b transition-all ${isDarkMode ? 'bg-[#161B22]/80 border-white/5 shadow-2xl' : 'bg-white/80 border-slate-200 shadow-sm'}`}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-xl shadow-indigo-500/20 shadow-lg">
              <Activity size={20} className="text-white" />
            </div>
            <h1 className="text-lg font-bold tracking-tight">SUPPLY<span className="text-indigo-600">BUILDER</span></h1>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => setIsDarkMode(!isDarkMode)} className={`p-2 rounded-full transition-all ${isDarkMode ? 'hover:bg-white/10 text-yellow-400' : 'hover:bg-slate-100 text-slate-500'}`}>
              {isDarkMode ? <Sun size={18}/> : <Moon size={18}/>}
            </button>
            <div className="h-6 w-[1px] bg-slate-200 dark:bg-white/10 mx-2" />
            <button onClick={() => setShowProfileModal(true)} className={`flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border transition-all ${isDarkMode ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}>
              <div className="w-7 h-7 bg-indigo-600 rounded-full flex items-center justify-center text-[10px] font-black text-white shadow-md">
                {newName?.charAt(0) || 'U'}
              </div>
              <span className="text-[11px] font-semibold uppercase tracking-wider hidden sm:block">{newName || 'Perfil'}</span>
            </button>
            <button onClick={() => supabase.auth.signOut().then(() => window.location.reload())} className="text-slate-400 hover:text-red-500 transition-colors p-2">
              <LogOut size={18}/>
            </button>
          </div>
        </div>
      </nav>

      {/* FILTROS GLASSMORPHISM */}
      <div className={`sticky top-16 z-40 border-b transition-all ${isDarkMode ? 'bg-[#0F111A]/95 border-white/5' : 'bg-[#F9FAFB]/95 border-slate-200'}`}>
        <div className="max-w-5xl mx-auto px-6 py-4 space-y-4 text-center">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3.5 top-3 text-slate-400" size={16} />
              <input className={`w-full pl-10 pr-4 py-2.5 rounded-2xl text-sm border-0 ring-1 outline-none transition-all ${isDarkMode ? 'bg-white/5 ring-white/10 focus:ring-indigo-500' : 'bg-white ring-slate-200 focus:ring-indigo-500 shadow-sm'}`} placeholder="Pesquisar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>

            <div className={`flex p-1 rounded-2xl ring-1 overflow-x-auto no-scrollbar max-w-full ${isDarkMode ? 'bg-black/20 ring-white/5' : 'bg-slate-200/50 ring-slate-200'}`}>
              {categories.map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap ${activeTab === tab ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>{tab}</button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 overflow-x-auto no-scrollbar py-1">
            <button onClick={() => setFilterUser('Todos')} className={`px-4 py-1.5 rounded-full text-[9px] font-bold uppercase transition-all ${filterUser === 'Todos' ? 'bg-slate-900 text-white dark:bg-indigo-600' : 'bg-white border border-slate-200 dark:bg-white/5 dark:text-slate-400'}`}>Todos</button>
            {profiles.map(p => (
              <button key={p.id} onClick={() => setFilterUser(p.id)} className={`px-4 py-1.5 rounded-full text-[9px] font-bold uppercase border transition-all flex items-center gap-2 ${filterUser === p.id ? 'bg-indigo-600 text-white border-transparent shadow-md' : 'bg-white border-slate-200 dark:bg-white/5 dark:border-white/10 text-slate-500'}`}>
                {p.full_name?.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto p-6">
        {activeTab === 'DASHBOARD' ? (
          <div className="space-y-8 animate-in fade-in duration-700 text-center">
             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <DashboardCard label="Metas" val={stats.total} isDark={isDarkMode} />
                <DashboardCard label="Concluídas" val={stats.concluidas} color="text-emerald-500" isDark={isDarkMode} />
                <DashboardCard label="Pendentes" val={stats.pendentes} color="text-rose-500" isDark={isDarkMode} />
             </div>
             <div className={`p-16 rounded-[48px] border transition-all ${isDarkMode ? 'bg-[#161B22] border-white/5' : 'bg-white border-slate-100 shadow-2xl'}`}>
                <h3 className="text-[120px] font-black tracking-tighter mb-4 leading-none">{stats.porcentagem}%</h3>
                <p className="text-xs font-bold uppercase text-slate-400 tracking-[0.4em]">Eficiência do Setor</p>
                <div className="mt-12 max-w-lg mx-auto bg-slate-100 dark:bg-white/5 h-4 rounded-full overflow-hidden p-1">
                  <div className="bg-indigo-600 h-full transition-all duration-1000 shadow-[0_0_30px_rgba(79,70,229,0.6)] rounded-full" style={{ width: `${stats.porcentagem}%` }} />
                </div>
             </div>
          </div>
        ) : activeTab === 'COMUNICADOS' ? (
          <div className="mt-8 space-y-6 max-w-3xl mx-auto">
             {userRole === 'admin' && (
               <div className={`p-8 rounded-[32px] border ${isDarkMode ? 'bg-[#161B22] border-white/5' : 'bg-white border-slate-100 shadow-xl'}`}>
                  <h3 className="font-black uppercase text-xl mb-6 flex items-center gap-3"><Megaphone className="text-indigo-600"/> Publicar Alerta</h3>
                  <input className={`w-full p-4 rounded-xl border mb-4 font-bold ${isDarkMode ? 'bg-white/5 border-white/5' : 'bg-slate-50'}`} placeholder="Título" value={newAnnounce.title} onChange={e => setNewAnnounce({...newAnnounce, title: e.target.value})} />
                  <textarea className={`w-full p-4 rounded-xl border mb-6 font-medium ${isDarkMode ? 'bg-white/5 border-white/5' : 'bg-slate-50'}`} placeholder="Mensagem..." rows={3} value={newAnnounce.content} onChange={e => setNewAnnounce({...newAnnounce, content: e.target.value})} />
                  <button onClick={async () => { await supabase.from('announcements').insert([{ ...newAnnounce, author_id: user.id }]); setNewAnnounce({title:'', content:''}); fetchAnnouncements(); }} className="w-full bg-indigo-600 text-white p-5 rounded-2xl font-black uppercase shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 transition-all">Lançar Comunicado Supremo</button>
               </div>
             )}
             {announcements.map(a => (
               <div key={a.id} className={`p-8 rounded-[40px] border-l-[12px] border-indigo-600 shadow-2xl ${isDarkMode ? 'bg-[#161B22]' : 'bg-white'}`}>
                 <h4 className="text-3xl font-black mb-4 uppercase italic tracking-tighter">{a.title}</h4>
                 <p className="text-lg font-medium opacity-80 mb-6">{a.content}</p>
                 <div className="text-[10px] font-black uppercase opacity-30 italic">Publicado em {new Date(a.created_at).toLocaleString()}</div>
               </div>
             ))}
          </div>
        ) : (
          <>
            {/* ACTION BUTTON */}
            <div className="mb-10 flex justify-center">
              <button onClick={() => setShowCreateBox(!showCreateBox)} className={`flex items-center gap-3 px-10 py-4 rounded-full font-black text-xs uppercase tracking-widest transition-all ${showCreateBox ? 'bg-slate-200 dark:bg-white/10 text-slate-500' : 'bg-indigo-600 text-white shadow-2xl shadow-indigo-600/40 hover:scale-105 active:scale-95'}`}>
                {showCreateBox ? <X size={20}/> : <Plus size={20} strokeWidth={4}/>} {showCreateBox ? 'Cancelar' : 'Lançar Missão'}
              </button>
            </div>

            {/* COMMAND CENTER */}
            {showCreateBox && (
              <div className={`p-10 rounded-[48px] border mb-16 animate-in slide-in-from-top-10 duration-500 shadow-2xl ${isDarkMode ? 'bg-[#161B22] border-white/5' : 'bg-white border-slate-100'}`}>
                <input className={`w-full text-5xl font-black bg-transparent outline-none mb-10 placeholder-slate-200 ${isDarkMode ? 'text-white' : 'text-slate-950'}`} placeholder="Nome da Missão" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} />
                <textarea className={`w-full p-8 rounded-[35px] border mb-10 text-xl font-bold transition-all ${isDarkMode ? 'bg-white/5 border-white/10 focus:bg-white/10' : 'bg-slate-50 border-slate-100 focus:bg-white focus:ring-1 focus:ring-indigo-100'}`} placeholder="Descrição Técnica..." rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
                
                {/* SUBTAREFAS NA CRIAÇÃO */}
                <div className="bg-indigo-600/5 p-6 rounded-[35px] border border-indigo-600/10 mb-10">
                   <label className="text-[10px] font-black uppercase text-indigo-600 mb-4 block tracking-widest flex items-center gap-2"><ListChecks size={16}/> Checklist de Passos</label>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     {tempSubtasks.map((sub, idx) => (
                       <div key={idx} className="flex items-center gap-3 bg-white dark:bg-white/5 p-3 rounded-2xl border border-slate-200 dark:border-white/5">
                         <input className="flex-1 bg-transparent font-bold text-sm outline-none" value={sub.title} onChange={e => { const n = [...tempSubtasks]; n[idx].title = e.target.value; setTempSubtasks(n); }} placeholder="Definir passo..." />
                         <button onClick={() => setTempSubtasks(tempSubtasks.filter((_, i) => i !== idx))} className="text-rose-400"><X size={18}/></button>
                       </div>
                     ))}
                     <button onClick={() => setTempSubtasks([...tempSubtasks, {title: '', done: false}])} className="flex items-center justify-center gap-2 p-3 border-2 border-dashed rounded-2xl text-slate-400 font-bold text-xs hover:border-indigo-500 hover:text-indigo-600 transition-all">+ Novo Passo</button>
                   </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-end border-t border-slate-100 dark:border-white/5 pt-10">
                   <div className="space-y-4">
                      <label className="text-[10px] font-black uppercase text-slate-400">Responsável</label>
                      <select disabled={userRole === 'membro'} className="w-full p-4 rounded-2xl bg-indigo-600 text-white font-black text-sm border-none shadow-xl cursor-pointer" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id} className="text-black">{p.full_name}</option>)}</select>
                   </div>
                   <div className="space-y-4">
                      <button onClick={() => setIsPontual(!isPontual)} className={`w-full p-4 rounded-2xl font-black uppercase text-[10px] border transition-all ${isPontual ? 'bg-amber-500 text-white border-transparent shadow-lg' : 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}>{isPontual ? '⚡ Missão Única' : '🔄 Recorrente'}</button>
                      {!isPontual && <div className="flex gap-1 bg-slate-100 dark:bg-white/5 p-1 rounded-xl border border-slate-200 dark:border-white/5">{weekDays.map(day => (<button key={day.id} type="button" onClick={() => toggleDay(day.id)} className={`flex-1 h-9 rounded-lg font-black text-[10px] transition-all ${selectedDays.includes(day.id) ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>{day.label}</button>))}</div>}
                   </div>
                   <button onClick={addTask} className="w-full bg-slate-900 dark:bg-indigo-600 text-white p-6 rounded-[30px] font-black uppercase text-xs tracking-widest shadow-2xl hover:scale-105 transition-all">Lançar no Sistema</button>
                </div>
              </div>
            )}

            <div className="space-y-6">
              <h2 className="text-[10px] font-black uppercase text-slate-400 tracking-[0.5em] flex items-center gap-4 mb-8">
                <div className="w-12 h-1 bg-indigo-600 rounded-full" /> {activeTab} • {filteredTasks.length} MISSÕES
              </h2>
              {filteredTasks.map(task => {
                const lS = getLastOccurrence(task); const lD = task.last_done_date || '1970-01-01';
                const isDone = lD >= lS; const isLate = !isDone && lS < getTodayStr();
                return (<TaskBox key={task.id} task={task} profiles={profiles} isLate={isLate} isDoneToday={isDone} userRole={userRole} currentUserId={user.id} isDarkMode={isDarkMode} onToggle={() => toggleComplete(task)} onEdit={(t: any) => { setEditingTask(t); setShowEditModal(true); }} onUpdate={fetchTasks} />)
              })}
            </div>
          </>
        )}
      </main>

      {/* MODAL EDIÇÃO (RESTAURADO E COMPLETO) */}
      {showEditModal && editingTask && (
        <div className="fixed inset-0 bg-slate-900/60 z-[60] flex items-center justify-center p-4 backdrop-blur-md animate-in zoom-in-95">
          <div className={`p-12 rounded-[50px] w-full max-w-2xl shadow-2xl overflow-y-auto max-h-[90vh] ${isDarkMode ? 'bg-[#161B22]' : 'bg-white'}`}>
             <h2 className="text-3xl font-black uppercase mb-10 tracking-tighter text-indigo-600">Editar Missão</h2>
             <div className="space-y-8 text-left">
                <input className={`w-full text-4xl font-black bg-transparent outline-none border-b uppercase ${isDarkMode ? 'text-white' : 'text-slate-900'}`} value={editingTask.title} onChange={e => setEditingTask({...editingTask, title: e.target.value})} />
                <textarea className={`w-full p-6 border rounded-3xl font-bold ${isDarkMode ? 'bg-white/5' : 'bg-slate-50'}`} rows={3} value={editingTask.notes || ''} onChange={e => setEditingTask({...editingTask, notes: e.target.value})} />
                
                <div className="space-y-4 border-t pt-6 border-slate-100 dark:border-white/5">
                  <label className="text-[10px] font-black uppercase opacity-40 flex items-center gap-2"><ListChecks size={16}/> Ajustar Passos</label>
                  <div className="space-y-2">
                    {(editingTask.subtasks || []).map((sub: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-3 bg-slate-50 dark:bg-white/5 p-3 rounded-2xl border">
                        <input type="checkbox" checked={sub.done} onChange={e => { const n = [...editingTask.subtasks]; n[idx].done = e.target.checked; setEditingTask({...editingTask, subtasks: n}); }} className="w-6 h-6 accent-indigo-600" />
                        <input className="flex-1 bg-transparent font-bold text-sm" value={sub.title} onChange={e => { const n = [...editingTask.subtasks]; n[idx].title = e.target.value; setEditingTask({...editingTask, subtasks: n}); }} />
                        <button onClick={() => { const n = editingTask.subtasks.filter((_:any, i:number) => i !== idx); setEditingTask({...editingTask, subtasks: n}); }} className="text-rose-400"><X size={20}/></button>
                      </div>
                    ))}
                    <button onClick={() => { const n = [...(editingTask.subtasks || []), {title:'', done:false}]; setEditingTask({...editingTask, subtasks: n}); }} className="w-full py-4 border-2 border-dashed rounded-3xl text-slate-400 font-black uppercase text-[10px] hover:text-indigo-600">+ Adicionar Etapa</button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <select className={`w-full p-4 rounded-2xl font-black ${isDarkMode ? 'bg-white/5' : 'bg-slate-100 text-slate-900'}`} value={editingTask.assigned_to} onChange={e => setEditingTask({...editingTask, assigned_to: e.target.value})}>{profiles.map(p => <option key={p.id} value={p.id} className="text-black">{p.full_name}</option>)}</select>
                  <input type="number" className={`w-full p-4 rounded-2xl font-black ${isDarkMode ? 'bg-white/5' : 'bg-slate-100 text-slate-900'}`} value={editingTask.repeat_interval || 1} onChange={e => setEditingTask({...editingTask, repeat_interval: parseInt(e.target.value)})} />
                </div>
                <button onClick={updateTask} className="w-full bg-indigo-600 text-white p-6 rounded-[30px] font-black uppercase text-xl shadow-xl hover:bg-indigo-700 transition-all mt-4">Salvar Alterações</button>
                <button onClick={() => setShowEditModal(false)} className="w-full font-black text-slate-400 uppercase text-[10px] tracking-[0.4em]">Cancelar</button>
             </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ==========================================
// 3. COMPONENTES AUXILIARES
// ==========================================

function TaskBox({ task, profiles, isLate, isDoneToday, onToggle, onEdit, onUpdate, userRole, currentUserId, isDarkMode }: any) {
  const [expanded, setExpanded] = useState(false);
  const canModify = userRole === 'admin' || userRole === 'gerente' || task.assigned_to === currentUserId;
  const subtasks = task.subtasks || [];
  const subDone = subtasks.filter((s: any) => s.done).length;
  const subTotal = subtasks.length;

  const toggleSub = async (idx: number) => {
    const newSubs = [...subtasks]; newSubs[idx].done = !newSubs[idx].done;
    await supabase.from('tasks').update({ subtasks: newSubs }).eq('id', task.id);
    onUpdate();
  };

  return (
    <div className={`p-6 rounded-[40px] border transition-all duration-500 flex flex-col gap-6 relative group ${
      isDoneToday 
      ? 'bg-slate-50 dark:bg-white/5 border-transparent opacity-60' 
      : isLate 
        ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 shadow-2xl shadow-rose-500/10' 
        : isDarkMode ? 'bg-[#1C1F2E] border-white/5 hover:border-indigo-500/50 shadow-[0_20px_50px_rgba(0,0,0,0.5)]' : 'bg-white border-slate-100 hover:border-indigo-200 shadow-[0_15px_40px_rgba(0,0,0,0.04)] hover:-translate-y-1'
    }`}>
      <div className="flex items-center gap-6">
        <button onClick={onToggle} className={`w-14 h-14 rounded-[22px] border-2 flex items-center justify-center transition-all flex-shrink-0 ${isDoneToday ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg' : isLate ? 'border-rose-500 text-transparent' : 'border-slate-200 dark:border-white/10 text-transparent hover:border-indigo-500'}`}><Check size={28} strokeWidth={4}/></button>
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <h3 className={`text-2xl font-black tracking-tight leading-tight transition-all ${isDoneToday ? 'text-slate-300 dark:text-slate-600 line-through' : isLate ? 'text-rose-600 dark:text-rose-400' : 'text-slate-950 dark:text-white'}`}>{task.title}</h3>
          
          {subTotal > 0 && (
            <div className="flex items-center gap-3 mt-3">
              <div className="flex-1 bg-slate-100 dark:bg-white/10 h-1.5 rounded-full overflow-hidden border border-slate-200/50 dark:border-transparent"><div className="bg-indigo-600 h-full transition-all duration-1000 shadow-[0_0_10px_rgba(79,70,229,0.5)]" style={{ width: `${(subDone / subTotal) * 100}%` }} /></div>
              <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{subDone}/{subTotal} ETAPAS</span>
              {expanded ? <ChevronUp size={14} className="text-slate-300"/> : <ChevronDown size={14} className="text-slate-300"/>}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-4">
            <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider flex items-center gap-1.5 border transition-all ${isDarkMode ? 'bg-white/5 border-white/5 text-slate-300' : 'bg-slate-100 border-slate-100 text-slate-600'}`}><User size={10} className="text-indigo-500"/> {profiles.find(p => p.id === task.assigned_to)?.full_name || 'Alocado'}</span>
            <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider border transition-all ${isDarkMode ? 'bg-indigo-600/10 border-indigo-600/20 text-indigo-400' : 'bg-indigo-50 border-indigo-100 text-indigo-600'}`}>{task.category}</span>
            <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase border transition-all ${isDarkMode ? 'bg-black/20 border-white/5 text-slate-400' : 'bg-white border-slate-200 text-slate-400'}`}><Calendar size={10}/> Próxima: {getNextOccurrence(task)}</span>
          </div>
        </div>
        {canModify && (
          <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => onEdit(task)} className="p-2 text-slate-400 hover:text-indigo-600 rounded-xl hover:bg-indigo-50 dark:hover:bg-white/5 transition-all"><Edit3 size={20}/></button>
            <button onClick={async () => { if(confirm('Excluir?')) { await supabase.from('tasks').delete().eq('id', task.id); onUpdate(); } }} className="p-2 text-slate-400 hover:text-rose-500 rounded-xl hover:bg-rose-50 dark:hover:bg-white/5 transition-all"><Trash2 size={20}/></button>
          </div>
        )}
      </div>

      {expanded && subTotal > 0 && (
        <div className="mt-2 space-y-2 border-t border-slate-100 dark:border-white/5 pt-6 animate-in slide-in-from-top-4 duration-500">
          {subtasks.map((sub: any, idx: number) => (
            <div key={idx} onClick={() => toggleSub(idx)} className={`flex items-center gap-4 p-4 rounded-2xl border transition-all cursor-pointer ${sub.done ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-600 opacity-60' : 'bg-slate-50 dark:bg-white/5 border-slate-100 dark:border-transparent hover:border-indigo-400'}`}>
              <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${sub.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300'}`}><Check size={14} strokeWidth={5} /></div>
              <span className={`text-sm font-bold uppercase tracking-tighter ${sub.done ? 'line-through' : ''}`}>{sub.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DashboardCard({ label, val, color, isDark }: any) {
  return (
    <div className={`p-10 rounded-[48px] border transition-all ${isDark ? 'bg-[#161B22] border-white/5' : 'bg-white border-slate-100 shadow-2xl shadow-slate-200/40 hover:-translate-y-1'}`}>
      <span className="text-[10px] font-black uppercase tracking-[0.4em] block mb-4 opacity-30 italic">{label}</span>
      <span className={`text-7xl font-black tracking-tighter ${color || (isDark ? 'text-white' : 'text-slate-950')}`}>{val}</span>
    </div>
  )
}

function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [isSignUp, setIsSignUp] = useState(false)
  const processAuth = async () => {
    const { error } = isSignUp ? await supabase.auth.signUp({ email, password, options: { data: { full_name: email.split('@')[0] } } }) : await supabase.auth.signInWithPassword({ email, password })
    if (error) alert(error.message); else window.location.reload()
  }
  return (
    <div className="min-h-screen bg-[#0F111A] flex items-center justify-center p-6 text-center">
      <div className="bg-white p-16 rounded-[60px] w-full max-w-sm shadow-[0_50px_100px_rgba(0,0,0,0.5)] relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-indigo-600"></div>
        <div className="bg-indigo-600 w-20 h-20 rounded-[28px] flex items-center justify-center mx-auto mb-10 shadow-2xl shadow-indigo-600/40 rotate-12"><Activity className="text-white" size={40} strokeWidth={3}/></div>
        <h1 className="text-6xl font-black italic tracking-tighter text-slate-950 leading-none mb-12">WALLY<br/><span className="text-indigo-600 text-3xl not-italic tracking-[0.3em] font-medium opacity-90 uppercase">Tasker</span></h1>
        <div className="space-y-4">
          <input className="w-full p-5 bg-slate-50 border border-slate-100 rounded-[28px] font-black text-xl text-slate-950 outline-none focus:ring-4 focus:ring-indigo-50" placeholder="E-MAIL" onChange={e => setEmail(e.target.value)} />
          <input className="w-full p-5 bg-slate-50 border border-slate-100 rounded-[28px] font-black text-xl text-slate-950 outline-none focus:ring-4 focus:ring-indigo-50" type="password" placeholder="SENHA" onChange={e => setPassword(e.target.value)} />
          <button onClick={processAuth} className="w-full bg-slate-950 text-white p-6 rounded-[30px] font-black uppercase text-xs tracking-widest shadow-2xl hover:bg-indigo-600 transition-all mt-6">{isSignUp ? 'Criar Nova Identidade' : 'Acessar Central'}</button>
          <button onClick={() => setIsSignUp(!isSignUp)} className="w-full mt-8 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-indigo-600 transition-colors">{isSignUp ? 'Voltar ao Login' : 'Solicitar Acesso à Equipe'}</button>
        </div>
      </div>
    </div>
  )
}