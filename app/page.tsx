'use client'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { 
  Plus, Trash2, CheckCircle2, LayoutDashboard, LogOut, Calendar, Tag, User, 
  Repeat, X, Check, AlertCircle, TrendingUp, Edit3, FileText, ChevronRight, 
  Activity, Clock, ListChecks, Users, Search, Moon, Sun, Megaphone, Send, ChevronDown, ChevronUp
} from 'lucide-react'

// --- 1. DEFINIÇÃO DE TIPOS ---
interface Subtask {
  title: string;
  done: boolean;
}

interface Task {
  id: string;
  created_at: string;
  title: string;
  notes?: string;
  assigned_to: string;
  status: 'pendente' | 'concluido';
  category: string;
  repeat_days?: string;
  repeat_interval: number;
  last_done_date?: string;
  due_date?: string;
  subtasks: Subtask[];
}

interface Profile {
  id: string;
  full_name: string;
  role: 'admin' | 'gerente' | 'membro';
}

// --- 2. UTILITÁRIOS DE DATA (FIXO) ---
const getTodayStr = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().split('T')[0];
};

const getLastOccurrence = (task: Task) => {
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

const getNextOccurrence = (task: Task) => {
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
// 3. COMPONENTE PRINCIPAL
// ==========================================
export default function App() {
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<Profile['role']>('membro');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
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
  
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [category, setCategory] = useState('Trade');
  const [isPontual, setIsPontual] = useState(false);
  const [repeatInterval, setRepeatInterval] = useState(1);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [tempSubtasks, setTempSubtasks] = useState<Subtask[]>([]);
  const [newName, setNewName] = useState('');
  const [newAnnounce, setNewAnnounce] = useState({ title: '', content: '' });

  const categories = ['HOJE', 'ATRASADOS', 'Minhas', 'Todas', 'Trade', 'Reunião', 'COMUNICADOS', 'HISTÓRICO', 'DASHBOARD'];
  const weekDays = [{ id: 'seg', label: 'S' }, { id: 'ter', label: 'T' }, { id: 'qua', label: 'Q' }, { id: 'qui', label: 'Q' }, { id: 'sex', label: 'S' }];

  const loadData = useCallback(async () => {
    const { data: t } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
    const { data: p } = await supabase.from('profiles').select('*');
    const { data: h } = await supabase.from('task_history').select('*').order('created_at', { ascending: false }).limit(50);
    const { data: a } = await supabase.from('announcements').select('*').order('created_at', { ascending: false });
    if (t) setTasks(t); if (p) setProfiles(p); if (h) setHistory(h); if (a) setAnnouncements(a);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        setAssignedTo(session.user.id);
        supabase.from('profiles').select('role, full_name').eq('id', session.user.id).single()
          .then(({ data }) => {
            if (data) { setUserRole(data.role); setNewName(data.full_name || ''); }
          });
        loadData();
      }
    });
  }, [loadData]);

  // --- FILTRAGEM ---
  const filteredTasks = useMemo(() => {
    const todayStr = getTodayStr();
    return tasks.filter(task => {
      const lS = getLastOccurrence(task);
      const isDone = (task.last_done_date || '1970-01-01') >= lS;
      const isLate = !isDone && lS < todayStr;
      const isDueToday = lS === todayStr;

      if (searchTerm && !task.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (filterUser !== 'Todos' && task.assigned_to !== filterUser) return false;

      switch(activeTab) {
        case 'ATRASADOS': return isLate;
        case 'HOJE': return isDueToday && !isDone;
        case 'Minhas': return userRole === 'admin' || userRole === 'gerente' ? true : task.assigned_to === user?.id;
        case 'Todas': return true;
        case 'DASHBOARD': case 'HISTÓRICO': case 'COMUNICADOS': return false;
        default: return task.category === activeTab;
      }
    });
  }, [tasks, activeTab, filterUser, searchTerm, user?.id, userRole]);

  const stats = useMemo(() => {
    const todayStr = getTodayStr();
    const base = tasks.filter(t => filterUser === 'Todos' || t.assigned_to === filterUser);
    const relevant = base.filter(t => dashFilter === 'HOJE' ? getLastOccurrence(t) === todayStr : true);
    const total = relevant.length;
    const done = relevant.filter(t => (t.last_done_date || '1970-01-01') >= getLastOccurrence(t)).length;
    return { total, concluidas: done, pendentes: total - done, perc: total > 0 ? Math.round((done/total)*100) : 0 };
  }, [tasks, filterUser, dashFilter]);

  // --- HANDLERS ---
  const handleToggle = async (task: Task) => {
    const todayStr = getTodayStr();
    const isDone = (task.last_done_date || '1970-01-01') >= getLastOccurrence(task);
    const newDate = isDone ? null : todayStr;

    if (!isDone) {
      const profile = profiles.find(p => p.id === user.id);
      await supabase.from('task_history').insert([{
        task_id: task.id, task_title: task.title, user_name: profile?.full_name || user.email, user_id: user.id, category: task.category
      }]);
    }
    await supabase.from('tasks').update({ last_done_date: newDate, status: newDate ? 'concluido' : 'pendente' }).eq('id', task.id);
    loadData();
  };

  const handleAddTask = async () => {
    if (!taskTitle) return;
    const { error } = await supabase.from('tasks').insert([{ 
      title: taskTitle.toUpperCase(), assigned_to: assignedTo, status: 'pendente', category, notes, 
      repeat_days: isPontual ? "" : selectedDays.join(','), repeat_interval: isPontual ? 1 : repeatInterval,
      subtasks: tempSubtasks, due_date: isPontual ? getTodayStr() : null 
    }]);
    if (!error) { setShowCreateBox(false); setTaskTitle(''); setNotes(''); setTempSubtasks([]); loadData(); }
  };

  const updateProfile = async () => {
    await supabase.from('profiles').update({ full_name: newName }).eq('id', user.id);
    setShowProfileModal(false); loadData();
  };

  const updateTask = async () => {
    if (!editingTask) return;
    await supabase.from('tasks').update({ 
      title: editingTask.title.toUpperCase(), notes: editingTask.notes, assigned_to: editingTask.assigned_to,
      category: editingTask.category, repeat_days: editingTask.repeat_days, repeat_interval: editingTask.repeat_interval, subtasks: editingTask.subtasks
    }).eq('id', editingTask.id);
    setShowEditModal(false); setEditingTask(null); loadData();
  };

  const toggleDay = (day: string) => setSelectedDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  const toggleDayInEdit = (day: string) => {
    if (!editingTask) return;
    const currentDays = editingTask.repeat_days ? editingTask.repeat_days.split(',') : [];
    const newDays = currentDays.includes(day) ? currentDays.filter(d => d !== day) : [...currentDays, day];
    setEditingTask({ ...editingTask, repeat_days: newDays.join(',') });
  };

  if (!user) return <Login />;

  return (
    <div className={`min-h-screen transition-colors duration-500 font-sans ${isDarkMode ? 'bg-[#0B0E14] text-slate-100' : 'bg-[#F8FAFC] text-slate-900'} overflow-x-hidden w-full`}>
      
      {/* NAVBAR */}
      <nav className={`sticky top-0 z-50 border-b transition-all ${isDarkMode ? 'bg-[#11141D]/90 border-white/5 shadow-2xl' : 'bg-white/90 border-slate-200 shadow-sm'} backdrop-blur-md`}>
        <div className="max-w-7xl mx-auto px-6 h-14 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-1.5 rounded-lg shadow-lg"><Activity size={18} className="text-white" /></div>
            <h1 className="text-sm font-bold tracking-tight uppercase">Supply<span className="text-indigo-600">Builder</span></h1>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-2 rounded-xl text-slate-400 hover:text-indigo-500 transition-all">
              {isDarkMode ? <Sun size={18}/> : <Moon size={18}/>}
            </button>
            <button onClick={() => setShowProfileModal(true)} className={`flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border transition-all ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
              <div className="w-7 h-7 bg-indigo-600 rounded-full flex items-center justify-center text-[10px] font-bold text-white">{newName?.charAt(0) || 'U'}</div>
              <span className="text-[10px] font-bold uppercase hidden sm:block">{newName || 'Perfil'}</span>
            </button>
            <button onClick={() => supabase.auth.signOut().then(() => window.location.reload())} className="text-slate-400 hover:text-red-500 p-2"><LogOut size={18}/></button>
          </div>
        </div>
      </nav>

      {/* FILTER BAR */}
      <div className={`sticky top-14 z-40 border-b transition-all ${isDarkMode ? 'bg-[#0B0E14]/95 border-white/5' : 'bg-[#F8FAFC]/95 border-slate-200 shadow-sm'}`}>
        <div className="max-w-5xl mx-auto px-6 py-4 space-y-4">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
              <input className={`w-full pl-9 pr-4 py-2 rounded-xl text-xs border-0 ring-1 outline-none transition-all ${isDarkMode ? 'bg-white/5 ring-white/10 text-white' : 'bg-white ring-slate-200 focus:ring-indigo-500 shadow-sm'}`} placeholder="Pesquisar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <div className={`flex p-0.5 rounded-xl ring-1 overflow-x-auto no-scrollbar max-w-full ${isDarkMode ? 'bg-black/20 ring-white/5' : 'bg-slate-200/50 ring-slate-200'}`}>
              {categories.map(tab => (
                <button key={tab} onClick={() => { setActiveTab(tab); setShowCreateBox(false); }} className={`px-4 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all whitespace-nowrap ${activeTab === tab ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-indigo-500'}`}>{tab}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 overflow-x-auto no-scrollbar pb-1">
            <button onClick={() => setFilterUser('Todos')} className={`px-3 py-1 rounded-lg text-[8px] font-bold uppercase border transition-all ${filterUser === 'Todos' ? 'bg-slate-900 text-white dark:bg-indigo-600 shadow-md' : 'bg-white border dark:bg-white/5 dark:text-slate-400 border-slate-200'}`}>Todos</button>
            {profiles.map((p: Profile) => (
              <button key={p.id} onClick={() => setFilterUser(p.id)} className={`px-3 py-1 rounded-lg text-[8px] font-bold uppercase border transition-all flex items-center gap-1.5 ${filterUser === p.id ? 'bg-indigo-600 text-white border-transparent shadow-lg' : 'bg-white border-slate-200 dark:bg-white/5 dark:text-slate-500'}`}>
                {p.full_name?.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-4xl mx-auto p-6">
        {activeTab === 'DASHBOARD' ? (
          <div className="space-y-6 animate-in fade-in duration-700 mt-4 text-center">
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <DashboardCard label="Metas" val={stats.total} isDark={isDarkMode} />
                <DashboardCard label="Sucesso" val={stats.concluidas} color="text-emerald-500" isDark={isDarkMode} />
                <DashboardCard label="Pendente" val={stats.pendentes} color="text-rose-500" isDark={isDarkMode} />
             </div>
             <div className={`p-16 rounded-[48px] border transition-all ${isDarkMode ? 'bg-[#161B22] border-white/5 shadow-none' : 'bg-white border-slate-100 shadow-2xl'}`}>
                <h3 className={`text-[120px] font-black tracking-tighter leading-none ${isDarkMode ? 'text-white' : 'text-slate-950'}`}>{stats.perc}%</h3>
                <p className="text-xs font-bold uppercase text-slate-400 tracking-[0.4em]">Eficiência do Setor</p>
                <div className="mt-12 max-w-lg mx-auto bg-slate-100 dark:bg-white/5 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-indigo-600 h-full transition-all duration-1000 shadow-[0_0_20px_rgba(79,70,229,0.8)]" style={{ width: `${stats.perc}%` }} />
                </div>
             </div>
          </div>
        ) : activeTab === 'COMUNICADOS' ? (
          <div className="mt-8 space-y-6 max-w-2xl mx-auto animate-in slide-in-from-bottom-4">
             {userRole === 'admin' && (
               <div className={`p-8 rounded-[32px] border ${isDarkMode ? 'bg-[#11141D] border-white/5' : 'bg-white border-slate-200 shadow-xl'}`}>
                  <input className={`w-full p-4 rounded-xl border mb-3 font-bold text-sm ${isDarkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-slate-50'}`} placeholder="Assunto..." value={newAnnounce.title} onChange={e => setNewAnnounce({...newAnnounce, title: e.target.value})} />
                  <textarea className={`w-full p-4 rounded-xl border mb-4 text-sm font-medium ${isDarkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-slate-50'}`} placeholder="Mensagem oficial..." rows={3} value={newAnnounce.content} onChange={e => setNewAnnounce({...newAnnounce, content: e.target.value})} />
                  <button onClick={async () => { await supabase.from('announcements').insert([{ ...newAnnounce, author_id: user.id }]); setNewAnnounce({title:'', content:''}); loadData(); }} className="w-full bg-indigo-600 text-white p-4 rounded-xl text-xs font-bold uppercase tracking-widest shadow-xl">Publicar</button>
               </div>
             )}
             {announcements.map(a => (
               <div key={a.id} className={`p-8 rounded-[32px] border-l-8 border-indigo-600 shadow-xl ${isDarkMode ? 'bg-[#11141D] border-white/5 text-white' : 'bg-white text-slate-900'}`}>
                 <h4 className="text-xl font-bold mb-3 uppercase italic tracking-tight">{a.title}</h4>
                 <p className="text-base font-medium opacity-70 mb-4">{a.content}</p>
                 <div className="text-[8px] font-bold uppercase opacity-30 italic">{new Date(a.created_at).toLocaleString()}</div>
               </div>
             ))}
          </div>
        ) : (
          <>
            {/* NEW TASK BUTTON */}
            <div className="mb-10 flex justify-center">
              <button onClick={() => setShowCreateBox(!showCreateBox)} className={`flex items-center gap-3 px-10 py-4 rounded-full font-bold text-xs uppercase tracking-widest transition-all ${showCreateBox ? 'bg-rose-500 text-white' : 'bg-indigo-600 text-white shadow-xl hover:scale-105 active:scale-95'}`}>
                {showCreateBox ? <X size={18}/> : <Plus size={18} strokeWidth={3}/>} {showCreateBox ? 'Fechar' : 'Nova Missão'}
              </button>
            </div>

            {showCreateBox && (
              <div className={`p-8 rounded-[40px] border mb-12 animate-in slide-in-from-top-10 duration-500 shadow-2xl ${isDarkMode ? 'bg-[#11141D] border-white/5' : 'bg-white border-slate-100'}`}>
                <input className={`w-full text-4xl font-bold bg-transparent outline-none mb-10 placeholder-slate-200 uppercase ${isDarkMode ? 'text-white' : 'text-slate-950'}`} placeholder="Nome da Missão" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} />
                <textarea className={`w-full p-6 rounded-2xl mb-8 font-medium text-lg border transition-all ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-100 focus:bg-white focus:ring-1 focus:ring-indigo-100 shadow-inner'}`} placeholder="Instruções e notas técnicas..." rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
                
                {/* CHECKLIST CRIAÇÃO */}
                <div className="bg-indigo-600/5 p-6 rounded-3xl border border-indigo-600/10 mb-10">
                   <label className="text-[10px] font-bold uppercase text-indigo-600 mb-4 block tracking-widest flex items-center gap-2"><ListChecks size={16}/> Checklist Estratégico</label>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     {tempSubtasks.map((sub, idx) => (
                       <div key={idx} className="flex items-center gap-3 bg-white dark:bg-white/5 p-3 rounded-xl border border-slate-200">
                         <input className={`flex-1 bg-transparent font-bold text-xs outline-none ${isDarkMode ? 'text-white' : 'text-slate-900'}`} value={sub.title} onChange={e => { const n = [...tempSubtasks]; n[idx].title = e.target.value; setTempSubtasks(n); }} placeholder="Passo..." />
                         <button onClick={() => setTempSubtasks(tempSubtasks.filter((_, i) => i !== idx))} className="text-rose-400"><X size={18}/></button>
                       </div>
                     ))}
                     <button onClick={() => setTempSubtasks([...tempSubtasks, {title: '', done: false}])} className="flex items-center justify-center gap-2 p-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 font-bold text-[9px] hover:border-indigo-500 transition-all uppercase">+ Inserir Passo</button>
                   </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-end border-t dark:border-white/5 pt-10">
                   <div className="space-y-4">
                      <label className="text-[10px] font-bold uppercase text-slate-400 ml-1">Agente Responsável</label>
                      <select disabled={userRole === 'membro'} className="w-full p-4 rounded-xl bg-indigo-600 text-white font-bold text-sm border-none shadow-xl cursor-pointer" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id} className="text-black">{p.full_name}</option>)}</select>
                   </div>
                   <div className="space-y-4">
                      <button onClick={() => setIsPontual(!isPontual)} className={`w-full p-4 rounded-xl font-bold uppercase text-[9px] border transition-all ${isPontual ? 'bg-amber-500 text-white' : 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}>{isPontual ? '⚡ Missão Única' : '🔄 Recorrente'}</button>
                      {!isPontual && <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-slate-100 dark:bg-white/5 border"><Repeat size={14} className="text-indigo-500"/><input type="number" min="1" className="w-8 bg-transparent font-bold text-sm text-center" value={repeatInterval} onChange={e => setRepeatInterval(parseInt(e.target.value))} /><span className="text-[8px] font-bold text-slate-400">Semanas</span></div>}
                   </div>
                   {!isPontual && <div className="flex gap-1 bg-slate-100 dark:bg-white/5 p-1 rounded-xl border">{weekDays.map(day => (<button key={day.id} type="button" onClick={() => toggleDay(day.id)} className={`flex-1 h-9 rounded-lg font-black text-[10px] transition-all ${selectedDays.includes(day.id) ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400'}`}>{day.label}</button>))}</div>}
                   <button onClick={handleAddTask} className="w-full bg-slate-900 dark:bg-indigo-600 text-white p-5 rounded-2xl font-bold uppercase text-xs tracking-widest shadow-2xl hover:scale-105 transition-all">Lançar no Sistema</button>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <h2 className="text-[10px] font-bold uppercase text-slate-400 tracking-[0.4em] flex items-center gap-4 mb-8"><div className="w-12 h-0.5 bg-indigo-600 rounded-full" /> {activeTab} • {filteredTasks.length} MISSÕES</h2>
              {filteredTasks.map(task => {
                const lSStr = getLastOccurrence(task); const lDStr = task.last_done_date || '1970-01-01';
                const isDone = lDStr >= lSStr; const isLate = !isDone && lSStr < getTodayStr();
                return (<TaskBox key={task.id} task={task} profiles={profiles} isLate={isLate} isDoneToday={isDone} userRole={userRole} currentUserId={user.id} isDarkMode={isDarkMode} onToggle={() => handleToggle(task)} onEdit={(t: Task) => { setEditingTask(t); setShowEditModal(true); }} onUpdate={loadData} />)
              })}
            </div>
          </>
        )}
      </main>

      {/* MODAL PERFIL */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-slate-900/60 z-[70] flex items-center justify-center p-6 backdrop-blur-md animate-in fade-in">
          <div className={`p-10 rounded-[32px] w-full max-w-sm shadow-2xl ${isDarkMode ? 'bg-[#161B22] text-white border border-white/5' : 'bg-white text-slate-950'}`}>
            <h2 className="text-xl font-bold mb-8">Sua Identidade</h2>
            <div className="space-y-4">
              <input className={`w-full p-4 rounded-xl border transition-all ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-100 focus:bg-white'}`} placeholder="Nome Completo" value={newName} onChange={e => setNewName(e.target.value)} />
              <button onClick={updateProfile} className="w-full bg-indigo-600 text-white p-4 rounded-xl font-bold shadow-xl">Salvar Perfil</button>
              <button onClick={() => setShowProfileModal(false)} className="w-full text-slate-400 font-bold text-[9px] uppercase tracking-widest mt-2">Sair</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EDIÇÃO */}
      {showEditModal && editingTask && (
        <div className="fixed inset-0 bg-slate-900/60 z-[70] flex items-center justify-center p-4 backdrop-blur-md animate-in zoom-in-95">
          <div className={`p-12 rounded-[40px] w-full max-w-2xl shadow-2xl overflow-y-auto max-h-[90vh] ${isDarkMode ? 'bg-[#161B22]' : 'bg-white'}`}>
             <h2 className="text-xl font-bold mb-10 tracking-tight text-indigo-600 uppercase italic">Editar Missão</h2>
             <div className="space-y-8 text-left">
                <input className={`w-full text-3xl font-bold bg-transparent outline-none border-b uppercase ${isDarkMode ? 'text-white' : 'text-slate-950'}`} value={editingTask.title} onChange={e => setEditingTask({...editingTask, title: e.target.value})} />
                <textarea className={`w-full p-6 border rounded-3xl font-bold ${isDarkMode ? 'bg-white/5' : 'bg-slate-50'}`} rows={3} value={editingTask.notes || ''} onChange={e => setEditingTask({...editingTask, notes: e.target.value})} />
                
                <div className="space-y-4 border-t pt-6 border-slate-100 dark:border-white/5">
                  <label className="text-[10px] font-bold uppercase opacity-40 flex items-center gap-2"><ListChecks size={14}/> Checklist Interno</label>
                  <div className="space-y-2">
                    {(editingTask.subtasks || []).map((sub, idx) => (
                      <div key={idx} className="flex items-center gap-3 bg-slate-50 dark:bg-white/5 p-3 rounded-xl border">
                        <input type="checkbox" checked={sub.done} onChange={e => { const n = [...editingTask.subtasks]; n[idx].done = e.target.checked; setEditingTask({...editingTask, subtasks: n}); }} className="w-6 h-6 accent-indigo-600 rounded-md" />
                        <input className="flex-1 bg-transparent font-bold text-xs" value={sub.title} onChange={e => { const n = [...editingTask.subtasks]; n[idx].title = e.target.value; setEditingTask({...editingTask, subtasks: n}); }} />
                        <button onClick={() => { const n = editingTask.subtasks.filter((_:any, i:number) => i !== idx); setEditingTask({...editingTask, subtasks: n}); }} className="text-rose-400 p-1"><X size={20}/></button>
                      </div>
                    ))}
                    <button onClick={() => { const n = [...(editingTask.subtasks || []), {title:'', done:false}]; setEditingTask({...editingTask, subtasks: n}); }} className="w-full py-4 border-2 border-dashed rounded-3xl text-slate-400 font-bold uppercase text-[9px] hover:text-indigo-600 transition-all">+ Novo Passo</button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                   <select className={`w-full p-4 rounded-xl font-bold text-xs ${isDarkMode ? 'bg-white/5 text-white' : 'bg-white text-slate-950'}`} value={editingTask.assigned_to} onChange={e => setEditingTask({...editingTask, assigned_to: e.target.value})}>{profiles.map(p => <option key={p.id} value={p.id} className="text-black">{p.full_name}</option>)}</select>
                   <input type="number" className={`w-full p-4 rounded-xl font-bold text-xs ${isDarkMode ? 'bg-white/5 text-white' : 'bg-slate-100 text-slate-950'}`} value={editingTask.repeat_interval || 1} onChange={e => setEditingTask({...editingTask, repeat_interval: parseInt(e.target.value)})} />
                </div>
                
                <div className="space-y-4">
                  <div className={`flex gap-1 p-1.5 rounded-xl border ${isDarkMode ? 'bg-black/30 border-white/5' : 'bg-slate-100'}`}>
                    {weekDays.map(day => (<button key={day.id} type="button" onClick={() => toggleDayInEdit(day.id)} className={`flex-1 h-10 rounded-lg font-bold text-xs transition-all ${editingTask.repeat_days?.split(',').includes(day.id) ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400'}`}>{day.label}</button>))}
                  </div>
                </div>
                <button onClick={updateTask} className="w-full bg-indigo-600 text-white p-6 rounded-2xl font-bold uppercase text-xs tracking-widest shadow-xl hover:bg-indigo-700 transition-all mt-4">Confirmar Alterações</button>
                <button onClick={() => setShowEditModal(false)} className="w-full font-bold text-slate-400 uppercase text-[9px] tracking-widest">Cancelar</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- SUB-COMPONENTES ---

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
    <div className={`p-5 rounded-[28px] border transition-all duration-500 flex flex-col gap-4 relative group ${
      isDoneToday 
      ? 'bg-slate-50 dark:bg-black/20 border-transparent opacity-50 grayscale shadow-none text-left' 
      : isLate 
        ? 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-500/30 shadow-xl shadow-rose-200/40 text-left' 
        : isDarkMode ? 'bg-[#1C1F2E] border-white/5 hover:border-indigo-500/50 shadow-2xl text-left' : 'bg-white border-slate-100 hover:border-indigo-200 shadow-xl shadow-slate-200/30 hover:-translate-y-0.5 text-left'
    }`}>
      <div className="flex items-center gap-5 text-left">
        {/* CHECKMARK SOFT */}
        <button 
          onClick={onToggle} 
          className={`w-11 h-11 rounded-2xl border-2 flex items-center justify-center transition-all flex-shrink-0 ${
            isDoneToday 
            ? 'bg-emerald-500 border-emerald-500 text-white' 
            : isLate ? 'border-rose-400 text-transparent' : 'border-slate-200 dark:border-white/10 text-transparent hover:border-indigo-500'
          }`}
        >
          <Check size={20} strokeWidth={4} />
        </button>
        
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <h3 className={`text-lg font-bold tracking-tight transition-all leading-tight uppercase ${isDoneToday ? 'text-slate-400 line-through' : isLate ? 'text-rose-600' : 'text-slate-950 dark:text-white'}`}>{task.title}</h3>
          
          {subTotal > 0 && (
            <div className="flex items-center gap-3 mt-1.5">
              <div className="flex-1 bg-slate-100 dark:bg-white/5 h-1 rounded-full overflow-hidden border dark:border-white/5"><div className="bg-indigo-600 h-full transition-all duration-700 shadow-[0_0_10px_rgba(79,70,229,0.5)]" style={{ width: `${(subDone / subTotal) * 100}%` }} /></div>
              <span className="text-[7px] font-bold text-slate-400 uppercase tracking-widest">{subDone}/{subTotal}</span>
              {expanded ? <ChevronUp size={12} className="text-indigo-600"/> : <ChevronDown size={12} className="text-slate-300"/>}
            </div>
          )}

          {task.notes && <div className="flex items-start gap-2 mt-2 opacity-60"><FileText size={12} className="mt-0.5 text-indigo-500 flex-shrink-0" /><p className={`text-[11px] font-bold leading-relaxed line-clamp-1 ${isDoneToday ? 'text-slate-300' : 'text-slate-600 dark:text-slate-400'}`}>{task.notes}</p></div>}

          <div className="flex flex-wrap gap-2 mt-4">
            <span className={`px-2 py-1 rounded-lg text-[8px] font-bold uppercase flex items-center gap-1.5 border transition-all ${isDoneToday ? 'bg-slate-100 border-transparent text-slate-300' : 'bg-slate-900 text-white border-slate-800'}`}><User size={10} className="text-indigo-500"/> {profiles.find(p => p.id === task.assigned_to)?.full_name || 'Agente'}</span>
            <span className={`px-2 py-1 rounded-lg text-[8px] font-bold uppercase border transition-all ${isDoneToday ? 'bg-slate-100 border-transparent text-slate-300' : 'bg-indigo-50 border-indigo-100 text-indigo-600'}`}>{task.category}</span>
            <span className={`px-2 py-1 rounded-lg text-[8px] font-bold uppercase border transition-all ${isDoneToday ? 'bg-slate-100 border-transparent text-slate-300' : 'bg-white border-slate-200 text-slate-500'}`}><Calendar size={10}/> Próxima: {getNextOccurrence(task)}</span>
          </div>
        </div>
        {canModify && (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => onEdit(task)} className="p-2 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 dark:hover:bg-white/5"><Edit3 size={18}/></button>
            <button onClick={async () => { if(confirm('Excluir?')) { await supabase.from('tasks').delete().eq('id', task.id); onUpdate(); } }} className="p-2 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-rose-50 dark:hover:bg-white/5"><Trash2 size={18}/></button>
          </div>
        )}
      </div>

      {expanded && subTotal > 0 && (
        <div className="mt-2 space-y-2 border-t border-slate-100 dark:border-white/5 pt-4 animate-in slide-in-from-top-2 duration-300 text-left">
          {subtasks.map((sub: any, idx: number) => (
            <div key={idx} onClick={() => toggleSub(idx)} className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${sub.done ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-600 opacity-50' : 'bg-slate-50 dark:bg-white/5 border-slate-100 dark:border-transparent hover:border-indigo-400'}`}>
              <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all ${sub.done ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm' : 'border-slate-300'}`}><Check size={12} strokeWidth={5} /></div>
              <span className={`text-xs font-bold uppercase tracking-tight ${sub.done ? 'line-through' : (isDarkMode ? 'text-white' : 'text-slate-900')}`}>{sub.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DashboardCard({ label, val, color, isDark }: any) {
  return (<div className={`p-8 rounded-[32px] border transition-all ${isDark ? 'bg-[#161B22] border-white/5 shadow-none' : 'bg-white border-slate-100 shadow-xl shadow-slate-200/40 hover:-translate-y-1'}`}><span className="text-[10px] font-bold uppercase tracking-[0.3em] block mb-2 opacity-40 italic">{label}</span><span className={`text-5xl font-black tracking-tighter ${color || (isDark ? 'text-white' : 'text-slate-950')}`}>{val}</span></div>)
}

function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [isSignUp, setIsSignUp] = useState(false)
  const processAuth = async () => {
    const { error } = isSignUp ? await supabase.auth.signUp({ email, password, options: { data: { full_name: email.split('@')[0] } } }) : await supabase.auth.signInWithPassword({ email, password })
    if (error) alert(error.message); else window.location.reload()
  }
  return (
    <div className="min-h-screen bg-[#0F111A] flex items-center justify-center p-6 text-center">
      <div className="bg-white p-12 rounded-[48px] w-full max-w-sm shadow-[0_50px_100px_rgba(0,0,0,0.5)] relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-indigo-600"></div>
        <div className="bg-indigo-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-10 shadow-2xl shadow-indigo-600/40 rotate-12"><Activity className="text-white" size={32} strokeWidth={3}/></div>
        <h1 className="text-5xl font-bold tracking-tighter text-slate-950 leading-none mb-10 uppercase">SUPPLY<br/><span className="text-indigo-600">Tasker</span></h1>
        <div className="space-y-4">
          <input className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-950 outline-none focus:ring-4 focus:ring-indigo-50" placeholder="E-MAIL" onChange={e => setEmail(e.target.value)} />
          <input className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-950 outline-none focus:ring-4 focus:ring-indigo-50" type="password" placeholder="SENHA" onChange={e => setPassword(e.target.value)} />
          <button onClick={processAuth} className="w-full bg-slate-950 text-white p-5 rounded-2xl font-bold uppercase text-[10px] tracking-widest shadow-2xl hover:bg-indigo-600 transition-all mt-4">{isSignUp ? 'Criar Identidade' : 'Acessar Central'}</button>
          <button onClick={() => setIsSignUp(!isSignUp)} className="w-full mt-8 text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:text-indigo-600">Solicitar Acesso</button>
        </div>
      </div>
    </div>
  )
}