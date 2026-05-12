'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { 
  Plus, Trash2, CheckCircle2, LayoutDashboard, LogOut, Calendar, Tag, User, 
  Repeat, X, Check, AlertCircle, TrendingUp, Edit3, FileText, ChevronRight, 
  Activity, Clock, ListChecks, Users, Search, Moon, Sun, Megaphone, Send, ChevronDown, ChevronUp
} from 'lucide-react'

// ==========================================
// 1. UTILITÁRIOS (Lógica de Calendário)
// ==========================================
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

// ==========================================
// 2. COMPONENTE PRINCIPAL
// ==========================================
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

  // Form States
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
        setUser(session.user); setAssignedTo(session.user.id);
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

  async function addTask() {
    if (!taskTitle) return;
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
    if (activeTab === 'Minhas') return userRole === 'admin' || userRole === 'gerente' ? true : task.assigned_to === user?.id;
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

  async function updateProfile() {
    await supabase.from('profiles').update({ full_name: newName }).eq('id', user.id);
    setShowProfileModal(false); fetchProfiles();
  }

  async function updateTask() {
    const { error } = await supabase.from('tasks').update({ 
      title: editingTask.title.toUpperCase(), notes: editingTask.notes, assigned_to: editingTask.assigned_to,
      category: editingTask.category, repeat_days: editingTask.repeat_days, repeat_interval: editingTask.repeat_interval, subtasks: editingTask.subtasks
    }).eq('id', editingTask.id);
    if (!error) { setShowEditModal(false); setEditingTask(null); fetchTasks(); }
  }

  if (!user) return <Login />;

  return (
    <div className={`min-h-screen transition-colors duration-500 ${isDarkMode ? 'bg-[#05070A] text-white' : 'bg-[#F0F2F5] text-black'} pb-20 font-sans overflow-x-hidden w-full`}>
      
      {/* NAVBAR */}
      <nav className={`sticky top-0 z-50 border-b transition-all ${isDarkMode ? 'bg-[#111827] border-white/10 shadow-2xl' : 'bg-white border-slate-200 shadow-sm'}`}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-xl shadow-lg shadow-indigo-500/30"><Activity size={20} className="text-white" /></div>
            <h1 className={`text-xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-black'}`}>SUPPLY<span className="text-indigo-600">BUILDER</span></h1>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setIsDarkMode(!isDarkMode)} className={`p-2 rounded-xl transition-all ${isDarkMode ? 'bg-white/5 text-yellow-400' : 'bg-slate-100 text-slate-900'}`}>{isDarkMode ? <Sun size={20}/> : <Moon size={20}/>}</button>
            <button onClick={() => setShowProfileModal(true)} className={`flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border transition-all ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
              <div className="w-7 h-7 bg-indigo-600 rounded-full flex items-center justify-center text-xs font-black text-white shadow-md">{newName?.charAt(0) || 'U'}</div>
              <span className={`text-[11px] font-black uppercase tracking-widest hidden sm:block ${isDarkMode ? 'text-white' : 'text-black'}`}>{newName || 'Perfil'}</span>
            </button>
            <button onClick={() => supabase.auth.signOut().then(() => window.location.reload())} className="text-red-500 hover:bg-red-500 hover:text-white p-2 rounded-lg transition-all"><LogOut size={20}/></button>
          </div>
        </div>
      </nav>

      {/* FILTER BAR */}
      <div className={`sticky top-16 z-40 border-b transition-all ${isDarkMode ? 'bg-[#05070A]/95 border-white/5' : 'bg-[#F0F2F5]/95 border-slate-200'}`}>
        <div className="max-w-6xl mx-auto px-6 py-5 space-y-5 text-center">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:w-80">
              <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
              <input className={`w-full pl-11 pr-4 py-2.5 rounded-2xl text-sm font-bold border-0 ring-2 outline-none transition-all ${isDarkMode ? 'bg-white/5 ring-white/10 text-white focus:ring-indigo-500' : 'bg-white ring-slate-200 text-black focus:ring-indigo-600 shadow-sm'}`} placeholder="Pesquisar missão..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <div className={`flex p-1 rounded-2xl ring-2 overflow-x-auto no-scrollbar max-w-full ${isDarkMode ? 'bg-black/40 ring-white/10' : 'bg-slate-200 ring-slate-200'}`}>
              {categories.map(tab => (
                <button key={tab} onClick={() => { setActiveTab(tab); setShowCreateBox(false); }} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === tab ? 'bg-indigo-600 text-white shadow-xl scale-105' : 'text-slate-500'}`}>{tab}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 overflow-x-auto no-scrollbar pb-1">
            <button onClick={() => setFilterUser('Todos')} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border-2 transition-all ${filterUser === 'Todos' ? 'bg-black text-white border-black dark:bg-indigo-600 dark:border-transparent shadow-lg' : 'bg-white border-slate-200 dark:bg-white/5 dark:text-slate-400'}`}>Todos</button>
            {profiles.map(p => (
              <button key={p.id} onClick={() => setFilterUser(p.id)} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border-2 transition-all flex items-center gap-2 ${filterUser === p.id ? 'bg-indigo-600 text-white border-transparent shadow-xl scale-110' : 'bg-white border-slate-200 dark:bg-white/5 dark:border-white/10 dark:text-slate-500'}`}>{p.full_name?.split(' ')[0]}</button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto p-6">
        {activeTab === 'DASHBOARD' ? (
          <div className="space-y-8 animate-in fade-in duration-700 text-center mt-6">
             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <DashboardCard label="Metas" val={stats.total} isDark={isDarkMode} />
                <DashboardCard label="Concluídas" val={stats.concluidas} color="text-emerald-500" isDark={isDarkMode} />
                <DashboardCard label="Pendentes" val={stats.pendentes} color="text-rose-500" isDark={isDarkMode} />
             </div>
             <div className={`p-16 rounded-[60px] border transition-all ${isDarkMode ? 'bg-[#161B22] border-white/5 shadow-none' : 'bg-white border-slate-100 shadow-2xl'}`}>
                <h3 className={`text-[120px] font-black tracking-tighter mb-4 leading-none ${isDarkMode ? 'text-white' : 'text-black'}`}>{stats.porcentagem}%</h3>
                <p className="text-xs font-black uppercase text-slate-400 tracking-[0.4em]">Eficiência do Setor</p>
                <div className="mt-12 max-w-lg mx-auto bg-slate-100 dark:bg-white/5 h-4 rounded-full overflow-hidden p-1 shadow-inner"><div className="bg-indigo-600 h-full transition-all duration-1000 shadow-[0_0_30px_rgba(79,70,229,0.8)] rounded-full" style={{ width: `${stats.porcentagem}%` }} /></div>
             </div>
          </div>
        ) : activeTab === 'COMUNICADOS' ? (
          <div className="mt-8 space-y-6 max-w-3xl mx-auto">
             {userRole === 'admin' && (
               <div className={`p-10 rounded-[40px] border-4 border-indigo-600 ${isDarkMode ? 'bg-[#161B22]' : 'bg-white'} shadow-2xl`}>
                  <h3 className={`font-black uppercase text-xl mb-6 flex items-center gap-3 ${isDarkMode ? 'text-white' : 'text-black'}`}><Megaphone className="text-indigo-600"/> Lançar Alerta</h3>
                  <input className={`w-full p-4 rounded-xl border-2 mb-4 font-black ${isDarkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-black'}`} placeholder="Título" value={newAnnounce.title} onChange={e => setNewAnnounce({...newAnnounce, title: e.target.value})} />
                  <textarea className={`w-full p-4 rounded-xl border-2 mb-6 font-bold ${isDarkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-black'}`} placeholder="Mensagem..." rows={3} value={newAnnounce.content} onChange={e => setNewAnnounce({...newAnnounce, content: e.target.value})} />
                  <button onClick={async () => { await supabase.from('announcements').insert([{ ...newAnnounce, author_id: user.id }]); setNewAnnounce({title:'', content:''}); fetchAnnouncements(); }} className="w-full bg-indigo-600 text-white p-5 rounded-3xl font-black uppercase shadow-lg hover:bg-indigo-700 transition-all">Publicar Agora</button>
               </div>
             )}
             {announcements.map(a => (
               <div key={a.id} className={`p-10 rounded-[50px] border-l-[16px] border-indigo-600 shadow-2xl ${isDarkMode ? 'bg-[#161B22] text-white' : 'bg-white text-black'}`}>
                 <h4 className="text-3xl font-black mb-4 uppercase italic tracking-tighter underline decoration-indigo-600/30">{a.title}</h4>
                 <p className="text-xl font-bold opacity-80 mb-6 leading-relaxed">{a.content}</p>
                 <div className="text-[10px] font-black uppercase opacity-30 italic">Publicado em {new Date(a.created_at).toLocaleString()}</div>
               </div>
             ))}
          </div>
        ) : (
          <>
            <div className="mb-10 flex justify-center">
              <button onClick={() => setShowCreateBox(!showCreateBox)} className={`flex items-center gap-3 px-12 py-5 rounded-full font-black text-xs uppercase tracking-widest transition-all ${showCreateBox ? 'bg-rose-500 text-white shadow-2xl' : 'bg-indigo-600 text-white shadow-2xl hover:scale-105 active:scale-95'}`}>
                {showCreateBox ? <X size={20}/> : <Plus size={20} strokeWidth={4}/>} {showCreateBox ? 'Cancelar Lançamento' : 'Nova Missão'}
              </button>
            </div>

            {showCreateBox && (
              <div className={`p-10 rounded-[48px] border-4 border-black mb-16 shadow-[20px_20px_0px_0px_rgba(0,0,0,1)] ${isDarkMode ? 'bg-[#161B22] border-white' : 'bg-white'}`}>
                <input className={`w-full text-5xl font-black bg-transparent outline-none mb-10 placeholder-slate-200 uppercase ${isDarkMode ? 'text-white' : 'text-black'}`} placeholder="Nome da Missão" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} />
                <textarea className={`w-full p-8 rounded-[35px] border-4 border-black mb-10 text-xl font-bold ${isDarkMode ? 'bg-white/5 text-white' : 'bg-slate-50 text-black'}`} placeholder="Instruções de Campo..." rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
                
                <div className="bg-indigo-600/5 p-8 rounded-[40px] border-4 border-dashed border-indigo-600/20 mb-10">
                   <label className="text-[11px] font-black uppercase text-indigo-600 mb-6 block tracking-[0.3em] flex items-center gap-3"><ListChecks size={20}/> Checklist de Passos</label>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     {tempSubtasks.map((sub, idx) => (
                       <div key={idx} className="flex items-center gap-3 bg-white dark:bg-black/20 p-4 rounded-2xl border-2 border-black">
                         <input className={`flex-1 bg-transparent font-black text-sm outline-none ${isDarkMode ? 'text-white' : 'text-black'}`} value={sub.title} onChange={e => { const n = [...tempSubtasks]; n[idx].title = e.target.value; setTempSubtasks(n); }} placeholder="Definir objetivo..." />
                         <button onClick={() => setTempSubtasks(tempSubtasks.filter((_, i) => i !== idx))} className="text-rose-400 hover:text-rose-600"><X size={20}/></button>
                       </div>
                     ))}
                     <button onClick={() => setTempSubtasks([...tempSubtasks, {title: '', done: false}])} className="flex items-center justify-center gap-3 p-4 border-4 border-dashed border-black rounded-[25px] text-slate-400 font-black text-xs hover:border-indigo-600">+ Adicionar Etapa</button>
                   </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-end border-t-4 border-black/10 pt-10 text-left">
                   <div className="space-y-4">
                      <label className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest italic">Responsável</label>
                      <select disabled={userRole === 'membro'} className="w-full p-4 rounded-3xl bg-indigo-600 text-white font-black text-sm border-4 border-black shadow-xl" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id} className="text-black">{p.full_name}</option>)}</select>
                   </div>
                   <div className="md:col-span-1 space-y-5">
                      <div className="flex gap-2">
                        <button onClick={() => setIsPontual(!isPontual)} className={`flex-1 p-4 rounded-2xl font-black uppercase text-[10px] border-4 border-black transition-all ${isPontual ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500'}`}>{isPontual ? '⚡ Única' : '🔄 Recorrente'}</button>
                        {!isPontual && <div className="flex items-center gap-3 px-4 rounded-2xl bg-white border-4 border-black"><Repeat size={18} className="text-indigo-500"/><input type="number" min="1" className="w-10 bg-transparent font-black text-lg text-center text-black" value={repeatInterval} onChange={e => setRepeatInterval(parseInt(e.target.value))} /><span className="text-[9px] font-black opacity-30 uppercase">Semanas</span></div>}
                      </div>
                      {!isPontual && <div className="flex gap-1.5 p-1.5 rounded-2xl border-4 border-black bg-slate-100">{weekDays.map(day => (<button key={day.id} type="button" onClick={() => toggleDay(day.id)} className={`flex-1 h-10 rounded-xl font-black text-[10px] transition-all ${selectedDays.includes(day.id) ? 'bg-indigo-600 text-white shadow-lg scale-105' : 'text-slate-400 hover:text-slate-600'}`}>{day.label}</button>))}</div>}
                   </div>
                   <button onClick={addTask} className="w-full bg-black text-white p-7 rounded-[35px] font-black uppercase text-xs tracking-[0.3em] shadow-2xl hover:bg-indigo-600 transition-all">Efetivar Lançamento</button>
                </div>
              </div>
            )}

            <div className="space-y-6">
              <h2 className="text-[10px] font-black uppercase text-slate-400 tracking-[0.5em] flex items-center gap-4 mb-10"><div className="w-16 h-1 bg-indigo-600 rounded-full" /> {activeTab} • {filteredTasks.length} MISSÕES</h2>
              {filteredTasks.map(task => {
                const todayStr = getTodayStr(); const lS = getLastOccurrence(task); const lD = task.last_done_date || '1970-01-01';
                const isDone = lD >= lS; const isLate = !isDone && lS < todayStr;
                return (<TaskBox key={task.id} task={task} profiles={profiles} isLate={isLate} isDoneToday={isDone} userRole={userRole} currentUserId={user.id} isDarkMode={isDarkMode} onToggle={() => toggleComplete(task)} onEdit={(t: any) => { setEditingTask(t); setShowEditModal(true); }} onUpdate={fetchTasks} />)
              })}
            </div>
          </>
        )}
      </main>

      {/* MODAL PERFIL */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-black/90 z-[70] flex items-center justify-center p-6 backdrop-blur-md animate-in fade-in">
          <div className="bg-white p-12 rounded-[50px] w-full max-w-sm border-8 border-black shadow-[20px_20px_0px_0px_rgba(59,130,246,1)]">
            <h2 className="text-2xl font-black uppercase mb-10 tracking-tighter italic text-black text-center underline decoration-indigo-600 underline-offset-8">Identidade</h2>
            <div className="space-y-6">
              <input className="w-full p-5 rounded-3xl border-4 border-black font-black bg-slate-50 text-black outline-none focus:bg-white" placeholder="Nome Completo" value={newName} onChange={e => setNewName(e.target.value)} />
              <button onClick={updateProfile} className="w-full bg-indigo-600 text-white p-5 rounded-3xl font-black uppercase text-sm tracking-widest border-4 border-black shadow-lg">Salvar Dados</button>
              <button onClick={() => setShowProfileModal(false)} className="w-full text-slate-400 font-black text-[10px] uppercase tracking-widest text-center mt-2">Sair</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EDIÇÃO */}
      {showEditModal && editingTask && (
        <div className="fixed inset-0 bg-black/90 z-[70] flex items-center justify-center p-4 backdrop-blur-md animate-in zoom-in-95">
          <div className={`p-14 rounded-[60px] w-full max-w-2xl border-8 border-indigo-600 shadow-2xl overflow-y-auto max-h-[95vh] ${isDarkMode ? 'bg-[#161B22]' : 'bg-white'}`}>
             <h2 className="text-4xl font-black uppercase mb-12 tracking-tighter text-indigo-600 italic">Modificar Missão</h2>
             <div className="space-y-10 text-left">
                <input className={`w-full text-4xl font-black bg-transparent outline-none border-b-4 uppercase ${isDarkMode ? 'text-white border-white/20' : 'text-black border-black/10'}`} value={editingTask.title} onChange={e => setEditingTask({...editingTask, title: e.target.value})} />
                <textarea className={`w-full p-8 rounded-[40px] border-4 border-black font-black ${isDarkMode ? 'bg-black/30 text-white' : 'bg-slate-50 text-black'}`} rows={3} value={editingTask.notes || ''} onChange={e => setEditingTask({...editingTask, notes: e.target.value})} />
                <div className="space-y-4 border-t-4 pt-8 border-black/10">
                  <label className="text-[11px] font-black uppercase opacity-40 flex items-center gap-3"><ListChecks size={18}/> Checklist de Passos</label>
                  <div className="space-y-3">
                    {(editingTask.subtasks || []).map((sub: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-4 bg-slate-50 dark:bg-black/30 p-4 rounded-3xl border-4 border-black">
                        <input type="checkbox" checked={sub.done} onChange={e => { const n = [...editingTask.subtasks]; n[idx].done = e.target.checked; setEditingTask({...editingTask, subtasks: n}); }} className="w-7 h-7 rounded-lg accent-indigo-600" />
                        <input className="flex-1 bg-transparent font-black text-lg text-black dark:text-white outline-none" value={sub.title} onChange={e => { const n = [...editingTask.subtasks]; n[idx].title = e.target.value; setEditingTask({...editingTask, subtasks: n}); }} />
                        <button onClick={() => { const n = editingTask.subtasks.filter((_:any, i:number) => i !== idx); setEditingTask({...editingTask, subtasks: n}); }} className="text-rose-400"><X size={24}/></button>
                      </div>
                    ))}
                    <button onClick={() => { const n = [...(editingTask.subtasks || []), {title:'', done:false}]; setEditingTask({...editingTask, subtasks: n}); }} className="w-full py-5 border-4 border-dashed border-slate-300 rounded-[35px] text-slate-400 font-black uppercase text-[10px] hover:text-indigo-600">+ Inserir Nova Etapa</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-8">
                   <select className="w-full p-5 rounded-3xl font-black border-4 border-black shadow-lg bg-indigo-600 text-white appearance-none" value={editingTask.assigned_to} onChange={e => setEditingTask({...editingTask, assigned_to: e.target.value})}>{profiles.map(p => <option key={p.id} value={p.id} className="text-black">{p.full_name}</option>)}</select>
                   <input type="number" className="w-full p-5 rounded-3xl font-black border-4 border-black text-center shadow-lg bg-slate-100 text-black" value={editingTask.repeat_interval || 1} onChange={e => setEditingTask({...editingTask, repeat_interval: parseInt(e.target.value)})} />
                </div>
                <div className="space-y-4">
                  <div className="flex gap-2 p-2 rounded-3xl border-4 border-black bg-slate-100">
                    {weekDays.map(day => (<button key={day.id} type="button" onClick={() => toggleDayInEdit(day.id)} className={`flex-1 h-14 rounded-2xl font-black text-lg transition-all ${editingTask.repeat_days?.split(',').includes(day.id) ? 'bg-indigo-600 text-white shadow-xl' : 'text-slate-400'}`}>{day.label}</button>))}
                  </div>
                </div>
                <button onClick={updateTask} className="w-full bg-black text-white p-8 rounded-[40px] font-black uppercase text-2xl shadow-2xl hover:bg-indigo-600 transition-all mt-6 border-b-[10px] border-blue-950">Confirmar Mudanças</button>
             </div>
          </div>
        </div>
      )}
    </div>
  )
}

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
    <div className={`p-8 rounded-[50px] border-4 transition-all duration-500 flex flex-col gap-6 relative group shadow-[15px_15px_0px_0px_rgba(0,0,0,1)] ${
      isDoneToday 
      ? 'bg-green-500/10 border-green-600 opacity-60 grayscale text-left' 
      : isLate 
        ? 'bg-rose-500/10 border-rose-600 animate-pulse text-left shadow-[15px_15px_0px_0px_rgba(220,38,38,1)]' 
        : isDarkMode ? 'bg-[#1C1F2E] border-white text-left' : 'bg-white border-black text-left hover:-translate-y-2'
    }`}>
      <div className="flex items-center gap-8 text-left">
        {/* CHECKBOX GIGANTE */}
        <button onClick={onToggle} className={`w-20 h-20 rounded-[30px] border-[6px] flex items-center justify-center transition-all flex-shrink-0 ${isDoneToday ? 'bg-green-600 border-black text-white' : 'bg-white border-black text-transparent hover:border-indigo-600'}`}><Check size={45} strokeWidth={6}/></button>
        
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <h3 className={`text-4xl font-black leading-none uppercase ${isDoneToday ? 'line-through text-slate-400' : isDarkMode ? 'text-white' : 'text-black'}`}>{task.title}</h3>
          
          {subTotal > 0 && (
            <div className="flex items-center gap-4 mt-3">
              <div className="flex-1 bg-slate-200 dark:bg-white/10 h-3 rounded-full overflow-hidden border-2 border-black/10"><div className="bg-indigo-600 h-full transition-all duration-1000 shadow-lg" style={{ width: `${(subDone / subTotal) * 100}%` }} /></div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{subDone}/{subTotal} PASSOS</span>
              {expanded ? <ChevronUp size={20} className="text-indigo-600"/> : <ChevronDown size={20} className="text-slate-300"/>}
            </div>
          )}

          {task.notes && <div className="flex items-start gap-2 mt-4 opacity-80"><FileText size={18} className="mt-1 text-indigo-500 flex-shrink-0" /><p className={`text-lg font-bold leading-relaxed line-clamp-1 ${isDoneToday ? 'text-slate-300' : isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>{task.notes}</p></div>}

          <div className="flex flex-wrap gap-3 mt-6">
            <span className="px-4 py-2 rounded-xl text-[10px] font-black uppercase bg-black text-white border-2 border-white/10 flex items-center gap-2"><User size={12}/> {profiles.find(p => p.id === task.assigned_to)?.full_name || 'Agente Alocado'}</span>
            <span className="px-4 py-2 rounded-xl text-[10px] font-black uppercase bg-indigo-600 text-white border-2 border-black shadow-md">{task.category}</span>
            <span className="px-4 py-2 rounded-xl text-[10px] font-black uppercase bg-white text-slate-900 border-2 border-black flex items-center gap-2"><Calendar size={12}/> Próxima: {getNextOccurrence(task)}</span>
          </div>
        </div>
        {canModify && (
          <div className="flex flex-col gap-3 opacity-0 group-hover:opacity-100 transition-all scale-90 group-hover:scale-100">
            <button onClick={() => onEdit(task)} className="p-4 text-indigo-600 hover:bg-indigo-50 rounded-2xl border-4 border-black bg-white shadow-[5px_5px_0px_0px_#000] transition-all"><Edit3 size={28} strokeWidth={3}/></button>
            <button onClick={async () => { if(confirm('Eliminar Missão?')) { await supabase.from('tasks').delete().eq('id', task.id); onUpdate(); } }} className="p-4 text-rose-600 hover:bg-rose-50 rounded-2xl border-4 border-black bg-white shadow-[5px_5px_0px_0px_#000] transition-all"><Trash2 size={28} strokeWidth={3}/></button>
          </div>
        )}
      </div>

      {expanded && subTotal > 0 && (
        <div className="mt-4 space-y-3 border-t-4 border-black/10 pt-10 animate-in slide-in-from-top-6 duration-500 text-left">
          {subtasks.map((sub: any, idx: number) => (
            <div key={idx} onClick={() => toggleSub(idx)} className={`flex items-center gap-6 p-6 rounded-[35px] border-4 border-black transition-all cursor-pointer shadow-lg ${sub.done ? 'bg-green-600/10 opacity-50 grayscale' : 'bg-slate-50 hover:translate-x-4'}`}>
              <div className={`w-12 h-12 rounded-xl border-[5px] border-black flex items-center justify-center transition-all ${sub.done ? 'bg-green-500 text-white shadow-inner' : 'bg-white text-transparent'}`}><Check size={28} strokeWidth={6} /></div>
              <span className={`text-2xl font-black uppercase tracking-tight ${sub.done ? 'line-through text-black' : isDarkMode ? 'text-white' : 'text-black'}`}>{sub.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DashboardCard({ label, val, color, isDark }: any) {
  return (<div className={`p-10 rounded-[48px] border transition-all ${isDark ? 'bg-[#161B22] border-white/5 shadow-none' : 'bg-white border-slate-100 shadow-2xl shadow-slate-200/40'}`}><span className="text-[10px] font-black uppercase tracking-[0.4em] block mb-4 opacity-30 italic">{label}</span><span className={`text-7xl font-black tracking-tighter ${color || (isDark ? 'text-white' : 'text-slate-950')}`}>{val}</span></div>)
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
        <h1 className="text-6xl font-black italic tracking-tighter text-slate-950 leading-none mb-12 uppercase font-sans">SUPPLY<br/><span className="text-indigo-600 text-3xl not-italic tracking-[0.3em] font-medium opacity-90 uppercase">Tasker</span></h1>
        <div className="space-y-4 text-center">
          <input className="w-full p-5 bg-slate-50 border border-slate-100 rounded-[28px] font-black text-xl text-slate-950 outline-none focus:ring-4 focus:ring-indigo-50" placeholder="E-MAIL" onChange={e => setEmail(e.target.value)} />
          <input className="w-full p-5 bg-slate-50 border border-slate-100 rounded-[28px] font-black text-xl text-slate-950 outline-none focus:ring-4 focus:ring-indigo-50" type="password" placeholder="SENHA" onChange={e => setPassword(e.target.value)} />
          <button onClick={processAuth} className="w-full bg-slate-950 text-white p-6 rounded-[30px] font-black uppercase text-xs tracking-widest shadow-2xl hover:bg-indigo-600 transition-all mt-6">{isSignUp ? 'CRIAR ACESSO' : 'ACESSAR CENTRO'}</button>
          <button onClick={() => setIsSignUp(!isSignUp)} className="w-full mt-8 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-indigo-600 transition-colors uppercase font-sans">SOLICITAR CONTA</button>
        </div>
      </div>
    </div>
  )
}