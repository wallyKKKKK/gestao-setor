
'use client'
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { AnnouncementBoard } from '@/app/components/announcement-board'
import { AppSection, AppSidebar } from '@/app/components/app-sidebar'
import { AppShellNav } from '@/app/components/app-shell-nav'
import { AuditTimeline } from '@/app/components/audit-timeline'
import { CreateTaskModal } from '@/app/components/create-task-modal'
import { DashboardView } from '@/app/components/dashboard-view'
import { EditTaskModal } from '@/app/components/edit-task-modal'
import { HistoryTimeline } from '@/app/components/history-timeline'
import { Login } from '@/app/components/login'
import { MeetingCalendarView } from '@/app/components/meeting-calendar-view'
import { PaymentTermsManager } from '@/app/components/payment-terms-manager'
import { PricingManager } from '@/app/components/pricing-manager'
import { ProfileModal } from '@/app/components/profile-modal'
import { SettingsModal } from '@/app/components/settings-modal'
import { TaskDrawer } from '@/app/components/task-drawer'
import { TaskListView } from '@/app/components/task-list-view'
import { useAnnouncementActions } from '@/app/hooks/use-announcement-actions'
import { useProfileActions } from '@/app/hooks/use-profile-actions'
import {
  addTaskHistory,
  addAuditLog,
  createMeeting,
  createTask,
  deleteTask as deleteTaskApi,
  fetchAnnouncements as fetchAnnouncementsApi,
  fetchAuditLogs,
  fetchCurrentProfile,
  fetchProfiles as fetchProfilesApi,
  fetchTaskHistory,
  fetchTasks as fetchTasksApi,
  updateTask as updateTaskApi,
  updateTaskCompletion,
} from '@/lib/api'
import { supabase } from '@/lib/supabase'
import type { RealtimeChannel, User as SupabaseUser } from '@supabase/supabase-js'
import { getTodayStr } from '@/lib/task-recurrence'
import { filterTasks, getSectorStats, getTaskStats, processTasks } from '@/lib/task-selectors'
import type { CreateMeetingInput } from '@/lib/api'
import type { Announcement, AuditLog, ProcessedTask, Profile, Subtask, Task, TaskHistory, UserRole } from '@/lib/types'
import { Plus, X } from 'lucide-react'

export default function App() {
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [userRole, setUserRole] = useState<UserRole>('membro')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [history, setHistory] = useState<TaskHistory[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  
  const [activeSection, setActiveSection] = useState<AppSection>('TAREFAS')
  const [activeTab, setActiveTab] = useState('HOJE')
  const [dashFilter, setDashFilter] = useState<'HOJE' | 'SEMANAL'>('HOJE')
  const [filterUsers, setFilterUsers] = useState<string[]>([])
  const [showCreateBox, setShowCreateBox] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
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
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [displayDate, setDisplayDate] = useState('DD/MM/YYYY');
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [editDisplayDate, setEditDisplayDate] = useState('DD/MM/YYYY');
  const editDateInputRef = useRef<HTMLInputElement>(null);
  const [editMode, setEditMode] = useState('semanal');
  const [searchTerm, setSearchTerm] = useState('');
  const [userSector, setUserSector] = useState('Geral');
  const [showAssignMenu, setShowAssignMenu] = useState(false);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);

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

  const processedTasks = useMemo(() => processTasks(tasks), [tasks]);

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

  const fetchAudit = useCallback(async () => {
    if (userRole !== 'admin') return;
    try {
      const data = await fetchAuditLogs();
      setAuditLogs(data);
    } catch (error) {
      console.error('Erro ao carregar auditoria:', error);
      setAuditLogs([]);
    }
  }, [userRole]);

  const fetchAnnouncements = useCallback(async () => {
    const data = await fetchAnnouncementsApi();
    setAnnouncements(data);
  }, []);

  const announcementActions = useAnnouncementActions({
    user,
    userSector,
    onChanged: fetchAnnouncements,
  });

  const {
    newName,
    setNewName,
    changeRole,
    changeSector,
    changeAccountStatus,
    changeActive,
    updateProfile,
    signOut,
  } = useProfileActions({
    user,
    onProfilesChanged: fetchProfiles,
    onRoleChanged: setUserRole,
    onProfileSaved: () => setShowProfileModal(false),
    setProfiles,
  });

  useEffect(() => {
  let channel: RealtimeChannel | null = null; // Canal reaproveitado na limpeza

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session?.user) {
      setUser(session.user);
      setAssignedTo(session.user.id);
      
      fetchCurrentProfile(session.user.id).then((data) => {
        if (data) {
          const isBlocked = data.is_active === false || data.account_status === 'pending' || data.account_status === 'rejected';

          if (isBlocked) {
            alert('Sua conta ainda não foi aprovada ou está bloqueada. Fale com um administrador.');
            supabase.auth.signOut().then(() => window.location.reload());
            return;
          }

          setUserRole((data.role as UserRole) || 'membro');
          setNewName(data.full_name || '');
          setUserSector(data.sector || 'Geral');
        }
      });
      
      fetchProfiles(); 
      fetchTasks(); 
      fetchHistory();
      fetchAudit();
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
}, [fetchAnnouncements, fetchAudit, fetchHistory, fetchProfiles, fetchTasks, setNewName]);

  const openEditTaskModal = useCallback((task: ProcessedTask) => {
    setEditingTask(task);
    const isMonthly = task.repeat_days && !task.repeat_days.includes(',') && !isNaN(parseInt(task.repeat_days));
    setEditMode(isMonthly ? 'mensal' : 'semanal');
    setEditDisplayDate(isMonthly ? `DIA ${task.repeat_days} (MANTIDO)` : 'DD/MM/YYYY');
    setShowEditModal(true);
  }, []);

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

  const addAudit = useCallback(async (
    action: string,
    entityType: string,
    entityId: string | null,
    entityTitle: string | null,
    sector: string,
    details?: string,
  ) => {
    if (!user) return;
    const profile = profiles.find((item) => item.id === user.id);

    try {
      await addAuditLog({
        actorId: user.id,
        actorName: profile?.full_name || user.email || 'Usuário',
        action,
        entityType,
        entityId,
        entityTitle,
        sector,
        details,
      });
      fetchAudit();
    } catch (error) {
      console.error('Erro ao registrar auditoria:', error);
    }
  }, [fetchAudit, profiles, user]);

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
    await addAudit('task_created', 'task', null, taskTitle, userSector, `Categoria: ${category}`);
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
    await addAudit(isCurrentlyDone ? 'task_reopened' : 'task_completed', 'task', task.id, task.title, task.sector);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    alert("Erro ao salvar: " + message);
    fetchTasks();
  }
}, [addAudit, fetchTasks, user, profiles]);

const deleteTask = useCallback(async (taskId: string) => {
  const taskToDelete = tasks.find((task) => task.id === taskId);
  if (!confirm('Deseja realmente deletar esta tarefa?')) return;

  const shouldDeleteGoogleEvent = Boolean(
    taskToDelete?.google_event_id &&
    confirm('Esta reunião está vinculada ao Google Calendar. Deseja excluir o evento do Google também?')
  );

  setTasks(prev => prev.filter(t => t.id !== taskId));

  try {
    if (shouldDeleteGoogleEvent && taskToDelete?.google_event_id && user?.id) {
      const response = await fetch(`/api/google-calendar/events?userId=${user.id}&eventId=${encodeURIComponent(taskToDelete.google_event_id)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        alert(data?.error || 'A tarefa será excluída, mas não foi possível excluir o evento do Google Calendar.');
      }
    }

    await deleteTaskApi(taskId);
    if (taskToDelete) {
      await addAudit('task_deleted', taskToDelete.category === 'Reunião' ? 'meeting' : 'task', taskToDelete.id, taskToDelete.title, taskToDelete.sector);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    alert("Erro ao deletar: " + message);
    fetchTasks();
  }
}, [addAudit, fetchTasks, tasks, user]);

const addMeeting = useCallback(async (meeting: CreateMeetingInput) => {
  try {
    await createMeeting(meeting);
    await fetchTasks();
    await addAudit('meeting_created', 'meeting', null, meeting.title, meeting.sector, `${meeting.date} ${meeting.time}`);
    alert('Reunião agendada com sucesso!');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    alert('Erro ao agendar reunião: ' + message);
  }
}, [addAudit, fetchTasks]);

const updateMeeting = useCallback(async (task: ProcessedTask, meeting: CreateMeetingInput) => {
  const details = [
    `Horário: ${meeting.time}`,
    `Motivo: ${meeting.motive}`,
    meeting.location ? `Local: ${meeting.location}` : null,
    meeting.notes ? `Observações: ${meeting.notes}` : null,
  ].filter(Boolean).join('\n');

  try {
    await updateTaskApi({
      id: task.id,
      title: meeting.title,
      notes: details,
      assignedTo: meeting.assignedTo,
      category: 'Reunião',
      repeatDays: '',
      repeatInterval: 1,
      subtasks: task.subtasks || [],
      dueDate: meeting.date,
      sector: meeting.sector,
    });
    await fetchTasks();
    await addAudit('task_updated', 'meeting', task.id, meeting.title, meeting.sector, `${meeting.date} ${meeting.time}`);
    alert('Reunião atualizada com sucesso!');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    alert('Erro ao atualizar reunião: ' + message);
  }
}, [addAudit, fetchTasks]);

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
    await addAudit('task_updated', 'task', editingTask.id, editingTask.title, editingTask.sector, `Categoria: ${editingTask.category}`);
    alert("Tarefa atualizada com sucesso!");
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error("Erro Supabase:", error);
    alert(`Erro ao salvar: ${message}`);
  }
}
  const filteredTasks = useMemo(() => filterTasks({
    tasks: processedTasks,
    activeTab,
    filterUsers,
    userRole,
    userSector,
    userId: user?.id,
    searchTerm,
  }), [processedTasks, activeTab, filterUsers, userRole, userSector, user?.id, searchTerm]);

  const stats = useMemo(
    () => getTaskStats({ tasks: processedTasks, dashFilter, filterUsers, userRole, userSector }),
    [processedTasks, dashFilter, filterUsers, userRole, userSector],
  );

  const sectorStats = useMemo(
    () => getSectorStats({ tasks: processedTasks, dashFilter, userRole, userSector }),
    [processedTasks, dashFilter, userRole, userSector],
  );

  const meetingTasks = useMemo(() => {
    return processedTasks.filter((task) => {
      if (task.category !== 'Reunião') return false;
      return userRole === 'admin' || task.sector === userSector;
    });
  }, [processedTasks, userRole, userSector]);

  const canAccessPricing = userRole === 'admin' || ['precificação', 'price'].includes(userSector.toLowerCase());
  const canAccessPaymentTerms = userRole === 'admin' || userSector.toLowerCase().startsWith('compras');
  const visibleSection =
    (activeSection === 'AUDITORIA' && userRole !== 'admin') ||
    (activeSection === 'PRECIFICACAO' && !canAccessPricing) ||
    (activeSection === 'PRAZOS' && !canAccessPaymentTerms)
      ? 'TAREFAS'
      : activeSection;

  if (!user) return <Login />

  return (
    <div className="min-h-screen bg-[#E8EEF7] text-slate-900 pb-24 md:pb-20 font-sans overflow-x-hidden w-full">
      <AppSidebar
        activeSection={visibleSection}
        userRole={userRole}
        userSector={userSector}
        onSectionChange={(section) => {
          setActiveSection(section);
          if (section === 'AUDITORIA') {
            fetchAudit();
          }
        }}
      />

      <div className="md:pl-24">
      {visibleSection === 'TAREFAS' ? (
        <>
        <AppShellNav
        userId={user.id}
        userRole={userRole}
        profiles={profiles}
        activeTab={activeTab}
        filterUsers={filterUsers}
        userSector={userSector}
        searchTerm={searchTerm}
        onActiveTabChange={(tab) => { setActiveTab(tab); setShowCreateBox(false); }}
        onFilterUsersChange={setFilterUsers}
        onSearchTermChange={setSearchTerm}
        onOpenProfile={() => setShowProfileModal(true)}
        onOpenSettings={() => setShowSettingsModal(true)}
      />

      <main className="max-w-4xl mx-auto p-4">
  {activeTab === 'DASHBOARD' ? (
    <DashboardView filter={dashFilter} onFilterChange={setDashFilter} stats={stats} sectorStats={sectorStats} />
  ) : activeTab === 'HISTÓRICO' ? (
    <HistoryTimeline history={history} userRole={userRole} userSector={userSector} />
  ) : activeTab === 'COMUNICADOS' ? (
    <AnnouncementBoard
      announcements={announcements}
      userRole={userRole}
      userSector={userSector}
      user={user}
      title={announcementActions.title}
      content={announcementActions.content}
      image={announcementActions.image}
      uploading={announcementActions.uploading}
      onTitleChange={announcementActions.setTitle}
      onContentChange={announcementActions.setContent}
      onImageChange={announcementActions.setImage}
      onAdd={announcementActions.addAnnouncement}
      onDelete={announcementActions.removeAnnouncement}
    />
) : (
    /* Aba padrao de tarefas */
    <>
      <div className="max-w-4xl mx-auto mt-5 mb-6 px-4 sm:px-16 lg:px-60">
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
      <TaskListView
        activeTab={activeTab}
        tasks={filteredTasks}
        profiles={profiles}
        userRole={userRole}
        currentUser={user}
        onToggle={toggleComplete}
        onView={setViewingTask}
        onEdit={openEditTaskModal}
        onUpdate={fetchTasks}
        onDelete={deleteTask}
      />
    </>
  )}
</main>
        </>
      ) : visibleSection === 'REUNIAO' ? (
        <MeetingCalendarView
          tasks={meetingTasks}
          profiles={profiles}
          userSector={userSector}
          defaultAssignedTo={user.id}
          onViewTask={setViewingTask}
          onDeleteTask={deleteTask}
          onCreateMeeting={addMeeting}
          onUpdateMeeting={updateMeeting}
        />
      ) : visibleSection === 'PRECIFICACAO' ? (
        <PricingManager />
      ) : visibleSection === 'PRAZOS' ? (
        <PaymentTermsManager />
      ) : (
        <main className="max-w-5xl mx-auto p-4 pt-8">
          <AuditTimeline logs={auditLogs} />
        </main>
      )}
      </div>

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
          onAccountStatusChange={changeAccountStatus}
          onActiveChange={changeActive}
          onSignOut={signOut}
        />
      )}

    </div> 
  );
}
