'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { 
  Plus, Trash2, CheckCircle2, Circle, LayoutDashboard, 
  LogOut, Calendar, Tag, User, Repeat, X, Check, AlertCircle, TrendingUp,
  Edit3, FileText, ChevronRight, Activity, Clock
} from 'lucide-react'

export default function App() {
  // --- ESTADOS DO SISTEMA ---
  const [user, setUser] = useState<any>(null)
  const [userRole, setUserRole] = useState('membro')
  const [profiles, setProfiles] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  
  // Interface
  const [activeTab, setActiveTab] = useState('HOJE')
  const [dashFilter, setDashFilter] = useState<'HOJE' | 'SEMANAL'>('HOJE')
  const categories = ['HOJE', 'ATRASADOS', 'Minhas', 'Todas', 'Trade', 'Reunião', 'DASHBOARD']

  // Modais
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingTask, setEditingTask] = useState<any>(null)

  // Criação
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

  // --- CARREGAMENTO INICIAL ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
        setAssignedTo(session.user.id)
        
        // Buscar cargo do usuário
        supabase.from('profiles').select('role, full_name').eq('id', session.user.id).single()
          .then(({ data }) => {
            if (data) {
              setUserRole(data.role || 'membro')
              setNewName(data.full_name || '')
            }
          })
        fetchProfiles()
        fetchTasks()
      }
    })
  }, [])

  const fetchProfiles = async () => {
    const { data } = await supabase.from('profiles').select('*')
    if (data) setProfiles(data)
  }

  const fetchTasks = async () => {
    const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending: false })
    if (data) setTasks(data)
  }

  // --- FUNÇÕES DE AÇÃO ---
  async function updateProfile() {
    if (!newName) return alert("Digite um nome!")
    const { error } = await supabase.from('profiles').update({ full_name: newName }).eq('id', user.id)
    if (!error) { alert("Perfil atualizado!"); setShowProfileModal(false); fetchProfiles(); }
  }

  async function addTask() {
    if (!taskTitle) return
    const isRecurring = selectedDays.length > 0
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
    if (!error) { setTaskTitle(''); setNotes(''); setSelectedDays([]); setRepeatInterval(1); fetchTasks(); }
  }

  async function toggleComplete(task: any) {
    const todayDate = new Date().toISOString().split('T')[0]
    const isCurrentlyDone = task.last_done_date === todayDate
    const newDate = isCurrentlyDone ? null : todayDate
    await supabase.from('tasks').update({ last_done_date: newDate, status: newDate ? 'concluido' : 'pendente' }).eq('id', task.id)
    fetchTasks()
  }

  async function updateTask() {
    const { error } = await supabase.from('tasks').update({ 
      title: editingTask.title.toUpperCase(),
      notes: editingTask.notes,
      assigned_to: editingTask.assigned_to,
      category: editingTask.category,
      repeat_days: editingTask.repeat_days,
      repeat_interval: editingTask.repeat_interval
    }).eq('id', editingTask.id)
    if (!error) { setShowEditModal(false); setEditingTask(null); fetchTasks(); }
  }

  const toggleDay = (day: string) => setSelectedDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])

  const toggleDayInEdit = (day: string) => {
    const currentDays = editingTask.repeat_days ? editingTask.repeat_days.split(',') : []
    const newDays = currentDays.includes(day) ? currentDays.filter((d:string) => d !== day) : [...currentDays, day]
    setEditingTask({ ...editingTask, repeat_days: newDays.join(',') })
  }

  // --- LÓGICA DE DATAS E FILTROS ---
  const today = new Date(); today.setHours(0,0,0,0)
  const todayDate = today.toISOString().split('T')[0]
  const daysMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']
  const todayTag = daysMap[today.getDay()]
  const todayIdx = today.getDay()

  const isCorrectWeek = (task: any) => {
    if (!task.created_at || task.repeat_interval <= 1) return true
    const startDate = new Date(task.created_at); startDate.setHours(0,0,0,0)
    const startMonday = new Date(startDate)
    startMonday.setDate(startDate.getDate() - (startDate.getDay() === 0 ? 6 : startDate.getDay() - 1))
    const diffInWeeks = Math.floor((today.getTime() - startMonday.getTime()) / (1000 * 3600 * 24 * 7))
    return diffInWeeks % task.repeat_interval === 0
  }

  const filteredTasks = tasks.filter(task => {
    const lastScheduled = getLastOccurrence(task)
    const lastDone = task.last_done_date ? new Date(task.last_done_date) : new Date(0)
    const isDone = lastDone >= lastScheduled
    const isDueToday = lastScheduled.getTime() === today.getTime()
    const isLate = !isDone && lastScheduled < today

    if (activeTab === 'ATRASADOS') return isLate
    if (activeTab === 'HOJE') return isDueToday && !isDone
    if (activeTab === 'Minhas') return userRole === 'admin' ? true : task.assigned_to === user?.id
    if (activeTab === 'Todas') return true
    if (activeTab === 'DASHBOARD') return false
    return task.category === activeTab
  })

  const stats = (() => {
    const relevantTasks = tasks.filter(task => {
      const taskDays = task.repeat_days ? task.repeat_days.split(',') : []
      const correctWeek = isCorrectWeek(task)
      if (dashFilter === 'HOJE') return (taskDays.includes(todayTag) && correctWeek) || task.due_date === todayDate
      return (taskDays.length > 0 && correctWeek) || (task.due_date && task.due_date >= todayDate)
    })
    const total = relevantTasks.length
    const done = relevantTasks.filter(t => {
       const lastS = getLastOccurrence(t)
       const lastD = t.last_done_date ? new Date(t.last_done_date) : new Date(0)
       return lastD >= lastS
    }).length
    return { total, concluidas: done, pendentes: total - done, porcentagem: total > 0 ? Math.round((done/total)*100) : 0 }
  })()

  if (!user) return <Login />

  return (
  <div className="min-h-screen bg-[#F8FAFC] text-slate-900 pb-20 font-sans overflow-x-hidden w-full">
      {/* HEADER GERAL */}
      <nav className="bg-[#0F172A] text-white sticky top-0 z-30 shadow-2xl border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 h-20 flex justify-between items-center">
          <div className="flex items-center gap-3 group cursor-pointer">
            <div className="bg-blue-600 p-2 rounded-xl group-hover:rotate-12 transition-transform duration-300 shadow-[0_0_20px_rgba(37,99,235,0.4)]">
              <LayoutDashboard size={24} />
            </div>
            <h1 className="text-xl font-black italic tracking-tighter uppercase leading-none">
              Supply <span className="text-blue-500 text-sm block tracking-widest not-italic font-medium">Task Builder</span>
            </h1>
          </div>
          <div className="flex items-center gap-6">
             <button onClick={() => setShowProfileModal(true)} className="flex items-center gap-3 bg-white/5 pl-2 pr-4 py-1.5 rounded-full border border-white/10 hover:bg-white/10 hover:border-blue-500/50 transition-all group shadow-sm">
                <div className="w-8 h-8 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-full flex items-center justify-center text-xs font-black shadow-lg">
                  {profiles.find(p => p.id === user.id)?.full_name?.charAt(0) || 'U'}
                </div>
                <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-300 group-hover:text-white hidden md:block">
                  {profiles.find(p => p.id === user.id)?.full_name || 'Meu Perfil'} {userRole === 'admin' && '👑'}
                </span>
             </button>
             <button onClick={() => supabase.auth.signOut().then(() => window.location.reload())} className="text-slate-400 hover:text-red-400 transition-colors"><LogOut size={20}/></button>
          </div>
        </div>
      </nav>

      {/* SEGMENTED CONTROL TABS */}
      <div className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-20 z-20 py-4 px-4">
        <div className="max-w-6xl mx-auto flex justify-center">
          <div className="inline-flex bg-slate-200/60 p-1 rounded-[24px] backdrop-blur-sm border border-slate-300/50 shadow-inner overflow-x-auto no-scrollbar max-w-full">
            {categories.map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`px-6 py-2.5 rounded-[20px] font-black text-[10px] uppercase tracking-wider transition-all duration-500 whitespace-nowrap ${activeTab === tab ? 'bg-white text-blue-600 shadow-[0_10px_20px_rgba(0,0,0,0.1)] scale-100 ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-900 scale-95 opacity-70 hover:opacity-100'}`}>{tab}</button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-4xl mx-auto p-4">
        {activeTab === 'DASHBOARD' ? (
  <div className="mt-6 space-y-6 animate-in fade-in duration-500">
    {/* Ajuste: flex-col no celular e flex-row no PC */}
    <div className="flex flex-col md:flex-row justify-between items-center gap-4 px-2">
      <h2 className="text-2xl md:text-3xl font-black uppercase italic tracking-tighter flex items-center gap-2">
        <TrendingUp className="text-blue-600"/> Performance
      </h2>
      
      {/* Botões de Filtro: largura total no celular */}
      <div className="flex bg-slate-200 p-1 rounded-2xl border-2 border-slate-900 shadow-sm w-full md:w-auto">
        <button onClick={() => setDashFilter('HOJE')} className={`flex-1 md:px-6 py-2 rounded-xl font-black text-xs uppercase transition-all ${dashFilter === 'HOJE' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500'}`}>Hoje</button>
        <button onClick={() => setDashFilter('SEMANAL')} className={`flex-1 md:px-6 py-2 rounded-xl font-black text-xs uppercase transition-all ${dashFilter === 'SEMANAL' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500'}`}>Semanal</button>
      </div>
    </div>

    {/* Ajuste: 1 coluna no celular, 3 no PC */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <DashboardCard label={`Total ${dashFilter}`} val={stats.total} color="border-slate-900 bg-white" />
      <DashboardCard label="Concluídas" val={stats.concluidas} color="border-green-600 bg-green-50 text-green-700" />
      <DashboardCard label="Pendentes" val={stats.pendentes} color="border-blue-600 bg-blue-50 text-blue-700" />
    </div>

    {/* Taxa de eficiência menor no celular */}
    <div className="bg-white p-6 md:p-12 rounded-[32px] md:rounded-[48px] border-4 border-slate-900 shadow-[8px_8px_0px_0px_rgba(15,23,42,1)] text-center">
       <p className="text-[10px] font-black uppercase text-slate-400 mb-2 tracking-widest">Eficiência {dashFilter}</p>
       <h3 className="text-6xl md:text-9xl font-black mb-6 md:mb-8 tracking-tighter text-slate-900">{stats.porcentagem}%</h3>
       <div className="w-full bg-slate-100 h-10 md:h-16 rounded-2xl border-4 border-slate-900 overflow-hidden p-1">
          <div className="bg-gradient-to-r from-blue-600 to-green-500 h-full rounded-xl transition-all duration-1000" style={{ width: `${stats.porcentagem}%` }} />
       </div>
    </div>
  </div>
) : (
          <>
            {/* MODERN COMMAND CENTER */}
            <div className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-[0_20px_50px_rgba(0,0,0,0.05)] mb-12 mt-4 relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-indigo-500 opacity-50"></div>
              <div className="flex flex-col gap-6">
                <input className="w-full text-3xl font-black outline-none placeholder-slate-300 text-slate-900 bg-transparent border-b-2 border-slate-100 focus:border-blue-500 transition-all pb-3" placeholder="O que vamos construir?" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} />
                <div className="relative group"><div className="absolute top-4 left-4 text-slate-400 group-focus-within:text-blue-500 transition-colors"><FileText size={18} /></div>
                  <textarea className="w-full pl-12 p-4 bg-slate-50 rounded-2xl font-medium text-slate-700 border border-slate-100 outline-none focus:border-blue-300 focus:bg-white transition-all min-h-[100px] resize-none" placeholder="Coordenadas da tarefa..." value={notes} onChange={e => setNotes(e.target.value)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-end border-t border-slate-100 pt-6">
                  <div className="md:col-span-4 space-y-4">
                    <label className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400 mb-1 ml-1 tracking-widest"><User size={12} className="text-blue-500"/> Alocar Para</label>
                    <select className="w-full p-3.5 bg-slate-50 rounded-xl font-bold text-sm border border-slate-200 text-slate-700 focus:bg-white outline-none" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id}>{p.full_name || p.id.slice(0,5)}</option>)}</select>
                    <label className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400 mb-1 ml-1 tracking-widest"><Tag size={12} className="text-blue-500"/> Setor</label>
                    <select className="w-full p-3.5 bg-slate-50 rounded-xl font-bold text-sm border border-slate-200 text-slate-700 focus:bg-white outline-none" value={category} onChange={e => setCategory(e.target.value)}><option>Trade</option><option>Reunião</option><option>Geral</option></select>
                  </div>
                  <div className="md:col-span-4 space-y-4">
                    <label className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400 mb-1 ml-1 tracking-widest"><Clock size={12} className="text-blue-500"/> Frequência</label>
                    <div className="flex gap-1.5 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">{weekDays.map(day => (<button key={day.id} type="button" onClick={() => toggleDay(day.id)} className={`flex-1 h-10 rounded-xl font-black text-xs transition-all ${selectedDays.includes(day.id) ? 'bg-blue-600 text-white shadow-lg scale-105' : 'text-slate-400 hover:bg-slate-200/50'}`}>{day.label}</button>))}</div>
                    <label className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400 mb-1 ml-1 tracking-widest"><Repeat size={12} className="text-blue-500"/> Intervalo (Semanas)</label>
                    <input type="number" min="1" className="w-full p-3.5 bg-slate-50 rounded-xl font-black border border-slate-200 text-slate-700 focus:bg-white outline-none" value={repeatInterval} onChange={e => setRepeatInterval(parseInt(e.target.value) || 1)} />
                  </div>
      {/* BOTÃO DE CRIAÇÃO CORRIGIDO */}
      <div className="md:col-span-4 w-full">
        <button 
          onClick={addTask} 
          className="w-full h-20 md:h-[calc(100%-10px)] bg-blue-600 hover:bg-[#0F172A] text-white rounded-[24px] font-black uppercase tracking-widest transition-all duration-500 flex flex-row md:flex-col items-center justify-center gap-3 shadow-[0_10px_30px_rgba(37,99,235,0.3)] group active:scale-95"
        >
          <div className="bg-white/20 p-2 md:p-3 rounded-full group-hover:rotate-90 transition-transform duration-500">
            <Plus className="w-6 h-6 md:w-8 md:h-8" strokeWidth={3} />
          </div>
          <span className="text-sm">Lançar Tarefa</span>
        </button>
      </div>

    </div>
  </div>
</div>

            {/* LISTAGEM DE TAREFAS */}
            <div className="space-y-6">
              <h2 className="font-black uppercase text-slate-400 text-[10px] tracking-[0.3em] px-2 flex items-center gap-2"><ChevronRight size={14} className="text-blue-600" /> {activeTab} • {filteredTasks.length} TAREFAS</h2>
              {filteredTasks.map(task => {
                const lastS = getLastOccurrence(task); const lastD = task.last_done_date ? new Date(task.last_done_date) : new Date(0)
                const isDone = lastD >= lastS; const isLate = !isDone && lastS < today;
                return (<TaskBox key={task.id} task={task} profiles={profiles} isLate={isLate} isDoneToday={isDone} userRole={userRole} onToggle={() => toggleComplete(task)} onEdit={(t: any) => { setEditingTask(t); setShowEditModal(true); }} onUpdate={fetchTasks} />)
              })}
            </div>
          </>
        )}
      </main>

      {/* MODAL PERFIL */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white p-10 rounded-[40px] w-full max-w-sm border-4 border-slate-900 shadow-2xl">
            <h2 className="text-2xl font-black uppercase mb-6 tracking-tighter">Configurações</h2>
            <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Nome Completo</label>
            <input className="w-full p-4 border-4 border-slate-100 rounded-2xl font-black mb-6 text-slate-900 outline-none focus:border-blue-500" placeholder="Ex: João Silva" value={newName} onChange={e => setNewName(e.target.value)} />
            <button onClick={updateProfile} className="w-full bg-blue-600 text-white p-5 rounded-3xl font-black uppercase text-lg shadow-lg hover:bg-slate-900 transition-all">Salvar Perfil</button>
            <button onClick={() => setShowProfileModal(false)} className="w-full mt-4 text-slate-400 font-bold uppercase text-[10px] tracking-widest text-center">Fechar</button>
          </div>
        </div>
      )}

      {/* MODAL EDIÇÃO */}
      {showEditModal && editingTask && (
        <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in zoom-in-95">
          <div className="bg-white p-10 rounded-[48px] w-full max-w-2xl border-4 border-slate-900 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center mb-8 text-slate-900">
              <h2 className="text-3xl font-black uppercase tracking-tighter italic">Editar Missão</h2>
              <button onClick={() => setShowEditModal(false)} className="hover:rotate-90 transition-all"><X size={40}/></button>
            </div>
            <div className="space-y-6">
              <input className="w-full p-6 border-4 border-slate-100 rounded-3xl font-black text-slate-900 text-2xl" value={editingTask.title} onChange={e => setEditingTask({...editingTask, title: e.target.value})} />
              <textarea className="w-full p-6 bg-slate-50 border-2 border-slate-100 rounded-3xl font-bold text-slate-800 text-lg" rows={3} value={editingTask.notes || ''} onChange={e => setEditingTask({...editingTask, notes: e.target.value})} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <select className="p-4 bg-slate-100 rounded-2xl font-black border-2 border-slate-200" value={editingTask.assigned_to} onChange={e => setEditingTask({...editingTask, assigned_to: e.target.value})}>{profiles.map(p => <option key={p.id} value={p.id}>{p.full_name || p.id.slice(0,5)}</option>)}</select>
                <select className="p-4 bg-slate-100 rounded-2xl font-black border-2 border-slate-200" value={editingTask.category} onChange={e => setEditingTask({...editingTask, category: e.target.value})}><option>Trade</option><option>Reunião</option><option>Geral</option></select>
              </div>
              <div className="space-y-4">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Ajustar Dias de Repetição</label>
                <div className="flex gap-2">{weekDays.map(day => (<button key={day.id} type="button" onClick={() => toggleDayInEdit(day.id)} className={`w-14 h-14 rounded-2xl font-black border-4 transition-all ${editingTask.repeat_days?.split(',').includes(day.id) ? 'bg-blue-600 border-blue-600 text-white scale-110 shadow-lg' : 'bg-white border-slate-200 text-slate-400 opacity-50'}`}>{day.label}</button>))}</div>
              </div>
              <button onClick={updateTask} className="w-full bg-blue-600 text-white p-6 rounded-[32px] font-black uppercase text-xl shadow-xl hover:bg-slate-900 transition-all flex items-center justify-center gap-3 mt-4"><Check size={32}/> Atualizar Tudo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TaskBox({ task, profiles, onUpdate, onEdit, isLate, isDoneToday, onToggle, userRole }: any) {
  // Verificação de permissão para Admin ou Dono da tarefa
  const canModify = userRole === 'admin' || task.assigned_to === profiles.find((p:any)=>p.id === task.assigned_to)?.id;

  return (
    <div className={`p-6 rounded-[32px] border-[4px] transition-all duration-300 flex items-center gap-6 relative group 
      ${isDoneToday 
        ? 'bg-green-50 border-green-600 shadow-[8px_8px_0px_0px_rgba(22,101,52,1)] opacity-90' 
        : isLate 
          ? 'bg-red-50 border-red-600 animate-pulse shadow-[8px_8px_0px_0px_rgba(153,27,27,1)]' 
          : 'bg-white border-slate-900 shadow-[8px_8px_0px_0px_rgba(15,23,42,1)] hover:translate-x-2'
      }`}
    >
      {/* ÍCONE DE ALERTA PARA ATRASADOS */}
      {isLate && !isDoneToday && (
        <div className="absolute -top-4 -right-2 bg-red-600 text-white p-1.5 rounded-full border-4 border-white shadow-lg z-10">
          <AlertCircle size={20} strokeWidth={3} />
        </div>
      )}
      
      {/* BOTÃO CHECKBOX COLORIDO */}
      <button 
        onClick={onToggle} 
        className={`w-16 h-16 rounded-[22px] border-4 flex items-center justify-center transition-all flex-shrink-0 shadow-sm
          ${isDoneToday 
            ? 'bg-green-600 border-green-700 text-white' 
            : isLate 
              ? 'bg-white border-red-600 text-red-600 hover:bg-red-600 hover:text-white' 
              : 'bg-white border-slate-900 text-transparent hover:border-blue-600 hover:text-blue-600/30'
          }`}
      >
        <CheckCircle2 size={40} strokeWidth={3} />
      </button>

      {/* CONTEÚDO DA TAREFA */}
      <div className="flex-1 min-w-0">
        <h3 className={`text-2xl font-black leading-tight tracking-tight truncate 
          ${isDoneToday 
            ? 'line-through text-green-900/50' 
            : isLate ? 'text-red-900' : 'text-slate-900'
          }`}
        >
          {task.title}
        </h3>
        
        {task.notes && (
          <p className={`text-sm font-bold mt-1 line-clamp-2 
            ${isDoneToday ? 'text-green-700/40' : isLate ? 'text-red-700/60' : 'text-slate-500'}`}
          >
            {task.notes}
          </p>
        )}

        {/* TAGS INFERIORES */}
        <div className="flex flex-wrap gap-2 mt-4 font-black text-[9px] uppercase tracking-widest">
          <span className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm border-2 
            ${isDoneToday ? 'bg-green-200 border-green-300 text-green-800' : 'bg-[#0F172A] text-white border-slate-800'}`}>
            <User size={10}/> {profiles.find((p: any) => p.id === task.assigned_to)?.full_name || 'Alocado'}
          </span>
          
          <span className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 border-2 shadow-sm
            ${isDoneToday ? 'bg-green-100 border-green-200 text-green-700' : 'bg-blue-600 border-blue-400 text-white'}`}>
            <Calendar size={10}/> PRÓXIMA: {getNextOccurrence(task)}
          </span>
          
          <span className={`px-3 py-1.5 rounded-lg border-2 shadow-sm
            ${isDoneToday ? 'bg-green-100 border-green-200 text-green-700' : 'bg-slate-100 border-slate-200 text-slate-900'}`}>
            {task.category}
          </span>
        </div>
      </div>

      {/* BOTÕES DE EDIÇÃO/EXCLUSÃO */}
      {canModify && (
        <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button 
            onClick={() => onEdit(task)} 
            className={`p-2 rounded-xl transition-all border-2 
              ${isDoneToday ? 'text-green-600 hover:bg-green-200 border-transparent' : 'text-slate-300 hover:text-blue-600 hover:bg-blue-50 border-transparent'}`}
          >
            <Edit3 size={24}/>
          </button>
          <button 
            onClick={async () => { if(confirm('Deseja deletar permanentemente?')) { await supabase.from('tasks').delete().eq('id', task.id); onUpdate(); } }} 
            className="text-slate-200 hover:text-red-600 p-2 hover:bg-red-50 rounded-xl transition-all"
          >
            <Trash2 size={24}/>
          </button>
        </div>
      )}
    </div>
  )
}

function DashboardCard({ label, val, color }: any) {
  return (
    <div className={`p-8 rounded-[40px] border-4 shadow-[10px_10px_0px_0px_rgba(15,23,42,1)] text-center transition-transform hover:scale-105 ${color}`}><span className="text-[10px] font-black uppercase tracking-[0.2em] block mb-2 opacity-40">{label}</span><span className="text-6xl font-black tracking-tighter">{val}</span></div>
  )
}

const getNextOccurrence = (task: any) => {
  if (!task.repeat_days || task.repeat_days.length === 0) return task.due_date ? new Date(task.due_date).toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'}) : '--/--';
  const today = new Date(); today.setHours(0,0,0,0);
  const daysMap: any = { seg: 1, ter: 2, qua: 3, qui: 4, sex: 5 };
  const taskDays = task.repeat_days.split(',').map((d: string) => daysMap[d]);
  const startDate = new Date(task.created_at); startDate.setHours(0,0,0,0);
  const startMonday = new Date(startDate); startMonday.setDate(startDate.getDate() - (startDate.getDay() === 0 ? 6 : startDate.getDay() - 1));
  for (let w = 0; w < 52; w += (task.repeat_interval || 1)) {
    const currMon = new Date(startMonday); currMon.setDate(startMonday.getDate() + (w * 7));
    for (let dayOffset of taskDays) {
      const occurrence = new Date(currMon); occurrence.setDate(currMon.getDate() + (dayOffset - 1));
      if (occurrence >= today) return occurrence.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    }
  }
  return '--/--';
};

const getLastOccurrence = (task: any) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysMap: any = { seg: 1, ter: 2, qua: 3, qui: 4, sex: 5 };
  if (!task.repeat_days) return task.due_date ? new Date(task.due_date) : new Date(0);
  const taskDays = task.repeat_days.split(',').map((d: string) => daysMap[d]);
  const startDate = new Date(task.created_at); startDate.setHours(0, 0, 0, 0);
  const startMonday = new Date(startDate); startMonday.setDate(startDate.getDate() - (startDate.getDay() === 0 ? 6 : startDate.getDay() - 1));
  let lastDate = new Date(0);
  for (let w = 0; w < 52; w += (task.repeat_interval || 1)) {
    const currMon = new Date(startMonday); currMon.setDate(startMonday.getDate() + (w * 7));
    for (let dayOffset of taskDays) {
      const occurrence = new Date(currMon); occurrence.setDate(currMon.getDate() + (dayOffset - 1));
      if (occurrence <= today && occurrence > lastDate) lastDate = occurrence;
    }
    const nextWeekMon = new Date(startMonday); nextWeekMon.setDate(startMonday.getDate() + ((w + 1) * 7));
    if (nextWeekMon > today) break;
  }
  return lastDate;
};

function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [isSignUp, setIsSignUp] = useState(false)
  const processAuth = async () => {
    const { error } = isSignUp ? await supabase.auth.signUp({ email, password, options: { data: { full_name: email.split('@')[0] } } }) : await supabase.auth.signInWithPassword({ email, password })
    if (error) alert(error.message); else window.location.reload()
  }
  return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-4">
      <div className="bg-white p-12 rounded-[60px] w-full max-w-sm border-b-[24px] border-blue-600 shadow-2xl text-center">
        <div className="bg-blue-600 w-16 h-16 rounded-[20px] flex items-center justify-center mx-auto mb-8 shadow-[0_0_30px_rgba(37,99,235,0.5)] rotate-12"><Activity className="text-white" size={32}/></div>
        <h1 className="text-6xl font-black italic uppercase tracking-tighter text-slate-900 leading-none">SUPPLY<br/><span className="text-blue-600 text-3xl not-italic tracking-[0.2em] font-medium opacity-80">TASKER</span></h1>
        <div className="space-y-4 mt-12">
          <input className="w-full p-6 bg-slate-50 border-4 border-slate-100 rounded-[28px] font-black text-slate-900 outline-none focus:border-blue-500 transition-all placeholder-slate-300" placeholder="E-MAIL" onChange={e => setEmail(e.target.value)} />
          <input className="w-full p-6 bg-slate-50 border-4 border-slate-100 rounded-[28px] font-black text-slate-900 outline-none focus:border-blue-500 transition-all" type="password" placeholder="SENHA" onChange={e => setPassword(e.target.value)} />
          <button onClick={processAuth} className="w-full bg-[#0F172A] text-white p-6 rounded-[28px] font-black uppercase text-xl hover:bg-blue-600 transition-all shadow-xl active:scale-95 mt-4">{isSignUp ? 'Cadastrar' : 'Acessar Centro'}</button>
          <button onClick={() => setIsSignUp(!isSignUp)} className="w-full text-[10px] font-black text-slate-400 uppercase tracking-widest text-center mt-6">{isSignUp ? 'Já sou da equipe' : 'Solicitar conta'}</button>
        </div>
      </div>
    </div>
  )
}