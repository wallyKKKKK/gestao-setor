'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { 
  Plus, Trash2, CheckCircle2, LayoutDashboard, LogOut, Calendar, Tag, User, 
  Repeat, X, Check, AlertCircle, TrendingUp, Edit3, FileText, ChevronRight, 
  Activity, Clock, ListChecks, Users, Search, Moon, Sun, Megaphone, Send, ChevronDown, ChevronUp
} from 'lucide-react'

// ==========================================
// 1. FUNÇÕES DE DATA (UTILITÁRIOS NO TOPO)
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
  const [user, setUser] = useState<any>(null); const [userRole, setUserRole] = useState('membro');
  const [profiles, setProfiles] = useState<any[]>([]); const [tasks, setTasks] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]); const [announcements, setAnnouncements] = useState<any[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(false); const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('HOJE'); const [dashFilter, setDashFilter] = useState<'HOJE' | 'SEMANAL'>('HOJE');
  const [filterUser, setFilterUser] = useState('Todos'); const [showCreateBox, setShowCreateBox] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false); const [showEditModal, setShowEditModal] = useState(false);
  const [newName, setNewName] = useState(''); const [editingTask, setEditingTask] = useState<any>(null);
  const [taskTitle, setTaskTitle] = useState(''); const [notes, setNotes] = useState('');
  const [assignedTo, setAssignedTo] = useState(''); const [category, setCategory] = useState('Trade');
  const [isPontual, setIsPontual] = useState(false); const [repeatInterval, setRepeatInterval] = useState(1);
  const [selectedDays, setSelectedDays] = useState<string[]>([]); const [tempSubtasks, setTempSubtasks] = useState<any[]>([]);
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
    <div className={`min-h-screen transition-colors duration-300 ${isDarkMode ? 'bg-[#0A0A0A] text-white' : 'bg-[#F0F2F5] text-slate-900'} pb-20 font-sans`}>
      
      {/* HEADER BRUTALISTA */}
      <nav className={`sticky top-0 z-40 border-b-4 border-black px-6 h-20 flex justify-between items-center ${isDarkMode ? 'bg-[#1A1A1A]' : 'bg-[#0F172A]'} text-white shadow-xl`}>
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg border-2 border-white shadow-lg"><Activity size={24} /></div>
          <h1 className="text-xl font-black italic tracking-tighter uppercase">SUPPLY <span className="text-blue-500">PRO</span></h1>
        </div>
        <div className="flex items-center gap-4">
           <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-2 bg-white/10 rounded-xl hover:bg-blue-600 border-2 border-transparent hover:border-white transition-all">{isDarkMode ? <Sun size={20}/> : <Moon size={20}/>}</button>
           <button onClick={() => setShowProfileModal(true)} className="flex items-center gap-3 bg-white/10 px-4 py-1.5 rounded-full border-2 border-white/20 hover:border-white">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-xs font-black border-2 border-white shadow-md">{userRole === 'admin' ? '👑' : 'U'}</div>
              <span className="text-[11px] font-black uppercase hidden md:block">{newName || 'Perfil'}</span>
           </button>
           <button onClick={() => supabase.auth.signOut().then(() => window.location.reload())} className="text-red-500 p-2 hover:bg-red-500 hover:text-white rounded-lg transition-all"><LogOut size={20}/></button>
        </div>
      </nav>

      {/* FILTROS E PESQUISA (REAJUSTADOS) */}
      <div className={`sticky top-20 z-30 border-b-4 border-black py-4 px-4 shadow-2xl transition-colors ${isDarkMode ? 'bg-[#1A1A1A]' : 'bg-white'}`}>
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            {/* PESQUISA */}
            <div className="relative flex-1">
              <Search className="absolute left-4 top-4 text-slate-400" size={18} />
              <input className={`w-full pl-12 pr-4 py-3.5 rounded-2xl border-4 border-black font-black outline-none transition-all ${isDarkMode ? 'bg-[#222] text-white focus:border-blue-500' : 'bg-slate-50 focus:border-blue-500'}`} placeholder="PESQUISAR MISSÃO..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            {/* ABAS */}
            <div className={`inline-flex p-1.5 rounded-[22px] border-4 border-black overflow-x-auto no-scrollbar ${isDarkMode ? 'bg-[#222]' : 'bg-slate-100'}`}>
              {categories.map(tab => (
                <button key={tab} onClick={() => { setActiveTab(tab); setShowCreateBox(false); }} className={`px-5 py-2 rounded-2xl font-black text-[10px] uppercase transition-all whitespace-nowrap ${activeTab === tab ? 'bg-blue-600 text-white shadow-md ring-2 ring-white scale-105' : 'text-slate-500 opacity-70 hover:opacity-100'}`}>{tab}</button>
              ))}
            </div>
          </div>
          {/* FILTRO DE USUÁRIOS */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            <button onClick={() => setFilterUser('Todos')} className={`px-5 py-2 rounded-xl font-black text-[10px] uppercase border-4 border-black transition-all ${filterUser === 'Todos' ? 'bg-black text-white' : 'bg-white text-slate-400'}`}>TODOS</button>
            {profiles.map(p => (
              <button key={p.id} onClick={() => setFilterUser(p.id)} className={`px-5 py-2 rounded-xl font-black text-[10px] uppercase border-4 border-black flex items-center gap-2 transition-all ${filterUser === p.id ? 'bg-blue-600 text-white scale-105' : 'bg-white text-slate-400'}`}>
                {p.full_name?.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-4xl mx-auto p-4">
        {activeTab === 'DASHBOARD' ? (
          <div className="mt-6 space-y-8 animate-in fade-in">
             <div className="flex justify-between items-center px-2">
              <h2 className={`text-4xl font-black italic tracking-tighter flex items-center gap-4 ${isDarkMode ? 'text-white' : 'text-black'}`}><TrendingUp size={40} className="text-blue-600"/> PERFORMANCE</h2>
              <div className="flex bg-slate-200 p-1 rounded-2xl border-4 border-black">
                <button onClick={() => setDashFilter('HOJE')} className={`px-6 py-2 rounded-xl font-black text-xs uppercase transition-all ${dashFilter === 'HOJE' ? 'bg-black text-white shadow-lg' : 'text-slate-500'}`}>Hoje</button>
                <button onClick={() => setDashFilter('SEMANAL')} className={`px-6 py-2 rounded-xl font-black text-xs uppercase transition-all ${dashFilter === 'SEMANAL' ? 'bg-black text-white shadow-lg' : 'text-slate-500'}`}>Semanal</button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <DashboardCard label={`META ${dashFilter}`} val={stats.total} color={isDarkMode ? 'bg-[#222] border-white' : 'bg-white border-black'} />
              <DashboardCard label="SUCESSO" val={stats.concluidas} color="bg-green-500 text-white border-black" />
              <DashboardCard label="PENDÊNCIA" val={stats.pendentes} color="bg-red-500 text-white border-black" />
            </div>
            <div className={`p-16 rounded-[60px] border-8 border-black shadow-[20px_20px_0px_0px_#3b82f6] text-center ${isDarkMode ? 'bg-[#222]' : 'bg-white'}`}>
                <h3 className={`text-[12rem] font-black tracking-tighter leading-none mb-6 ${isDarkMode ? 'text-white' : 'text-black'}`}>{stats.porcentagem}%</h3>
                <div className="w-full bg-slate-100 h-20 rounded-[30px] border-4 border-black overflow-hidden p-1.5 shadow-inner">
                  <div className="bg-gradient-to-r from-blue-600 to-green-500 h-full rounded-[20px] transition-all duration-1000" style={{ width: `${stats.porcentagem}%` }} />
               </div>
            </div>
          </div>
        ) : activeTab === 'COMUNICADOS' ? (
           <div className="mt-8 space-y-6">
            {userRole === 'admin' && (
              <div className={`p-8 rounded-[40px] border-4 border-black shadow-[15px_15px_0px_0px_#000] ${isDarkMode ? 'bg-[#222]' : 'bg-white'}`}>
                <h3 className="font-black uppercase text-xl mb-4 flex items-center gap-3"><Megaphone size={28}/> LANÇAR COMUNICADO</h3>
                <input className="w-full p-5 rounded-2xl mb-4 font-black border-4 border-black text-slate-900 bg-slate-50" placeholder="TÍTULO DO ALERTA" value={newAnnounce.title} onChange={e => setNewAnnounce({...newAnnounce, title: e.target.value})} />
                <textarea className="w-full p-5 rounded-2xl mb-4 font-bold border-4 border-black text-slate-900 bg-slate-50" placeholder="MENSAGEM..." rows={3} value={newAnnounce.content} onChange={e => setNewAnnounce({...newAnnounce, content: e.target.value})} />
                <button onClick={async () => { await supabase.from('announcements').insert([{ ...newAnnounce, author_id: user.id }]); setNewAnnounce({title:'', content:''}); fetchAnnouncements(); }} className="w-full bg-blue-600 text-white p-5 rounded-[28px] font-black uppercase text-xl border-4 border-black shadow-lg">PUBLICAR AGORA</button>
              </div>
            )}
            <div className="space-y-6">
              {announcements.map(a => (
                <div key={a.id} className={`p-8 rounded-[45px] border-4 border-black shadow-[12px_12px_0px_0px_#3b82f6] ${isDarkMode ? 'bg-[#222]' : 'bg-white text-black'}`}>
                  <h4 className="text-3xl font-black mb-3 uppercase italic underline decoration-blue-600 underline-offset-8">{a.title}</h4>
                  <p className="text-xl font-bold opacity-80 mb-6">{a.content}</p>
                  <div className="text-[10px] font-black uppercase opacity-40 italic tracking-[0.2em] border-t-4 pt-4 border-black/10">POSTADO EM {new Date(a.created_at).toLocaleString('pt-BR')} • ADMIN SUPREMO</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="mt-8 mb-10">
              <button onClick={() => setShowCreateBox(!showCreateBox)} className={`w-full py-6 rounded-[35px] border-4 border-black font-black uppercase tracking-[0.4em] text-sm transition-all shadow-[12px_12px_0px_0px_#000] hover:translate-x-1 hover:translate-y-1 hover:shadow-none ${isDarkMode ? 'bg-white text-black' : 'bg-white text-black'}`}>
                {showCreateBox ? <X size={28} strokeWidth={4}/> : <Plus size={28} strokeWidth={4} className="text-blue-600"/>} LANÇAR NOVA MISSÃO
              </button>
            </div>

            {showCreateBox && (
              <div className={`p-10 rounded-[55px] border-4 border-black shadow-[20px_20px_0px_0px_rgba(0,0,0,0.1)] mb-12 animate-in slide-in-from-top-6 ${isDarkMode ? 'bg-[#1A1A1A]' : 'bg-white'}`}>
                <input className={`w-full text-5xl font-black outline-none bg-transparent mb-10 border-b-4 uppercase ${isDarkMode ? 'text-white border-blue-500' : 'text-black border-slate-100 focus:border-blue-500'}`} placeholder="NOME DA MISSÃO" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} />
                <textarea className={`w-full p-8 rounded-[40px] mb-10 font-bold text-xl border-4 border-black ${isDarkMode ? 'bg-[#222] text-white' : 'bg-slate-50 text-black'}`} placeholder="INSTRUÇÕES E COORDENADAS..." rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
                
                <div className="space-y-6 bg-blue-600/5 p-8 rounded-[45px] border-4 border-dashed border-blue-600/20 mb-10">
                  <label className="text-xs font-black uppercase tracking-widest flex items-center gap-3"><ListChecks size={22} className="text-blue-600"/> CHECKLIST DE PASSOS</label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {tempSubtasks.map((sub, index) => (
                      <div key={index} className="flex items-center gap-4 bg-white p-4 rounded-[25px] border-4 border-black shadow-md">
                        <input className="flex-1 text-sm font-black text-black outline-none" value={sub.title} onChange={(e) => { const n = [...tempSubtasks]; n[index].title = e.target.value; setTempSubtasks(n); }} placeholder="DEFINIR PASSO..." />
                        <button onClick={() => setTempSubtasks(tempSubtasks.filter((_, i) => i !== index))} className="text-red-500 p-1 hover:bg-red-50 rounded-lg transition-all"><X size={20}/></button>
                      </div>
                    ))}
                    <button onClick={() => setTempSubtasks([...tempSubtasks, { title: '', done: false }])} className="flex items-center justify-center gap-3 p-4 border-4 border-dashed border-black/20 rounded-[25px] text-slate-400 font-black text-xs hover:border-blue-600 hover:text-blue-600 transition-all">+ ADICIONAR PASSO</button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-end">
                   <div className="space-y-4">
                      <label className="text-[11px] font-black uppercase opacity-40 ml-2">AGENTE RESPONSÁVEL</label>
                      <select disabled={userRole === 'membro'} className="w-full p-5 bg-blue-600 text-white rounded-[25px] font-black border-4 border-black shadow-xl appearance-none text-lg" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
                        {profiles.map(p => <option key={p.id} value={p.id} className="text-black">{p.full_name}</option>)}
                      </select>
                   </div>
                   <div className="space-y-4">
                      <label className="text-[11px] font-black uppercase opacity-40 ml-2">TIPO DE OPERAÇÃO</label>
                      <button onClick={() => setIsPontual(!isPontual)} className={`w-full p-5 rounded-[25px] font-black uppercase text-xs border-4 border-black transition-all ${isPontual ? 'bg-orange-500 text-white shadow-[8px_8px_0px_0px_#000]' : 'bg-slate-100 text-slate-500'}`}>
                        {isPontual ? '⚡ MISSÃO ÚNICA' : '🔄 RECORRENTE'}
                      </button>
                   </div>
                   {!isPontual && (
                     <div className="space-y-4">
                        <label className="text-[11px] font-black uppercase opacity-40 ml-2 italic tracking-widest">AGENDAMENTO</label>
                        <div className="flex gap-2 bg-slate-200 p-2 rounded-[25px] border-4 border-black shadow-inner">
                           {weekDays.map(day => (<button key={day.id} type="button" onClick={() => toggleDay(day.id)} className={`flex-1 h-12 rounded-2xl font-black text-xs border-2 border-black/10 transition-all ${selectedDays.includes(day.id) ? 'bg-blue-600 text-white scale-110 shadow-lg' : 'bg-white text-slate-400'}`}>{day.label}</button>))}
                        </div>
                        <div className="flex items-center gap-3 bg-white p-3 rounded-[20px] border-4 border-black shadow-md"><Repeat size={18} className="text-blue-600"/><input type="number" min="1" className="w-full bg-transparent font-black text-lg outline-none" value={repeatInterval} onChange={e => setRepeatInterval(parseInt(e.target.value))} /><span className="text-[10px] font-black opacity-30 whitespace-nowrap">SEMANAS</span></div>
                     </div>
                   )}
                </div>
                <button onClick={addTask} className="w-full mt-14 bg-blue-600 text-white p-8 rounded-[45px] font-black uppercase text-3xl border-4 border-black shadow-[15px_15px_0px_0px_#000] hover:bg-black active:translate-y-2 transition-all flex items-center justify-center gap-6">
                  <div className="bg-white/20 p-3 rounded-full flex items-center justify-center border-4 border-white/30"><Plus size={40} strokeWidth={4}/></div> LANÇAR MISSÃO NO SISTEMA
                </button>
              </div>
            )}

            <div className="space-y-12">
              <h2 className="font-black uppercase text-slate-400 text-sm tracking-[0.5em] px-4 flex items-center gap-4"><ChevronRight size={24} className="text-blue-600" /> {activeTab} • {filteredTasks.length} MISSÕES</h2>
              {filteredTasks.map(task => {
                const lSStr = getLastOccurrence(task); const lDStr = task.last_done_date || '1970-01-01';
                const isDone = lDStr >= lSStr; const isLate = !isDone && lSStr < getTodayStr();
                return (<TaskBox key={task.id} task={task} profiles={profiles} isLate={isLate} isDoneToday={isDone} userRole={userRole} currentUserId={user.id} isDarkMode={isDarkMode} onToggle={() => toggleComplete(task)} onEdit={(t: any) => { setEditingTask(t); setShowEditModal(true); }} onUpdate={fetchTasks} />)
              })}
            </div>
          </>
        )}
      </main>

      {/* MODAL PERFIL */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-4 backdrop-blur-xl animate-in fade-in">
          <div className="bg-white p-12 rounded-[60px] w-full max-w-sm border-8 border-black shadow-[25px_25px_0px_0px_#3b82f6]">
            <h2 className="text-4xl font-black uppercase mb-10 text-black tracking-tighter italic underline decoration-blue-600">IDENTIDADE</h2>
            <label className="text-[11px] font-black uppercase text-slate-400 ml-2 tracking-widest">NOME COMPLETO DO AGENTE</label>
            <input className="w-full p-6 border-4 border-black rounded-[28px] font-black text-2xl mb-10 text-black outline-none bg-slate-50 focus:bg-white" placeholder="EX: WALLY LOHAN" value={newName} onChange={e => setNewName(e.target.value)} />
            <button onClick={updateProfile} className="w-full bg-blue-600 text-white p-7 rounded-[30px] font-black uppercase text-2xl border-4 border-black shadow-xl hover:bg-black transition-all">SALVAR DADOS</button>
            <button onClick={() => setShowProfileModal(false)} className="w-full mt-6 text-slate-400 font-black uppercase text-xs tracking-widest">VOLTAR</button>
          </div>
        </div>
      )}

      {/* MODAL EDIÇÃO (Sincronizado com as novas funções) */}
      {showEditModal && editingTask && (
        <div className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-4 backdrop-blur-2xl animate-in zoom-in-95">
          <div className={`p-14 rounded-[70px] w-full max-w-3xl border-[10px] border-blue-600 shadow-2xl overflow-y-auto max-h-[95vh] ${isDarkMode ? 'bg-[#111] text-white' : 'bg-white text-black'}`}>
             <h2 className="text-5xl font-black italic uppercase mb-12 tracking-tighter text-blue-600">MODIFICAR MISSÃO</h2>
             <div className="space-y-10">
                <div className="space-y-4">
                  <label className="text-[11px] font-black uppercase opacity-40 ml-2 tracking-[0.2em]">IDENTIFICAÇÃO DA TAREFA</label>
                  <input className={`w-full text-4xl font-black bg-transparent border-b-8 uppercase ${isDarkMode ? 'text-white border-slate-700' : 'text-black border-slate-100'}`} value={editingTask.title} onChange={e => setEditingTask({...editingTask, title: e.target.value})} />
                </div>
                
                <div className="space-y-4">
                  <label className="text-[11px] font-black uppercase opacity-40 ml-2 tracking-[0.2em]">NOTAS DE OPERAÇÃO</label>
                  <textarea className={`w-full p-8 border-4 border-black rounded-[45px] font-bold text-2xl ${isDarkMode ? 'bg-[#222]' : 'bg-slate-50'}`} rows={3} value={editingTask.notes || ''} onChange={e => setEditingTask({...editingTask, notes: e.target.value})} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <label className="text-[11px] font-black uppercase opacity-40 tracking-[0.2em]">RESPONSÁVEL ATUAL</label>
                    <select className="w-full p-6 rounded-[30px] bg-blue-600 text-white border-4 border-black font-black text-2xl appearance-none shadow-xl" value={editingTask.assigned_to} onChange={e => setEditingTask({...editingTask, assigned_to: e.target.value})}>
                      {profiles.map(p => <option key={p.id} value={p.id} className="text-black">{p.full_name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-4">
                    <label className="text-[11px] font-black uppercase opacity-40 tracking-[0.2em]">INTERVALO (SEMANAS)</label>
                    <input type="number" className="w-full p-6 rounded-[30px] bg-slate-100 text-black border-4 border-black font-black text-3xl text-center shadow-inner" value={editingTask.repeat_interval || 1} onChange={e => setEditingTask({...editingTask, repeat_interval: parseInt(e.target.value)})} />
                  </div>
                </div>

                <div className="space-y-6">
                  <label className="text-[11px] font-black uppercase opacity-40 tracking-[0.2em]">ATUALIZAR DIAS DA SEMANA</label>
                  <div className="flex gap-3 bg-slate-100 p-3 rounded-[35px] border-4 border-black shadow-inner">
                    {weekDays.map(day => (
                      <button key={day.id} type="button" onClick={() => toggleDayInEdit(day.id)} className={`flex-1 h-16 rounded-[25px] font-black text-xl border-4 transition-all ${editingTask.repeat_days?.split(',').includes(day.id) ? 'bg-blue-600 border-black text-white scale-110 shadow-lg' : 'bg-white border-slate-200 text-slate-300 opacity-50'}`}>{day.label}</button>
                    ))}
                  </div>
                </div>

                <button onClick={updateTask} className="w-full bg-slate-900 text-white p-9 rounded-[50px] font-black uppercase text-3xl border-4 border-blue-600 shadow-[15px_15px_0px_0px_#3b82f6] hover:bg-black active:scale-95 transition-all">CONSOLIDAR MUDANÇAS</button>
             </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ==========================================
// 3. COMPONENTES AUXILIARES (Design Maximizados)
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
    <div className={`p-10 rounded-[60px] border-[6px] transition-all duration-500 flex flex-col gap-8 relative group shadow-[15px_15px_0px_0px_rgba(0,0,0,1)] ${isDoneToday ? 'bg-green-100/50 border-green-600 opacity-60' : isLate ? 'bg-red-100/50 border-red-600 animate-pulse' : isDarkMode ? 'bg-[#1A1A1A] border-white text-white' : 'bg-white border-black hover:-translate-y-2'}`}>
      <div className="flex items-center gap-10">
        {/* CHECKBOX GIGANTE */}
        <button onClick={onToggle} className={`w-24 h-24 rounded-[35px] border-[8px] flex items-center justify-center transition-all flex-shrink-0 shadow-2xl ${isDoneToday ? 'bg-green-600 border-black text-white rotate-6' : 'bg-white border-black text-transparent hover:border-blue-600 hover:scale-110'}`}>
          <Check size={55} strokeWidth={8}/>
        </button>
        
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <h3 className={`text-5xl font-black leading-none tracking-tighter uppercase mb-4 ${isDoneToday ? 'line-through opacity-30' : isLate ? 'text-red-900' : ''}`}>
            {task.title}
          </h3>
          
          {subTotal > 0 && (
            <div className="flex items-center gap-6 mt-4">
              <div className="flex-1 bg-black/10 h-6 rounded-full border-[3px] border-black overflow-hidden p-1 shadow-inner">
                <div className="bg-blue-600 h-full rounded-full transition-all duration-1000 shadow-md" style={{ width: `${(subDone / subTotal) * 100}%` }} />
              </div>
              <span className="text-[12px] font-black opacity-30 uppercase tracking-[0.3em] whitespace-nowrap">{subDone} / {subTotal} PASSOS</span>
              {expanded ? <ChevronUp size={24} className="opacity-20" /> : <ChevronDown size={24} className="opacity-20" />}
            </div>
          )}

          <div className="flex flex-wrap gap-4 mt-8">
            <span className="bg-black text-white px-5 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-widest flex items-center gap-3 border-2 border-white/10 shadow-lg"><User size={16}/> {profiles.find(p => p.id === task.assigned_to)?.full_name || 'ALOCADO'}</span>
            <span className="bg-blue-600 text-white px-5 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-widest border-4 border-black shadow-[5px_5px_0px_0px_#000]"><Calendar size={16}/> PRÓXIMA: {getNextOccurrence(task)}</span>
            <span className={`px-5 py-2.5 rounded-2xl text-[11px] font-black uppercase border-4 border-black ${isDarkMode ? 'bg-slate-700 border-white' : 'bg-slate-100 border-black'}`}>{task.category}</span>
          </div>
        </div>

        {canModify && (
          <div className="flex flex-col gap-4 opacity-0 group-hover:opacity-100 transition-all scale-75 group-hover:scale-100">
            <button onClick={() => onEdit(task)} className="p-5 bg-white border-[5px] border-black rounded-[30px] text-blue-600 shadow-[8px_8px_0px_0px_#3b82f6] hover:bg-blue-50 transition-all"><Edit3 size={32} strokeWidth={3}/></button>
            <button onClick={async () => { if(confirm('DELETAR MISSÃO DO SISTEMA?')) { await supabase.from('tasks').delete().eq('id', task.id); onUpdate(); } }} className="p-5 bg-white border-[5px] border-black rounded-[30px] text-red-600 shadow-[8px_8px_0px_0px_#ef4444] hover:bg-red-50 transition-all"><Trash2 size={32} strokeWidth={3}/></button>
          </div>
        )}
      </div>

      {expanded && subTotal > 0 && (
        <div className="mt-6 space-y-4 border-t-[6px] border-black/5 pt-10 animate-in slide-in-from-top-10 duration-700">
          {subtasks.map((sub: any, idx: number) => (
            <div key={idx} onClick={() => toggleSub(idx)} className={`flex items-center gap-6 p-7 rounded-[40px] border-4 transition-all cursor-pointer shadow-2xl ${sub.done ? 'bg-green-600/10 border-green-600 opacity-40 scale-[0.98]' : 'bg-slate-50 border-black hover:translate-x-4'}`}>
              <div className={`w-14 h-14 rounded-[22px] border-[6px] flex items-center justify-center transition-all ${sub.done ? 'bg-green-600 border-black text-white' : 'bg-white border-black text-transparent'}`}><Check size={32} strokeWidth={8} /></div>
              <span className={`text-3xl font-black uppercase tracking-tight ${sub.done ? 'line-through' : 'text-black'}`}>{sub.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DashboardCard({ label, val, color }: any) {
  return (
    <div className={`p-12 rounded-[60px] border-[6px] border-black shadow-[15px_15px_0px_0px_rgba(0,0,0,1)] text-center transition-all hover:scale-105 hover:rotate-1 ${color}`}>
      <span className="text-[13px] font-black uppercase tracking-[0.4em] block mb-6 opacity-30 italic leading-none">{label}</span>
      <span className="text-8xl font-black tracking-tighter leading-none">{val}</span>
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
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-6 font-sans">
      <div className="bg-white p-16 rounded-[80px] w-full max-w-md border-b-[30px] border-blue-600 shadow-[0_0_100px_rgba(59,130,246,0.3)] text-center">
        <div className="bg-blue-600 w-24 h-24 rounded-[35px] flex items-center justify-center mx-auto mb-10 shadow-[0_0_50px_rgba(37,99,235,0.6)] rotate-12 border-[6px] border-white"><Activity className="text-white" size={48} strokeWidth={3}/></div>
        <h1 className="text-8xl font-black italic uppercase tracking-tighter text-black leading-[0.8]">SUPPLY<br/><span className="text-blue-600 text-4xl not-italic tracking-[0.3em] font-medium opacity-90 uppercase">Tasker</span></h1>
        <div className="space-y-6 mt-16">
          <input className="w-full p-8 bg-slate-50 border-[6px] border-black rounded-[35px] font-black text-2xl text-black outline-none focus:border-blue-600 transition-all placeholder-slate-300" placeholder="E-MAIL AGENTE" onChange={e => setEmail(e.target.value)} />
          <input className="w-full p-8 bg-slate-50 border-[6px] border-black rounded-[35px] font-black text-2xl text-black outline-none focus:border-blue-600 transition-all" type="password" placeholder="SENHA ACESSO" onChange={e => setPassword(e.target.value)} />
          <button onClick={processAuth} className="w-full bg-black text-white p-8 rounded-[35px] font-black uppercase text-2xl hover:bg-blue-600 transition-all shadow-2xl active:translate-y-2 mt-6 border-b-[10px] border-blue-900">{isSignUp ? 'CADASTRAR AGENTE' : 'ACESSAR CENTRO'}</button>
          <button onClick={() => setIsSignUp(!isSignUp)} className="w-full text-sm font-black text-slate-400 uppercase tracking-[0.4em] text-center mt-8 hover:text-blue-600 transition-colors">{isSignUp ? 'JÁ POSSUO ACESSO' : 'SOLICITAR NOVA CONTA'}</button>
        </div>
      </div>
    </div>
  )
}