'use client'
import { useEffect, useState, useMemo, memo, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { 
  Plus, Trash2, CheckCircle2, LayoutDashboard, 
  LogOut, Calendar, User, X, Check, AlertCircle, TrendingUp,
  Edit3, ChevronRight, Activity, ListChecks, ChevronDown, ChevronUp, FileText, Megaphone, Settings, Search
} from 'lucide-react'

// 1. Defina exatamente o que é cada dado no seu sistema
interface Subtask {
  title: string;
  done: boolean;
}

interface Task {
  id: string;
  title: string;
  notes: string;
  assigned_to: string;
  category: string;
  status: 'pendente' | 'concluido';
  last_done_date: string | null;
  repeat_days: string;
  repeat_interval: number;
  subtasks: Subtask[];
  created_at: string;
  // Campos que vamos calcular e "pendurar" no objeto para performance:
  lastOcc?: string; 
  nextOcc?: string;
  isDoneToday?: boolean;
}

interface Profile {
  id: string;
  full_name: string;
  role: 'admin' | 'gerente' | 'membro';
}

// --- FUNÇÕES DE UTILIDADE (FORA DO COMPONENTE) ---
const getTodayStr = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const formatToBR = (dateStr: string) => {
  if (!dateStr || dateStr === '1970-01-01' || dateStr.includes('/')) return dateStr;
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
};

const getLastOccurrence = (task: Task) => {
  const todayStr = getTodayStr();
  const createdAtStr = task.created_at.split('T')[0];
  
  if (!task.repeat_days || task.repeat_days === "") return task.last_done_date || '1970-01-01';

  let theoreticalLastStr = '1970-01-01';

  const dayOfMonth = parseInt(task.repeat_days);
  if (!isNaN(dayOfMonth) && !task.repeat_days.includes(',')) {
    const today = new Date();
    const thisMonthOcc = new Date(today.getFullYear(), today.getMonth(), dayOfMonth);
    const lastMonthOcc = new Date(today.getFullYear(), today.getMonth() - 1, dayOfMonth);
    
    const targetDate = (today.getDate() >= dayOfMonth) ? thisMonthOcc : lastMonthOcc;
    theoreticalLastStr = targetDate.toISOString().split('T')[0];
  } 
  else {
    const daysMap: Record<string, number> = { seg: 1, ter: 2, qua: 3, qui: 4, sex: 5 };
    const taskDays = task.repeat_days.split(',').map((d: string) => daysMap[d as keyof typeof daysMap]);
    const startDate = new Date(task.created_at);
    const startMonday = new Date(startDate);
    startMonday.setDate(startDate.getDate() - (startDate.getDay() === 0 ? 6 : startDate.getDay() - 1));

    for (let w = 0; w < 52; w++) {
      if (w % (task.repeat_interval || 1) === 0) {
        const currWeekMon = new Date(startMonday);
        currWeekMon.setDate(startMonday.getDate() + (w * 7));
        for (let dayOffset of taskDays) {
          const occurrence = new Date(currWeekMon);
          occurrence.setDate(currWeekMon.getDate() + (dayOffset - 1));
          const occStr = occurrence.toISOString().split('T')[0];
          if (occStr <= todayStr && occStr > theoreticalLastStr) theoreticalLastStr = occStr;
        }
      }
      const nextW = new Date(startMonday); 
      nextW.setDate(startMonday.getDate() + ((w + 1) * 7));
      if (nextW.toISOString().split('T')[0] > todayStr) break;
    }
  }

  if (theoreticalLastStr < createdAtStr) {
    const nextOccBR = getNextOccurrence(task);
    const [d, m, y] = nextOccBR.split('/');
    return `${y}-${m}-${d}`;
  }

  return theoreticalLastStr;
};

const getNextOccurrence = (task: Task) => {
  const today = new Date();
  const todayStr = getTodayStr();
  if (!task.repeat_days || task.repeat_days === "") return '--/--/----';

  const dayOfMonth = parseInt(task.repeat_days);
  if (!isNaN(dayOfMonth) && !task.repeat_days.includes(',')) {
    const thisMonthOcc = new Date(today.getFullYear(), today.getMonth(), dayOfMonth);
    const nextMonthOcc = new Date(today.getFullYear(), today.getMonth() + (task.repeat_interval || 1), dayOfMonth);
    let nextDate = (today.getDate() < dayOfMonth) ? thisMonthOcc : nextMonthOcc;
    return formatToBR(nextDate.toISOString().split('T')[0]);
  }

  const daysMap: Record<string, number> = { seg: 1, ter: 2, qua: 3, qui: 4, sex: 5 };
  const taskDays = task.repeat_days.split(',').map((d: string) => daysMap[d as keyof typeof daysMap]);
  const startDate = new Date(task.created_at);
  const startMonday = new Date(startDate);
  startMonday.setDate(startDate.getDate() - (startDate.getDay() === 0 ? 6 : startDate.getDay() - 1));

  for (let w = 0; w < 52; w += (task.repeat_interval || 1)) {
    const currMon = new Date(startMonday);
    currMon.setDate(startMonday.getDate() + (w * 7));
    for (let dayOffset of taskDays) {
      const occ = new Date(currMon);
      occ.setDate(currMon.getDate() + (dayOffset - 1));
      const occStr = occ.toISOString().split('T')[0];
      if (occStr >= todayStr) return formatToBR(occStr);
    }
  }
  return '--/--/----';
};

export default function App() {
  const [user, setUser] = useState<any>(null)
  const [userRole, setUserRole] = useState('membro')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [history, setHistory] = useState<any[]>([])
  
  const [activeTab, setActiveTab] = useState('HOJE')
  const [dashFilter, setDashFilter] = useState<'HOJE' | 'SEMANAL'>('HOJE')
  const [filterUser, setFilterUser] = useState('Todos')
  const [showCreateBox, setShowCreateBox] = useState(false)
  const categories = ['HOJE', 'ATRASADOS', 'Minhas', 'Todas', 'Trade', 'Reunião', 'HISTÓRICO', 'DASHBOARD', 'COMUNICADOS']

  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingTask, setEditingTask] = useState<any>(null)

  const [taskTitle, setTaskTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [category, setCategory] = useState('Trade')
  const [repeatInterval, setRepeatInterval] = useState(1)
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const [tempSubtasks, setTempSubtasks] = useState<{title: string, done: boolean}[]>([])
  const [viewingTask, setViewingTask] = useState<any>(null);
  const [announcements, setAnnouncements] = useState<any[]>([])
  const [annTitle, setAnnTitle] = useState('')
  const [annContent, setAnnContent] = useState('')
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [displayDate, setDisplayDate] = useState('DD/MM/YYYY');
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [editDisplayDate, setEditDisplayDate] = useState('DD/MM/YYYY');
  const editDateInputRef = useRef<HTMLInputElement>(null);
  const [editMode, setEditMode] = useState('semanal');
  const [searchTerm, setSearchTerm] = useState('');

  // Este bloco pega as tasks brutas do Supabase e calcula a recorrência apenas quando necessário
  const processedTasks = useMemo(() => {
  const today = getTodayStr();

  return tasks.map((task: Task) => {
    const last = getLastOccurrence(task);
    const next = getNextOccurrence(task);
    
    // NOVA LÓGICA: Está pronta se (foi feita hoje) OU (a data da última conclusão é >= data prevista)
    const doneToday = (task.last_done_date === today) || (task.last_done_date && task.last_done_date >= last);

    return {
      ...task,
      lastOcc: last,
      nextOcc: next,
      isDoneToday: !!doneToday // O !! garante que seja um valor verdadeiro/falso (booleano)
    };
  });
}, [tasks]);

// Função de Logout Centralizada
const handleLogout = async () => {
  await supabase.auth.signOut();
  window.location.reload();
};
  
  const weekDays = [{ id: 'seg', label: 'S' }, { id: 'ter', label: 'T' }, { id: 'qua', label: 'Q' }, { id: 'qui', label: 'Q' }, { id: 'sex', label: 'S' }]

  useEffect(() => {
  let channel: any ; // Declaramos a variável fora para usá-la na limpeza

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session?.user) {
      setUser(session.user);
      setAssignedTo(session.user.id);
      
      supabase.from('profiles').select('role, full_name').eq('id', session.user.id).single()
        .then(({ data }) => {
          if (data) { 
            setUserRole(data.role || 'membro'); 
            setNewName(data.full_name || ''); 
          }
        });
      
      fetchProfiles(); 
      fetchTasks(); 
      fetchHistory();
      if (typeof fetchAnnouncements === 'function') fetchAnnouncements();

      // --- CONFIGURAÇÃO CORRETA DO REALTIME ---
      // 1. Criamos o canal
      // 2. Adicionamos o evento .on ANTES do .subscribe
      channel = supabase
        .channel('db-realtime-tasks') // Nome único para o canal
        .on(
          'postgres_changes', 
          { event: '*', schema: 'public', table: 'tasks' }, 
          (payload) => {
            console.log("Mudança detectada!", payload);
            fetchTasks(); 
          }
        )
        .subscribe((status) => {
          console.log("Status da conexão realtime:", status);
        });
    }
  });

  // FUNÇÃO DE LIMPEZA: Importante para evitar o erro que você recebeu
  return () => {
    if (channel) {
      supabase.removeChannel(channel);
    }
  };
}, []);

  const fetchProfiles = async () => { const { data } = await supabase.from('profiles').select('*'); if (data) setProfiles(data); }
  const fetchTasks = async () => { const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending: false }); if (data) setTasks(data); }
  const fetchHistory = async () => { const { data } = await supabase.from('task_history').select('*').order('created_at', { ascending: false }).limit(50); if (data) setHistory(data); }
  const fetchAnnouncements = async () => { const { data } = await supabase.from('announcements').select('*, profiles(full_name)').order('created_at', { ascending: false }); if (data) setAnnouncements(data); }

  async function changeRole(profileId: string, newRole: string) {
  // 1. Faz a atualização no Supabase
  const { error } = await supabase
    .from('profiles')
    .update({ role: newRole })
    .eq('id', profileId);

  if (error) {
    alert("Erro ao mudar cargo: " + error.message);
  } else {
    // 2. ATUALIZAÇÃO LOCAL (Onde dava o erro)
    // Usamos "as any" aqui para dizer ao TypeScript que nós garantimos 
    // que o texto em newRole é um cargo válido.
    setProfiles((prevProfiles: Profile[]) => 
  prevProfiles.map(p => 
    p.id === profileId ? { ...p, role: newRole as any } : p
  )
);

    if (profileId === user?.id) {
      setUserRole(newRole as any);
    }

    alert("Cargo atualizado com sucesso!");
  }
}

  async function addAnnouncement() {
  if (!annTitle || !annContent) return
  const { error } = await supabase.from('announcements').insert([
    { title: annTitle.toUpperCase(), content: annContent, created_by: user.id }
  ])
  if (!error) {
    setAnnTitle(''); setAnnContent('');
    fetchAnnouncements();
  }
}
  async function updateProfile() {
    const { error } = await supabase.from('profiles').update({ full_name: newName }).eq('id', user.id)
    if (!error) { alert("Perfil atualizado!"); setShowProfileModal(false); fetchProfiles(); }
  }
  // Função para marcar/desmarcar dias na criação de nova tarefa
const toggleDay = (day: string) => {
  setSelectedDays((prev: string[]) => 
    prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
  )
}

// Função para marcar/desmarcar dias na edição de tarefa existente
const toggleDayInEdit = (day: string) => {
  if (!editingTask) return;
  const currentDays = editingTask.repeat_days ? editingTask.repeat_days.split(',') : []
  const newDays = currentDays.includes(day) 
    ? currentDays.filter((d: any) => d !== day) 
    : [...currentDays, day]
  
  setEditingTask({ ...editingTask, repeat_days: newDays.join(',') })
}

  async function addTask() {
    if (!taskTitle) return
    const isRecurring = selectedDays.length > 0
    const { error } = await supabase.from('tasks').insert([{ 
        title: taskTitle.toUpperCase(), assigned_to: assignedTo, status: 'pendente', category, notes, 
        repeat_days: selectedDays.join(','), repeat_interval: repeatInterval, subtasks: tempSubtasks,
        due_date: isRecurring ? null : getTodayStr()
    }])
    if (!error) { setTaskTitle(''), setDisplayDate('DD/MM/YYYY'); setNotes(''); setSelectedDays([]); setTempSubtasks([]); setShowCreateBox(false); fetchTasks(); }
  }

  // 1. Localize e substitua a função toggleComplete dentro do App
  const toggleComplete = useCallback(async (task: Task) => {
  const todayStr = getTodayStr();
  
  // Usamos a propriedade isDoneToday que calculamos no useMemo
  const isCurrentlyDone = task.isDoneToday;
  const newDate = isCurrentlyDone ? null : todayStr;

  // Sincroniza todas as subtarefas automaticamente (Regra de Negócio)
  const updatedSubtasks = (task.subtasks || []).map((sub: any) => ({
    ...sub,
    done: !isCurrentlyDone
  }));

  // Optimistic Update: Atualiza a interface instantaneamente antes mesmo do banco
  setTasks(prevTasks => prevTasks.map(t => 
    t.id === task.id ? { ...t, last_done_date: newDate, subtasks: updatedSubtasks } : t
  ));

  // Grava no histórico se estiver concluindo
  if (!isCurrentlyDone) {
    const profile = profiles.find(p => p.id === user.id);
    await supabase.from('task_history').insert([{
      task_id: task.id,
      task_title: task.title,
      user_name: profile?.full_name || user.email,
      user_id: user.id,
      category: task.category
    }]);
  }

  // Atualiza o Banco de Dados
  const { error } = await supabase.from('tasks').update({ 
    last_done_date: newDate, 
    status: newDate ? 'concluido' : 'pendente',
    subtasks: updatedSubtasks 
  }).eq('id', task.id);

  if (error) {
    alert("Erro ao salvar: " + error.message);
    fetchTasks(); // Se deu erro, recarrega os dados originais
  }
}, [user, profiles]); // Dependências do useCallback

const deleteTask = useCallback(async (taskId: string) => {
  if (!confirm('Deseja realmente deletar esta missão?')) return;

  // Optimistic Update: Remove da tela na hora
  setTasks(prev => prev.filter(t => t.id !== taskId));

  const { error } = await supabase.from('tasks').delete().eq('id', taskId);

  if (error) {
    alert("Erro ao deletar: " + error.message);
    fetchTasks(); // Recarrega se der erro
  }
}, []);

  async function updateTask() {
  if (!editingTask) return;

  // Mostra um feedback visual de carregamento (opcional)
  console.log("Tentando atualizar tarefa:", editingTask.id);

  const { error } = await supabase
    .from('tasks')
    .update({ 
      title: editingTask.title.toUpperCase(), 
      notes: editingTask.notes, 
      assigned_to: editingTask.assigned_to,
      category: editingTask.category, 
      repeat_days: editingTask.repeat_days, 
      repeat_interval: editingTask.repeat_interval, 
      subtasks: editingTask.subtasks 
    })
    .eq('id', editingTask.id);

  if (error) {
    // SE DER ERRO (como falta de permissão), o sistema agora vai avisar!
    console.error("Erro Supabase:", error);
    alert(`Erro ao salvar: ${error.message}`);
  } else {
    // SUCESSO
    setShowEditModal(false); 
    setEditingTask(null); 
    // O fetchTasks será chamado automaticamente pelo Realtime, 
    // mas chamamos aqui por segurança caso o realtime falhe
    fetchTasks(); 
    alert("Missão atualizada com sucesso!");
  }
}

  const filteredTasks = useMemo(() => {
  return processedTasks.filter(task => {
    const todayStr = getTodayStr();

    // --- 1. LÓGICA DE PESQUISA ---
    // Verifica se o termo pesquisado existe no título ou nas observações
    const term = searchTerm.toLowerCase();
    const matchesSearch = 
      task.title.toLowerCase().includes(term) || 
      (task.notes && task.notes.toLowerCase().includes(term));

    // Se houver algo escrito e não bater com a busca, descarta a tarefa
    if (searchTerm && !matchesSearch) return false;

    // --- 2. LÓGICA DE VISIBILIDADE (Permissões de Classe) ---
    const abasGlobais = ['Todas', 'HOJE', 'Trade', 'Reunião', 'ATRASADOS'];
    if (userRole === 'membro' && !abasGlobais.includes(activeTab) && task.assigned_to !== user?.id) {
      return false;
    }

    // --- 3. FILTRO DE USUÁRIO (Dropdown) ---
    if (filterUser !== 'Todos' && task.assigned_to !== filterUser) return false;

    // --- 4. LÓGICA DE STATUS / ABAS ---
    const isLate = !task.isDoneToday && task.lastOcc < todayStr;
    const isDueToday = task.lastOcc === todayStr;

    if (activeTab === 'ATRASADOS') return isLate;
    if (activeTab === 'HOJE') return isDueToday && !task.isDoneToday;
    if (activeTab === 'Minhas') return task.assigned_to === user?.id;
    if (activeTab === 'Todas') return true;

    // Categorias específicas
    return task.category === activeTab;
  });
}, [processedTasks, activeTab, filterUser, userRole, user?.id, searchTerm]); // <--- searchTerm adicionado aqui

  const stats = useMemo(() => {
  const todayStr = getTodayStr();
  
  // Cálculo da segunda-feira (semana)
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  monday.setHours(0,0,0,0);
  const startOfWeekStr = monday.toISOString().split('T')[0];

  // Base global (conforme solicitado anteriormente)
  let baseTasks = processedTasks;
  
  if (filterUser !== 'Todos') {
    baseTasks = baseTasks.filter(t => t.assigned_to === filterUser);
  }

  let totalPeriodo = 0;
  let concluidasPeriodo = 0;

  if (dashFilter === 'HOJE') {
    const hojeTasks = baseTasks.filter(t => t.lastOcc === todayStr);
    totalPeriodo = hojeTasks.length;
    concluidasPeriodo = hojeTasks.filter(t => t.isDoneToday).length;
  } else {
    totalPeriodo = baseTasks.length;
    concluidasPeriodo = baseTasks.filter(t => t.isDoneToday).length;
  }

  const porcentagem = totalPeriodo > 0 ? Math.round((concluidasPeriodo / totalPeriodo) * 100) : 0;

  return { 
    total: totalPeriodo, 
    concluidas: concluidasPeriodo, 
    pendentes: totalPeriodo - concluidasPeriodo, 
    porcentagem 
  };
}, [processedTasks, dashFilter, filterUser]); // <--- Só recalcula se esses valores mudarem

  if (!user) return <Login />

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 pb-20 font-sans overflow-x-hidden w-full">
      <nav className="bg-[#0F172A] text-white sticky top-0 z-30 shadow-2xl border-b border-white/10 px-6 h-20 flex justify-between items-center">
 {/* NAVBAR LOGO */}
<div className="flex items-center gap-3">
  {/* SUBSTITUA O BLOCO DO ÍCONE POR ESTE: */}
  <img 
    src="/icon.png" 
    alt="Logo" 
    className="w-10 h-10 rounded-xl shadow-lg object-contain bg-blue-600 p-1" 
  />
  
  <h1 className="text-xl font-black italic tracking-tighter uppercase">
    WALLY<span className="text-blue-500 text-sm block not-italic font-medium">Task Manager</span>
  </h1>
</div>

  {/* BOTÕES DA DIREITA */}
  <div className="flex items-center gap-4">
    {/* BOTÃO DE PERFIL */}
    <button 
      onClick={() => setShowProfileModal(true)} 
      className="flex items-center gap-3 bg-white/5 pl-2 pr-4 py-1.5 rounded-full border border-white/10 hover:bg-white/10 transition-all shadow-sm"
    >
      <div className="w-8 h-8 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-full flex items-center justify-center text-[10px] font-black shadow-lg">
        {profiles.find(p => p.id === user.id)?.full_name?.charAt(0) || 'U'}
      </div>
      <span className="text-[11px] font-bold uppercase text-slate-300 hidden md:block">
        {profiles.find(p => p.id === user.id)?.full_name || 'Meu Perfil'} 
        {userRole === 'admin' ? ' 👑' : userRole === 'gerente' ? ' ⚡' : ''}
      </span>
    </button>
    
    {/* NOVO BOTÃO DE CONFIGURAÇÕES (SUBSTITUI O LOGOUT DIRETO) */}
    <button 
      onClick={() => setShowSettingsModal(true)} 
      className="w-10 h-10 flex items-center justify-center bg-white/5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all"
    >
      <Settings size={20} />
    </button>
  </div>
</nav>

      {/* ÁREA DE CONTROLE: ABAS + FILTROS + PESQUISA */}
<div className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-20 z-30 py-4 px-4 shadow-sm">
  <div className="max-w-7xl mx-auto space-y-4">
    
    {/* LINHA 1: CONTAINER RELATIVO PARA ABAS E PESQUISA */}
    <div className="relative flex items-center justify-center">
      
      {/* ABAS PRINCIPAIS (Ficam no centro) */}
      <div className="inline-flex bg-slate-100 p-1 rounded-full border border-slate-200 overflow-x-auto no-scrollbar max-w-[80%]">
        {['HOJE', 'ATRASADOS', 'Minhas', 'Todas', 'Trade', 'Reunião', 'HISTÓRICO', 'DASHBOARD', 'COMUNICADOS'].map(tab => (
          <button 
            key={tab} 
            onClick={() => { setActiveTab(tab); setShowCreateBox(false); }} 
            className={`px-6 py-2 rounded-full font-black text-[10px] uppercase transition-all whitespace-nowrap ${activeTab === tab ? 'bg-white text-blue-600 shadow-md ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-600'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* BARRA DE PESQUISA (Alinhada à Direita) */}
      {/* O valor -right-16 move ela cerca de 64px para a direita do limite original */}
<div className="absolute -right-8 xl:-right-16 hidden lg:block group w-30 xl:w-55">
        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
        <input 
          type="text"
          placeholder="BUSCAR MISSÃO..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-slate-50 border-2 border-slate-100 rounded-full font-bold text-[10px] outline-none focus:border-blue-500 focus:bg-white focus:shadow-md transition-all uppercase placeholder:text-slate-300"
        />
      </div>
    </div>

    {/* LINHA 2: FILTROS DE USUÁRIO (Centralizados ou à esquerda) */}
    <div className="flex justify-center">
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        <button 
          onClick={() => setFilterUser('Todos')} 
          className={`px-4 py-1.5 rounded-full font-black text-[9px] uppercase border-2 transition-all ${filterUser === 'Todos' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-400 border-slate-100'}`}
        >
          Todos
        </button>
        {profiles.map(p => (
          <button 
            key={p.id} 
            onClick={() => setFilterUser(p.id)} 
            className={`px-4 py-1.5 rounded-full font-black text-[9px] uppercase border-2 flex items-center gap-2 transition-all ${filterUser === p.id ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-slate-400 border-slate-100'}`}
          >
            <div className={`w-3 h-3 rounded-full flex items-center justify-center text-[6px] ${filterUser === p.id ? 'bg-white text-blue-600' : 'bg-blue-100 text-blue-600'}`}>
              {p.full_name?.charAt(0)}
            </div>
            {p.full_name?.split(' ')[0]}
          </button>
        ))}
      </div>
    </div>

  </div>
</div>

      <main className="max-w-4xl mx-auto p-4">
  {activeTab === 'DASHBOARD' ? (
    <div className="mt-6 space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 px-2">
          <h2 className="text-3xl font-black uppercase italic tracking-tighter flex items-center gap-2"><TrendingUp className="text-blue-600"/> Performance</h2>
          <div className="flex bg-slate-200 p-1 rounded-2xl border-2 border-slate-900 shadow-sm w-full md:w-auto">
            <button onClick={() => setDashFilter('HOJE')} className={`flex-1 px-6 py-2 rounded-xl font-black text-xs uppercase transition-all ${dashFilter === 'HOJE' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500'}`}>Hoje</button>
            <button onClick={() => setDashFilter('SEMANAL')} className={`flex-1 px-6 py-2 rounded-xl font-black text-xs uppercase transition-all ${dashFilter === 'SEMANAL' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500'}`}>Semanal</button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <DashboardCard label={`Total ${dashFilter}`} val={stats.total} color="border-slate-900 bg-white" />
          <DashboardCard label="Concluídas" val={stats.concluidas} color="border-green-600 bg-green-50 text-green-700" />
          <DashboardCard label="Pendentes" val={stats.pendentes} color="border-blue-600 bg-blue-50 text-blue-700" />
        </div>
        <div className="bg-white p-12 rounded-[48px] border-4 border-slate-900 shadow-[15px_15px_0px_0px_rgba(15,23,42,1)] text-center">
          <h3 className="text-9xl font-black mb-8 tracking-tighter">{stats.porcentagem}%</h3>
          <div className="w-full bg-slate-100 h-16 rounded-3xl border-4 border-slate-900 overflow-hidden shadow-inner p-1"><div className="bg-green-500 h-full rounded-2xl transition-all duration-1000" style={{ width: `${stats.porcentagem}%` }} /></div>
        </div>
    </div>
  ) : activeTab === 'HISTÓRICO' ? (
    <div className="mt-8 space-y-6 animate-in slide-in-from-bottom-4 duration-500">
        <h2 className="text-3xl font-black uppercase italic tracking-tighter">Linha do Tempo</h2>
        <div className="relative border-l-4 border-slate-200 ml-4 pl-8 space-y-8 py-4">
        {history.map((log) => (
          <div key={log.id} className="relative">
            <div className="absolute -left-[42px] top-0 w-5 h-5 bg-blue-600 rounded-full border-4 border-white shadow-md"></div>
            <div className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-sm">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">{new Date(log.created_at).toLocaleString('pt-BR')}</p>
              <h4 className="text-xl font-black text-slate-900 mb-2">{log.task_title}</h4>
              <p className="text-[10px] font-black text-blue-600 uppercase">Concluído por {log.user_name}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  ) : activeTab === 'COMUNICADOS' ? (
    /* NOVA ABA DE COMUNICADOS */
    <div className="mt-8 space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <h2 className="text-3xl font-black uppercase italic tracking-tighter flex items-center gap-2">
          <Activity className="text-red-600 animate-pulse" /> Mural de Alertas
        </h2>
        {userRole === 'admin' && (
          <span className="text-[9px] font-black bg-red-100 text-red-600 px-4 py-2 rounded-full border-2 border-red-200">
            MODO ADMIN SUPREMO 👑
          </span>
        )}
      </div>

      {userRole === 'admin' && (
        <div className="bg-white p-8 rounded-[40px] border-4 border-slate-900 shadow-[15px_15px_0px_0px_rgba(15,23,42,1)] space-y-4">
          <input 
            className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-slate-900 outline-none focus:border-red-500"
            placeholder="TÍTULO DO ALERTA"
            value={annTitle}
            onChange={e => setAnnTitle(e.target.value)}
          />
          <textarea 
            className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-slate-700 outline-none focus:border-red-500 min-h-[100px]"
            placeholder="MENSAGEM PARA A EQUIPE..."
            value={annContent}
            onChange={e => setAnnContent(e.target.value)}
          />
          <button 
            onClick={addAnnouncement}
            className="w-full bg-red-600 text-white p-5 rounded-3xl font-black uppercase tracking-widest hover:bg-slate-900 transition-all flex items-center justify-center gap-3"
          >
            Transmitir Alerta
          </button>
        </div>
      )}

      <div className="space-y-6">
        {announcements.map((ann) => (
          <div key={ann.id} className="bg-white border-4 border-slate-900 rounded-[40px] p-8 shadow-[10px_10px_0px_0px_rgba(248,113,113,1)] relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-2 h-full bg-red-600"></div>
            <div className="flex justify-between items-start mb-4">
              <div>
                <p className="text-[10px] font-black text-red-600 uppercase tracking-widest mb-1 flex items-center gap-2">
                  <AlertCircle size={12}/> ALERTA OFICIAL
                </p>
                <h4 className="text-2xl font-black text-slate-900 leading-none">{ann.title}</h4>
              </div>
              <span className="text-[9px] font-black text-slate-400 uppercase">
                {new Date(ann.created_at).toLocaleDateString('pt-BR')}
              </span>
            </div>
            <div className="bg-slate-50 p-6 rounded-3xl border-2 border-slate-100 text-slate-700 font-bold leading-relaxed whitespace-pre-wrap">
              {ann.content}
            </div>
            <div className="mt-6 flex justify-between items-center">
              <p className="text-[9px] font-black text-slate-400 uppercase">
                Transmitido por: <span className="text-slate-900">{ann.profiles?.full_name || 'Admin'}</span>
              </p>
              {userRole === 'admin' && (
                <button 
                  onClick={async () => { if(confirm('Remover alerta?')) { await supabase.from('announcements').delete().eq('id', ann.id); fetchAnnouncements(); }}}
                  className="text-red-400 hover:text-red-600 transition-colors"
                >
                  <Trash2 size={18}/>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  ) : (
    /* ABA PADRÃO DE TAREFAS */
    <>
      <div className="max-w-4xl mx-auto mt-8 mb-6 px-4">
        <button onClick={() => setShowCreateBox(!showCreateBox)} className={`w-full py-5 rounded-[32px] font-black uppercase tracking-[0.2em] text-[11px] transition-all duration-500 flex items-center justify-center gap-3 border-4 ${showCreateBox ? 'bg-slate-100 border-slate-200 text-slate-400' : 'bg-white border-slate-900 text-slate-900 shadow-[10px_10px_0px_0px_rgba(15,23,42,1)] hover:translate-x-1 hover:translate-y-1'}`}>
          {showCreateBox ? <><X size={20} /> Cancelar Operação</> : <><Plus size={20} strokeWidth={3} className="text-blue-600" /> Lançar Nova Missão</>}
        </button>
      </div>

      {showCreateBox && (
        <div className="max-w-4xl mx-auto bg-white p-8 rounded-[32px] border border-slate-200 shadow-[0_20px_50px_rgba(0,0,0,0.05)] mb-12 mt-4 relative overflow-hidden animate-in slide-in-from-top-4 duration-500">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-500 to-indigo-600 opacity-60"></div>
          <div className="flex flex-col gap-6">
            <input className="w-full text-3xl font-black outline-none placeholder-slate-300 text-slate-900 bg-transparent border-b-2 border-slate-100 focus:border-blue-500 transition-all pb-3 uppercase" placeholder="O QUE VAMOS CONSTRUIR?" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} />
            <textarea className="w-full p-4 bg-slate-50 rounded-2xl font-medium text-slate-700 border border-slate-100 outline-none focus:border-blue-300 focus:bg-white transition-all min-h-[80px] resize-none" placeholder="Coordenadas da tarefa..." value={notes} onChange={e => setNotes(e.target.value)} />
            <div className="space-y-3 bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-2"><ListChecks size={14} className="text-blue-500"/> Checklist de Passos</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {tempSubtasks.map((sub, index) => (
                  <div key={index} className="flex items-center gap-2 bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
                    <input className="flex-1 text-xs font-bold text-slate-600 outline-none" value={sub.title} onChange={(e) => { const newSubs = [...tempSubtasks]; newSubs[index].title = e.target.value; setTempSubtasks(newSubs); }} placeholder="Nome do passo..." />
                    <button onClick={() => setTempSubtasks(tempSubtasks.filter((_, i) => i !== index))} className="text-red-400 p-1"><X size={14}/></button>
                  </div>
                ))}
                <button onClick={() => setTempSubtasks([...tempSubtasks, { title: '', done: false }])} className="flex items-center justify-center gap-2 p-2 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 font-black text-[10px] hover:border-blue-400 transition-all uppercase"><Plus size={14}/> Adicionar Passo</button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch">
              <div className="md:col-span-4 space-y-4">
  {/* SELETOR DE MODO: SEMANAL OU MENSAL */}
  <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200">
    <button 
      type="button"
      onClick={() => setSelectedDays([])}
      className={`flex-1 py-2 rounded-xl font-black text-[10px] uppercase transition-all ${selectedDays.length === 0 || isNaN(parseInt(selectedDays[0])) ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}
    >
      Semanal
    </button>
    <button 
      type="button"
      onClick={() => setSelectedDays(['1'])}
      className={`flex-1 py-2 rounded-xl font-black text-[10px] uppercase transition-all ${!isNaN(parseInt(selectedDays[0])) ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}
    >
      Mensal
    </button>
  </div>

  {/* LÓGICA DINÂMICA: MENSAL OU SEMANAL */}
  {!isNaN(parseInt(selectedDays[0])) ? (
  // --- BLOCO MENSAL COM ACIONAMENTO FORÇADO ---
  <div className="space-y-2">
    <label className="text-[9px] font-black uppercase text-slate-400 ml-2 italic">Data de Início da Recorrência</label>
    
    <div 
      className="relative h-[60px] group cursor-pointer"
      // Quando clicar em qualquer lugar da div, força o calendário a abrir
      onClick={() => dateInputRef.current?.showPicker()}
    >
      {/* Camada Visual (O que você vê) */}
      <div className="absolute inset-0 flex items-center justify-center bg-slate-50 rounded-xl border-2 border-slate-200 font-black text-slate-700 text-xl pointer-events-none group-hover:border-blue-500 transition-all uppercase">
        {displayDate}
        <Calendar size={20} className="absolute right-4 text-blue-500" />
      </div>

      {/* Input Real (Escondido mas funcional) */}
      <input 
        ref={dateInputRef} // Conecta com a nossa referência
        type="date" 
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        onChange={e => {
          const dateVal = e.target.value;
          if(dateVal) {
            const [y, m, d] = dateVal.split('-');
            const formatted = `${d}/${m}/${y}`;
            setDisplayDate(formatted);
            setSelectedDays([d]);
          }
        }}
      />
    </div>
    
    <p className="text-[8px] font-bold text-blue-500 text-center mt-1 uppercase tracking-tighter">
      {displayDate !== 'DD/MM/YYYY' ? `TODO DIA ${selectedDays[0]} DE CADA MÊS` : 'CLIQUE NA CAIXA PARA ABRIR O CALENDÁRIO'}
    </p>
  </div>
) : (
    // --- BLOCO MODO SEMANAL ---
    <div className="flex gap-1.5 bg-slate-50 p-1.5 rounded-xl border border-slate-100">
      {weekDays.map(day => (
        <button 
          key={day.id} 
          type="button" 
          onClick={() => toggleDay(day.id)} 
          className={`flex-1 h-9 rounded-lg font-black text-xs transition-all ${selectedDays.includes(day.id) ? 'bg-blue-600 text-white shadow-lg scale-105' : 'text-slate-400 hover:bg-slate-200/50'}`}
        >
          {day.label}
        </button>
      ))}
    </div>
  )}

  {/* CAMPO DE INTERVALO */}
  <div className="space-y-2">
    <label className="text-[9px] font-black uppercase text-slate-400 ml-2">
      Repetir a cada quanto(s) {!isNaN(parseInt(selectedDays[0])) ? 'mês/meses' : 'semana(s)'}?
    </label>
    <input 
      type="number" 
      min="1" 
      className="w-full p-3.5 bg-slate-50 rounded-xl font-black border border-slate-200 text-slate-700 outline-none focus:border-blue-500 text-center" 
      value={repeatInterval} 
      onChange={e => setRepeatInterval(parseInt(e.target.value) || 1)} 
    />
  </div>
</div>
              <div className="md:col-span-4 flex"><button onClick={addTask} className="w-full py-6 md:py-10 bg-blue-600 hover:bg-[#0F172A] text-white rounded-[32px] font-black uppercase tracking-widest transition-all duration-500 flex flex-row md:flex-col items-center justify-center gap-3 shadow-[0_10px_30px_rgba(37,99,235,0.3)] active:scale-95 group"><Plus size={32} strokeWidth={3} /><span className="text-sm">Lançar Missão</span></button></div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        <h2 className="font-black uppercase text-slate-400 text-[10px] tracking-[0.3em] px-2 flex items-center gap-2"><ChevronRight size={14} className="text-blue-600" /> {activeTab} • {filteredTasks.length} TAREFAS</h2>
        {/* Localize este bloco no seu App.tsx */}
{filteredTasks.map(task => (
  <TaskItem 
    key={task.id} 
    task={task} 
    profiles={profiles} 
    userRole={userRole} 
    currentUser={user} 
    onToggle={toggleComplete} 
    onView={setViewingTask} 
    onEdit={(t: any) => { 
  setEditingTask(t); 
  const isMonthly = t.repeat_days && !t.repeat_days.includes(',') && !isNaN(parseInt(t.repeat_days));
  setEditMode(isMonthly ? 'mensal' : 'semanal');
  
  // Se for mensal, mostra o dia atual na legenda, senão reseta para o padrão
  setEditDisplayDate(isMonthly ? `DIA ${t.repeat_days} (MANTIDO)` : 'DD/MM/YYYY');
  
  setShowEditModal(true); 
}}
    onUpdate={fetchTasks} // <--- VOLTE PARA fetchTasks (para atualizar subtarefas)
    onDelete={deleteTask} // <--- ADICIONE ESTA NOVA PROPRIEDADE
  />
))}
      </div>
    </>
  )}
</main>

      {/* --- MODALS --- */}
      
      {/* 1. Modal de Perfil */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white p-10 rounded-[40px] w-full max-w-sm border-4 border-slate-900 shadow-2xl text-center">
            <h2 className="text-2xl font-black uppercase mb-6 tracking-tighter">Meu Perfil</h2>
            <input className="w-full p-4 border-4 border-slate-100 rounded-2xl font-black mb-6 text-slate-900 outline-none focus:border-blue-500 transition-all" placeholder="Nome Completo" value={newName} onChange={e => setNewName(e.target.value)} />
            <button onClick={updateProfile} className="w-full bg-blue-600 text-white p-5 rounded-3xl font-black uppercase text-lg shadow-lg hover:bg-slate-900 transition-all">Salvar Dados</button>
            <button onClick={() => setShowProfileModal(false)} className="w-full mt-4 text-slate-400 font-bold uppercase text-[10px] tracking-widest">Fechar</button>
          </div>
        </div>
      )}

      {/* 2. Modal de Edição */}
      {showEditModal && editingTask && (
        <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in zoom-in-95">
          <div className="bg-white p-10 rounded-[48px] w-full max-w-2xl border-4 border-slate-900 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center mb-8 text-slate-900"><h2 className="text-3xl font-black uppercase tracking-tighter italic">Editar Missão</h2><button onClick={() => setShowEditModal(false)}><X size={40}/></button></div>
            <div className="space-y-6">
              <input className="w-full p-6 border-4 border-slate-100 rounded-3xl font-black text-slate-900 text-2xl uppercase" value={editingTask.title} onChange={e => setEditingTask({...editingTask, title: e.target.value})} />
              <textarea className="w-full p-6 bg-slate-50 border-2 border-slate-100 rounded-3xl font-bold text-slate-800 text-lg" rows={3} value={editingTask.notes || ''} onChange={e => setEditingTask({...editingTask, notes: e.target.value})} />
              <div className="space-y-4 border-t border-slate-100 pt-6">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-1 tracking-widest flex items-center gap-2"><ListChecks size={14} className="text-blue-500"/> Subtarefas / Checklist</label>
                <div className="space-y-2">
                  {(editingTask.subtasks || []).map((sub: any, index: number) => (
                    <div key={index} className="flex items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                      <input type="checkbox" checked={sub.done} onChange={(e) => { const newSubs = [...editingTask.subtasks]; newSubs[index].done = e.target.checked; setEditingTask({...editingTask, subtasks: newSubs}); }} className="w-5 h-5 accent-blue-600" />
                      <input className="flex-1 bg-transparent font-bold text-slate-700 outline-none" value={sub.title} onChange={(e) => { const newSubs = [...editingTask.subtasks]; newSubs[index].title = e.target.value; setEditingTask({...editingTask, subtasks: newSubs}); }} />
                      <button onClick={() => { const newSubs = editingTask.subtasks.filter((_:any, i:number) => i !== index); setEditingTask({...editingTask, subtasks: newSubs}); }} className="text-red-400"><X size={16}/></button>
                    </div>
                  ))}
                  <button onClick={() => { const newSubs = [...(editingTask.subtasks || []), { title: '', done: false }]; setEditingTask({...editingTask, subtasks: newSubs}); }} className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 font-bold text-xs hover:border-blue-500 hover:text-blue-500 transition-all">+ ADICIONAR PASSO</button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-slate-100">
                <select className="p-4 bg-slate-100 rounded-2xl font-black border-2 border-slate-200" value={editingTask.assigned_to} onChange={e => setEditingTask({...editingTask, assigned_to: e.target.value})}>{profiles.map(p => <option key={p.id} value={p.id}>{p.full_name || p.id.slice(0,5)}</option>)}</select>
                <select className="p-4 bg-slate-100 rounded-2xl font-black border-2 border-slate-200" value={editingTask.category} onChange={e => setEditingTask({...editingTask, category: e.target.value})}><option>Trade</option><option>Reunião</option><option>Geral</option></select>
              </div>
              {/* --- SELETOR DE RECORRÊNCIA NO MODAL DE EDIÇÃO --- */}
<div className="space-y-4 pt-6 border-t border-slate-100">
  <label className="text-[10px] font-black uppercase text-slate-400 ml-1 tracking-widest flex items-center gap-2">
    Configuração de Repetição
  </label>
  
  {/* Alternador Semanal / Mensal */}
  <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200">
    <button 
      type="button"
      onClick={() => {
        setEditMode('semanal');
        setEditingTask({...editingTask, repeat_days: ''});
      }}
      className={`flex-1 py-2 rounded-xl font-black text-[10px] uppercase transition-all ${editMode === 'semanal' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}
    >
      Semanal
    </button>
    <button 
      type="button"
      onClick={() => {
        setEditMode('mensal');
        setEditingTask({...editingTask, repeat_days: '1'});
      }}
      className={`flex-1 py-2 rounded-xl font-black text-[10px] uppercase transition-all ${editMode === 'mensal' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}
    >
      Mensal
    </button>
  </div>

  {/* Interface de Edição Dinâmica */}
  {editMode === 'mensal' ? (
    // --- NOVO BLOCO MENSAL COM CALENDÁRIO ---
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-[9px] font-black uppercase text-slate-400 ml-2 italic text-center block">Nova Data de Referência</label>
        <div 
          className="relative h-[60px] group cursor-pointer"
          onClick={() => editDateInputRef.current?.showPicker()}
        >
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 rounded-3xl border-2 border-slate-100 font-black text-slate-700 text-xl pointer-events-none group-hover:border-blue-500 transition-all uppercase">
            {editDisplayDate}
            <Calendar size={20} className="absolute right-6 text-blue-500" />
          </div>
          <input 
  ref={editDateInputRef}
  type="date" 
  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
  onChange={e => {
    const dateVal = e.target.value; // Formato yyyy-mm-dd
    if (dateVal) {
      const parts = dateVal.split('-');
      const day = parts[2];
      const month = parts[1];
      const year = parts[0];
      
      // Atualiza o texto visual IMEDIATAMENTE
      setEditDisplayDate(`${day}/${month}/${year}`);
      
      // Atualiza o objeto da tarefa IMEDIATAMENTE
      setEditingTask((prev: any) => ({
        ...prev,
        repeat_days: day // Garante que pegamos o dia novo
      }));
      
      console.log("Nova data selecionada:", day);
    }
  }}
/>
        </div>
      </div>
      <div className="bg-slate-50 p-4 rounded-3xl border-2 border-slate-100 text-center">
        <label className="text-[9px] font-black uppercase text-slate-400 block mb-1 italic">Repetir a cada (meses)</label>
        <input 
          type="number" 
          min="1"
          className="w-full bg-transparent font-black text-2xl text-slate-700 outline-none text-center"
          value={editingTask.repeat_interval}
          onChange={e => setEditingTask({...editingTask, repeat_interval: parseInt(e.target.value) || 1})}
        />
      </div>
    </div>
  ) : (
    // --- BLOCO SEMANAL (O seu original) ---
    <div className="space-y-4">
      <div className="flex gap-2 justify-center">
        {weekDays.map(day => (
          <button 
            key={day.id} 
            type="button" 
            onClick={() => toggleDayInEdit(day.id)} 
            className={`w-12 h-12 rounded-2xl font-black border-4 transition-all ${editingTask.repeat_days?.split(',').includes(day.id) ? 'bg-blue-600 border-blue-600 text-white scale-110 shadow-lg' : 'bg-white border-slate-200 text-slate-400'}`}
          >
            {day.label}
          </button>
        ))}
      </div>
      <div className="bg-slate-50 p-4 rounded-3xl border-2 border-slate-100">
        <label className="text-[9px] font-black uppercase text-slate-400 block mb-1 text-center italic">Intervalo de Semanas</label>
        <input 
          type="number" 
          min="1"
          className="w-full bg-transparent font-black text-2xl text-slate-700 outline-none text-center"
          value={editingTask.repeat_interval}
          onChange={e => setEditingTask({...editingTask, repeat_interval: parseInt(e.target.value) || 1})}
        />
      </div>
    </div>
  )}
</div>
              <button onClick={updateTask} className="w-full bg-blue-600 text-white p-6 rounded-[32px] font-black uppercase text-xl shadow-xl hover:bg-[#0F172A] transition-all flex items-center justify-center gap-3 mt-4"><Check size={32}/> Atualizar Missão</button>
            </div>
          </div>
        </div>
      )}

      {/* 3. BARRA LATERAL (SIDEBAR) */}
      <div className={`fixed top-0 right-0 h-full bg-white w-full md:w-[450px] border-l-4 border-slate-900 z-50 shadow-[-20px_0px_60px_rgba(0,0,0,0.1)] transition-transform duration-500 transform ${viewingTask ? 'translate-x-0' : 'translate-x-full'}`}>
        {viewingTask && (
          <div className="flex flex-col h-full">
            <div className={`p-8 border-b-4 border-slate-900 ${viewingTask.last_done_date ? 'bg-green-500' : 'bg-blue-600'} text-white`}>
              <div className="flex justify-between items-start mb-6">
                <span className="bg-black/20 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest">{viewingTask.category}</span>
                <button onClick={() => setViewingTask(null)} className="hover:scale-110 transition-transform"><X size={32} strokeWidth={3}/></button>
              </div>
              <h2 className="text-3xl font-black uppercase italic tracking-tighter leading-none">{viewingTask.title}</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-8 space-y-8">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3">Coordenadas da Missão</label>
                <div className="bg-slate-50 p-6 rounded-3xl border-2 border-slate-100 text-slate-700 font-bold leading-relaxed whitespace-pre-wrap text-sm">{viewingTask.notes || "Sem observações detalhadas."}</div>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-4 text-center">Status do Checklist</label>
                <div className="space-y-2">
                  {(viewingTask.subtasks || []).map((sub: any, i: number) => (
                    <div key={i} className={`flex items-center gap-3 p-4 rounded-2xl border-2 ${sub.done ? 'bg-green-50 border-green-200 text-green-700' : 'bg-slate-50 border-slate-100 text-slate-500'}`}>
                      {sub.done ? <CheckCircle2 size={18} /> : <div className="w-4 h-4 rounded-full border-2 border-slate-300" />}
                      <span className="text-xs font-black uppercase">{sub.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-8 border-t-4 border-slate-900 bg-slate-50">
              {(userRole === 'admin' || userRole === 'gerente' || viewingTask.assigned_to === user.id) ? (
                <button onClick={() => { setEditingTask(viewingTask); setShowEditModal(true); setViewingTask(null); }} className="w-full bg-slate-900 text-white p-5 rounded-2xl font-black uppercase tracking-widest hover:bg-blue-600 transition-all flex items-center justify-center gap-3"><Edit3 size={20} /> Editar Missão</button>
              ) : ( <p className="text-center text-[10px] font-black text-slate-400 uppercase">Visualização restrita</p> )}
            </div>
          </div>
        )}
      </div>

      {/* 4. MODAL DE CONFIGURAÇÕES (FORA DA SIDEBAR) */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-slate-900/95 z-[60] flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in">
          <div className="bg-white w-full max-w-2xl rounded-[48px] border-4 border-slate-900 shadow-[20px_20px_0px_0px_rgba(37,99,235,1)] flex flex-col max-h-[90vh] overflow-hidden">
            <div className="p-8 border-b-4 border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h2 className="text-3xl font-black uppercase italic tracking-tighter text-slate-900">Configurações</h2>
                <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Painel de Controle</p>
              </div>
              <button onClick={() => setShowSettingsModal(false)}><X size={32} strokeWidth={3} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-8 space-y-10">
              {userRole === 'admin' ? (
                <div className="space-y-6">
                  <div className="flex items-center gap-2"><User size={20} className="text-blue-600"/><h3 className="font-black uppercase text-sm tracking-widest text-slate-900">Gestão de Tropa</h3></div>
                  <div className="space-y-3">
                    {profiles.map((profile) => (
                      <div key={profile.id} className="flex flex-col md:flex-row md:items-center justify-between p-4 bg-slate-50 rounded-3xl border-2 border-slate-100 gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-slate-900 text-white rounded-2xl flex items-center justify-center font-black text-xs">{profile.full_name?.charAt(0)}</div>
                          <div><p className="font-black text-slate-900 text-sm leading-tight">{profile.full_name || 'Sem Nome'}</p><p className="text-[9px] font-bold text-slate-400 uppercase">{profile.role || 'membro'}</p></div>
                        </div>
                        <div className="flex gap-1.5">
                          {['membro', 'gerente', 'admin'].map((role) => (
                            <button key={role} onClick={() => changeRole(profile.id, role)} className={`px-3 py-1.5 rounded-xl font-black text-[9px] uppercase border-2 transition-all ${profile.role === role ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-400'}`}>{role}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : ( <div className="p-8 bg-blue-50 rounded-[32px] text-center text-xs font-black text-blue-900 uppercase">Gestão restrita ao Admin</div> )}
              <div className="space-y-6 pt-6 border-t-2 border-slate-100">
                <button onClick={async () => { await supabase.auth.signOut(); window.location.reload(); }} className="w-full flex items-center justify-between p-6 bg-red-50 hover:bg-red-100 border-2 border-red-100 rounded-3xl transition-all">
                  <div className="flex items-center gap-4"><div className="p-3 bg-white rounded-2xl text-red-600 border-2 border-red-50"><LogOut size={24} /></div><div className="text-left"><p className="font-black text-red-600 uppercase text-sm">Sair do Sistema</p></div></div>
                  <ChevronRight className="text-red-300" />
                </button>
              </div>
            </div>
            <div className="p-6 bg-slate-50 border-t-4 border-slate-100 text-center"><p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.4em]">WALLY Task Builder • v2.0</p></div>
          </div>
        </div>
      )}

    </div> // Fim do div principal
  );
} // Fim do export default

// 1. Substitua todo o bloco da TaskBox por este:
const TaskItem = memo(({ task, profiles, onUpdate, onEdit, userRole, currentUser, onView, onToggle, onDelete }: any) => {
  const [expanded, setExpanded] = useState(false);
  
  // Usamos as permissões pré-calculadas
  const isOwner = task.assigned_to === currentUser?.id;
  const canManage = userRole === 'admin' || userRole === 'gerente' || isOwner;

  const subtasks = task.subtasks || [];
  const subDone = subtasks.filter((s: any) => s.done).length;
  const subTotal = subtasks.length;

  // Função interna de subtarefas preservada e otimizada
  const toggleSubtask = async (index: number) => {
    if (!canManage) return alert("Acesso negado.");
    if (!currentUser?.id) {
      console.error("Usuário não identificado");
      return;
    }

    const newSubtasks = [...subtasks];
    newSubtasks[index].done = !newSubtasks[index].done;

    const allDone = newSubtasks.length > 0 && newSubtasks.every((s: any) => s.done);
    const todayStr = getTodayStr();

    if (allDone && !task.isDoneToday) {
      const profile = profiles.find((p: any) => p.id === currentUser.id);
      await supabase.from('task_history').insert([{
        task_id: task.id,
        task_title: task.title,
        user_name: profile?.full_name || currentUser.email || 'Usuário',
        user_id: currentUser.id,
        category: task.category
      }]);
    }

    await supabase.from('tasks').update({
      subtasks: newSubtasks,
      last_done_date: allDone ? todayStr : null,
      status: allDone ? 'concluido' : 'pendente'
    }).eq('id', task.id);
    
    onUpdate(); // Atualiza a lista geral
  };

  return (
    // Dentro do return do TaskItem, verifique se a primeira linha está assim:
<div className={`p-6 rounded-[32px] border-[4px] transition-all duration-300 flex flex-col gap-4 relative group 
  ${task.isDoneToday ? 'bg-green-50 border-green-600 shadow-[8px_8px_0px_0px_rgba(22,101,52,1)] opacity-90' : 
    (task.lastOcc < getTodayStr() && !task.isDoneToday && task.lastOcc !== '1970-01-01') ? 'bg-red-50 border-red-600 shadow-[8px_8px_0px_0px_rgba(153,27,27,1)]' : 
    'bg-white border-slate-900 shadow-[8px_8px_0px_0px_rgba(15,23,42,1)] hover:translate-x-2'
  }`}
>
      <div className="flex items-center gap-5">
        <button 
          onClick={() => canManage ? onToggle(task) : alert("Acesso negado.")}  
          className={`w-16 h-16 rounded-[22px] border-4 flex items-center justify-center transition-all flex-shrink-0 shadow-sm
            ${!canManage ? 'opacity-30 grayscale cursor-not-allowed' : ''}
            ${task.isDoneToday ? 'bg-green-600 border-green-700 text-white' : 'bg-white border-slate-200 text-transparent hover:border-blue-500'}`}
        >
          <CheckCircle2 size={40} strokeWidth={3} />
</button>

        {/* CONTEÚDO CENTRAL */}
<div className="flex-1 min-w-0">
  {/* ÁREA INTERATIVA DO TÍTULO E NOTAS */}
  <div 
    className="inline-block cursor-pointer group/title select-none"
    onClick={() => onView(task)}
  >
    {/* Título com mudança de cor no hover */}
    <h3 className={`text-2xl font-black leading-tight truncate transition-all duration-200 
      ${task.isDoneToday 
        ? 'line-through text-green-900/40' 
        : 'text-slate-900 group-hover/title:text-blue-600 group-hover/title:translate-x-1'}
    `}>
      {task.title}
    </h3>
    
    {/* Notas com mudança de opacidade no hover */}
    {task.notes && (
      <p className={`text-[11px] font-bold mt-0.5 line-clamp-1 italic transition-colors
        ${task.isDoneToday 
          ? 'text-green-700/30' 
          : 'text-slate-400 group-hover/title:text-slate-600'}
      `}>
        {task.notes}
      </p>
    )}
  </div>

  {/* BOTÃO DE PASSOS (Fora da área de clique do título) */}
  {subTotal > 0 && (
    <div className="flex items-center gap-3 mt-3">
      <div className="flex-1 bg-slate-100 h-2 rounded-full overflow-hidden border border-slate-200">
        <div className="bg-blue-500 h-full transition-all duration-500" style={{ width: `${(subDone / subTotal) * 100}%` }} />
      </div>
      <button 
        onClick={(e) => {
          e.stopPropagation(); // Garante que não abra a sidebar ao expandir passos
          setExpanded(!expanded);
        }}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border-2 transition-all font-black text-[10px] uppercase
          ${expanded ? 'bg-slate-900 border-slate-900 text-white shadow-md' : 'bg-white border-slate-200 text-slate-500 hover:border-blue-500'}`}
      >
        {subDone}/{subTotal} PASSOS
        {expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
      </button>
    </div>
  )}
</div>

        <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {canManage && (
            <>
              <button onClick={() => onEdit(task)} className="text-slate-300 hover:text-blue-600 p-2"><Edit3 size={24}/></button>
<button 
  onClick={(e) => { 
    e.stopPropagation(); 
    onDelete(task.id);
  }} 
  className="text-slate-200 hover:text-red-600 p-2 transition-all"
>
  <Trash2 size={24}/>
</button>
            </>
          )}
        </div>
      </div>

      {expanded && subTotal > 0 && (
        <div className="mt-2 space-y-2 border-t-4 border-slate-100 pt-4 animate-in slide-in-from-top-2">
          {subtasks.map((sub: any, index: number) => (
            <div 
              key={index} 
              onClick={() => toggleSubtask(index)}
              className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all cursor-pointer
                ${!canManage ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-200'}
                ${sub.done ? 'bg-green-100/50 border-green-200 text-green-700 opacity-70' : 'bg-slate-50 border-slate-100 text-slate-700'}
              `}
            >
              <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center
                ${sub.done ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-slate-300 text-transparent'}`}>
                <Check size={14} strokeWidth={4} />
              </div>
               <span className={`text-xs font-black uppercase ${sub.done ? 'line-through' : ''}`}>{sub.title}</span>
            </div>
          ))}
        </div>
      )}

      {/* TAGS INFERIORES */}
<div className="flex flex-wrap gap-2 mt-2 font-black text-[9px] uppercase tracking-widest">
  {/* Tag do Responsável */}
  <span className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 bg-[#0F172A] text-white border-2 border-slate-800 shadow-sm">
    <User size={10}/> {profiles.find((p: any) => p.id === task.assigned_to)?.full_name || 'Alocado'}
  </span>

  {/* NOVA TAG: Classificação / Categoria */}
  <span className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 border-2 border-blue-100 bg-blue-50 text-blue-600 shadow-sm">
    <Activity size={10}/> {task.category}
  </span>

  {/* Substitua a parte das Tags de Data no TaskItem por esta: */}
{task.isDoneToday ? (
  <span className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 border-2 border-green-200 bg-green-100 text-green-700 shadow-sm">
    <Check size={10}/> CONCLUÍDO
  </span>
) : (task.lastOcc !== '1970-01-01' && task.lastOcc < getTodayStr()) ? (
  <span className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 border-2 border-red-600 bg-red-600 text-white animate-pulse shadow-sm">
    <AlertCircle size={10}/> ATRASADO: {formatToBR(task.lastOcc)}
  </span>
) : (
  <span className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 border-2 border-slate-200 bg-white text-slate-600 shadow-sm">
    <Calendar size={10}/> PRÓXIMA: {task.nextOcc}
  </span>
)}
</div>
    </div>
  );
});

TaskItem.displayName = 'TaskItem';

function DashboardCard({ label, val, color }: any) {
  return (<div className={`p-8 rounded-[40px] border-4 shadow-[10px_10px_0px_0px_rgba(15,23,42,1)] text-center transition-transform hover:scale-105 ${color}`}><span className="text-[10px] font-black uppercase tracking-[0.2em] block mb-2 opacity-40">{label}</span><span className="text-6xl font-black tracking-tighter">{val}</span></div>)
}

function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [isSignUp, setIsSignUp] = useState(false)
  const processAuth = async () => {
    const { error } = isSignUp ? await supabase.auth.signUp({ email, password, options: { data: { full_name: email.split('@')[0] } } }) : await supabase.auth.signInWithPassword({ email, password })
    if (error) alert(error.message); else window.location.reload()
  }
  return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-4 text-center font-sans">
      <div className="bg-white p-12 rounded-[60px] w-full max-w-sm border-b-[24px] border-blue-600 shadow-2xl">
        {/* SUBSTITUA O BLOCO DO ÍCONE POR ESTE: */}
        <div className="mb-8 flex justify-center">
          <img 
            src="/icon.png" 
            alt="Wally Logo" 
            className="w-20 h-20 rounded-[24px] shadow-[0_0_30px_rgba(37,99,235,0.3)] rotate-3 hover:rotate-0 transition-transform duration-500" 
          />
        </div>
        <h1 className="text-6xl font-black italic uppercase tracking-tighter text-slate-900 leading-none">
          WALLY<br/>
          <span className="text-blue-600 text-3xl not-italic tracking-[0.2em] font-medium opacity-80 uppercase">Task Builder</span>
        </h1>
        <div className="space-y-4 mt-12">
          <input className="w-full p-6 bg-slate-50 border-4 border-slate-100 rounded-[28px] font-black text-slate-900 outline-none focus:border-blue-500 transition-all placeholder-slate-300" placeholder="E-MAIL" onChange={e => setEmail(e.target.value)} />
          <input className="w-full p-6 bg-slate-50 border-4 border-slate-100 rounded-[28px] font-black text-slate-900 outline-none focus:border-blue-500 transition-all" type="password" placeholder="SENHA" onChange={e => setPassword(e.target.value)} />
          <button onClick={processAuth} className="w-full bg-[#0F172A] text-white p-6 rounded-[28px] font-black uppercase text-xl hover:bg-blue-600 transition-all shadow-xl mt-4">Acessar Centro</button>
          <button onClick={() => setIsSignUp(!isSignUp)} className="w-full text-[10px] font-black text-slate-400 uppercase tracking-widest text-center mt-6">{isSignUp ? 'Já sou da equipe' : 'Solicitar conta'}</button>
        </div>
      </div>
    </div>
  )
}