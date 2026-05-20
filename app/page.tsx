'use client'
import { useEffect, useState, useMemo, memo, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { 
  Plus, Trash2, CheckCircle2, LayoutDashboard, 
  LogOut, Calendar, User, X, Check, AlertCircle, TrendingUp,
  Edit3, ChevronRight, Activity, ListChecks, ChevronDown, ChevronUp, FileText, Megaphone, Settings, Search, Users, History, Filter, ChevronsDown
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
  sector: string;
  // Campos que vamos calcular e "pendurar" no objeto para performance:
  lastOcc?: string; 
  nextOcc?: string;
  isDoneToday?: boolean;
}

interface Profile {
  id: string;
  full_name: string;
  role: 'admin' | 'gerente' | 'membro';
  sector: string;
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
  const navCategories = [
  { id: 'HOJE', label: 'Hoje', icon: Calendar },
  { id: 'ATRASADOS', label: 'Atrasados', icon: AlertCircle },
  { id: 'Minhas', label: 'Minhas', icon: User },
  { id: 'Todas', label: 'Todas', icon: ListChecks },
  { id: 'Trade', label: 'Trade', icon: TrendingUp },
  { id: 'Reunião', label: 'Reunião', icon: Users },
  { id: 'HISTÓRICO', label: 'Histórico', icon: History },
  { id: 'DASHBOARD', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'COMUNICADOS', label: 'Alertas', icon: Megaphone },
];
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
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [userSector, setUserSector] = useState('Geral');
  const [showAssignMenu, setShowAssignMenu] = useState(false);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [annImage, setAnnImage] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // TRAVA DE SCROLL: Impede a rolagem do fundo quando modais estão abertos
useEffect(() => {
  // Verificamos se qualquer um dos seus modais está aberto
  const isAnyModalOpen = showCreateBox || showSettingsModal || showProfileModal || showEditModal;

  if (isAnyModalOpen) {
    // Trava o scroll no corpo da página
    document.body.style.overflow = 'hidden';
  } else {
    // Libera o scroll quando tudo fechar
    document.body.style.overflow = 'unset';
  }

  // Limpeza de segurança (caso o componente feche inesperadamente)
  return () => {
    document.body.style.overflow = 'unset';
  };
}, [showCreateBox, showSettingsModal, showProfileModal, showEditModal]);

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
      
      // Procure a parte que faz o select no profiles e mude para:
supabase.from('profiles').select('role, full_name, sector').eq('id', session.user.id).single()
  .then(({ data }) => {
    if (data) { 
      setUserRole(data.role || 'membro'); 
      setNewName(data.full_name || '');
      setUserSector(data.sector || 'Geral'); // <--- ADICIONE ESTA LINHA
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
  if (!annTitle || !annContent) return;
  setUploading(true);

  let publicUrl = null;

  // 1. Lógica de Upload da Imagem (se houver)
  if (annImage) {
    const fileExt = annImage.name.split('.').pop();
    const fileName = `${Math.random()}.${fileExt}`;
    const filePath = `alerts/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('announcement-images')
      .upload(filePath, annImage);

    if (!uploadError) {
      const { data } = supabase.storage.from('announcement-images').getPublicUrl(filePath);
      publicUrl = data.publicUrl;
    }
  }

  // 2. Inserção no Banco
  const { error } = await supabase.from('announcements').insert([
    { 
      title: annTitle.toUpperCase(), 
      content: annContent, 
      created_by: user.id,
      sector: userSector,
      image_url: publicUrl // Salva o link da foto
    }
  ]);

  if (!error) {
    setAnnTitle(''); setAnnContent(''); setAnnImage(null);
    fetchAnnouncements();
    alert("Alerta transmitido!");
  }
  setUploading(false);
}
  async function updateProfile() {
  if (!user?.id) return;

  // Tenta atualizar no banco
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: newName })
    .eq('id', user.id);

  if (error) {
    // Se o erro persistir, o alert vai mostrar a mensagem do banco
    alert("Erro do Banco: " + error.message);
    console.error("Erro completo:", error);
  } else {
    alert("Perfil atualizado com sucesso!");
    setShowProfileModal(false);
    
    // Atualiza o estado local para o nome mudar na tela sem precisar de F5
    setProfiles((prev: Profile[]) => 
      prev.map(p => p.id === user.id ? { ...p, full_name: newName } : p)
    );
    
    fetchProfiles(); // Recarrega por segurança
  }
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
  if (!taskTitle) return;
  
  // Melhoria na detecção de recorrência (aceita mensal e semanal)
  const isRecurring = selectedDays.length > 0;

  const { error } = await supabase.from('tasks').insert([{ 
      title: taskTitle.toUpperCase(), 
      assigned_to: assignedTo, 
      status: 'pendente', 
      category, 
      notes, 
      repeat_days: selectedDays.join(','), 
      repeat_interval: repeatInterval, 
      subtasks: tempSubtasks,
      due_date: isRecurring ? null : getTodayStr(),
      sector: userSector 
  }]);

  if (!error) { 
    setTaskTitle('');
    setDisplayDate('DD/MM/YYYY'); 
    setNotes(''); 
    setSelectedDays([]); 
    setTempSubtasks([]); 
    setShowCreateBox(false); 
    fetchTasks(); 
  } else {
    alert("Erro ao lançar tarefa: " + error.message);
  }
}

  // 1. Localize e substitua a função toggleComplete dentro do App
  const toggleComplete = useCallback(async (task: Task) => {
  const todayStr = getTodayStr();
  const isCurrentlyDone = task.isDoneToday;
  const newDate = isCurrentlyDone ? null : todayStr;

  const updatedSubtasks = (task.subtasks || []).map((sub: any) => ({
    ...sub,
    done: !isCurrentlyDone
  }));

  // Optimistic Update
  setTasks(prevTasks => prevTasks.map(t => 
    t.id === task.id ? { ...t, last_done_date: newDate, subtasks: updatedSubtasks } : t
  ));

  if (!isCurrentlyDone) {
    const profile = profiles.find(p => p.id === user.id);
    await supabase.from('task_history').insert([{
      task_id: task.id,
      task_title: task.title,
      user_name: profile?.full_name || user.email,
      user_id: user.id,
      category: task.category,
      sector: task.sector // <--- REGISTRA O SETOR NO HISTÓRICO
    }]);
  }

  const { error } = await supabase.from('tasks').update({ 
    last_done_date: newDate, 
    status: newDate ? 'concluido' : 'pendente',
    subtasks: updatedSubtasks 
  }).eq('id', task.id);

  if (error) {
    alert("Erro ao salvar: " + error.message);
    fetchTasks();
  }
}, [user, profiles, userSector]); // Adicione userSector nas dependências

const deleteTask = useCallback(async (taskId: string) => {
  if (!confirm('Deseja realmente deletar esta tarefa?')) return;

  setTasks(prev => prev.filter(t => t.id !== taskId));
  const { error } = await supabase.from('tasks').delete().eq('id', taskId);

  if (error) {
    alert("Erro ao deletar: " + error.message);
    fetchTasks();
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
    alert("Tarefa atualizada com sucesso!");
  }
}

  const filteredTasks = useMemo(() => {
  return processedTasks.filter(task => {
    if (userRole !== 'admin' && task.sector !== userSector) {
      return false;
    }
    const term = searchTerm.toLowerCase();
    const matchesSearch = task.title.toLowerCase().includes(term) || (task.notes && task.notes.toLowerCase().includes(term));
    if (searchTerm && !matchesSearch) return false;

    const abasGlobais = ['Todas', 'HOJE', 'Trade', 'Reunião', 'ATRASADOS'];
    if (userRole === 'membro' && !abasGlobais.includes(activeTab) && task.assigned_to !== user?.id) return false;
    if (filterUser !== 'Todos' && task.assigned_to !== filterUser) return false;

    const todayStr = getTodayStr();
    if (activeTab === 'ATRASADOS') return !task.isDoneToday && task.lastOcc < todayStr;
    if (activeTab === 'HOJE') return task.lastOcc === todayStr && !task.isDoneToday;
    if (activeTab === 'Minhas') return task.assigned_to === user?.id;
    if (activeTab === 'Todas') return true;

    return task.category === activeTab;
  });
}, [processedTasks, activeTab, filterUser, userRole, userSector, user?.id, searchTerm]); // <--- searchTerm adicionado aqui

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
    <div className="min-h-screen bg-[#E8EEF7] text-slate-900 pb-20 font-sans overflow-x-hidden w-full">
      <nav className="bg-[#232D4A] text-white sticky top-0 z-30 shadow-white-100xl border-b border-white/10 px-6 h-20 flex justify-between items-center">
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

      {/* --- ÁREA DE CONTROLE (ABAS EM CARDS + FUSÃO TOTAL) --- */}
<div className="sticky top-20 z-30 w-full">
  
  {/* LINHA 1: ABAS NO FUNDO CINZA CLARO */}
  <div className="bg-[#DCE7F5] border-b border-slate-200 pt-6 px-4">
    <div className="max-w-[99%] mx-auto flex items-end justify-center gap-2 overflow-x-auto no-scrollbar">
      {navCategories.map(tab => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        
        return (
          <button 
            key={tab.id} 
            onClick={() => { setActiveTab(tab.id); setShowCreateBox(false); }} 
            className={`
              flex flex-col items-center justify-center min-w-[109px] h-[80px] gap-1 px-4 transition-all duration-2 relative
              rounded-t-2xl border-x-2 border-t-0 border-transparent
              ${isActive
                ? 'bg-[#F6F7F9] border-blue-500 border-t-2 z-40 -mb-[-3px] h-[85px] shadow-[0_-4px_10px_rgba(0,0,0,0.02)]' 
                : 'bg-gradient-to-b from-white to-slate-200 border-slate-300 text-slate-500 hover:to-white'}
            `}
          >
            <Icon size={isActive ? 24 : 20} className={isActive ? 'text-blue-500' : ''} strokeWidth={isActive ? 3 : 2} />
            <span className={`text-[10px] font-black uppercase tracking-tight ${isActive ? 'text-blue-500' : ''}`}>
              {tab.label}
            </span>

            {/* A "BORRACHA" QUE APAGA A LINHA: Esta div fica por cima da borda cinza */}
            {isActive && (
              <div className="absolute -bottom-[3px] left-[-1px] right-[-1px] h-[5px] bg-[#F6F7F9] z-[50]"></div>
            )}
          </button>
        );
      })}
    </div>
  </div>

  {/* LINHA 2: BARRA DE COMANDO COMPACTA (SÓ FILTRO E PESQUISA) */}
  <div className="bg-[#F6F7F9] border-b-2 border-slate-200 pt-10 pb-8 px-10 relative z-10 -mt-[2px]">
   <div className="max-w-[98%] mx-auto flex items-center justify-between gap-8">
      
      {/* SELETOR DE EQUIPE DROPDOWN (SUBSTITUI OS NOMES ESPALHADOS) */}
      <div className="relative">
       <button 
  type="button"
  onClick={() => setShowUserMenu(!showUserMenu)}
  className={`
    h-12 px-6 rounded-2xl border-2 font-black text-[10px] uppercase flex items-center gap-3 whitespace-nowrap relative
    
    /* EFEITO FÍSICO REAL (SEM DELAY) */
    transition-transform duration-75 active:duration-0
    active:translate-x-[4px] active:translate-y-[4px] active:shadow-none
    
    ${filterUser === 'Todos' 
      ? 'border-slate-100 bg-white text-slate-900 shadow-[4px_4px_0px_0px_rgba(15,23,42,1)] hover:bg-slate-50' 
      : 'border-blue-600 bg-blue-50 text-blue-600 shadow-[4px_4px_0px_0px_rgba(37,99,235,1)] hover:bg-blue-100'}
  `}
>
  <Filter size={16} />
  <span>{filterUser === 'Todos' ? 'Filtrar Equipe' : profiles.find(p => p.id === filterUser)?.full_name}</span>
  
  {/* A setinha continua rodando conforme o menu abre/fecha */}
  <ChevronDown 
    size={16} 
    className={`transition-transform duration-300 ${showUserMenu ? 'rotate-180' : ''}`} 
  />
</button>

        {/* MENU SUSPENSO DOS USUÁRIOS (COM FILTRO DE SETOR) */}
{showUserMenu && (
  <>
    <div className="fixed inset-0 z-10" onClick={() => setShowUserMenu(false)}></div>
    <div className="absolute left-0 mt-3 w-64 bg-white border-4 border-slate-900 rounded-[32px] shadow-[15px_15px_0px_0px_rgba(15,23,42,1)] z-20 p-4">
      <div className="flex flex-col gap-2">
        <button 
          type="button"
          onClick={() => { setFilterUser('Todos'); setShowUserMenu(false); }}
          className={`p-3 text-left font-black text-[10px] uppercase rounded-xl transition-all ${filterUser === 'Todos' ? 'bg-slate-900 text-white' : 'hover:bg-slate-100 text-slate-600'}`}
        >
          🌍 Equipe Total {userRole === 'admin' ? '' : `(${userSector})`}
        </button>
        
        <div className="h-[1px] bg-slate-100 my-1"></div>

        {/* --- FILTRAGEM AQUI --- */}
        {profiles
          .filter(p => userRole === 'admin' || p.sector === userSector) // Regra: Admin vê tudo, outros só o próprio setor
          .map(p => (
          <button 
            key={p.id} 
            type="button"
            onClick={() => { setFilterUser(p.id); setShowUserMenu(false); }}
            className={`p-3 text-left font-black text-[10px] uppercase flex items-center gap-3 rounded-xl transition-all ${filterUser === p.id ? 'bg-blue-600 text-white' : 'hover:bg-blue-50 text-slate-600'}`}
          >
            <div className={`w-5 h-5 rounded bg-blue-100 text-blue-600 flex items-center justify-center text-[8px] font-bold ${filterUser === p.id ? 'bg-white/20' : ''}`}>
              {p.full_name?.charAt(0)}
            </div>
            {p.full_name}
          </button>
        ))}
      </div>
    </div>
  </>
)}
      </div>

      {/* ÁREA DE PESQUISA (Ocupando o resto da linha) */}
      <div className="w-full md:w-96 group">
        <div className="relative flex items-center h-12">
          <Search size={18} className={`absolute left-5 top-1/2 -translate-y-1/2 transition-colors duration-300 z-10 ${searchTerm ? 'text-blue-600' : 'text-slate-400'}`} />
          <input 
            type="text"
            placeholder="DIGITE PARA BUSCAR TAREFAS..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full h-full pl-14 pr-12 bg-white border-2 border-transparent rounded-2xl font-black text-[11px] text-slate-900 outline-none transition-all placeholder:text-slate-300 shadow-[5px_5px_0px_0px_rgba(15,23,42,1)]
              ${searchTerm 
                ? 'border-blue-600 bg-white shadow-[0_0_20px_rgba(37,99,235,0.1)]' 
                : 'border-transparent shadow-[0px_0px_0px_1px_rgba(15,23,42,1)] focus:border-slate-200 focus:shadow-none focus:translate-x-[1px] focus:translate-y-[1px]'}`}
          />
          {searchTerm && (
            <button type="button" onClick={() => setSearchTerm('')} className="absolute right-4 bg-slate-100 hover:bg-red-100 text-slate-400 p-1.5 rounded-lg transition-all">
              <X size={14} strokeWidth={3} />
            </button>
          )}
        </div>
      </div> 
    </div>
  </div>
</div> {/* Este fecha o sticky top-20 w-full */}

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
  <div className="mt-8 space-y-6 animate-in slide-in-from-bottom-4 duration-500 pb-20">
    <div className="flex justify-between items-center px-4">
      <h2 className="text-3xl font-black uppercase italic tracking-tighter">Linha do Tempo</h2>
      <div className="bg-blue-600 text-white px-4 py-1.5 rounded-full font-black text-[10px] uppercase shadow-md">
        Setor: {userRole === 'admin' ? 'Global' : userSector}
      </div>
    </div>

    <div className="relative border-l-4 border-slate-200 ml-6 pl-8 space-y-8 py-4">
      {history
        /* FILTRO DE SETOR NO FRONT-END */
        .filter(log => userRole === 'admin' || log.sector === userSector || log.sector === 'Geral')
        .map((log) => (
          <div key={log.id} className="relative">
            {/* Círculo da Timeline */}
            <div className="absolute -left-[42px] top-1 w-5 h-5 bg-blue-600 rounded-full border-4 border-white shadow-md"></div>
            
            <div className="bg-white p-6 rounded-[32px] border-2 border-slate-100 shadow-sm hover:border-blue-300 transition-colors">
              <div className="flex justify-between items-start mb-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                  {new Date(log.created_at).toLocaleString('pt-BR')}
                </p>
                <span className="text-[8px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase">
                  {log.sector}
                </span>
              </div>
              
              <h4 className="text-xl font-black text-slate-900 mb-2 uppercase">
                {log.task_title}
              </h4>
              
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-[8px] font-bold">
                  {log.user_name?.charAt(0)}
                </div>
                <p className="text-[10px] font-black text-blue-600 uppercase">
                  Concluído por {log.user_name}
                </p>
              </div>
            </div>
          </div>
      ))}

      {/* Mensagem caso o histórico esteja vazio para o setor */}
      {history.filter(log => userRole === 'admin' || log.sector === userSector).length === 0 && (
        <div className="text-center py-20 opacity-30">
          <p className="font-black uppercase tracking-widest text-slate-400">Nenhum registro neste setor...</p>
        </div>
      )}
    </div>
  </div>
  ) : activeTab === 'COMUNICADOS' ? (
  <div className="mt-8 space-y-8 animate-in fade-in duration-500 pb-20">
    <div className="flex justify-between items-center px-4">
      <h2 className="text-3xl font-black uppercase italic tracking-tighter flex items-center gap-3">
        <Megaphone className="text-red-600 animate-bounce" size={32} /> Mural de Avisos
      </h2>
      <div className="bg-slate-900 text-white px-4 py-1.5 rounded-full font-black text-[10px] uppercase">
        Setor: {userSector}
      </div>
    </div>

    {/* CAIXA DE CRIAÇÃO COM UPLOAD */}
    <div className="bg-white p-8 rounded-[40px] border-4 border-slate-900 shadow-[12px_12px_0px_0px_rgba(15,23,42,1)] space-y-4 mx-4">
      <input 
        className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-slate-900 outline-none focus:border-red-500 uppercase"
        placeholder="TÍTULO DO ALERTA..."
        value={annTitle}
        onChange={e => setAnnTitle(e.target.value)}
      />
      <textarea 
        className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-slate-700 outline-none focus:border-red-500 min-h-[100px] resize-none"
        placeholder="MENSAGEM PARA A EQUIPE..."
        value={annContent}
        onChange={e => setAnnContent(e.target.value)}
      />
      
      {/* Input de Imagem Estilizado */}
      <div className="flex items-center gap-4">
        <label className="flex-1 flex items-center justify-center gap-3 p-4 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-all group">
          <input type="file" accept="image/*" className="hidden" onChange={e => setAnnImage(e.target.files?.[0] || null)} />
          <div className="bg-blue-100 text-blue-600 p-2 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors">
            <Plus size={20} strokeWidth={3} />
          </div>
          <span className="text-[10px] font-black uppercase text-slate-500">
            {annImage ? `IMAGEM: ${annImage.name.slice(0,15)}...` : 'ADICIONAR FOTO AO ALERTA'}
          </span>
        </label>
        
        {annImage && (
          <button onClick={() => setAnnImage(null)} className="p-4 bg-red-50 text-red-500 rounded-2xl hover:bg-red-500 hover:text-white transition-all">
            <X size={20} strokeWidth={3} />
          </button>
        )}
      </div>

      <button 
        onClick={addAnnouncement}
        disabled={uploading}
        className="w-full bg-red-600 text-white p-5 rounded-3xl font-black uppercase tracking-widest hover:bg-slate-900 transition-all flex items-center justify-center gap-3 shadow-lg active:scale-[0.98]"
      >
        {uploading ? 'ENVIANDO...' : <><Megaphone size={20}/> TRANSMITIR ALERTA</>}
      </button>
    </div>

    {/* LISTA DE ALERTAS */}
    <div className="space-y-8 px-4">
      {announcements
        .filter(ann => userRole === 'admin' || ann.sector === userSector || ann.sector === 'Geral')
        .map((ann) => (
        <div key={ann.id} className="bg-white border-4 border-slate-900 rounded-[40px] shadow-[12px_12px_0px_0px_rgba(248,113,113,1)] overflow-hidden">
          
          {/* Imagem do Alerta (se houver) */}
          {ann.image_url && (
            <div className="w-full h-64 overflow-hidden border-b-4 border-slate-900 bg-slate-100">
               <img src={ann.image_url} alt="Alert" className="w-full h-full object-cover hover:scale-105 transition-transform duration-700" />
            </div>
          )}

          <div className="p-8">
            <div className="flex justify-between items-start mb-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="bg-red-600 text-white text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-widest">ALERTA OFICIAL</span>
                  <span className="bg-slate-100 text-slate-600 text-[8px] font-black px-2 py-0.5 rounded uppercase">{ann.sector}</span>
                </div>
                <h4 className="text-3xl font-black text-slate-900 leading-none uppercase italic">{ann.title}</h4>
              </div>
              
              {/* DATA E HORA COMPLETA */}
              <div className="text-right flex flex-col items-end">
                <p className="text-[10px] font-black text-slate-900 uppercase">
                  {new Date(ann.created_at).toLocaleDateString('pt-BR')}
                </p>
                <p className="text-[14px] font-black text-blue-600 leading-none mt-1">
                  {new Date(ann.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>

            <div className="bg-slate-50 p-6 rounded-3xl border-2 border-slate-100 text-slate-700 font-bold leading-relaxed whitespace-pre-wrap mb-6">
              {ann.content}
            </div>

            <div className="flex justify-between items-center">
               <div className="flex items-center gap-2">
                 <div className="w-6 h-6 bg-slate-900 text-white rounded-full flex items-center justify-center text-[8px] font-black uppercase">
                    {ann.profiles?.full_name?.charAt(0)}
                 </div>
                 <p className="text-[9px] font-black text-slate-400 uppercase">Transmitido por: <span className="text-slate-900">{ann.profiles?.full_name}</span></p>
               </div>
               
               {(userRole === 'admin' || ann.created_by === user?.id) && (
                 <button onClick={async () => { if(confirm('Excluir alerta?')) { await supabase.from('announcements').delete().eq('id', ann.id); fetchAnnouncements(); }}} className="text-red-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-xl transition-all">
                   <Trash2 size={20}/>
                 </button>
               )}
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
) : (
    /* ABA PADRÃO DE TAREFAS */
    <>
      <div className="max-w-4xl mx-auto mt-5 mb-6 px-60">
        <button onClick={() => setShowCreateBox(!showCreateBox)} className={`w-full py-5 rounded-[32px] font-black uppercase tracking-[0.2em] text-[11px] transition-all duration-500 flex items-center justify-center gap-3 border-2 ${showCreateBox ? 'bg-slate-100 border-slate-200 text-slate-400' : 'bg-white border-slate-100 text-slate-900 shadow-[10px_10px_0px_0px_rgba(15,23,42,1)] hover:translate-x-1 hover:translate-y-1'}`}>
          {showCreateBox ? <><X size={20} /> Cancelar Operação</> : <><Plus size={20} strokeWidth={3} className="text-blue-600" /> Lançar Nova Tarefa</>}
        </button>
      </div>

     {/* ----------------------------------------------------------- */}
{/* MODAL FLUTUANTE: LANÇAR NOVA TAREFA (VERSÃO FINAL CORRIGIDA) */}
{/* ----------------------------------------------------------- */}
{showCreateBox && (
  <div className="fixed inset-0 bg-slate-900/90 z-[70] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
    
    {/* CONTAINER DO CARD (Largura travada em max-w-2xl) */}
    <div className="bg-white w-full max-w-2xl rounded-[40px] border-4 border-slate-900 shadow-[20px_20px_0px_0px_rgba(15,23,42,1)] flex flex-col max-h-[95vh] overflow-hidden relative">
      {/* Detalhe superior: Industrial Pattern */}
<div className="absolute top-0 left-0 w-full h-2 bg-blue-600 rounded-t-[40px] overflow-hidden">
  {/* O gradiente principal */}
  <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-indigo-600 opacity-90"></div>
  
  {/* A textura de listras sutis */}
  <div 
    className="absolute inset-0 opacity-20" 
    style={{ 
      backgroundImage: `linear-gradient(45deg, #white 25%, transparent 25%, transparent 50%, #white 50%, #white 75%, transparent 75%, transparent)`,
      backgroundSize: '10px 10px' 
    }}
  ></div>
  
  {/* Sombrinha interna para dar profundidade */}
  <div className="absolute inset-0 shadow-[inset_0_-2px_4px_rgba(0,0,0,0.1)]"></div>
</div>

      {/* Cabeçalho */}
      <div className="p-6 border-b-4 border-slate-100 flex justify-between items-center bg-slate-50/50">
        <div>
          <h2 className="text-2xl font-black uppercase italic tracking-tighter text-slate-900 leading-none text-left">Nova Tarefa</h2>
          <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest mt-1 text-left">Setor Operacional: {userSector}</p>
        </div>
        <button onClick={() => setShowCreateBox(false)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-white border-2 border-slate-200 text-slate-400 hover:text-red-600 transition-all">
          <X size={20} strokeWidth={3} />
        </button>
      </div>

      {/* Formulário com Scroll Interno */}
      <div className="flex-1 overflow-y-auto p-8 space-y-8 no-scrollbar">
        
        {/* Título e Notas */}
        <div className="space-y-4">
          <input className="w-full text-2xl font-black outline-none placeholder:text-slate-200 text-slate-900 bg-transparent border-b-4 border-slate-100 focus:border-blue-500 transition-all pb-2 uppercase" placeholder="O QUE VAMOS FAZER?" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} />
          <textarea className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-slate-700 border-2 border-slate-100 outline-none focus:border-blue-300 focus:bg-white transition-all min-h-[80px] text-sm resize-none" placeholder="Coordenadas e detalhes da tarefa..." value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        {/* Checklist */}
        <div className="space-y-3 bg-slate-50/50 p-5 rounded-[24px] border-2 border-dashed border-slate-200">
          <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-2"><ListChecks size={14} className="text-blue-500"/> Passos de Execução</label>
          <div className="grid grid-cols-1 gap-2">
            {tempSubtasks.map((sub, index) => (
              <div key={index} className="flex items-center gap-2 bg-white p-2.5 rounded-xl border-2 border-slate-100 shadow-sm">
                <input className="flex-1 text-xs font-black text-slate-600 outline-none uppercase" value={sub.title} onChange={(e) => { const newSubs = [...tempSubtasks]; newSubs[index].title = e.target.value; setTempSubtasks(newSubs); }} placeholder="Nome do passo..." />
                <button onClick={() => setTempSubtasks(tempSubtasks.filter((_, i) => i !== index))} className="text-red-400 p-1 hover:bg-red-50 rounded-lg"><X size={14}/></button>
              </div>
            ))}
            <button onClick={() => setTempSubtasks([...tempSubtasks, { title: '', done: false }])} className="flex items-center justify-center gap-2 p-2 border-2 border-dashed border-slate-300 rounded-xl text-slate-400 font-black text-[9px] hover:border-blue-400 transition-all uppercase"><Plus size={14} strokeWidth={3}/> Adicionar Passo</button>
          </div>
        </div>

        {/* Configurações (Aqui estão os Dropups) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
          
          {/* Coluna Datas */}
          <div className="space-y-3 bg-white p-4 rounded-[24px] border-2 border-slate-100 shadow-sm">
            <div className="flex bg-slate-100 p-1 rounded-xl border-2 border-slate-200">
              <button type="button" onClick={() => setSelectedDays([])} className={`flex-1 py-1.5 rounded-lg font-black text-[9px] uppercase transition-all ${isNaN(parseInt(selectedDays[0])) ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>Semanal</button>
              <button type="button" onClick={() => setSelectedDays(['1'])} className={`flex-1 py-1.5 rounded-lg font-black text-[9px] uppercase transition-all ${!isNaN(parseInt(selectedDays[0])) ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>Mensal</button>
            </div>
            {!isNaN(parseInt(selectedDays[0])) ? (
              <div className="relative h-[50px] group cursor-pointer" onClick={() => dateInputRef.current?.showPicker()}>
                <div className="absolute inset-0 flex items-center justify-center bg-slate-50 rounded-xl border-2 border-slate-100 font-black text-slate-700 text-base pointer-events-none uppercase">{displayDate}<Calendar size={16} className="absolute right-4 text-blue-500" /></div>
                <input ref={dateInputRef} type="date" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={e => { const dVal = e.target.value; if(dVal){ const [y,m,d] = dVal.split('-'); setDisplayDate(`${d}/${m}/${y}`); setSelectedDays([d]); }}} />
              </div>
            ) : (
              <div className="flex gap-1.5 justify-center p-1.5 bg-slate-50 rounded-xl border-2 border-slate-100">
                {weekDays.map(day => (<button key={day.id} type="button" onClick={() => toggleDay(day.id)} className={`w-8 h-8 rounded-lg font-black text-[10px] transition-all ${selectedDays.includes(day.id) ? 'bg-blue-600 text-white shadow-lg scale-110' : 'bg-white text-slate-300'}`}>{day.label}</button>))}
              </div>
            )}
            <div className="flex items-center justify-between gap-4 px-2"><label className="text-[8px] font-black uppercase text-slate-400 italic">Intervalo</label><input type="number" min="1" className="w-16 p-1.5 bg-slate-50 rounded-lg font-black border-2 border-slate-100 text-slate-900 text-center text-xs" value={repeatInterval} onChange={e => setRepeatInterval(parseInt(e.target.value) || 1)} /></div>
          </div>

          {/* Coluna Responsável e Classificação */}
          <div className="space-y-4">
            {/* Responsável Customizado */}
            <div className="relative">
              <label className="text-[9px] font-black uppercase text-slate-400 ml-2 italic">Responsável</label>
              <button type="button" onClick={() => userRole !== 'membro' && setShowAssignMenu(!showAssignMenu)} className={`w-full h-12 px-4 rounded-xl border-2 font-black text-[10px] uppercase flex items-center justify-between transition-all relative z-20 ${showAssignMenu ? 'border-blue-600 bg-white' : 'border-slate-900 bg-white shadow-[4px_4px_0px_0px_rgba(15,23,42,1)]'}`}>
                <div className="flex items-center gap-2"><User size={14} className="text-blue-500" /><span>{profiles.find(p => p.id === assignedTo)?.full_name || 'Selecionar...'}</span></div>
                <ChevronDown size={16} className={`transition-transform duration-300 ${showAssignMenu ? 'rotate-180' : ''}`} />
              </button>
              {showAssignMenu && (
                <>
                  <div className="fixed inset-0 z-[85]" onClick={() => setShowAssignMenu(false)}></div>
                  <div className="absolute left-0 right-0 bottom-full mb-2 bg-white border-4 border-slate-900 rounded-[24px] shadow-[10px_10px_0px_0px_rgba(15,23,42,1)] z-[100] p-3 max-h-[360] overflow-y-auto no-scrollbar animate-in slide-in-from-bottom-2">
                    <div className="flex flex-col gap-1">{profiles.filter(p => userRole === 'admin' || p.sector === userSector).map(p => (
                      <button key={p.id} type="button" onClick={() => { setAssignedTo(p.id); setShowAssignMenu(false); }} className={`p-2.5 text-left font-black text-[9px] uppercase flex items-center gap-2 rounded-lg transition-all border-2 ${assignedTo === p.id ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-white border-slate-50 text-slate-600 hover:border-blue-300'}`}><div className={`w-5 h-5 rounded-md border flex items-center justify-center text-[7px] font-bold ${assignedTo === p.id ? 'bg-white/20' : 'bg-blue-100 text-blue-600'}`}>{p.full_name?.charAt(0)}</div>{p.full_name}</button>
                    ))}</div>
                  </div>
                </>
              )}
            </div>

            {/* Classificação Customizada */}
            <div className="relative">
              <label className="text-[9px] font-black uppercase text-slate-400 ml-2 italic">Classificação</label>
              <button type="button" onClick={() => setShowCategoryMenu(!showCategoryMenu)} className={`w-full h-12 px-4 rounded-xl border-2 font-black text-[10px] uppercase flex items-center justify-between transition-all relative z-20 ${showCategoryMenu ? 'border-blue-600 bg-white' : 'border-slate-900 bg-white shadow-[4px_4px_0px_0px_rgba(15,23,42,1)]'}`}>
                <div className="flex items-center gap-2"><Activity size={14} className="text-blue-500" /><span>{category}</span></div>
                <ChevronDown size={16} className={`transition-transform duration-300 ${showCategoryMenu ? 'rotate-180' : ''}`} />
              </button>
              {showCategoryMenu && (
                <>
                  <div className="fixed inset-0 z-[85]" onClick={() => setShowCategoryMenu(false)}></div>
                  <div className="absolute left-0 right-0 bottom-full mb-2 bg-white border-4 border-slate-900 rounded-[24px] shadow-[10px_10px_0px_0px_rgba(15,23,42,1)] z-[100] p-3 animate-in slide-in-from-bottom-2">
                    <div className="flex flex-col gap-1">{['Trade', 'Reunião', 'Geral'].map(opt => (
                      <button key={opt} type="button" onClick={() => { setCategory(opt); setShowCategoryMenu(false); }} className={`p-3 text-left font-black text-[9px] uppercase rounded-lg transition-all border-2 ${category === opt ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-white border-slate-50 text-slate-600 hover:border-blue-300'}`}>{opt}</button>
                    ))}</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Rodapé fixo */}
      <div className="p-6 bg-slate-50 border-t-4 border-slate-100 flex gap-3 mt-auto">
        <button onClick={() => setShowCreateBox(false)} className="flex-1 py-4 rounded-2xl border-2 border-slate-200 text-slate-400 font-black uppercase text-[10px] hover:bg-slate-100 transition-all">Descartar</button>
        <button onClick={addTask} className="flex-[2] py-4 bg-blue-600 hover:bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95"><Check size={20} strokeWidth={4} /> Lançar Tarefa Agora</button>
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

      {/* ----------------------------------------------------------- */}
{/* MODAL FLUTUANTE: EDITAR TAREFA (VERSÃO SUPPLY PRO) */}
{/* ----------------------------------------------------------- */}
{showEditModal && editingTask && (
  <div className="fixed inset-0 bg-slate-900/90 z-[70] flex items-center justify-center p-4 backdrop-blur-sm animate-in zoom-in-95 duration-300">
    
    {/* CONTAINER DO CARD */}
    <div className="bg-white w-full max-w-2xl rounded-[40px] border-4 border-slate-900 shadow-[20px_20px_0px_0px_rgba(15,23,42,1)] flex flex-col max-h-[90vh] overflow-hidden relative">
      
      {/* Detalhe superior (Opção Industrial) */}
      <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-600 to-indigo-600"></div>

      {/* Cabeçalho */}
      <div className="p-6 border-b-4 border-slate-100 flex justify-between items-center bg-slate-50/50">
        <div>
          <h2 className="text-2xl font-black uppercase italic tracking-tighter text-slate-900 leading-none">Editar tarefa</h2>
          <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest mt-1">Ajuste de Coordenadas Operacionais</p>
        </div>
        <button 
          onClick={() => setShowEditModal(false)} 
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-white border-2 border-slate-200 text-slate-400 hover:text-red-600 transition-all shadow-sm"
        >
          <X size={20} strokeWidth={3} />
        </button>
      </div>

      {/* Formulário com Scroll Interno */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar pb-6">
        
        {/* Título e Notas */}
        <div className="space-y-4">
          <input 
            className="w-full text-2xl font-black outline-none placeholder:text-slate-200 text-slate-900 bg-transparent border-b-4 border-slate-100 focus:border-blue-500 transition-all pb-2 uppercase" 
            value={editingTask.title} 
            onChange={e => setEditingTask({...editingTask, title: e.target.value})} 
          />
          <textarea 
            className="w-full p-4 bg-slate-50 rounded-3xl font-bold text-slate-700 border-2 border-slate-100 outline-none focus:border-blue-300 focus:bg-white transition-all min-h-[80px] text-sm resize-none" 
            value={editingTask.notes || ''} 
            onChange={e => setEditingTask({...editingTask, notes: e.target.value})} 
          />
        </div>

        {/* Checklist de Subtarefas */}
        <div className="space-y-3 bg-slate-50/50 p-5 rounded-[24px] border-2 border-dashed border-slate-200">
          <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-2">
            <ListChecks size={14} className="text-blue-500"/> Checklist de Passos
          </label>
          <div className="grid grid-cols-1 gap-2">
            {(editingTask.subtasks || []).map((sub: any, index: number) => (
              <div key={index} className="flex items-center gap-2 bg-white p-2.5 rounded-xl border-2 border-slate-100 shadow-sm">
                <input 
                  type="checkbox" 
                  checked={sub.done} 
                  onChange={(e) => { const newSubs = [...editingTask.subtasks]; newSubs[index].done = e.target.checked; setEditingTask({...editingTask, subtasks: newSubs}); }} 
                  className="w-4 h-4 accent-blue-600 ml-2" 
                />
                <input 
                  className="flex-1 text-xs font-black text-slate-600 outline-none uppercase" 
                  value={sub.title} 
                  onChange={(e) => { const newSubs = [...editingTask.subtasks]; newSubs[index].title = e.target.value; setEditingTask({...editingTask, subtasks: newSubs}); }} 
                />
                <button onClick={() => { const newSubs = editingTask.subtasks.filter((_:any, i:number) => i !== index); setEditingTask({...editingTask, subtasks: newSubs}); }} className="text-red-400 p-1 hover:bg-red-50 rounded-lg"><X size={14}/></button>
              </div>
            ))}
            <button 
              onClick={() => { const newSubs = [...(editingTask.subtasks || []), { title: '', done: false }]; setEditingTask({...editingTask, subtasks: newSubs}); }} 
              className="flex items-center justify-center gap-2 p-2 border-2 border-dashed border-slate-300 rounded-xl text-slate-400 font-black text-[9px] hover:border-blue-400 transition-all uppercase"
            >
              <Plus size={14} strokeWidth={3}/> Adicionar Passo
            </button>
          </div>
        </div>

        {/* Configurações (Filtros Dropup) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
          
          {/* Coluna 1: Recorrência */}
          <div className="space-y-3 bg-white p-4 rounded-[24px] border-2 border-slate-100 shadow-sm">
            <div className="flex bg-slate-100 p-1 rounded-xl border-2 border-slate-200">
              <button type="button" onClick={() => { setEditMode('semanal'); setEditingTask({...editingTask, repeat_days: ''}); }} className={`flex-1 py-1.5 rounded-lg font-black text-[10px] uppercase transition-all ${editMode === 'semanal' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>Semanal</button>
              <button type="button" onClick={() => { setEditMode('mensal'); setEditingTask({...editingTask, repeat_days: '1'}); }} className={`flex-1 py-1.5 rounded-lg font-black text-[10px] uppercase transition-all ${editMode === 'mensal' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>Mensal</button>
            </div>

            {editMode === 'mensal' ? (
              <div className="space-y-2">
                <label className="text-[9px] font-black uppercase text-slate-400 ml-2 italic">Novo Dia</label>
                <div className="relative h-[50px] group cursor-pointer" onClick={() => editDateInputRef.current?.showPicker()}>
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-50 rounded-xl border-2 border-slate-100 font-black text-slate-700 text-base pointer-events-none uppercase transition-all group-hover:border-blue-500">
                    {editDisplayDate}
                    <Calendar size={16} className="absolute right-4 text-blue-500" />
                  </div>
                  <input ref={editDateInputRef} type="date" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={e => { const dVal = e.target.value; if(dVal){ const [y,m,d] = dVal.split('-'); setEditDisplayDate(`${d}/${m}/${y}`); setEditingTask({...editingTask, repeat_days: d}); }}} />
                </div>
              </div>
            ) : (
              <div className="flex gap-1.5 justify-center p-1.5 bg-slate-50 rounded-xl border-2 border-slate-100">
                {weekDays.map(day => (
                  <button key={day.id} type="button" onClick={() => toggleDayInEdit(day.id)} className={`w-8 h-8 rounded-lg font-black text-[10px] transition-all ${editingTask.repeat_days?.split(',').includes(day.id) ? 'bg-blue-600 text-white shadow-lg' : 'bg-white text-slate-300'}`}>{day.label}</button>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between gap-4 px-2">
               <label className="text-[8px] font-black uppercase text-slate-400 italic">Intervalo</label>
               <input type="number" min="1" className="w-16 p-1.5 bg-slate-50 rounded-lg font-black border-2 border-slate-100 text-slate-900 text-center text-xs" value={editingTask.repeat_interval} onChange={e => setEditingTask({...editingTask, repeat_interval: parseInt(e.target.value) || 1})} />
            </div>
          </div>

          {/* Coluna 2: Responsável e Classificação */}
          <div className="space-y-4">
            {/* Responsável com Dropup */}
            <div className="relative">
              <label className="text-[9px] font-black uppercase text-slate-400 ml-2 italic">Responsável</label>
              <button 
                type="button"
                onClick={() => userRole !== 'membro' && setShowAssignMenu(!showAssignMenu)}
                className={`w-full h-12 px-4 rounded-xl border-2 font-black text-[10px] uppercase flex items-center justify-between transition-all relative z-[80]
                  ${showAssignMenu ? 'border-blue-600 bg-white' : 'border-slate-900 bg-white shadow-[3px_3px_0px_0px_rgba(15,23,42,1)]'}`}
              >
                <div className="flex items-center gap-2">
                  <User size={14} className="text-blue-500" />
                  <span className="truncate">{profiles.find(p => p.id === editingTask.assigned_to)?.full_name || 'Selecionar...'}</span>
                </div>
                <ChevronDown size={16} className={`transition-transform duration-300 ${showAssignMenu ? 'rotate-180' : ''}`} />
              </button>

              {showAssignMenu && (
                <>
                  <div className="fixed inset-0 z-[85]" onClick={() => setShowAssignMenu(false)}></div>
                  <div className="absolute left-0 right-0 bottom-full mb-2 bg-white border-4 border-slate-900 rounded-[24px] shadow-[10px_10px_0px_0px_rgba(15,23,42,1)] z-[100] p-3 max-h-[180px] overflow-y-auto no-scrollbar animate-in slide-in-from-bottom-2">
                    <div className="flex flex-col gap-1">
                      {profiles.filter(p => userRole === 'admin' || p.sector === userSector).map(p => (
                        <button key={p.id} type="button" onClick={() => { setEditingTask({...editingTask, assigned_to: p.id}); setShowAssignMenu(false); }} className={`p-2.5 text-left font-black text-[9px] uppercase flex items-center gap-2 rounded-lg transition-all border-2 ${editingTask.assigned_to === p.id ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-50 text-slate-600 hover:border-blue-300'}`}>
                          <div className={`w-5 h-5 rounded-md border flex items-center justify-center text-[7px] font-bold ${editingTask.assigned_to === p.id ? 'bg-white/20' : 'bg-blue-100 text-blue-600'}`}>{p.full_name?.charAt(0)}</div>
                          {p.full_name}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Classificação com Dropup */}
            <div className="relative">
              <label className="text-[9px] font-black uppercase text-slate-400 ml-2 italic">Classificação</label>
              <button 
                type="button"
                onClick={() => setShowCategoryMenu(!showCategoryMenu)}
                className={`w-full h-12 px-4 rounded-xl border-2 font-black text-[10px] uppercase flex items-center justify-between transition-all relative z-[80]
                  ${showCategoryMenu ? 'border-blue-600 bg-white' : 'border-slate-900 bg-white shadow-[3px_3px_0px_0px_rgba(15,23,42,1)]'}`}
              >
                <div className="flex items-center gap-2">
                  <Activity size={14} className="text-blue-500" />
                  <span>{editingTask.category}</span>
                </div>
                <ChevronDown size={16} className={`transition-transform duration-300 ${showCategoryMenu ? 'rotate-180' : ''}`} />
              </button>
              {showCategoryMenu && (
                <>
                  <div className="fixed inset-0 z-[85]" onClick={() => setShowCategoryMenu(false)}></div>
                  <div className="absolute left-0 right-0 bottom-full mb-2 bg-white border-4 border-slate-900 rounded-[24px] shadow-[10px_10px_0px_0px_rgba(15,23,42,1)] z-[100] p-3 animate-in slide-in-from-bottom-2">
                    <div className="flex flex-col gap-1">
                      {['Trade', 'Reunião', 'Geral'].map(opt => (
                        <button key={opt} type="button" onClick={() => { setEditingTask({...editingTask, category: opt}); setShowCategoryMenu(false); }} className={`p-3 text-left font-black text-[10px] uppercase rounded-lg transition-all border-2 ${editingTask.category === opt ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-white border-slate-50 text-slate-600 hover:border-blue-300'}`}>{opt}</button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Rodapé Fixo */}
      <div className="p-6 bg-slate-50 border-t-4 border-slate-100 flex gap-3 mt-auto">
        <button 
          onClick={() => setShowEditModal(false)}
          className="flex-1 py-4 rounded-2xl border-2 border-slate-200 text-slate-400 font-black uppercase text-[10px] hover:bg-slate-100 transition-all"
        >
          Cancelar
        </button>
        <button 
          onClick={updateTask} 
          className="flex-[2] py-4 bg-blue-600 hover:bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95"
        >
          <Check size={20} strokeWidth={4} /> Atualizar tarefa Agora
        </button>
      </div>
    </div>
  </div>
)}
{/* 3. PAINEL LATERAL INTEGRADO (DRAWER STYLE) */}
<div 
  className={`fixed inset-0 z-[100] transition-all duration-500 ${viewingTask ? 'visible' : 'invisible pointer-events-none'}`}
>
  {/* Camada de fundo quase transparente para manter o contexto total da lista */}
  <div 
    className={`absolute inset-0 bg-slate-900/10 transition-opacity duration-500 ${viewingTask ? 'opacity-100' : 'opacity-0'}`} 
    onClick={() => setViewingTask(null)}
  />

  {/* GAVETA (SIDEBAR) - Encostada na borda com sombra suave lateral */}
  <div 
    className={`absolute top-0 right-0 h-full bg-white w-full md:w-[420px] border-l-2 border-slate-200 shadow-[-10px_0_30px_rgba(0,0,0,0.05)] flex flex-col transition-transform duration-500 ease-in-out transform z-[110]
      ${viewingTask ? 'translate-x-0' : 'translate-x-full'}`}
  >
    {viewingTask && (
      <div className="flex flex-col h-full overflow-hidden bg-[#F8FAFC]">
        
        {/* CABEÇALHO: Mesma cor da Navbar para dar continuidade */}
        <div className={`p-8 border-b-2 border-white/10 ${viewingTask.isDoneToday ? 'bg-green-600' : 'bg-[#232D4A]'} text-white relative`}>
          <div className="flex justify-between items-center mb-6">
            <span className="bg-white/10 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border border-white/10">
              {viewingTask.category}
            </span>
            <button 
              onClick={(e) => { e.stopPropagation(); setViewingTask(null); }} 
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/20 text-white transition-all"
            >
              <X size={24} strokeWidth={3}/>
            </button>
          </div>
          <h2 className="text-2xl font-black uppercase italic tracking-tighter leading-tight break-words">
            {viewingTask.title}
          </h2>
        </div>

        {/* ÁREA DE CONTEÚDO: fundo levemente diferente para destacar os cards internos */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar">
          
          {/* CARDS DE INFO RÁPIDA */}
          <div className="grid grid-cols-2 gap-3">
             <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm">
                <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Responsável</p>
                <div className="flex items-center gap-2">
                   <div className="w-6 h-6 bg-slate-900 text-white rounded-md flex items-center justify-center text-[10px] font-black uppercase">
                     {profiles.find(p => p.id === viewingTask.assigned_to)?.full_name?.charAt(0)}
                   </div>
                   <span className="font-bold text-[11px] text-slate-900 uppercase truncate">
                     {profiles.find(p => p.id === viewingTask.assigned_to)?.full_name}
                   </span>
                </div>
             </div>
             <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm">
                <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Setor</p>
                <div className="flex items-center gap-2">
                   <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                   <span className="font-bold text-[11px] text-slate-900 uppercase">
                     {viewingTask.sector}
                   </span>
                </div>
             </div>
          </div>

          {/* DESCRIÇÃO - Agora com visual de Bloco de Notas */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 flex items-center gap-2">
              <FileText size={12}/> Instruções da Missão
            </label>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 text-slate-700 font-medium leading-relaxed whitespace-pre-wrap text-sm break-all shadow-sm">
              {viewingTask.notes || "Sem notas adicionais."}
            </div>
          </div>

          {/* CHECKLIST: Visual limpo e conectado */}
          {viewingTask.subtasks?.length > 0 && (
            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 text-center block">Checklist de Execução</label>
              <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-sm">
                {viewingTask.subtasks.map((sub: any, i: number) => (
                  <div key={i} className="flex items-center gap-4 p-4 transition-all">
                    {sub.done ? <CheckCircle2 size={18} className="text-green-500" /> : <div className="w-4 h-4 rounded-full border-2 border-slate-200" />}
                    <span className={`text-[10px] font-black uppercase ${sub.done ? 'line-through text-slate-300' : 'text-slate-600'}`}>{sub.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RODAPÉ: Integrado e fixo */}
        <div className="p-6 bg-white border-t border-slate-200 flex gap-3">
           {(userRole === 'admin' || userRole === 'gerente' || viewingTask.assigned_to === user.id) && (
              <button 
                onClick={() => { setEditingTask(viewingTask); setShowEditModal(true); setViewingTask(null); }} 
                className="flex-[2] bg-[#232D4A] text-white p-4 rounded-xl font-black uppercase tracking-widest hover:bg-blue-600 transition-all flex items-center justify-center gap-2 text-[11px] shadow-md"
              >
                <Edit3 size={16} /> Editar
              </button>
           )}
           <button 
             onClick={() => setViewingTask(null)}
             className="flex-1 py-4 rounded-xl border border-slate-200 font-black uppercase text-[10px] text-slate-400 hover:bg-slate-50 transition-all"
           >
             Sair
           </button>
        </div>
      </div>
    )}
  </div>
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
                          {/* Dentro do profiles.map no Modal de Configurações */}
<select 
  value={profile.sector || 'Geral'}
  onChange={async (e) => {
    const newS = e.target.value;
    await supabase.from('profiles').update({ sector: newS }).eq('id', profile.id);
    fetchProfiles(); // Recarrega a lista para mostrar a mudança
  }}
  className="text-[9px] font-black uppercase bg-white border-2 border-slate-900 rounded-lg px-2 py-1"
>
  <option value="Geral">Geral</option>
  <option value="Compras Perfumaria">Compras Perfumaria</option>
  <option value="Compras Medicamentos">Compras Medicamentos</option>
  <option value="Precificação">Precificação</option>
  <option value="Logística">Logística</option>
</select>
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

const TaskItem = memo(({ task, profiles, onUpdate, onEdit, userRole, currentUser, onView, onToggle, onDelete }: any) => {
  const [expanded, setExpanded] = useState(false);
  const isOwner = task.assigned_to === currentUser?.id;
  const canManage = userRole === 'admin' || userRole === 'gerente' || isOwner;
  const subtasks = task.subtasks || [];
  const subDone = subtasks.filter((s: any) => s.done).length;
  const subTotal = subtasks.length;
  const isLate = task.lastOcc < getTodayStr() && !task.isDoneToday && task.lastOcc !== '1970-01-01';

  const toggleSubtask = async (index: number) => {
    if (!canManage) return alert("Acesso negado.");
    const newSubtasks = [...subtasks];
    newSubtasks[index].done = !newSubtasks[index].done;
    const allDone = newSubtasks.length > 0 && newSubtasks.every((s: any) => s.done);
    const todayStr = getTodayStr();

    if (allDone && !task.isDoneToday) {
      const profile = profiles.find((p: any) => p.id === currentUser?.id);
      await supabase.from('task_history').insert([{
        task_id: task.id, task_title: task.title,
        user_name: profile?.full_name || currentUser?.email || 'Usuário',
        user_id: currentUser?.id, category: task.category, sector: task.sector
      }]);
    }

    await supabase.from('tasks').update({
      subtasks: newSubtasks,
      last_done_date: allDone ? todayStr : null,
      status: allDone ? 'concluido' : 'pendente'
    }).eq('id', task.id);
    onUpdate();
  };

  return (
    <div className={`relative flex flex-col transition-all duration-200 border-[3px] rounded-[24px] mb-2 group
      ${task.isDoneToday ? 'bg-green-400 border-green-200 opacity-80' : 
        isLate ? 'bg-red-400 border-red-200 shadow-[4px_4px_0px_0px_rgba(220,38,38,1)]' : 
        'bg-white border-slate-100 hover:border-slate-900 hover:shadow-[6px_6px_0px_0px_rgba(15,23,42,1)]'
      }`}
    >
      <div className="flex items-center gap-6 p-4 md:px-8">
        
        {/* CHECKBOX (VERDE) */}
        <div className="flex-shrink-0">
          <button 
            onClick={() => canManage ? onToggle(task) : alert("Acesso negado.")}  
            className={`w-12 h-12 rounded-full border-4 flex items-center justify-center transition-all
              ${task.isDoneToday ? 'bg-green-600 border-green-700 text-white' : 'bg-white border-slate-200 text-transparent hover:border-blue-500'}`}
          >
            <Check size={26} strokeWidth={4} />
          </button>
        </div>

        {/* INFO CENTRAL (TÍTULO + DESC + BADGES) */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="cursor-pointer select-none group/title" onClick={() => onView(task)}>
            <h3 className={`text-lg font-black uppercase tracking-tight leading-none transition-colors
              ${task.isDoneToday ? 'line-through text-green-900/40' : 'text-slate-900 group-hover:text-blue-600'}`}>
              {task.title}
            </h3>
            {task.notes && (
              <p className={`text-[10px] font-bold text-slate-400 italic line-clamp-1 mt-1 max-w-[400px]
                ${task.isDoneToday ? 'text-green-700/30' : ''}`}>
                {task.notes}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 mt-2">
             <span className="px-2.5 py-1 rounded-lg bg-[#232D4A] text-white text-[8px] font-black uppercase flex items-center gap-1.5 shadow-sm">
               <User size={10}/> {profiles.find((p: any) => p.id === task.assigned_to)?.full_name?.split(' ')[0]}
             </span>
             <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 text-[8px] font-black uppercase shadow-sm">
               {task.category}
             </span>
             <span className={`px-2.5 py-1 rounded-lg text-[8px] font-black uppercase border shadow-sm
               ${task.isDoneToday ? 'bg-green-100 border-green-200 text-green-700' : 
                 isLate ? 'bg-red-600 border-red-700 text-white animate-pulse' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
               {isLate ? `DESDE ${formatToBR(task.lastOcc)}` : `PRÓXIMA: ${task.nextOcc}`}
             </span>
          </div>
        </div>

        {/* PROGRESSO DE SUBTAREFAS */}
        <div className="flex-shrink-0 flex items-center gap-3">
          {subTotal > 0 && (
            <div 
              className={`flex items-center gap-3 px-4 py-2 rounded-2xl border-2 transition-all cursor-pointer
                ${expanded ? 'bg-[#232D4A] border-slate-900 text-white shadow-md' : 'bg-slate-50 border-slate-100 text-slate-500 hover:border-blue-400 hover:text-blue-600'}`}
              onClick={() => setExpanded(!expanded)}
            >
              <div className="flex items-center gap-2">
                <div className={`w-16 h-1.5 rounded-full overflow-hidden ${expanded ? 'bg-white/20' : 'bg-slate-200'}`}>
                   <div className={`${expanded ? 'bg-blue-400' : 'bg-blue-600'} h-full transition-all duration-500`} style={{ width: `${(subDone / subTotal) * 100}%` }} />
                </div>
                <span className="text-[10px] font-black whitespace-nowrap">{subDone}/{subTotal}</span>
              </div>
              <ChevronDown size={18} className={`transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
            </div>
          )}
        </div>

        {/* BOTÕES DE AÇÃO (FINAL) */}
        <div className="flex items-center gap-1 border-l-2 pl-4 border-slate-100 opacity-0 group-hover:opacity-100 transition-opacity">
          {canManage && (
            <>
              <button onClick={(e) => { e.stopPropagation(); onEdit(task); }} className="p-2 text-slate-300 hover:text-blue-600 transition-all">
                <Edit3 size={20}/>
              </button>
              <button onClick={(e) => { e.stopPropagation(); onDelete(task.id); }} className="p-2 text-slate-200 hover:text-red-600 transition-all">
                <Trash2 size={20}/>
              </button>
            </>
          )}
        </div>
      </div>

      {/* ÁREA EXPANSÍVEL (DENTRO DO CARD) */}
      {expanded && subTotal > 0 && (
        <div className="px-10 pb-6 space-y-2 animate-in slide-in-from-top-3 duration-300">
          <div className="h-[2px] bg-slate-100 mb-4 w-full" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {subtasks.map((sub: any, index: number) => (
              <div key={index} onClick={() => toggleSubtask(index)}
                className={`flex items-center gap-3 p-3 rounded-2xl border-2 transition-all cursor-pointer
                  ${sub.done ? 'bg-green-50/50 border-green-200 text-green-700 opacity-60' : 'bg-slate-50 border-slate-100 text-slate-700 hover:border-blue-400'}
                `}
              >
                <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all
                  ${sub.done ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-slate-300'}`}>
                  {sub.done && <Check size={12} strokeWidth={4} />}
                </div>
                <span className={`text-[10px] font-black uppercase ${sub.done ? 'line-through opacity-50' : ''}`}>{sub.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

TaskItem.displayName = 'TaskItem';

function DashboardCard({ label, val, color }: any) {
  return (<div className={`p-8 rounded-[40px] border-4 shadow-[10px_10px_0px_0px_rgba(15,23,42,1)] text-center transition-transform hover:scale-105 ${color}`}><span className="text-[10px] font-black uppercase tracking-[0.2em] block mb-2 opacity-40">{label}</span><span className="text-6xl font-black tracking-tighter">{val}</span></div>)
}

function Login() {
  const [identifier, setIdentifier] = useState(''); // Mudamos de 'email' para 'identifier'
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);

  const processAuth = async () => {
    let finalEmail = identifier;

    // --- LÓGICA DO USUÁRIO MESTRE ---
    // Se o usuário digitar 'ADMIN' (ou qualquer nome que você definir), 
    // o sistema converte para o e-mail secreto por baixo dos panos.
    if (identifier.toUpperCase() === 'ADMIN') {
      finalEmail = 'admin@wally.system'; // O e-mail que você criou no passo 1
    }

    const { error } = isSignUp 
      ? await supabase.auth.signUp({ email: finalEmail, password, options: { data: { full_name: identifier } } }) 
      : await supabase.auth.signInWithPassword({ email: finalEmail, password });
    
    if (error) alert("Acesso Negado: Credenciais Inválidas"); 
    else window.location.reload();
  };

  return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-4 text-center font-sans">
      <div className="bg-white p-12 rounded-[60px] w-full max-w-sm border-b-[24px] border-blue-600 shadow-2xl">
        
        <div className="mb-8 flex justify-center">
          <img src="/icon.png" alt="Logo" className="w-20 h-20 rounded-[24px] shadow-lg bg-blue-600 p-1" />
        </div>

        <h1 className="text-5xl font-black italic uppercase tracking-tighter text-slate-900 leading-none">
          WALLY<br/>
          <span className="text-blue-600 text-2xl tracking-[0.2em] font-medium opacity-80 uppercase not-italic">Acesso Restrito</span>
        </h1>

        <div className="space-y-4 mt-12">
          {/* O campo agora aceita NOME ou EMAIL */}
          <input 
            className="w-full p-6 bg-slate-50 border-4 border-slate-100 rounded-[28px] font-black text-slate-900 outline-none focus:border-blue-500 transition-all placeholder:text-slate-300 uppercase" 
            placeholder="USUÁRIO OU E-MAIL" 
            value={identifier}
            onChange={e => setIdentifier(e.target.value)} 
          />
          <input 
            className="w-full p-6 bg-slate-50 border-4 border-slate-100 rounded-[28px] font-black text-slate-900 outline-none focus:border-blue-500 transition-all placeholder:text-slate-300" 
            type="password" 
            placeholder="SENHA" 
            value={password}
            onChange={e => setPassword(e.target.value)} 
          />
          
          <button 
            onClick={processAuth} 
            className="w-full bg-[#0F172A] text-white p-6 rounded-[28px] font-black uppercase text-xl hover:bg-blue-600 transition-all shadow-xl mt-4"
          >
            Entrar no Sistema
          </button>

          {/* Escondemos o botão de "Criar conta" para o Admin Master não ser descoberto facilmente */}
          <button 
            onClick={() => setIsSignUp(!isSignUp)} 
            className="w-full text-[8px] font-black text-slate-200 uppercase tracking-widest text-center mt-6 hover:text-slate-400 transition-colors"
          >
            {isSignUp ? 'Voltar para Login' : 'Solicitar novo acesso à TI'}
          </button>
        </div>
      </div>
    </div>
  );
}