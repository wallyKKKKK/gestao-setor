'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { 
  Plus, Trash2, CheckCircle2, LayoutDashboard, LogOut, Calendar, Tag, User, 
  Repeat, X, Check, AlertCircle, TrendingUp, Edit3, FileText, ChevronRight, 
  Activity, Clock, ListChecks, Users, Search, Moon, Sun, Megaphone, Send, ChevronDown, ChevronUp
} from 'lucide-react'

// --- UTILITÁRIOS ---
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
    <div className={`min-h-screen transition-colors duration-500 ${isDarkMode ? 'bg-[#0F111A] text-slate-100' : 'bg-[#F9FAFB] text-slate-900'} pb-20 font-sans`}>
      
      {/* NAVBAR HIGH-END */}
      <nav className={`sticky top-0 z-50 backdrop-blur-xl border-b transition-all ${isDarkMode ? 'bg-[#161B22]/80 border-white/5' : 'bg-white/80 border-slate-200'}`}>
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

      {/* FILTER BAR (CLEAN & FLOATING) */}
      <div className={`sticky top-16 z-40 border-b transition-all ${isDarkMode ? 'bg-[#0F111A]/95 border-white/5' : 'bg-[#F9FAFB]/95 border-slate-200'}`}>
        <div className="max-w-5xl mx-auto px-6 py-4 space-y-4">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3.5 top-3 text-slate-400" size={16} />
              <input 
                className={`w-full pl-10 pr-4 py-2.5 rounded-2xl text-sm border-0 ring-1 outline-none transition-all ${isDarkMode ? 'bg-white/5 ring-white/10 focus:ring-indigo-500' : 'bg-white ring-slate-200 focus:ring-indigo-500 shadow-sm'}`} 
                placeholder="Buscar missão..." 
                value={searchTerm} 
                onChange={e => setSearchTerm(e.target.value)} 
              />
            </div>

            <div className={`flex p-1 rounded-xl ring-1 overflow-x-auto no-scrollbar max-w-full ${isDarkMode ? 'bg-black/20 ring-white/5' : 'bg-slate-200/50 ring-slate-200'}`}>
              {categories.map(tab => (
                <button 
                  key={tab} 
                  onClick={() => setActiveTab(tab)} 
                  className={`px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all whitespace-nowrap ${
                    activeTab === tab 
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' 
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >{tab}</button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 overflow-x-auto no-scrollbar py-1">
            <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest flex items-center gap-1.5"><Users size={12}/> Agentes:</span>
            <button onClick={() => setFilterUser('Todos')} className={`px-3 py-1 rounded-full text-[9px] font-bold uppercase border transition-all ${filterUser === 'Todos' ? 'bg-slate-900 text-white dark:bg-indigo-600 border-transparent' : 'bg-white border-slate-200 dark:bg-white/5 dark:border-white/10 text-slate-500'}`}>Todos</button>
            {profiles.map(p => (
              <button key={p.id} onClick={() => setFilterUser(p.id)} className={`px-3 py-1 rounded-full text-[9px] font-bold uppercase border transition-all flex items-center gap-1.5 ${filterUser === p.id ? 'bg-indigo-600 text-white border-transparent shadow-md' : 'bg-white border-slate-200 dark:bg-white/5 dark:border-white/10 text-slate-500 hover:border-indigo-400'}`}>
                {p.full_name?.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto p-6">
        {activeTab === 'DASHBOARD' ? (
          <div className="space-y-8 animate-in fade-in duration-700">
             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <DashboardCard label="Monitorados" val={stats.total} isDark={isDarkMode} />
                <DashboardCard label="Concluídos" val={stats.concluidas} color="text-emerald-500" isDark={isDarkMode} />
                <DashboardCard label="Pendentes" val={stats.pendentes} color="text-rose-500" isDark={isDarkMode} />
             </div>
             <div className={`p-16 rounded-[40px] border transition-all text-center ${isDarkMode ? 'bg-[#161B22] border-white/5' : 'bg-white border-slate-100 shadow-xl shadow-slate-200/50'}`}>
                <div className="inline-flex items-center justify-center p-8 rounded-full bg-indigo-600/10 mb-6">
                  <Activity size={48} className="text-indigo-600" />
                </div>
                <h3 className="text-8xl font-black tracking-tighter mb-4">{stats.porcentagem}%</h3>
                <p className="text-xs font-bold uppercase text-slate-400 tracking-[0.3em]">Eficiência Operacional {dashFilter}</p>
                <div className="mt-10 max-w-md mx-auto bg-slate-100 dark:bg-white/5 h-3 rounded-full overflow-hidden">
                  <div className="bg-indigo-600 h-full transition-all duration-1000 shadow-[0_0_20px_rgba(79,70,229,0.5)]" style={{ width: `${stats.porcentagem}%` }} />
                </div>
             </div>
          </div>
        ) : (
          <>
            {/* CLEAN ACTION BUTTON */}
            <div className="mb-8 flex justify-center">
              <button 
                onClick={() => setShowCreateBox(!showCreateBox)} 
                className={`flex items-center gap-3 px-8 py-3.5 rounded-full font-bold text-xs uppercase tracking-widest transition-all ${
                  showCreateBox 
                  ? 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white' 
                  : 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/25 hover:scale-105 active:scale-95'
                }`}
              >
                {showCreateBox ? <X size={18}/> : <Plus size={18}/>}
                {showCreateBox ? 'Fechar Painel' : 'Nova Missão'}
              </button>
            </div>

            {/* HIGH-END COMMAND CENTER */}
            {showCreateBox && (
              <div className={`p-8 rounded-[32px] border mb-12 animate-in slide-in-from-top-8 duration-500 shadow-2xl ${isDarkMode ? 'bg-[#161B22] border-white/10' : 'bg-white border-slate-100'}`}>
                <input className={`w-full text-4xl font-bold bg-transparent outline-none mb-8 placeholder-slate-300 ${isDarkMode ? 'text-white' : 'text-slate-900'}`} placeholder="Nome da missão" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} />
                <textarea className={`w-full p-6 rounded-2xl mb-8 font-medium text-lg border transition-all ${isDarkMode ? 'bg-white/5 border-white/10 focus:bg-white/10' : 'bg-slate-50 border-slate-100 focus:bg-white focus:ring-1 focus:ring-indigo-200 shadow-inner'}`} placeholder="Instruções e notas técnicas..." rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
                
                <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-end">
                   <div className="md:col-span-4 space-y-4">
                      <div className="flex flex-col">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Agente Alocado</label>
                        <select disabled={userRole === 'membro'} className="w-full p-3 rounded-xl bg-indigo-600 text-white font-bold text-sm border-none shadow-lg appearance-none cursor-pointer" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
                          {profiles.map(p => <option key={p.id} value={p.id} className="text-slate-900">{p.full_name}</option>)}
                        </select>
                      </div>
                      <div className="flex flex-col">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Segmento</label>
                        <select className={`w-full p-3 rounded-xl font-bold text-sm border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200'}`} value={category} onChange={e => setCategory(e.target.value)}>
                          <option>Trade</option><option>Reunião</option><option>Geral</option>
                        </select>
                      </div>
                   </div>

                   <div className="md:col-span-5 space-y-4">
                      <div className="flex flex-col">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Frequência Semanal</label>
                        <div className={`flex gap-1 p-1 rounded-xl border ${isDarkMode ? 'bg-black/20 border-white/10' : 'bg-slate-100 border-slate-200'}`}>
                          {weekDays.map(day => (<button key={day.id} type="button" onClick={() => toggleDay(day.id)} className={`flex-1 h-9 rounded-lg font-black text-[10px] transition-all ${selectedDays.includes(day.id) ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}>{day.label}</button>))}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <button onClick={() => setIsPontual(!isPontual)} className={`flex-1 p-3 rounded-xl text-[10px] font-bold uppercase transition-all ${isPontual ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/30' : 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}>
                          {isPontual ? '⚡ Única' : '🔄 Recorrente'}
                        </button>
                        {!isPontual && (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                            <Repeat size={14} className="text-slate-400"/>
                            <input type="number" min="1" className="w-8 bg-transparent font-bold text-sm text-center" value={repeatInterval} onChange={e => setRepeatInterval(parseInt(e.target.value))} />
                            <span className="text-[9px] font-bold text-slate-400">Semanas</span>
                          </div>
                        )}
                      </div>
                   </div>

                   <div className="md:col-span-3">
                      <button onClick={addTask} className="w-full bg-slate-900 dark:bg-indigo-600 text-white p-5 rounded-2xl font-bold uppercase text-xs tracking-widest shadow-2xl hover:scale-105 active:scale-95 transition-all">Lançar Missão</button>
                   </div>
                </div>
              </div>
            )}

            {/* TASK LIST (CLEAN & SEPARATED) */}
            <div className="space-y-4">
              <h2 className="text-[10px] font-bold uppercase text-slate-400 tracking-[0.3em] px-2 flex items-center gap-2 mb-6">
                <div className="w-8 h-[1px] bg-slate-200 dark:bg-white/10"/> {activeTab} • {filteredTasks.length} MISSÕES
              </h2>
              {filteredTasks.map(task => {
                const lSStr = getLastOccurrence(task); const lDStr = task.last_done_date || '1970-01-01';
                const isDone = lDStr >= lSStr; const isLate = !isDone && lSStr < getTodayStr();
                return (<TaskBox key={task.id} task={task} profiles={profiles} isLate={isLate} isDoneToday={isDone} userRole={userRole} currentUserId={user.id} isDarkMode={isDarkMode} onToggle={() => toggleComplete(task)} onEdit={(t: any) => { setEditingTask(t); setShowEditModal(true); }} onUpdate={fetchTasks} />)
              })}
            </div>
          </>
        )}
      </main>

      {/* MODAL PERFIL (CLEAN) */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-slate-900/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className={`p-10 rounded-[32px] w-full max-w-sm shadow-2xl ${isDarkMode ? 'bg-[#161B22] text-white' : 'bg-white text-slate-900'}`}>
            <h2 className="text-xl font-bold mb-8">Configurar Identidade</h2>
            <div className="space-y-4">
              <input className={`w-full p-4 rounded-xl border transition-all ${isDarkMode ? 'bg-white/5 border-white/10 focus:border-indigo-500' : 'bg-slate-50 border-slate-100 focus:bg-white focus:ring-2 focus:ring-indigo-100'}`} placeholder="Nome Completo" value={newName} onChange={e => setNewName(e.target.value)} />
              <button onClick={updateProfile} className="w-full bg-indigo-600 text-white p-4 rounded-xl font-bold shadow-xl shadow-indigo-600/20 hover:scale-[1.02] transition-all">Salvar Dados</button>
              <button onClick={() => setShowProfileModal(false)} className="w-full text-slate-400 font-bold text-xs uppercase tracking-widest mt-2">Voltar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EDIÇÃO (ULTRA MODERN) */}
      {showEditModal && editingTask && (
        <div className="fixed inset-0 bg-slate-900/60 z-[60] flex items-center justify-center p-4 backdrop-blur-md animate-in zoom-in-95">
          <div className={`p-12 rounded-[40px] w-full max-w-2xl shadow-[0_30px_80px_rgba(0,0,0,0.4)] overflow-y-auto max-h-[90vh] ${isDarkMode ? 'bg-[#161B22] border border-white/5' : 'bg-white'}`}>
             <div className="flex justify-between items-center mb-10">
               <h2 className="text-2xl font-bold tracking-tight">Editar Missão</h2>
               <button onClick={() => setShowEditModal(false)} className="text-slate-400 hover:text-slate-600"><X size={24}/></button>
             </div>
             <div className="space-y-8">
                <input className={`w-full text-3xl font-bold bg-transparent outline-none border-b transition-all ${isDarkMode ? 'text-white border-white/10 focus:border-indigo-500' : 'text-slate-900 border-slate-100 focus:border-indigo-600'}`} value={editingTask.title} onChange={e => setEditingTask({...editingTask, title: e.target.value})} />
                <textarea className={`w-full p-6 rounded-2xl font-medium border transition-all ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-100 focus:bg-white'}`} rows={3} value={editingTask.notes || ''} onChange={e => setEditingTask({...editingTask, notes: e.target.value})} />
                
                <div className="grid grid-cols-2 gap-6">
                   <div className="space-y-2">
                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Responsável</label>
                     <select className={`w-full p-4 rounded-xl font-bold border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200'}`} value={editingTask.assigned_to} onChange={e => setEditingTask({...editingTask, assigned_to: e.target.value})}>
                       {profiles.map(p => <option key={p.id} value={p.id} className="text-slate-900">{p.full_name}</option>)}
                     </select>
                   </div>
                   <div className="space-y-2">
                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Intervalo (Semanas)</label>
                     <input type="number" className={`w-full p-4 rounded-xl font-bold border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'}`} value={editingTask.repeat_interval || 1} onChange={e => setEditingTask({...editingTask, repeat_interval: parseInt(e.target.value)})} />
                   </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ajustar Dias</label>
                  <div className={`flex gap-1 p-1 rounded-xl border ${isDarkMode ? 'bg-black/20 border-white/10' : 'bg-slate-100 border-slate-200'}`}>
                    {weekDays.map(day => (
                      <button key={day.id} type="button" onClick={() => toggleDayInEdit(day.id)} className={`flex-1 h-10 rounded-lg font-black text-[10px] transition-all ${editingTask.repeat_days?.split(',').includes(day.id) ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}>{day.label}</button>
                    ))}
                  </div>
                </div>

                <button onClick={updateTask} className="w-full bg-indigo-600 text-white p-6 rounded-2xl font-bold uppercase text-xs tracking-widest shadow-xl shadow-indigo-600/20 hover:scale-[1.02] transition-all mt-4">Confirmar Alterações</button>
             </div>
          </div>
        </div>
      )}
    </div>
  )
}

// --- COMPONENTES AUXILIARES ---

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
    <div className={`p-5 rounded-3xl border transition-all duration-300 flex flex-col gap-4 relative group ${
      isDoneToday 
      ? 'bg-slate-50 dark:bg-white/5 border-transparent opacity-60' 
      : isLate 
        ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 shadow-lg shadow-rose-500/10' 
        : isDarkMode ? 'bg-[#161B22] border-white/5 hover:border-indigo-500/50 shadow-2xl shadow-black/40' : 'bg-white border-slate-100 hover:border-indigo-200 shadow-xl shadow-slate-200/40 hover:-translate-y-1'
    }`}>
      <div className="flex items-center gap-5">
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
          <h3 className={`text-lg font-bold tracking-tight transition-all ${isDoneToday ? 'line-through text-slate-400' : isLate ? 'text-rose-900 dark:text-rose-200' : 'text-slate-900 dark:text-slate-100'}`}>
            {task.title}
          </h3>
          
          {subTotal > 0 && (
            <div className="flex items-center gap-3 mt-1.5">
              <div className="flex-1 bg-slate-100 dark:bg-white/5 h-1.5 rounded-full overflow-hidden border border-slate-200/50 dark:border-transparent">
                <div className="bg-indigo-600 h-full transition-all duration-700" style={{ width: `${(subDone / subTotal) * 100}%` }} />
              </div>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{subDone}/{subTotal}</span>
              {expanded ? <ChevronUp size={12} className="text-slate-300"/> : <ChevronDown size={12} className="text-slate-300"/>}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-3">
            <span className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider flex items-center gap-1.5 border transition-all ${isDarkMode ? 'bg-white/5 border-white/5 text-slate-300' : 'bg-slate-100 border-slate-100 text-slate-600'}`}>
              <User size={10} className="text-indigo-500"/> {profiles.find(p => p.id === task.assigned_to)?.full_name || 'Alocado'}
            </span>
            <span className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider border transition-all ${isDarkMode ? 'bg-indigo-600/10 border-indigo-600/20 text-indigo-400' : 'bg-indigo-50 border-indigo-100 text-indigo-600'}`}>
              {task.category}
            </span>
            <span className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase border transition-all ${isDarkMode ? 'bg-black/20 border-white/5 text-slate-400' : 'bg-white border-slate-200 text-slate-400'}`}>
              <Calendar size={10}/> Próxima: {getNextOccurrence(task)}
            </span>
          </div>
        </div>

        {canModify && (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => onEdit(task)} className="p-2 text-slate-400 hover:text-indigo-600 transition-all rounded-lg hover:bg-indigo-50 dark:hover:bg-white/5"><Edit3 size={18}/></button>
            <button onClick={async () => { if(confirm('Excluir?')) { await supabase.from('tasks').delete().eq('id', task.id); onUpdate(); } }} className="p-2 text-slate-400 hover:text-rose-500 transition-all rounded-lg hover:bg-rose-50 dark:hover:bg-white/5"><Trash2 size={18}/></button>
          </div>
        )}
      </div>

      {expanded && subTotal > 0 && (
        <div className="mt-2 space-y-2 border-t border-slate-100 dark:border-white/5 pt-4 animate-in slide-in-from-top-2 duration-300">
          {subtasks.map((sub: any, idx: number) => (
            <div key={idx} onClick={() => toggleSub(idx)} className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${sub.done ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-600 opacity-60' : 'bg-slate-50 dark:bg-white/5 border-slate-100 dark:border-transparent hover:border-indigo-400'}`}>
              <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all ${sub.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 text-transparent'}`}><Check size={12} strokeWidth={5} /></div>
              <span className={`text-xs font-bold ${sub.done ? 'line-through' : ''}`}>{sub.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DashboardCard({ label, val, color, isDark }: any) {
  return (
    <div className={`p-8 rounded-[32px] border transition-all ${isDark ? 'bg-[#161B22] border-white/5' : 'bg-white border-slate-100 shadow-xl shadow-slate-200/40 hover:-translate-y-1'}`}>
      <span className="text-[10px] font-bold uppercase tracking-[0.3em] block mb-2 opacity-40 italic">{label}</span>
      <span className={`text-5xl font-black tracking-tight ${color || (isDark ? 'text-white' : 'text-slate-900')}`}>{val}</span>
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
    <div className="min-h-screen bg-[#0F111A] flex items-center justify-center p-6">
      <div className="bg-white p-12 rounded-[48px] w-full max-w-sm shadow-[0_40px_100px_rgba(0,0,0,0.4)] text-center relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-indigo-600"></div>
        <div className="bg-indigo-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-8 shadow-xl shadow-indigo-600/40 rotate-12"><Activity className="text-white" size={32}/></div>
        <h1 className="text-4xl font-bold tracking-tighter text-slate-900 leading-none mb-10">SUPPLY<br/><span className="text-indigo-600">PRO</span></h1>
        <div className="space-y-4">
          <input className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-100 transition-all border border-slate-100" placeholder="E-MAIL" onChange={e => setEmail(e.target.value)} />
          <input className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-100 transition-all border border-slate-100" type="password" placeholder="SENHA" onChange={e => setPassword(e.target.value)} />
          <button onClick={processAuth} className="w-full bg-slate-900 text-white p-5 rounded-2xl font-bold uppercase text-xs tracking-widest shadow-2xl hover:bg-indigo-600 transition-all mt-4">{isSignUp ? 'Criar Acesso' : 'Entrar no Sistema'}</button>
          <button onClick={() => setIsSignUp(!isSignUp)} className="w-full text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-6 hover:text-indigo-600 transition-colors">{isSignUp ? 'Voltar para login' : 'Solicitar nova conta'}</button>
        </div>
      </div>
    </div>
  )
}