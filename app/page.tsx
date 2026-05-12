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
  
  if (!task.repeat_days || task.repeat_days === "") {
    return task.due_date || '1970-01-01';
  }

  const taskDays = task.repeat_days.split(',').map((d: string) => daysMap[d]);
  const startDate = new Date(task.created_at);
  const startMonday = new Date(startDate);
  startMonday.setDate(startDate.getDate() - (startDate.getDay() === 0 ? 6 : startDate.getDay() - 1));

  let lastDateStr = '1970-01-01';
  for (let w = 0; w < 52; w++) {
    if (w % (task.repeat_interval || 1) === 0) {
      const currWeekMon = new Date(startMonday);
      currWeekMon.setDate(startMonday.getDate() + (w * 7));
      for (let dayOffset of taskDays) {
        const occurrence = new Date(currWeekMon);
        occurrence.setDate(currWeekMon.getDate() + (dayOffset - 1));
        const occStr = occurrence.toISOString().split('T')[0];
        if (occStr <= todayStr && occStr > lastDateStr) lastDateStr = occStr;
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
    const currMon = new Date(startMonday); currMon.setDate(startMonday.getDate() + (w * 7));
    for (let dayOffset of taskDays) {
      const occ = new Date(currMon); occ.setDate(currMon.getDate() + (dayOffset - 1));
      const occStr = occ.toISOString().split('T')[0];
      if (occStr >= todayStr) {
        const [y, m, d] = occStr.split('-');
        return `${d}/${m}`;
      }
    }
  }
  return '--/--';
};

// ==========================================
// 2. COMPONENTE PRINCIPAL
// ==========================================

export default function App() {
  const [user, setUser] = useState<any>(null)
  const [userRole, setUserRole] = useState('membro') 
  const [profiles, setProfiles] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [history, setHistory] = useState<any[]>([])
  const [announcements, setAnnouncements] = useState<any[]>([])
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  
  const [activeTab, setActiveTab] = useState('HOJE')
  const [dashFilter, setDashFilter] = useState<'HOJE' | 'SEMANAL'>('HOJE')
  const [filterUser, setFilterUser] = useState('Todos')
  const [showCreateBox, setShowCreateBox] = useState(false)
  const categories = ['HOJE', 'ATRASADOS', 'Minhas', 'Todas', 'Trade', 'Reunião', 'COMUNICADOS', 'HISTÓRICO', 'DASHBOARD']

  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingTask, setEditingTask] = useState<any>(null)

  const [taskTitle, setTaskTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [category, setCategory] = useState('Trade')
  const [isPontual, setIsPontual] = useState(false)
  const [repeatInterval, setRepeatInterval] = useState(1)
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const [tempSubtasks, setTempSubtasks] = useState<{title: string, done: boolean}[]>([])
  const [newAnnounce, setNewAnnounce] = useState({ title: '', content: '' })

  const weekDays = [{ id: 'seg', label: 'S' }, { id: 'ter', label: 'T' }, { id: 'qua', label: 'Q' }, { id: 'qui', label: 'Q' }, { id: 'sex', label: 'S' }]

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
        setAssignedTo(session.user.id)
        supabase.from('profiles').select('role, full_name').eq('id', session.user.id).single()
          .then(({ data }) => {
            if (data) {
              setUserRole(data.role || 'membro')
              setNewName(data.full_name || '')
            }
          })
        fetchProfiles(); fetchTasks(); fetchHistory(); fetchAnnouncements();
      }
    })
  }, [])

  const fetchProfiles = async () => { const { data } = await supabase.from('profiles').select('*'); if (data) setProfiles(data); }
  const fetchTasks = async () => { const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending: false }); if (data) setTasks(data); }
  const fetchHistory = async () => { const { data } = await supabase.from('task_history').select('*').order('created_at', { ascending: false }).limit(50); if (data) setHistory(data); }
  const fetchAnnouncements = async () => { const { data } = await supabase.from('announcements').select('*').order('created_at', { ascending: false }); if (data) setAnnouncements(data); }

  // --- LOGICA DE FILTRAGEM ---
  const filteredTasks = tasks.filter(task => {
    const todayStr = getTodayStr();
    const lS = getLastOccurrence(task);
    const lD = task.last_done_date || '1970-01-01';
    const isDone = lD >= lS;
    const isDueToday = lS === todayStr;
    const isLate = !isDone && lS < todayStr;

    if (searchTerm && !task.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (filterUser !== 'Todos' && task.assigned_to !== filterUser) return false;

    if (activeTab === 'ATRASADOS') return isLate;
    if (activeTab === 'HOJE') return isDueToday && !isDone;
    if (activeTab === 'Minhas') return task.assigned_to === user?.id;
    if (activeTab === 'Todas') return true;
    if (activeTab === 'DASHBOARD' || activeTab === 'HISTÓRICO' || activeTab === 'COMUNICADOS') return false;
    return task.category === activeTab;
  });

  const stats = (() => {
    const todayStr = getTodayStr();
    const base = tasks.filter(t => filterUser === 'Todos' || t.assigned_to === filterUser);
    const relevant = base.filter(t => dashFilter === 'HOJE' ? getLastOccurrence(t) === todayStr : true);
    const total = relevant.length;
    const done = relevant.filter(t => (t.last_done_date || '1970-01-01') >= getLastOccurrence(t)).length;
    return { total, concluidas: done, pendentes: total - done, porcentagem: total > 0 ? Math.round((done/total)*100) : 0 }
  })();

  // --- FUNÇÕES DE AÇÃO ---
  async function addTask() {
    if (!taskTitle) return;
    const { error } = await supabase.from('tasks').insert([{ 
        title: taskTitle.toUpperCase(), assigned_to: assignedTo, status: 'pendente', category, notes, 
        repeat_days: isPontual ? "" : selectedDays.join(','), 
        repeat_interval: isPontual ? 1 : repeatInterval,
        subtasks: tempSubtasks,
        due_date: isPontual ? getTodayStr() : null 
    }]);
    if (!error) { setShowCreateBox(false); setTaskTitle(''); setNotes(''); setTempSubtasks([]); fetchTasks(); }
  }

  async function toggleComplete(task: any) {
    const todayStr = getTodayStr();
    const lastS = getLastOccurrence(task);
    const lastD = task.last_done_date || '1970-01-01';
    const isDone = lastD >= lastS;
    const newDate = isDone ? null : todayStr;

    if (!isDone) {
      const profile = profiles.find(p => p.id === user.id);
      await supabase.from('task_history').insert([{
        task_id: task.id, task_title: task.title, user_name: profile?.full_name || user.email, user_id: user.id, category: task.category
      }]);
    }
    await supabase.from('tasks').update({ last_done_date: newDate, status: newDate ? 'concluido' : 'pendente' }).eq('id', task.id);
    fetchTasks(); fetchHistory();
  }

  async function updateTask() {
    const { error } = await supabase.from('tasks').update({ 
      title: editingTask.title.toUpperCase(), notes: editingTask.notes, assigned_to: editingTask.assigned_to,
      category: editingTask.category, repeat_days: editingTask.repeat_days, repeat_interval: editingTask.repeat_interval, subtasks: editingTask.subtasks
    }).eq('id', editingTask.id);
    if (!error) { setShowEditModal(false); setEditingTask(null); fetchTasks(); }
  }

  const toggleDay = (day: string) => setSelectedDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  const toggleDayInEdit = (day: string) => {
    const currentDays = editingTask.repeat_days ? editingTask.repeat_days.split(',') : [];
    const newDays = currentDays.includes(day) ? currentDays.filter((d:any) => d !== day) : [...currentDays, day];
    setEditingTask({ ...editingTask, repeat_days: newDays.join(',') });
  };

  if (!user) return <Login />

  return (
    <div className={`min-h-screen transition-colors duration-500 ${isDarkMode ? 'bg-[#0F172A] text-white' : 'bg-[#F8FAFC] text-slate-900'} pb-20 font-sans overflow-x-hidden w-full`}>
      
      {/* HEADER */}
      <nav className={`${isDarkMode ? 'bg-slate-900' : 'bg-[#0F172A]'} text-white sticky top-0 z-30 shadow-2xl px-6 h-20 flex justify-between items-center border-b border-white/10`}>
        <div className="flex items-center gap-3">
          <Activity className="text-blue-500" />
          <h1 className="text-xl font-black italic tracking-tighter uppercase leading-none">Wally <span className="text-blue-500 text-sm block tracking-widest not-italic font-medium">Task Builder</span></h1>
        </div>
        
        <div className="flex items-center gap-4">
           <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-2 bg-white/5 rounded-xl hover:bg-white/10 transition-all">
             {isDarkMode ? <Sun size={20}/> : <Moon size={20}/>}
           </button>
           <button onClick={() => setShowProfileModal(true)} className="flex items-center gap-3 bg-white/5 pl-2 pr-4 py-1.5 rounded-full border border-white/10">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-xs font-black shadow-lg">{userRole === 'admin' ? '👑' : userRole === 'gerente' ? 'G' : 'M'}</div>
              <span className="text-[11px] font-bold uppercase hidden md:block">{newName || 'Perfil'}</span>
           </button>
           <button onClick={() => supabase.auth.signOut().then(() => window.location.reload())} className="text-slate-400 hover:text-red-400"><LogOut size={20}/></button>
        </div>
      </nav>

      {/* BARRA DE BUSCA E TABS */}
      <div className={`${isDarkMode ? 'bg-slate-900/90' : 'bg-white/90'} backdrop-blur-md sticky top-20 z-20 py-4 px-4 space-y-4 border-b border-slate-200`}>
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-4 items-center">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-3 text-slate-400" size={16} />
            <input className={`w-full pl-10 pr-4 py-2.5 rounded-xl border-2 outline-none transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-100'}`} placeholder="Pesquisar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <div className="inline-flex bg-slate-200/50 p-1 rounded-[24px] overflow-x-auto no-scrollbar max-w-full">
            {categories.map(tab => (
              <button key={tab} onClick={() => { setActiveTab(tab); setShowCreateBox(false); }} className={`px-5 py-2 rounded-[20px] font-black text-[10px] uppercase tracking-wider transition-all ${activeTab === tab ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 opacity-70'}`}>{tab}</button>
            ))}
          </div>
        </div>

        {/* FILTRO DE USUÁRIO */}
        <div className="max-w-6xl mx-auto flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          <button onClick={() => setFilterUser('Todos')} className={`px-4 py-1.5 rounded-full font-black text-[9px] uppercase transition-all ${filterUser === 'Todos' ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-500'}`}>Todos</button>
          {profiles.map(p => (
            <button key={p.id} onClick={() => setFilterUser(p.id)} className={`px-4 py-1.5 rounded-full font-black text-[9px] uppercase flex items-center gap-2 transition-all ${filterUser === p.id ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-200 text-slate-500'}`}>
              {p.full_name?.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-4xl mx-auto p-4">
        {activeTab === 'DASHBOARD' ? (
          /* TELA DASHBOARD */
          <div className="mt-6 space-y-6 animate-in fade-in">
             <div className="flex justify-between items-center">
              <h2 className="text-3xl font-black uppercase italic tracking-tighter flex items-center gap-2"><TrendingUp className="text-blue-600"/> Performance</h2>
              <div className="flex bg-slate-200 p-1 rounded-2xl border-2 border-slate-900 shadow-sm">
                <button onClick={() => setDashFilter('HOJE')} className={`px-6 py-2 rounded-xl font-black text-xs uppercase transition-all ${dashFilter === 'HOJE' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500'}`}>Hoje</button>
                <button onClick={() => setDashFilter('SEMANAL')} className={`px-6 py-2 rounded-xl font-black text-xs uppercase transition-all ${dashFilter === 'SEMANAL' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500'}`}>Semanal</button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <DashboardCard label={`Total ${dashFilter}`} val={stats.total} color={isDarkMode ? 'bg-slate-800' : 'bg-white'} />
              <DashboardCard label="Sucesso" val={stats.concluidas} color="bg-green-500 text-white border-green-600" />
              <DashboardCard label="Pendentes" val={stats.pendentes} color="bg-red-500 text-white border-red-600" />
            </div>
            <div className={`p-12 rounded-[48px] border-4 border-slate-900 shadow-[12px_12px_0px_0px_rgba(37,99,235,1)] text-center ${isDarkMode ? 'bg-slate-800' : 'bg-white'}`}>
                <h3 className="text-9xl font-black mb-4">{stats.porcentagem}%</h3>
                <div className="w-full bg-slate-100 h-16 rounded-3xl border-4 border-slate-900 overflow-hidden shadow-inner p-1">
                  <div className="bg-gradient-to-r from-blue-600 to-green-500 h-full rounded-2xl transition-all duration-1000" style={{ width: `${stats.porcentagem}%` }} />
               </div>
            </div>
          </div>
        ) : activeTab === 'COMUNICADOS' ? (
           /* TELA COMUNICADOS */
           <div className="mt-8 space-y-6">
            {userRole === 'admin' && (
              <div className={`p-6 rounded-[32px] border-4 ${isDarkMode ? 'bg-slate-800 border-blue-500' : 'bg-white border-blue-600'}`}>
                <h3 className="font-black uppercase text-xl mb-4 flex items-center gap-2"><Megaphone/> Lançar Comunicado</h3>
                <input className="w-full p-4 rounded-xl mb-4 font-bold border-2 text-slate-900 bg-slate-50" placeholder="Título" value={newAnnounce.title} onChange={e => setNewAnnounce({...newAnnounce, title: e.target.value})} />
                <textarea className="w-full p-4 rounded-xl mb-4 font-medium border-2 text-slate-900 bg-slate-50" placeholder="Mensagem..." rows={3} value={newAnnounce.content} onChange={e => setNewAnnounce({...newAnnounce, content: e.target.value})} />
                <button onClick={async () => { await supabase.from('announcements').insert([{ ...newAnnounce, author_id: user.id }]); setNewAnnounce({title:'', content:''}); fetchAnnouncements(); }} className="w-full bg-blue-600 text-white p-4 rounded-2xl font-black uppercase shadow-xl hover:bg-blue-700">Publicar para Equipe</button>
              </div>
            )}
            <div className="space-y-4">
              {announcements.map(a => (
                <div key={a.id} className={`p-6 rounded-[32px] border-l-[12px] border-blue-600 shadow-xl ${isDarkMode ? 'bg-slate-800' : 'bg-white'}`}>
                  <h4 className="text-2xl font-black mb-2">{a.title}</h4>
                  <p className="opacity-80 font-medium mb-4">{a.content}</p>
                  <div className="text-[10px] font-black uppercase opacity-40 italic">{new Date(a.created_at).toLocaleString('pt-BR')} • ADMIN SUPREMO</div>
                </div>
              ))}
            </div>
          </div>
        ) : activeTab === 'HISTÓRICO' ? (
          /* TELA HISTÓRICO */
          <div className="mt-8 space-y-6">
            <h2 className="text-3xl font-black uppercase italic tracking-tighter">Linha do Tempo</h2>
            <div className="relative border-l-4 border-slate-200 ml-4 pl-8 space-y-8 py-4">
              {history.map((log) => (
                <div key={log.id} className="relative">
                  <div className="absolute -left-[42px] top-0 w-5 h-5 bg-blue-600 rounded-full border-4 border-white"></div>
                  <div className={`p-6 rounded-[32px] border shadow-sm ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                    <p className="text-[10px] font-black opacity-40 uppercase tracking-[0.2em] mb-2">{new Date(log.created_at).toLocaleString('pt-BR')}</p>
                    <h4 className="text-xl font-black mb-2">{log.task_title}</h4>
                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Concluído por {log.user_name}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* LISTAGEM DE TAREFAS */
          <>
            <div className="mt-8 mb-6">
              <button onClick={() => setShowCreateBox(!showCreateBox)} className={`w-full py-5 rounded-[32px] font-black uppercase tracking-[0.2em] text-[11px] transition-all border-4 ${showCreateBox ? 'bg-slate-100 border-slate-200 text-slate-400' : 'bg-white border-slate-900 text-slate-900 shadow-[10px_10px_0px_0px_rgba(15,23,42,1)]'}`}>
                {showCreateBox ? <><X size={20} /> Cancelar</> : <><Plus size={20} strokeWidth={3} className="text-blue-600" /> Lançar Nova Missão</>}
              </button>
            </div>

            {showCreateBox && (
              <div className={`bg-white p-8 rounded-[32px] border border-slate-200 shadow-2xl mb-12 relative overflow-hidden animate-in slide-in-from-top-4 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white'}`}>
                <input className={`w-full text-3xl font-black outline-none bg-transparent mb-6 border-b-2 uppercase ${isDarkMode ? 'text-white border-slate-700' : 'text-slate-900 border-slate-100'}`} placeholder="Nome da Tarefa" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} />
                <textarea className={`w-full p-4 rounded-2xl mb-6 font-bold border-2 ${isDarkMode ? 'bg-slate-700 border-slate-600' : 'bg-slate-50'}`} placeholder="Observações..." value={notes} onChange={e => setNotes(e.target.value)} />
                
                {/* SUBTAREFAS NA CRIAÇÃO */}
                <div className="space-y-3 bg-slate-100/50 p-4 rounded-2xl border mb-6">
                  <label className="text-[10px] font-black uppercase opacity-40 flex items-center gap-2"><ListChecks size={14}/> Checklist de Passos</label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {tempSubtasks.map((sub, index) => (
                      <div key={index} className="flex items-center gap-2 bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
                        <input className="flex-1 text-xs font-bold text-slate-600 outline-none" value={sub.title} onChange={(e) => { const newSubs = [...tempSubtasks]; newSubs[index].title = e.target.value; setTempSubtasks(newSubs); }} placeholder="Nome do passo..." />
                        <button onClick={() => setTempSubtasks(tempSubtasks.filter((_, i) => i !== index))} className="text-red-400 p-1"><X size={14}/></button>
                      </div>
                    ))}
                    <button onClick={() => setTempSubtasks([...tempSubtasks, { title: '', done: false }])} className="flex items-center justify-center gap-2 p-2 border-2 border-dashed rounded-xl text-slate-400 font-black text-[10px] hover:border-blue-400">+ ADICIONAR PASSO</button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
                   <div className="space-y-4">
                      <label className="text-[10px] font-black uppercase opacity-40 tracking-widest">Responsável</label>
                      <select disabled={userRole === 'membro'} className="w-full p-3.5 bg-blue-600 text-white rounded-xl font-black border-none" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
                        {profiles.map(p => <option key={p.id} value={p.id} className="text-slate-900">{p.full_name}</option>)}
                      </select>
                   </div>
                   <div className="space-y-4">
                      <label className="text-[10px] font-black uppercase opacity-40 tracking-widest">Frequência</label>
                      <button onClick={() => setIsPontual(!isPontual)} className={`w-full p-3.5 rounded-xl font-black uppercase text-[10px] border-2 transition-all ${isPontual ? 'bg-orange-500 border-orange-500 text-white shadow-lg' : 'bg-slate-100 border-slate-200 text-slate-500'}`}>
                        {isPontual ? '⚡ Tarefa Pontual' : '🔄 Recorrente'}
                      </button>
                   </div>
                   {!isPontual && (
                     <div className="space-y-4 animate-in slide-in-from-right-2">
                        <label className="text-[10px] font-black uppercase opacity-40 tracking-widest">Dias e Intervalo</label>
                        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
                           {weekDays.map(day => (<button key={day.id} type="button" onClick={() => toggleDay(day.id)} className={`flex-1 h-8 rounded-lg font-black text-[9px] transition-all ${selectedDays.includes(day.id) ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>{day.label}</button>))}
                        </div>
                        <input type="number" min="1" className="w-full p-2 bg-slate-50 border-2 rounded-xl text-center font-black" value={repeatInterval} onChange={e => setRepeatInterval(parseInt(e.target.value))} />
                     </div>
                   )}
                </div>
                <button onClick={addTask} className="w-full mt-10 bg-blue-600 text-white p-6 rounded-[32px] font-black uppercase text-xl shadow-xl hover:bg-[#0F172A] transition-all active:scale-95 flex items-center justify-center gap-3"><Plus size={32} strokeWidth={3}/> LANÇAR NO SISTEMA</button>
              </div>
            )}

            <div className="space-y-6">
              <h2 className="font-black uppercase text-slate-400 text-[10px] tracking-[0.3em] px-2 flex items-center gap-2"><ChevronRight size={14} className="text-blue-600" /> {activeTab} • {filteredTasks.length} TAREFAS</h2>
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
        <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white p-10 rounded-[40px] w-full max-w-sm border-4 border-slate-900 shadow-2xl text-center">
            <h2 className="text-2xl font-black uppercase mb-6 text-slate-900 tracking-tighter italic underline decoration-blue-600">Configurações</h2>
            <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Seu Nome Completo</label>
            <input className="w-full p-4 border-4 border-slate-100 rounded-2xl font-black mb-6 text-slate-900 outline-none" placeholder="Ex: João Silva" value={newName} onChange={e => setNewName(e.target.value)} />
            <button onClick={updateProfile} className="w-full bg-blue-600 text-white p-5 rounded-3xl font-black uppercase text-lg shadow-lg hover:bg-slate-900 transition-all">Salvar Dados</button>
            <button onClick={() => setShowProfileModal(false)} className="w-full mt-4 text-slate-400 font-bold uppercase text-[10px]">Fechar</button>
          </div>
        </div>
      )}

      {/* MODAL EDIÇÃO */}
      {showEditModal && editingTask && (
        <div className="fixed inset-0 bg-slate-900/95 z-50 flex items-center justify-center p-4 backdrop-blur-lg">
          <div className={`p-10 rounded-[50px] w-full max-w-2xl border-4 border-blue-600 shadow-2xl overflow-y-auto max-h-[90vh] ${isDarkMode ? 'bg-slate-800 text-white' : 'bg-white'}`}>
             <h2 className="text-4xl font-black italic uppercase mb-8 tracking-tighter">Editar Missão</h2>
             <div className="space-y-6">
                <input className={`w-full text-2xl font-black bg-transparent border-b-4 border-blue-500/20 mb-4 ${isDarkMode ? 'text-white' : 'text-slate-900'}`} value={editingTask.title} onChange={e => setEditingTask({...editingTask, title: e.target.value})} />
                <textarea className={`w-full p-6 border-2 rounded-3xl font-bold text-lg ${isDarkMode ? 'bg-slate-700 border-slate-600' : 'bg-slate-50 border-slate-100'}`} rows={3} value={editingTask.notes || ''} onChange={e => setEditingTask({...editingTask, notes: e.target.value})} />
                
                {/* CHECKLIST NO MODAL DE EDIÇÃO */}
                <div className="space-y-4 border-t border-slate-100 pt-6">
                  <label className="text-[10px] font-black uppercase opacity-40 flex items-center gap-2"><ListChecks size={14}/> Gerenciar Passos</label>
                  <div className="space-y-2">
                    {(editingTask.subtasks || []).map((sub: any, index: number) => (
                      <div key={index} className="flex items-center gap-3 bg-slate-100/50 p-3 rounded-xl border border-slate-200">
                        <input type="checkbox" checked={sub.done} onChange={(e) => { const newSubs = [...editingTask.subtasks]; newSubs[index].done = e.target.checked; setEditingTask({...editingTask, subtasks: newSubs}); }} className="w-5 h-5 accent-blue-600" />
                        <input className="flex-1 bg-transparent font-bold text-slate-700 outline-none text-sm" value={sub.title} onChange={(e) => { const newSubs = [...editingTask.subtasks]; newSubs[index].title = e.target.value; setEditingTask({...editingTask, subtasks: newSubs}); }} />
                        <button onClick={() => { const newSubs = editingTask.subtasks.filter((_:any, i:number) => i !== index); setEditingTask({...editingTask, subtasks: newSubs}); }} className="text-red-400"><X size={16}/></button>
                      </div>
                    ))}
                    <button onClick={() => { const newSubs = [...(editingTask.subtasks || []), { title: '', done: false }]; setEditingTask({...editingTask, subtasks: newSubs}); }} className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 font-bold text-xs">+ ADICIONAR PASSO</button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase opacity-40">Intervalo de Semanas</label>
                    <input type="number" className="w-full p-4 rounded-2xl bg-slate-100 text-slate-900 font-black" value={editingTask.repeat_interval || 1} onChange={e => setEditingTask({...editingTask, repeat_interval: parseInt(e.target.value)})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase opacity-40">Responsável</label>
                    <select className="w-full p-4 rounded-2xl bg-slate-100 text-slate-900 font-black" value={editingTask.assigned_to} onChange={e => setEditingTask({...editingTask, assigned_to: e.target.value})}>
                      {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    </select>
                  </div>
                </div>
                <button onClick={updateTask} className="w-full bg-blue-600 text-white p-6 rounded-[30px] font-black uppercase text-xl shadow-xl hover:bg-[#0F172A] transition-all">Salvar Alterações</button>
                <button onClick={() => setShowEditModal(false)} className="w-full font-black uppercase text-[10px] opacity-40">Cancelar</button>
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
    const newSubs = [...subtasks];
    newSubs[idx].done = !newSubs[idx].done;
    await supabase.from('tasks').update({ subtasks: newSubs }).eq('id', task.id);
    onUpdate();
  };

  return (
    <div className={`p-6 rounded-[32px] border-[4px] transition-all flex flex-col gap-4 relative group ${isDoneToday ? 'bg-green-500/10 border-green-600 opacity-80' : isLate ? 'bg-red-500/10 border-red-600 animate-pulse' : isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-900 shadow-[8px_8px_0px_0px_rgba(15,23,42,1)]'}`}>
      <div className="flex items-center gap-6">
        <button onClick={onToggle} className={`w-16 h-16 rounded-[22px] border-4 flex items-center justify-center transition-all flex-shrink-0 ${isDoneToday ? 'bg-green-600 border-green-700 text-white' : 'border-slate-400 text-transparent'}`}><Check size={32} strokeWidth={4}/></button>
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <h3 className={`text-2xl font-black leading-tight truncate ${isDoneToday ? 'line-through opacity-40' : isLate ? 'text-red-900' : ''}`}>{task.title}</h3>
          
          {/* PROGRESSO DE SUBTAREFAS */}
          {subTotal > 0 && (
            <div className="flex items-center gap-3 mt-1">
              <div className="flex-1 bg-slate-100 h-2 rounded-full overflow-hidden border">
                <div className="bg-blue-500 h-full transition-all duration-500" style={{ width: `${(subDone / subTotal) * 100}%` }} />
              </div>
              <span className="text-[9px] font-black text-slate-400 uppercase">{subDone}/{subTotal} PASSOS</span>
              {expanded ? <ChevronUp size={14} className="text-slate-300"/> : <ChevronDown size={14} className="text-slate-300"/>}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-4 font-black text-[9px] uppercase tracking-widest">
            <span className="bg-blue-600 text-white px-3 py-1 rounded-lg flex items-center gap-1"><User size={10}/> {profiles.find(p => p.id === task.assigned_to)?.full_name || 'Alocado'}</span>
            <span className={`${isDarkMode ? 'bg-slate-700' : 'bg-slate-900'} text-white px-3 py-1 rounded-lg`}>{task.category}</span>
            <span className="bg-white text-blue-600 border px-3 py-1 rounded-lg flex items-center gap-1"><Calendar size={10}/> PRÓXIMA: {getNextOccurrence(task)}</span>
          </div>
        </div>
        {canModify && (
          <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => onEdit(task)} className="p-2 text-blue-500 hover:bg-blue-50 rounded-xl"><Edit3 size={20}/></button>
            <button onClick={async () => { if(confirm('Excluir?')) { await supabase.from('tasks').delete().eq('id', task.id); onUpdate(); } }} className="p-2 text-red-500 hover:bg-red-50 rounded-xl"><Trash2 size={20}/></button>
          </div>
        )}
      </div>

      {/* CHECKLIST EXPANSÍVEL */}
      {expanded && subTotal > 0 && (
        <div className="mt-2 space-y-2 border-t-2 border-slate-100 pt-4 animate-in slide-in-from-top-2 duration-300">
          {subtasks.map((sub: any, index: number) => (
            <div key={index} onClick={() => toggleSub(index)} className={`flex items-center gap-3 p-3 rounded-2xl border-2 transition-all cursor-pointer ${sub.done ? 'bg-green-100/50 border-green-200 text-green-700 opacity-60' : 'bg-slate-50 border-slate-100'}`}>
              <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${sub.done ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-slate-300'}`}><Check size={14} strokeWidth={4} /></div>
              <span className={`text-xs font-bold ${sub.done ? 'line-through' : ''}`}>{sub.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DashboardCard({ label, val, color }: any) {
  return (<div className={`p-8 rounded-[40px] border-4 border-slate-900 shadow-[8px_8px_0px_0px_rgba(15,23,42,1)] text-center transition-all ${color}`}><span className="text-[10px] font-black uppercase tracking-widest block mb-2 opacity-40">{label}</span><span className="text-6xl font-black">{val}</span></div>)
}

function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [isSignUp, setIsSignUp] = useState(false)
  const processAuth = async () => {
    const { error } = isSignUp ? await supabase.auth.signUp({ email, password, options: { data: { full_name: email.split('@')[0] } } }) : await supabase.auth.signInWithPassword({ email, password })
    if (error) alert(error.message); else window.location.reload()
  }
  return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-4 text-center">
      <div className="bg-white p-12 rounded-[60px] w-full max-w-sm border-b-[24px] border-blue-600 shadow-2xl">
        <div className="bg-blue-600 w-16 h-16 rounded-[20px] flex items-center justify-center mx-auto mb-8 shadow-[0_0_30px_rgba(37,99,235,0.5)] rotate-12"><Activity className="text-white" size={32}/></div>
        <h1 className="text-6xl font-black italic uppercase tracking-tighter text-slate-900 leading-none">WALLY<br/><span className="text-blue-600 text-3xl not-italic tracking-[0.2em] font-medium opacity-80 uppercase">Task Builder</span></h1>
        <div className="space-y-4 mt-12">
          <input className="w-full p-6 bg-slate-50 border-4 border-slate-100 rounded-[28px] font-black text-slate-900 outline-none" placeholder="E-MAIL" onChange={e => setEmail(e.target.value)} />
          <input className="w-full p-6 bg-slate-50 border-4 border-slate-100 rounded-[28px] font-black text-slate-900 outline-none" type="password" placeholder="SENHA" onChange={e => setPassword(e.target.value)} />
          <button onClick={processAuth} className="w-full bg-[#0F172A] text-white p-6 rounded-[28px] font-black uppercase text-xl hover:bg-blue-600 transition-all shadow-xl mt-4">Acessar Centro</button>
          <button onClick={() => setIsSignUp(!isSignUp)} className="w-full text-[10px] font-black text-slate-400 uppercase tracking-widest text-center mt-6">{isSignUp ? 'Já sou da equipe' : 'Solicitar conta'}</button>
        </div>
      </div>
    </div>
  )
}