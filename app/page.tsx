'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { 
  Plus, Trash2, CheckCircle2, Circle, LayoutDashboard, 
  LogOut, Calendar, Tag, User, Repeat, X, Check, AlertCircle, TrendingUp
} from 'lucide-react'

export default function App() {
  const [user, setUser] = useState<any>(null)
  const [profiles, setProfiles] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [newName, setNewName] = useState('')

  // Estados de Interface
  const [activeTab, setActiveTab] = useState('HOJE')
  const categories = ['HOJE', 'ATRASADOS', 'Minhas', 'Todas', 'Trade', 'Reunião', 'DASHBOARD']

  // Estados de Criação
  const [taskTitle, setTaskTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [category, setCategory] = useState('Trade')
  const [repeatInterval, setRepeatInterval] = useState(1) // INTERVALO RESTAURADO
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

  async function fetchTasks() {
    const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending: false })
    if (data) setTasks(data)
  }

  // Dentro do seu componente App...

async function updateProfile() {
  if (!newName) return alert("Digite um nome!");

  const { error } = await supabase
    .from('profiles')
    .update({ full_name: newName }) // Salva o nome digitado
    .eq('id', user.id); // Garante que é o perfil do usuário logado

  if (error) {
    console.error(error);
    alert("Erro ao salvar: " + error.message);
  } else {
    alert("Perfil atualizado com sucesso!");
    setShowProfileModal(false);
    setNewName(''); // Limpa o campo
    fetchProfiles(); // Recarrega a lista de nomes para atualizar a interface
  }
}

// ... No seu JSX, procure o Modal de Perfil e garanta que o input tenha o VALUE e o ONCHANGE:

{showProfileModal && (
  <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
    <div className="bg-white p-8 rounded-3xl w-full max-w-sm border-4 border-slate-900 shadow-2xl">
      <h2 className="text-2xl font-black uppercase mb-6 tracking-tighter">Configurar Perfil</h2>
      
      <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Seu Nome Completo</label>
      <input 
        className="w-full p-4 border-4 border-slate-100 rounded-2xl font-black mb-6 text-slate-900 outline-none focus:border-blue-500 transition-all" 
        placeholder="Digite seu nome..." 
        value={newName} // IMPORTANTE: vincular ao estado
        onChange={e => setNewName(e.target.value)} // IMPORTANTE: atualizar o estado
      />

      <div className="flex flex-col gap-2">
        <button 
          onClick={updateProfile} 
          className="w-full bg-blue-600 text-white p-4 rounded-2xl font-black uppercase text-lg shadow-lg hover:bg-blue-700 transition-all active:scale-95"
        >
          Salvar Dados
        </button>
        <button 
          onClick={() => setShowProfileModal(false)} 
          className="w-full py-2 text-slate-400 font-bold uppercase text-[10px] tracking-widest"
        >
          Cancelar
        </button>
      </div>
    </div>
  </div>
)}

  async function addTask() {
  if (!taskTitle) return
  
  // Se marcou dias da semana, não envia due_date fixo, 
  // deixa o sistema trabalhar apenas com a repetição.
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
  else { setTaskTitle(''); setNotes(''); setSelectedDays([]); fetchTasks(); }
}

  // LOGICA DE DATAS E DASHBOARD
  const today = new Date();
  const todayDate = today.toISOString().split('T')[0];
  const daysMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
  const todayTag = daysMap[today.getDay()];

  const stats = {
    total: tasks.length,
    concluidas: tasks.filter(t => t.status === 'concluido').length,
    pendentes: tasks.filter(t => t.status === 'pendente').length,
    atrasadas: tasks.filter(t => t.status !== 'concluido' && t.due_date && t.due_date < todayDate).length,
    porcentagem: tasks.length > 0 ? Math.round((tasks.filter(t => t.status === 'concluido').length / tasks.length) * 100) : 0
  }

  const filteredTasks = tasks.filter(task => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayDate = today.toISOString().split('T')[0];
  const daysMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
  const todayIdx = today.getDay();

  const checkWeek = () => {
    if (!task.created_at || task.repeat_interval <= 1) return true;
    const startDate = new Date(task.created_at);
    startDate.setHours(0, 0, 0, 0);
    // Ajusta a data de início para a segunda-feira daquela semana para padronizar o cálculo
    const startMonday = new Date(startDate);
    startMonday.setDate(startDate.getDate() - (startDate.getDay() === 0 ? 6 : startDate.getDay() - 1));
    
    const diffInWeeks = Math.floor((today.getTime() - startMonday.getTime()) / (1000 * 3600 * 24 * 7));
    return diffInWeeks % task.repeat_interval === 0;
  };

  const isCorrectWeek = checkWeek();

  // --- LÓGICA DE ATRASO REAL ---
  const isLate = task.status !== 'concluido' && (
    // 1. Atraso de data fixa
    (task.due_date && task.due_date < todayDate) || 
    // 2. Atraso de recorrência: É a semana certa E o dia da semana já passou
    (isCorrectWeek && task.repeat_days && task.repeat_days.split(',').some((day: string) => { // Adicionado : string
  const taskDayIdx = daysMap.indexOf(day);
  return taskDayIdx !== -1 && taskDayIdx < todayIdx;
}))
  );

  // --- REGRAS DAS ABAS ---
  if (activeTab === 'ATRASADOS') return isLate;

  if (activeTab === 'HOJE') {
    if (task.status === 'concluido') return false;
    // Aparece hoje se: (Bate o dia da semana E a semana está ativa) OU (A data fixa é hoje)
    const matchesDay = isCorrectWeek && task.repeat_days?.split(',').includes(daysMap[todayIdx]);
    const matchesDate = task.due_date === todayDate;
    return matchesDay || matchesDate;
  }
  
  if (activeTab === 'Minhas') return task.assigned_to === user?.id;
  if (activeTab === 'Todas') return true;
  if (activeTab === 'DASHBOARD') return false;
  
  return task.category === activeTab;
});

  if (!user) return <Login />

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 pb-20 font-sans">
      {/* HEADER */}
      <nav className="bg-slate-900 text-white p-4 sticky top-0 z-30 shadow-2xl border-b-4 border-blue-600">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="text-blue-400" />
            <h1 className="text-xl font-black italic tracking-tighter">SETOR_PRO</h1>
          </div>
          <div className="flex items-center gap-4">
             <button onClick={() => setShowProfileModal(true)} className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-xl border-2 border-slate-700 hover:border-blue-500 transition-all shadow-sm">
                <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-[10px] font-black uppercase">
                  {profiles.find(p => p.id === user.id)?.full_name?.charAt(0) || 'U'}
                </div>
                <span className="text-xs font-black uppercase tracking-widest hidden md:block">
                  {profiles.find(p => p.id === user.id)?.full_name || 'Meu Perfil'}
                </span>
             </button>
             <button onClick={() => supabase.auth.signOut().then(() => window.location.reload())} className="text-red-500 hover:bg-red-600 hover:text-white p-2 rounded-lg transition-all"><LogOut size={20}/></button>
          </div>
        </div>
      </nav>

      {/* ABAS */}
      <div className="bg-white border-b-4 border-slate-200 sticky top-[68px] z-20 overflow-x-auto no-scrollbar">
        <div className="max-w-4xl mx-auto flex">
          {categories.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`px-6 py-4 font-black text-xs uppercase tracking-tighter border-b-4 transition-all whitespace-nowrap ${activeTab === tab ? 'border-blue-600 text-blue-600 bg-blue-50' : 'border-transparent text-slate-400'}`}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-4xl mx-auto p-4">
        {activeTab === 'DASHBOARD' ? (
          /* DASHBOARD COMPLETO */
          <div className="mt-6 space-y-6">
            <h2 className="text-3xl font-black uppercase italic tracking-tighter flex items-center gap-3">
               <TrendingUp className="text-blue-600" size={32}/> Performance do Setor
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <DashboardCard label="Total" val={stats.total} color="border-slate-900 bg-white" />
              <DashboardCard label="Concluídas" val={stats.concluidas} color="border-green-600 bg-green-50 text-green-700" />
              <DashboardCard label="Pendentes" val={stats.pendentes} color="border-blue-600 bg-blue-50 text-blue-700" />
              <DashboardCard label="Atrasadas" val={stats.atrasadas} color="border-red-600 bg-red-50 text-red-600" />
            </div>
            <div className="bg-white p-8 rounded-[40px] border-4 border-slate-900 shadow-xl text-center">
               <p className="text-xs font-black uppercase text-slate-400 mb-2 tracking-widest">Progresso Geral</p>
               <h3 className="text-7xl font-black mb-4">{stats.porcentagem}%</h3>
               <div className="w-full bg-slate-100 h-10 rounded-2xl border-4 border-slate-900 overflow-hidden">
                  <div className="bg-green-500 h-full transition-all duration-1000" style={{ width: `${stats.porcentagem}%` }} />
               </div>
            </div>
          </div>
        ) : (
          <>
            {/* BOX DE CRIAÇÃO RESTAURADO E COMPLETO */}
            <div className="bg-white p-6 rounded-3xl border-4 border-slate-900 shadow-xl mb-10 mt-4 transition-all">
              <input className="w-full text-3xl font-black outline-none mb-2 border-b-4 border-slate-100 focus:border-blue-500 pb-2 text-slate-900 uppercase" placeholder="NOME DA TAREFA..." value={taskTitle} onChange={e => setTaskTitle(e.target.value)} />
              
              <textarea className="w-full mt-4 p-4 bg-slate-50 rounded-2xl font-bold text-slate-800 border-2 border-slate-200 outline-none focus:border-blue-400 transition-all placeholder-slate-300" placeholder="Observações e detalhes..." rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6 pt-6 border-t-2 border-slate-100">
                {/* RESPONSÁVEL E CATEGORIA */}
                <div className="space-y-4">
                  <div className="flex flex-col">
                    <label className="text-[10px] font-black uppercase text-slate-400 mb-1 ml-1">Responsável</label>
                    <select className="p-3 bg-slate-100 rounded-xl font-black border-2 border-slate-200 text-slate-900" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
                      {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name || p.id.slice(0,5)}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col">
                    <label className="text-[10px] font-black uppercase text-slate-400 mb-1 ml-1">Categoria</label>
                    <select className="p-3 bg-slate-100 rounded-xl font-black border-2 border-slate-200 text-slate-900" value={category} onChange={e => setCategory(e.target.value)}>
                      <option>Trade</option><option>Reunião</option><option>Geral</option>
                    </select>
                  </div>
                </div>

                {/* REPETIÇÃO E INTERVALO (RESTAURADO) */}
                <div className="space-y-4">
                   <div className="flex flex-col">
                     <label className="text-[10px] font-black uppercase text-slate-400 mb-1 ml-1">Repetir nos Dias</label>
                     <div className="flex gap-1.5">
                       {weekDays.map(day => (
                         <button key={day.id} onClick={() => setSelectedDays(prev => prev.includes(day.id) ? prev.filter(d => d !== day.id) : [...prev, day.id])} className={`w-9 h-9 rounded-xl font-black border-2 transition-all ${selectedDays.includes(day.id) ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-400'}`}>
                           {day.label}
                         </button>
                       ))}
                     </div>
                   </div>
                   <div className="flex flex-col">
                     <label className="text-[10px] font-black uppercase text-slate-400 mb-1 ml-1">Intervalo (Semanas)</label>
                     <input type="number" min="1" className="p-3 bg-slate-100 rounded-xl font-black border-2 border-slate-200 text-slate-900" value={repeatInterval} onChange={e => setRepeatInterval(parseInt(e.target.value) || 1)} />
                   </div>
                </div>

                {/* BOTÃO CRIAR */}
                <button onClick={addTask} className="bg-blue-600 text-white rounded-[32px] font-black uppercase hover:bg-slate-900 transition-all flex flex-col items-center justify-center gap-2 py-6 shadow-xl active:scale-95">
                  <Plus size={40}/> <span className="text-lg">Criar Tarefa</span>
                </button>
              </div>
            </div>

            {/* LISTA DE TAREFAS */}
            <div className="space-y-4">
              <h2 className="font-black uppercase text-slate-400 text-xs tracking-widest px-2">{activeTab} - {filteredTasks.length} ITENS</h2>
              {filteredTasks.map(task => {
  // Repetimos o cálculo para que o componente saiba que deve ficar vermelho
  const today = new Date();
  today.setHours(0,0,0,0);
  const todayIdx = today.getDay();
  const daysMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

  // ... dentro do filteredTasks.map
const isLate = task.status !== 'concluido' && (
  (task.due_date && task.due_date < today.toISOString().split('T')[0]) ||
  (task.repeat_days && task.repeat_days.split(',').some((day: string) => daysMap.indexOf(day) < todayIdx)) // Adicionado : string
);

  return (
    <TaskBox 
      key={task.id} 
      task={task} 
      isLate={isLate} 
      profiles={profiles} 
      todayDate={today.toISOString().split('T')[0]} 
      onUpdate={fetchTasks} 
    />
  );
})}
            </div>
          </>
        )}
      </main>

      {/* MODAL PERFIL */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white p-8 rounded-3xl w-full max-w-sm border-4 border-slate-900 shadow-2xl animate-in zoom-in-95 duration-200">
            <h2 className="text-2xl font-black uppercase mb-6 tracking-tighter">Configurar Perfil</h2>
            <input className="w-full p-4 border-4 border-slate-100 rounded-2xl font-black mb-6 text-slate-900 outline-none focus:border-blue-500" placeholder="Nome Completo" value={newName} onChange={e => setNewName(e.target.value)} />
            <button onClick={updateProfile} className="w-full bg-blue-600 text-white p-4 rounded-2xl font-black uppercase text-lg shadow-lg">Salvar Dados</button>
            <button onClick={() => setShowProfileModal(false)} className="w-full mt-4 text-slate-400 font-bold uppercase text-[10px] tracking-widest">Fechar</button>
          </div>
        </div>
      )}
    </div>
  )
}

function TaskBox({ task, profiles, todayDate, onUpdate }: any) {
  const isLate = task.status !== 'concluido' && task.due_date && task.due_date < todayDate;
  
  const toggle = async () => {
    const newStatus = task.status === 'concluido' ? 'pendente' : 'concluido'
    await supabase.from('tasks').update({ status: newStatus }).eq('id', task.id)
    onUpdate()
  }

  return (
    <div className={`p-6 rounded-[32px] border-4 shadow-lg transition-all flex items-center gap-4 relative group ${
      task.status === 'concluido' ? 'bg-green-50 border-green-600 opacity-60' : 
      isLate ? 'bg-red-50 border-red-600 animate-pulse' : 'bg-white border-slate-900'
    }`}>
      {isLate && <div className="absolute -top-3 -right-3 bg-red-600 text-white p-1 rounded-full border-2 border-white"><AlertCircle size={24} /></div>}
      
      <button onClick={toggle} className={`w-14 h-14 rounded-2xl border-4 flex items-center justify-center transition-all flex-shrink-0 ${
        task.status === 'concluido' ? 'bg-green-600 border-green-600 text-white' : 
        isLate ? 'border-red-600 text-red-600' : 'border-slate-900 text-transparent'
      }`}>
        <CheckCircle2 size={36} />
      </button>

      <div className="flex-1 min-w-0">
        <h3 className={`text-2xl font-black leading-tight tracking-tight truncate ${task.status === 'concluido' ? 'line-through text-slate-400' : 'text-slate-900'}`}>{task.title}</h3>
        {task.notes && <p className={`text-sm font-bold mt-1 line-clamp-2 ${task.status === 'concluido' ? 'text-green-700/50' : 'text-slate-600'}`}>{task.notes}</p>}
        
        <div className="flex flex-wrap gap-2 mt-3 font-black text-[9px] uppercase tracking-widest">
          <span className="bg-slate-900 text-white px-2 py-1 rounded-lg flex items-center gap-1 shadow-sm">
            <User size={10}/> {profiles.find((p: any) => p.id === task.assigned_to)?.full_name || 'Alocado'}
          </span>
          <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-lg border border-blue-200">{task.category}</span>
          {task.repeat_days && (
            <span className="bg-white text-slate-400 border border-slate-200 px-2 py-1 rounded-lg flex items-center gap-1">
              <Repeat size={10}/> {task.repeat_days} (1/{task.repeat_interval}S)
            </span>
          )}
          {isLate && <span className="bg-red-600 text-white px-2 py-1 rounded-lg shadow-sm">ATRASADO</span>}
        </div>
      </div>

      <button onClick={async () => { if(confirm('Deseja excluir?')) { await supabase.from('tasks').delete().eq('id', task.id); onUpdate(); } }} className="text-slate-200 hover:text-red-600 transition-all p-2"><Trash2 size={24}/></button>
    </div>
  )
}

function DashboardCard({ label, val, color }: any) {
  return (
    <div className={`p-6 rounded-[32px] border-4 shadow-xl text-center transition-transform hover:scale-105 ${color}`}>
      <span className="text-[10px] font-black uppercase tracking-[0.2em] block mb-2">{label}</span>
      <span className="text-5xl font-black tracking-tighter">{val}</span>
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
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white p-10 rounded-[48px] w-full max-w-sm border-b-[16px] border-blue-600 shadow-2xl">
        <h1 className="text-6xl font-black text-center mb-12 italic uppercase tracking-tighter text-slate-900">SETOR</h1>
        <div className="space-y-4">
          <input className="w-full p-5 border-4 border-slate-100 rounded-[24px] font-black text-slate-900 outline-none focus:border-blue-500 transition-all" placeholder="E-MAIL" onChange={e => setEmail(e.target.value)} />
          <input className="w-full p-5 border-4 border-slate-100 rounded-[24px] font-black text-slate-900 outline-none focus:border-blue-500 transition-all" type="password" placeholder="SENHA" onChange={e => setPassword(e.target.value)} />
          <button onClick={processAuth} className="w-full bg-slate-900 text-white p-6 rounded-[24px] font-black uppercase text-xl hover:bg-blue-600 transition-all shadow-xl active:scale-95">
            {isSignUp ? 'Cadastrar' : 'Entrar'}
          </button>
          <button onClick={() => setIsSignUp(!isSignUp)} className="w-full text-[10px] font-black text-slate-400 uppercase tracking-widest text-center mt-4">
            {isSignUp ? 'Já tenho conta' : 'Criar nova conta'}
          </button>
        </div>
      </div>
    </div>
  )
}