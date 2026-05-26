
'use client'
import Image from 'next/image'
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { GLOBAL_MEMBER_TABS, NAV_CATEGORIES } from '@/app/constants'
import { AnnouncementBoard } from '@/app/components/announcement-board'
import { CreateTaskModal } from '@/app/components/create-task-modal'
import { DashboardView } from '@/app/components/dashboard-view'
import { EditTaskModal } from '@/app/components/edit-task-modal'
import { HistoryTimeline } from '@/app/components/history-timeline'
import { Login } from '@/app/components/login'
import { ProfileModal } from '@/app/components/profile-modal'
import { SettingsModal } from '@/app/components/settings-modal'
import { TaskDrawer } from '@/app/components/task-drawer'
import { TaskItem } from '@/app/components/task-item'
import {
  addTaskHistory,
  createAnnouncement,
  createTask,
  deleteAnnouncement,
  deleteTask as deleteTaskApi,
  fetchAnnouncements as fetchAnnouncementsApi,
  fetchCurrentProfile,
  fetchProfiles as fetchProfilesApi,
  fetchTaskHistory,
  fetchTasks as fetchTasksApi,
  updateTask as updateTaskApi,
  updateTaskCompletion,
  updateProfileName,
  updateProfileRole,
  updateProfileSector,
} from '@/lib/api'
import { supabase } from '@/lib/supabase'
import type { RealtimeChannel, User as SupabaseUser } from '@supabase/supabase-js'
import { getLastOccurrence, getNextOccurrence, getTodayStr } from '@/lib/task-recurrence'
import type { Announcement, ProcessedTask, Profile, Subtask, Task, TaskHistory, UserRole } from '@/lib/types'
import { 
  Plus, X,
  ChevronRight, ChevronDown, Settings, Search, Filter,
} from 'lucide-react'

export default function App() {
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [userRole, setUserRole] = useState<UserRole>('membro')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [history, setHistory] = useState<TaskHistory[]>([])
  
  const [activeTab, setActiveTab] = useState('HOJE')
  const [dashFilter, setDashFilter] = useState<'HOJE' | 'SEMANAL'>('HOJE')
  const [filterUser, setFilterUser] = useState('Todos')
  const [showCreateBox, setShowCreateBox] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingTask, setEditingTask] = useState<ProcessedTask | null>(null)

  const [taskTitle, setTaskTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [category, setCategory] = useState('Trade')
  const [repeatInterval, setRepeatInterval] = useState(1)
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const [tempSubtasks, setTempSubtasks] = useState<{title: string, done: boolean}[]>([])
  const [viewingTask, setViewingTask] = useState<ProcessedTask | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
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

  // Trava o scroll do fundo quando modais estao abertos
useEffect(() => {
  // Verifica se algum modal esta aberto
  const isAnyModalOpen = showCreateBox || showSettingsModal || showProfileModal || showEditModal;

  if (isAnyModalOpen) {
    // Trava o scroll no corpo da pagina
    document.body.style.overflow = 'hidden';
  } else {
    // Libera o scroll quando tudo fechar
    document.body.style.overflow = 'unset';
  }

  // Limpeza de seguranca caso o componente feche inesperadamente
  return () => {
    document.body.style.overflow = 'unset';
  };
}, [showCreateBox, showSettingsModal, showProfileModal, showEditModal]);

  // Calcula a recorrencia das tarefas apenas quando necessario
  const processedTasks = useMemo<ProcessedTask[]>(() => {
  const today = getTodayStr();

  return tasks.map((task: Task) => {
    const last = getLastOccurrence(task);
    const next = getNextOccurrence(task);
    
    // Considera pronta se foi feita hoje ou se a ultima conclusao cobre a data prevista
    const doneToday = (task.last_done_date === today) || (task.last_done_date && task.last_done_date >= last);

    return {
      ...task,
      lastOcc: last,
      nextOcc: next,
      isDoneToday: !!doneToday // O !! garante que seja um valor verdadeiro/falso (booleano)
    };
  });
}, [tasks]);

  const fetchProfiles = useCallback(async () => {
    const data = await fetchProfilesApi();
    setProfiles(data);
  }, []);

  const fetchTasks = useCallback(async () => {
    const data = await fetchTasksApi();
    setTasks(data);
  }, []);

  const fetchHistory = useCallback(async () => {
    const data = await fetchTaskHistory();
    setHistory(data);
  }, []);

  const fetchAnnouncements = useCallback(async () => {
    const data = await fetchAnnouncementsApi();
    setAnnouncements(data);
  }, []);

  useEffect(() => {
  let channel: RealtimeChannel | null = null; // Canal reaproveitado na limpeza

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session?.user) {
      setUser(session.user);
      setAssignedTo(session.user.id);
      
      fetchCurrentProfile(session.user.id).then((data) => {
        if (data) {
          setUserRole((data.role as UserRole) || 'membro');
          setNewName(data.full_name || '');
          setUserSector(data.sector || 'Geral');
        }
      });
      
      fetchProfiles(); 
      fetchTasks(); 
      fetchHistory();
      fetchAnnouncements();

      // Configuracao do realtime
      // 1. Criamos o canal
      // 2. Adicionamos o evento .on ANTES do .subscribe
      channel = supabase
        .channel('db-realtime-tasks') // Nome unico para o canal
        .on(
          'postgres_changes', 
          { event: '*', schema: 'public', table: 'tasks' }, 
          (payload) => {
            console.log("Mudanca detectada!", payload);
            fetchTasks(); 
          }
        )
        .subscribe((status) => {
          console.log("Status da conexao realtime:", status);
        });
    }
  });

  // Limpeza do canal realtime para evitar subscriptions duplicadas
  return () => {
    if (channel) {
      supabase.removeChannel(channel);
    }
  };
}, [fetchAnnouncements, fetchHistory, fetchProfiles, fetchTasks]);


  async function changeRole(profileId: string, newRole: UserRole) {
  // 1. Atualiza o perfil no Supabase
  try {
    await updateProfileRole(profileId, newRole);
    // 2. Atualiza o estado local
    // UserRole garante que newRole seja um cargo valido.

    setProfiles((prevProfiles: Profile[]) => 
      prevProfiles.map(p => 
    p.id === profileId ? { ...p, role: newRole } : p
  )
);

    if (profileId === user?.id) {
      setUserRole(newRole);
    }

    alert("Cargo atualizado com sucesso!");
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    alert("Erro ao mudar cargo: " + message);
  }
}

  async function addAnnouncement() {
  if (!annTitle || !annContent || !user) return;
  setUploading(true);

  try {
    await createAnnouncement({
      title: annTitle,
      content: annContent,
      createdBy: user.id,
      sector: userSector,
      image: annImage,
    });
    setAnnTitle(''); setAnnContent(''); setAnnImage(null);
    fetchAnnouncements();
    alert("Alerta transmitido!");
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    alert("Erro ao transmitir alerta: " + message);
  } finally {
    setUploading(false);
  }
}

  const removeAnnouncement = useCallback(async (announcementId: string) => {
    await deleteAnnouncement(announcementId);
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  const changeSector = useCallback(async (profileId: string, sector: string) => {
    await updateProfileSector(profileId, sector);
    fetchProfiles();
  }, [fetchProfiles]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    window.location.reload();
  }, []);

  async function updateProfile() {
  if (!user?.id) return;

  try {
    await updateProfileName(user.id, newName);
    alert("Perfil atualizado com sucesso!");
    setShowProfileModal(false);
    
    // Atualiza o estado local para o nome mudar na tela sem precisar de F5
    setProfiles((prev: Profile[]) => 
      prev.map(p => p.id === user.id ? { ...p, full_name: newName } : p)
    );
    
    fetchProfiles(); // Recarrega por seguranca
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    alert("Erro do Banco: " + message);
    console.error("Erro completo:", error);
  }
}
  // Marca/desmarca dias na criacao de nova tarefa
const toggleDay = (day: string) => {
  setSelectedDays((prev: string[]) => 
    prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
  )
}

// Marca/desmarca dias na edicao de tarefa existente
const toggleDayInEdit = (day: string) => {
  if (!editingTask) return;
  const currentDays = editingTask.repeat_days ? editingTask.repeat_days.split(',') : []
  const newDays = currentDays.includes(day) 
    ? currentDays.filter((d: string) => d !== day) 
    : [...currentDays, day]
  
  setEditingTask({ ...editingTask, repeat_days: newDays.join(',') })
}

  async function addTask() {
  if (!taskTitle) return;
  
  // Detecta recorrencia mensal e semanal
  const isRecurring = selectedDays.length > 0;

  try {
    await createTask({
      title: taskTitle,
      assignedTo,
      category,
      notes,
      repeatDays: selectedDays.join(','),
      repeatInterval,
      subtasks: tempSubtasks,
      dueDate: isRecurring ? null : getTodayStr(),
      sector: userSector,
    });
    setTaskTitle('');
    setDisplayDate('DD/MM/YYYY'); 
    setNotes(''); 
    setSelectedDays([]); 
    setTempSubtasks([]); 
    setShowCreateBox(false); 
    fetchTasks(); 
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    alert("Erro ao lançar tarefa: " + message);
  }
}
  // Marca ou desmarca a conclusao da tarefa
  const toggleComplete = useCallback(async (task: ProcessedTask) => {
  if (!user) return;

  const todayStr = getTodayStr();
  const isCurrentlyDone = task.isDoneToday;
  const newDate = isCurrentlyDone ? null : todayStr;

  const updatedSubtasks = (task.subtasks || []).map((sub: Subtask) => ({
    ...sub,
    done: !isCurrentlyDone
  }));

  // Optimistic Update
  setTasks(prevTasks => prevTasks.map(t => 
    t.id === task.id ? { ...t, last_done_date: newDate, subtasks: updatedSubtasks } : t
  ));

  if (!isCurrentlyDone) {
    const profile = profiles.find(p => p.id === user.id);
    await addTaskHistory({
      taskId: task.id,
      taskTitle: task.title,
      userName: profile?.full_name || user.email || 'Usuário',
      userId: user.id,
      category: task.category,
      sector: task.sector,
    });
  }

  try {
    await updateTaskCompletion(task.id, newDate, updatedSubtasks);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    alert("Erro ao salvar: " + message);
    fetchTasks();
  }
}, [fetchTasks, user, profiles]);

const deleteTask = useCallback(async (taskId: string) => {
  if (!confirm('Deseja realmente deletar esta tarefa?')) return;

  setTasks(prev => prev.filter(t => t.id !== taskId));

  try {
    await deleteTaskApi(taskId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    alert("Erro ao deletar: " + message);
    fetchTasks();
  }
}, [fetchTasks]);

  async function updateTask() {
  if (!editingTask) return;

  console.log("Tentando atualizar tarefa:", editingTask.id);

  try {
    await updateTaskApi({
      id: editingTask.id,
      title: editingTask.title,
      notes: editingTask.notes,
      assignedTo: editingTask.assigned_to,
      category: editingTask.category,
      repeatDays: editingTask.repeat_days,
      repeatInterval: editingTask.repeat_interval,
      subtasks: editingTask.subtasks,
    });
    setShowEditModal(false); 
    setEditingTask(null); 
    fetchTasks(); 
    alert("Tarefa atualizada com sucesso!");
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error("Erro Supabase:", error);
    alert(`Erro ao salvar: ${message}`);
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

    if (userRole === 'membro' && !GLOBAL_MEMBER_TABS.includes(activeTab) && task.assigned_to !== user?.id) return false;
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
  
  // Calcula a segunda-feira da semana atual
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  monday.setHours(0,0,0,0);

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
}, [processedTasks, dashFilter, filterUser]);

  if (!user) return <Login />

  return (
    <div className="min-h-screen bg-[#E8EEF7] text-slate-900 pb-20 font-sans overflow-x-hidden w-full">
      <nav className="bg-[#232D4A] text-white sticky top-0 z-30 shadow-white-100xl border-b border-white/10 px-6 h-20 flex justify-between items-center">
 {/* NAVBAR LOGO */}
<div className="flex items-center gap-3">
  {/* Bloco do logo */}
  <Image 
    src="/icon.png" 
    alt="Logo" 
    width={40}
    height={40}
    className="w-10 h-10 rounded-xl shadow-lg object-contain bg-blue-600 p-1" 
  />
  
  <h1 className="text-xl font-black italic tracking-tighter uppercase">
    WALLY<span className="text-blue-500 text-sm block not-italic font-medium">Task Manager</span>
  </h1>
</div>

  {/* Botoes da direita */}
  <div className="flex items-center gap-4">
    {/* Botao de perfil */}
    <button 
      onClick={() => setShowProfileModal(true)} 
      className="flex items-center gap-3 bg-white/5 pl-2 pr-4 py-1.5 rounded-full border border-white/10 hover:bg-white/10 transition-all shadow-sm"
    >
      <div className="w-8 h-8 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-full flex items-center justify-center text-[10px] font-black shadow-lg">
        {profiles.find(p => p.id === user.id)?.full_name?.charAt(0) || 'U'}
      </div>
      <span className="text-[11px] font-bold uppercase text-slate-300 hidden md:block">
        {profiles.find(p => p.id === user.id)?.full_name || 'Meu Perfil'} 
        {userRole === 'admin' ? ' ADMIN' : userRole === 'gerente' ? ' GERENTE' : ''}
      </span>
    </button>
    
    {/* Botao de configuracoes */}
    <button 
      onClick={() => setShowSettingsModal(true)} 
      className="w-10 h-10 flex items-center justify-center bg-white/5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all"
    >
      <Settings size={20} />
    </button>
  </div>
</nav>

      {/* Area de controle */}
<div className="sticky top-20 z-30 w-full">
  
  {/* LINHA 1: ABAS NO FUNDO CINZA CLARO */}
  <div className="bg-[#DCE7F5] border-b border-slate-200 pt-6 px-4">
    <div className="max-w-[99%] mx-auto flex items-end justify-center gap-2 overflow-x-auto no-scrollbar">
      {NAV_CATEGORIES.map(tab => {
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

  {/* Barra de comando compacta */}
  <div className="bg-[#F6F7F9] border-b-2 border-slate-200 pt-10 pb-8 px-10 relative z-10 -mt-[2px]">
   <div className="max-w-[98%] mx-auto flex items-center justify-between gap-8">
      
      {/* SELETOR DE EQUIPE DROPDOWN (SUBSTITUI OS NOMES ESPALHADOS) */}
      <div className="relative">
       <button 
  type="button"
  onClick={() => setShowUserMenu(!showUserMenu)}
  className={`
    h-12 px-6 rounded-2xl border-2 font-black text-[10px] uppercase flex items-center gap-3 whitespace-nowrap relative
    
    /* Efeito fisico sem delay */
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

        {/* Menu de usuarios com filtro de setor */}
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
          Equipe Total {userRole === 'admin' ? '' : `(${userSector})`}
        </button>
        
        <div className="h-[1px] bg-slate-100 my-1"></div>

        {/* --- FILTRAGEM AQUI --- */}
        {profiles
          .filter(p => userRole === 'admin' || p.sector === userSector) // Admin ve todos; os demais veem o proprio setor
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

      {/* Area de pesquisa */}
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
    <DashboardView filter={dashFilter} onFilterChange={setDashFilter} stats={stats} />
  ) : activeTab === 'HISTÓRICO' ? (
    <HistoryTimeline history={history} userRole={userRole} userSector={userSector} />
  ) : activeTab === 'COMUNICADOS' ? (
    <AnnouncementBoard
      announcements={announcements}
      userRole={userRole}
      userSector={userSector}
      user={user}
      title={annTitle}
      content={annContent}
      image={annImage}
      uploading={uploading}
      onTitleChange={setAnnTitle}
      onContentChange={setAnnContent}
      onImageChange={setAnnImage}
      onAdd={addAnnouncement}
      onDelete={removeAnnouncement}
    />
) : (
    /* Aba padrao de tarefas */
    <>
      <div className="max-w-4xl mx-auto mt-5 mb-6 px-60">
        <button onClick={() => setShowCreateBox(!showCreateBox)} className={`w-full py-5 rounded-[32px] font-black uppercase tracking-[0.2em] text-[11px] transition-all duration-500 flex items-center justify-center gap-3 border-2 ${showCreateBox ? 'bg-slate-100 border-slate-200 text-slate-400' : 'bg-white border-slate-100 text-slate-900 shadow-[10px_10px_0px_0px_rgba(15,23,42,1)] hover:translate-x-1 hover:translate-y-1'}`}>
          {showCreateBox ? <><X size={20} /> Cancelar Operação</> : <><Plus size={20} strokeWidth={3} className="text-blue-600" /> Lançar Nova Tarefa</>}
        </button>
      </div>

     {/* ----------------------------------------------------------- */}
{/* Modal flutuante: lancar nova tarefa */}
{/* ----------------------------------------------------------- */}
{showCreateBox && (
  <CreateTaskModal
    taskTitle={taskTitle}
    setTaskTitle={setTaskTitle}
    notes={notes}
    setNotes={setNotes}
    assignedTo={assignedTo}
    setAssignedTo={setAssignedTo}
    category={category}
    setCategory={setCategory}
    repeatInterval={repeatInterval}
    setRepeatInterval={setRepeatInterval}
    selectedDays={selectedDays}
    setSelectedDays={setSelectedDays}
    tempSubtasks={tempSubtasks}
    setTempSubtasks={setTempSubtasks}
    displayDate={displayDate}
    setDisplayDate={setDisplayDate}
    dateInputRef={dateInputRef}
    profiles={profiles}
    userRole={userRole}
    userSector={userSector}
    showAssignMenu={showAssignMenu}
    setShowAssignMenu={setShowAssignMenu}
    showCategoryMenu={showCategoryMenu}
    setShowCategoryMenu={setShowCategoryMenu}
    onToggleDay={toggleDay}
    onClose={() => setShowCreateBox(false)}
    onSave={addTask}
  />
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
    onEdit={(t: ProcessedTask) => { 
  setEditingTask(t); 
  const isMonthly = t.repeat_days && !t.repeat_days.includes(',') && !isNaN(parseInt(t.repeat_days));
  setEditMode(isMonthly ? 'mensal' : 'semanal');
  
  // Se for mensal, mostra o dia atual na legenda; senao, usa o padrao
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
        <ProfileModal
          newName={newName}
          onNameChange={setNewName}
          onSave={updateProfile}
          onClose={() => setShowProfileModal(false)}
        />
      )}

      {/* ----------------------------------------------------------- */}
{/* Modal flutuante: editar tarefa */}
{/* ----------------------------------------------------------- */}
{showEditModal && editingTask && (
  <EditTaskModal
    task={editingTask}
    setTask={setEditingTask}
    profiles={profiles}
    userRole={userRole}
    userSector={userSector}
    editMode={editMode}
    setEditMode={setEditMode}
    editDisplayDate={editDisplayDate}
    setEditDisplayDate={setEditDisplayDate}
    editDateInputRef={editDateInputRef}
    showAssignMenu={showAssignMenu}
    setShowAssignMenu={setShowAssignMenu}
    showCategoryMenu={showCategoryMenu}
    setShowCategoryMenu={setShowCategoryMenu}
    onToggleDay={toggleDayInEdit}
    onClose={() => setShowEditModal(false)}
    onSave={updateTask}
  />
      )}<TaskDrawer
  task={viewingTask}
  profiles={profiles}
  user={user}
  userRole={userRole}
  onClose={() => setViewingTask(null)}
  onEdit={(task) => { setEditingTask(task); setShowEditModal(true); setViewingTask(null); }}
/>
      {/* Modal de configuracoes */}
      {showSettingsModal && (
        <SettingsModal
          profiles={profiles}
          userRole={userRole}
          onClose={() => setShowSettingsModal(false)}
          onRoleChange={changeRole}
          onSectorChange={changeSector}
          onSignOut={signOut}
        />
      )}

    </div> // Fim do div principal
  );
} // Fim do export default
