'use client'
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { AnnouncementBoard } from '@/app/components/announcement-board'
import { AppSection, AppSidebar } from '@/app/components/app-sidebar'
import { AppShellNav } from '@/app/components/app-shell-nav'
import { CreateTaskModal } from '@/app/components/create-task-modal'
import { DashboardView } from '@/app/components/dashboard-view'
import { EditTaskModal } from '@/app/components/edit-task-modal'
import { HistoryTimeline } from '@/app/components/history-timeline'
import { Login } from '@/app/components/login'
import { ProfileModal } from '@/app/components/profile-modal'
import { PurchaseAssistant } from '@/app/components/purchase-assistant'
import { SettingsModal } from '@/app/components/settings-modal'
import { TaskDrawer } from '@/app/components/task-drawer'
import { TaskListView } from '@/app/components/task-list-view'
import { showSystemToast } from '@/app/components/system-toast'
import { NAV_CATEGORIES } from '@/app/constants'
import { useAnnouncementActions } from '@/app/hooks/use-announcement-actions'
import { useProfileActions } from '@/app/hooks/use-profile-actions'
import {
  addTaskHistory,
  addAuditLog,
  createAppNotification,
  createMeeting,
  createTask,
  deleteTask as deleteTaskApi,
  fetchAppNotifications,
  fetchAnnouncements as fetchAnnouncementsApi,
  fetchAuditLogs,
  fetchCurrentProfile,
  fetchPricingMarginRules,
  fetchProfiles as fetchProfilesApi,
  fetchTaskHistory,
  fetchTasks as fetchTasksApi,
  fetchTradeTaskNoteTaskIds,
  updateTask as updateTaskApi,
  updateTaskCompletion,
  updateTaskScheduleOverride,
} from '@/lib/api'
import { getAuthHeaders } from '@/lib/auth-headers'
import { supabase } from '@/lib/supabase'
import { getAppPermissions, getPermissionDeniedMessage, isPerfumePurchasingSector } from '@/lib/permissions'
import type { RealtimeChannel, User as SupabaseUser } from '@supabase/supabase-js'
import { addDaysToDateStr, getTodayStr, parseMonthlyWeekdayRepeat } from '@/lib/task-recurrence'
import { filterTasks, getSectorStats, getTaskStats, processTasks } from '@/lib/task-selectors'
import type { CreateMeetingInput } from '@/lib/api'
import { DEFAULT_TASK_PRIORITY } from '@/lib/task-priority'
import { MARGIN_FLOW_CATEGORY, canUseMarginFlowTasks, parseMarginFlowTaskNotes } from '@/lib/margin-flow-task'
import type { Announcement, AppDbNotification, AppNotification, AuditLog, NotificationPreferences, PricingMarginRule, ProcessedTask, Profile, Subtask, Task, TaskHistory, TaskPriority, UserRole } from '@/lib/types'
import { ArrowRight, Plus, Search, X } from 'lucide-react'

const SectionLoader = () => (
  <main className="max-w-5xl mx-auto p-6">
    <div className="rounded-[28px] border-2 border-slate-100 bg-white p-8 text-center text-[10px] font-black uppercase tracking-widest text-slate-300">
      Carregando interface...
    </div>
  </main>
)

const DEFAULT_TASK_CATEGORY = 'Geral'

const AuditTimeline = dynamic(() => import('@/app/components/audit-timeline').then((mod) => mod.AuditTimeline), { loading: SectionLoader })
const MeetingCalendarView = dynamic(() => import('@/app/components/meeting-calendar-view').then((mod) => mod.MeetingCalendarView), { loading: SectionLoader })
const PaymentTermsManager = dynamic(() => import('@/app/components/payment-terms-manager').then((mod) => mod.PaymentTermsManager), { loading: SectionLoader })
const PricingManager = dynamic(() => import('@/app/components/pricing-manager').then((mod) => mod.PricingManager), { loading: SectionLoader })
const ReallocationManager = dynamic(() => import('@/app/components/reallocation-manager').then((mod) => mod.ReallocationManager), { loading: SectionLoader })
const RegistrationsManager = dynamic(() => import('@/app/components/registrations-manager').then((mod) => mod.RegistrationsManager), { loading: SectionLoader })
const TransportDebtManager = dynamic(() => import('@/app/components/transport-debt-manager').then((mod) => mod.TransportDebtManager), { loading: SectionLoader })

function normalizeSector(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return fallback;
}

function isSupremeAdminEmail(email: string | undefined) {
  const normalizedEmail = email?.trim().toLowerCase();
  const configuredEmail = process.env.NEXT_PUBLIC_SUPREME_ADMIN_EMAIL?.trim().toLowerCase();

  return Boolean(normalizedEmail && (normalizedEmail === configuredEmail || normalizedEmail === 'admin@wally.system'));
}

function currentMinuteKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function isLegacyNoisyNotificationId(id: string) {
  return id.startsWith('task-today:') || id.startsWith('task-late:') || id.startsWith('meeting-today:');
}

function isFreshForBrowserNotification(notification: AppNotification) {
  const createdTime = new Date(notification.createdAt).getTime();
  if (!Number.isFinite(createdTime)) return false;

  const ageMs = Date.now() - createdTime;
  return ageMs >= -15 * 60_000 && ageMs <= 5 * 60_000;
}

function getMeetingTimeFromNotes(notes: string | null | undefined) {
  const match = notes?.match(/Horário:\s*([0-9]{2}:[0-9]{2})/i);
  return match?.[1] || null;
}

function timeToMinutes(time: string | null) {
  if (!time) return null;
  const [hours, minutes] = time.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

const SECTION_LABELS: Record<AppSection, string> = {
  TAREFAS: 'Tarefas',
  COMPRAS_IA: 'Compras IA',
  REUNIAO: 'Reunião',
  CADASTROS: 'Cadastros',
  PRECIFICACAO: 'Precificação',
  PRAZOS: 'Prazos',
  TRANSPORTE: 'Transporte',
  BALACUBACO: 'Remanejamento Inteligente',
  AUDITORIA: 'Auditoria',
};

const APP_PREFERENCES_KEY_PREFIX = 'wally-app-preferences';
const NOTIFICATION_PREFERENCES_KEY_PREFIX = 'wally-notification-preferences';
const APP_SECTIONS: AppSection[] = ['TAREFAS', 'REUNIAO', 'COMPRAS_IA', 'CADASTROS', 'PRECIFICACAO', 'PRAZOS', 'TRANSPORTE', 'BALACUBACO', 'AUDITORIA'];
const TASK_TABS = NAV_CATEGORIES.map((category) => category.id);

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  morningBriefing: true,
  closingSummary: true,
  meetingReminders: true,
  oneOffTasks: true,
  teamCompletions: true,
};

interface UserAppPreferences {
  activeSection?: AppSection;
  activeTab?: string;
  dashFilter?: 'HOJE' | 'SEMANAL';
  filterUsers?: string[];
  searchTerm?: string;
}

interface GlobalSearchItem {
  id: string;
  title: string;
  description: string;
  section: AppSection;
  tab?: string;
  searchTerm?: string;
  type: 'Modulo' | 'Tarefa' | 'Reuniao' | 'Aviso';
  keywords: string;
}

function readUserAppPreferences(userId: string): UserAppPreferences {
  if (typeof window === 'undefined') return {};

  try {
    const stored = window.localStorage.getItem(`${APP_PREFERENCES_KEY_PREFIX}:${userId}`);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as UserAppPreferences;

    return {
      activeSection: parsed.activeSection && APP_SECTIONS.includes(parsed.activeSection) ? parsed.activeSection : undefined,
      activeTab: parsed.activeTab && TASK_TABS.includes(parsed.activeTab) ? parsed.activeTab : undefined,
      dashFilter: parsed.dashFilter === 'HOJE' || parsed.dashFilter === 'SEMANAL' ? parsed.dashFilter : undefined,
      filterUsers: Array.isArray(parsed.filterUsers) ? parsed.filterUsers.filter((id) => typeof id === 'string') : undefined,
      searchTerm: typeof parsed.searchTerm === 'string' ? parsed.searchTerm : undefined,
    };
  } catch {
    return {};
  }
}

function readNotificationPreferences(userId: string): NotificationPreferences {
  if (typeof window === 'undefined') return DEFAULT_NOTIFICATION_PREFERENCES;

  try {
    const stored = window.localStorage.getItem(`${NOTIFICATION_PREFERENCES_KEY_PREFIX}:${userId}`);
    if (!stored) return DEFAULT_NOTIFICATION_PREFERENCES;
    const parsed = JSON.parse(stored) as Partial<NotificationPreferences>;

    return {
      morningBriefing: typeof parsed.morningBriefing === 'boolean' ? parsed.morningBriefing : DEFAULT_NOTIFICATION_PREFERENCES.morningBriefing,
      closingSummary: typeof parsed.closingSummary === 'boolean' ? parsed.closingSummary : DEFAULT_NOTIFICATION_PREFERENCES.closingSummary,
      meetingReminders: typeof parsed.meetingReminders === 'boolean' ? parsed.meetingReminders : DEFAULT_NOTIFICATION_PREFERENCES.meetingReminders,
      oneOffTasks: typeof parsed.oneOffTasks === 'boolean' ? parsed.oneOffTasks : DEFAULT_NOTIFICATION_PREFERENCES.oneOffTasks,
      teamCompletions: typeof parsed.teamCompletions === 'boolean' ? parsed.teamCompletions : DEFAULT_NOTIFICATION_PREFERENCES.teamCompletions,
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    const storedTheme = window.localStorage.getItem('wally-theme');
    if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  })
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [userRole, setUserRole] = useState<UserRole>('membro')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [tradeNoteTaskIds, setTradeNoteTaskIds] = useState<string[]>([])
  const [history, setHistory] = useState<TaskHistory[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [appNotifications, setAppNotifications] = useState<AppDbNotification[]>([])
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([])
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES)
  const [notificationDispatchTick, setNotificationDispatchTick] = useState(0)
  const [clockMinute, setClockMinute] = useState('')
  const browserNotifiedIdsRef = useRef<Set<string>>(new Set())
  const [preferencesReady, setPreferencesReady] = useState(false)
  
  const [activeSection, setActiveSection] = useState<AppSection>('TAREFAS')
  const [activeTab, setActiveTab] = useState('HOJE')
  const [dashFilter, setDashFilter] = useState<'HOJE' | 'SEMANAL'>('HOJE')
  const [filterUsers, setFilterUsers] = useState<string[]>([])
  const [showCreateBox, setShowCreateBox] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showGlobalSearch, setShowGlobalSearch] = useState(false)
  const [globalSearchTerm, setGlobalSearchTerm] = useState('')
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingTask, setEditingTask] = useState<ProcessedTask | null>(null)

  const [taskTitle, setTaskTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [category, setCategory] = useState(DEFAULT_TASK_CATEGORY)
  const [taskPriority, setTaskPriority] = useState<TaskPriority>(DEFAULT_TASK_PRIORITY)
  const [taskScheduleMode, setTaskScheduleMode] = useState<'pontual' | 'semanal' | 'mensal'>('semanal')
  const [oneOffDate, setOneOffDate] = useState(getTodayStr())
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
  const [editMode, setEditMode] = useState<'pontual' | 'semanal' | 'mensal'>('semanal');
  const [searchTerm, setSearchTerm] = useState('');
  const [userSector, setUserSector] = useState('Geral');
  const [showAssignMenu, setShowAssignMenu] = useState(false);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [marginRules, setMarginRules] = useState<PricingMarginRule[]>([]);
  const canUseMarginFlow = canUseMarginFlowTasks(userSector);

  useEffect(() => {
    if (!user?.id) {
      queueMicrotask(() => setPreferencesReady(false));
      return;
    }

    const preferences = readUserAppPreferences(user.id);
    queueMicrotask(() => {
      if (preferences.activeSection) setActiveSection(preferences.activeSection);
      if (preferences.activeTab) setActiveTab(preferences.activeTab);
      if (preferences.dashFilter) setDashFilter(preferences.dashFilter);
      if (preferences.filterUsers) setFilterUsers(preferences.filterUsers);
      if (preferences.searchTerm !== undefined) setSearchTerm(preferences.searchTerm);
      setPreferencesReady(true);
    });
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !preferencesReady) return;

    const preferences: UserAppPreferences = {
      activeSection,
      activeTab,
      dashFilter,
      filterUsers,
      searchTerm,
    };

    window.localStorage.setItem(`${APP_PREFERENCES_KEY_PREFIX}:${user.id}`, JSON.stringify(preferences));
  }, [activeSection, activeTab, dashFilter, filterUsers, preferencesReady, searchTerm, user?.id]);

  useEffect(() => {
    queueMicrotask(() => {
      if (activeTab === MARGIN_FLOW_CATEGORY && !canUseMarginFlow) {
        setActiveTab('HOJE');
      }
      if (category === MARGIN_FLOW_CATEGORY && !canUseMarginFlow) {
        setCategory(DEFAULT_TASK_CATEGORY);
        setNotes((current) => parseMarginFlowTaskNotes(current).cleanNotes);
      }
    });
  }, [activeTab, canUseMarginFlow, category]);

  useEffect(() => {
    if (!user?.id) {
      queueMicrotask(() => setNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES));
      return;
    }

    const preferences = readNotificationPreferences(user.id);
    queueMicrotask(() => setNotificationPreferences(preferences));
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    window.localStorage.setItem(`${NOTIFICATION_PREFERENCES_KEY_PREFIX}:${user.id}`, JSON.stringify(notificationPreferences));
  }, [notificationPreferences, user?.id]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('wally-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!user?.id) {
      queueMicrotask(() => setReadNotificationIds([]));
      browserNotifiedIdsRef.current = new Set();
      return;
    }

    const stored = window.localStorage.getItem(`wally-read-notifications:${user.id}`);
    const browserStored = window.localStorage.getItem(`wally-browser-notified:${user.id}`);
    const cleanedReadIds = (stored ? JSON.parse(stored) as string[] : []).filter((id) => !isLegacyNoisyNotificationId(id));
    const cleanedBrowserIds = (browserStored ? JSON.parse(browserStored) as string[] : []).filter((id) => !isLegacyNoisyNotificationId(id));
    window.localStorage.setItem(`wally-read-notifications:${user.id}`, JSON.stringify(cleanedReadIds));
    window.localStorage.setItem(`wally-browser-notified:${user.id}`, JSON.stringify(cleanedBrowserIds));
    queueMicrotask(() => setReadNotificationIds(cleanedReadIds));
    browserNotifiedIdsRef.current = new Set(cleanedBrowserIds);
  }, [user?.id]);

  useEffect(() => {
    const permission = 'Notification' in window ? Notification.permission : 'unsupported';
    queueMicrotask(() => setBrowserNotificationPermission(permission));
  }, []);

  useEffect(() => {
    queueMicrotask(() => setClockMinute(currentMinuteKey()));
    const interval = window.setInterval(() => {
      setClockMinute(currentMinuteKey());
      setNotificationDispatchTick((current) => current + 1);
    }, 30_000);

    return () => window.clearInterval(interval);
  }, []);

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

  // Limpeza de segurança caso o componente feche inesperadamente
  return () => {
    document.body.style.overflow = 'unset';
  };
}, [showCreateBox, showSettingsModal, showProfileModal, showEditModal]);

useEffect(() => {
  const handleEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;

    if (showGlobalSearch) {
      setShowGlobalSearch(false);
      setGlobalSearchTerm('');
      return;
    }
    if (showAssignMenu) {
      setShowAssignMenu(false);
      return;
    }
    if (showCategoryMenu) {
      setShowCategoryMenu(false);
      return;
    }
    if (viewingTask) {
      setViewingTask(null);
      return;
    }
    if (showEditModal) {
      setShowAssignMenu(false);
      setShowCategoryMenu(false);
      setShowEditModal(false);
      setEditingTask(null);
      return;
    }
    if (showCreateBox) {
      setShowAssignMenu(false);
      setShowCategoryMenu(false);
      setShowCreateBox(false);
      return;
    }
    if (showProfileModal) {
      setShowProfileModal(false);
      return;
    }
    if (showSettingsModal) {
      setShowSettingsModal(false);
      return;
    }
    if (searchTerm) {
      setSearchTerm('');
    }
  };

  window.addEventListener('keydown', handleEscape);
  return () => window.removeEventListener('keydown', handleEscape);
}, [searchTerm, showAssignMenu, showCategoryMenu, showCreateBox, showEditModal, showGlobalSearch, showProfileModal, showSettingsModal, viewingTask]);

useEffect(() => {
  const handleGlobalShortcut = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      setShowGlobalSearch(true);
    }
  };

  window.addEventListener('keydown', handleGlobalShortcut);
  return () => window.removeEventListener('keydown', handleGlobalShortcut);
}, []);

  const processedTasks = useMemo(() => processTasks(tasks), [tasks]);

  const fetchProfiles = useCallback(async () => {
    const data = await fetchProfilesApi();
    setProfiles(data);
  }, []);

  const fetchTradeNoteIndicators = useCallback(async (taskRows: Task[]) => {
    const tradeTaskIds = taskRows
      .filter((task) => task.category === 'Trade')
      .map((task) => task.id);
    const ids = await fetchTradeTaskNoteTaskIds(tradeTaskIds).catch(() => []);
    setTradeNoteTaskIds(ids);
  }, []);

  const fetchTasks = useCallback(async () => {
    const data = await fetchTasksApi();
    setTasks(data);
    await fetchTradeNoteIndicators(data);
  }, [fetchTradeNoteIndicators]);

  const fetchMarginRules = useCallback(async () => {
    const data = await fetchPricingMarginRules().catch((error) => {
      console.error('Erro ao carregar regras de margem:', error);
      return [] as PricingMarginRule[];
    });
    setMarginRules(data);
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

  const fetchInternalNotifications = useCallback(async () => {
    const data = await fetchAppNotifications();
    setAppNotifications(data);
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

  const normalizedSector = normalizeSector(userSector);
  const isSupremeAdmin = userRole === 'admin' && isSupremeAdminEmail(user?.email);
  const permissions = useMemo(() => getAppPermissions({
    role: userRole,
    sector: userSector,
    isSupremeAdmin,
  }), [isSupremeAdmin, userRole, userSector]);

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
      fetchMarginRules();
      fetchAnnouncements();
      fetchInternalNotifications();

      // Configuracao do realtime
      // 1. Criamos o canal
      // 2. Adicionamos o evento .on ANTES do .subscribe
      channel = supabase
        .channel('db-realtime-tasks') // Nome unico para o canal
        .on(
          'postgres_changes', 
          { event: '*', schema: 'public', table: 'tasks' }, 
          () => {
            fetchTasks(); 
          }
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'app_notifications' },
          (payload) => {
            const incomingNotification = payload.new as AppDbNotification;
            setAppNotifications((current) => {
              if (current.some((notification) => notification.id === incomingNotification.id)) return current;
              return [incomingNotification, ...current].slice(0, 80);
            });
            setNotificationDispatchTick((current) => current + 1);
          }
        )
        .subscribe();
    }
  });

  // Limpeza do canal realtime para evitar subscriptions duplicadas
  return () => {
    if (channel) {
      supabase.removeChannel(channel);
    }
  };
}, [fetchAnnouncements, fetchInternalNotifications, fetchMarginRules, fetchProfiles, fetchTasks, setNewName]);

  useEffect(() => {
    if (!user) return;
    if (activeSection === 'TAREFAS' && activeTab === 'HISTÓRICO') {
      queueMicrotask(() => {
        void fetchHistory();
      });
    }
  }, [activeSection, activeTab, fetchHistory, user]);

  useEffect(() => {
    if (!user) return;
    if (activeSection === 'TAREFAS' && activeTab === 'COMUNICADOS') {
      queueMicrotask(() => {
        void fetchAnnouncements();
      });
    }
  }, [activeSection, activeTab, fetchAnnouncements, user]);

  useEffect(() => {
    if (!user || userRole !== 'admin') return;
    if (activeSection === 'AUDITORIA') {
      queueMicrotask(() => {
        void fetchAudit();
      });
    }
  }, [activeSection, fetchAudit, user, userRole]);

  const openEditTaskModal = useCallback((task: ProcessedTask) => {
    setEditingTask(task);
    const isMonthlyWeekday = Boolean(parseMonthlyWeekdayRepeat(task.repeat_days));
    const isMonthly = isMonthlyWeekday || Boolean(task.repeat_days && !task.repeat_days.includes(',') && !isNaN(parseInt(task.repeat_days)));
    const isOneOff = Boolean(task.is_one_off);
    setEditMode(isOneOff ? 'pontual' : isMonthly ? 'mensal' : 'semanal');
    if (isOneOff) {
      const dateValue = task.due_date || task.lastOcc || getTodayStr();
      const [year, month, day] = dateValue.split('-');
      setEditDisplayDate(year && month && day ? `${day}/${month}/${year}` : 'DD/MM/YYYY');
    } else {
      setEditDisplayDate(isMonthly && !isMonthlyWeekday ? `DIA ${task.repeat_days} (MANTIDO)` : 'DD/MM/YYYY');
    }
    setShowEditModal(true);
  }, []);

  // Marca/desmarca dias na criação de nova tarefa
const toggleDay = (day: string) => {
  setSelectedDays((prev: string[]) => 
    prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
  )
}

// Marca/desmarca dias na edição de tarefa existente
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

  const recordPermissionBlock = useCallback(async (moduleName: string, action: string, details: string) => {
    await addAudit('permission_blocked', 'permission', null, action, userSector || moduleName, `Modulo: ${moduleName}. ${details}`);
  }, [addAudit, userSector]);

  async function addTask() {
  const cleanTitle = taskTitle.trim();
  const cleanNotes = notes.trim();
  const cleanSubtasks = tempSubtasks
    .map((subtask) => ({ ...subtask, title: subtask.title.trim() }))
    .filter((subtask) => subtask.title.length > 0);

  if (!cleanTitle) {
    alert('Informe o titulo da tarefa.');
    return;
  }

  if (!assignedTo) {
    alert('Selecione um responsavel pela tarefa.');
    return;
  }

  if (category === MARGIN_FLOW_CATEGORY && !canUseMarginFlow) {
    alert('Fluxo de margens é exclusivo do setor de Precificação.');
    return;
  }

  if (category === MARGIN_FLOW_CATEGORY && !parseMarginFlowTaskNotes(cleanNotes).data?.category) {
    alert('Selecione linha, departamento e categoria do fluxo de margens.');
    return;
  }

  if (taskScheduleMode === 'semanal' && selectedDays.length === 0) {
    alert('Selecione ao menos um dia da semana ou use o modo Pontual.');
    return;
  }

  if (taskScheduleMode === 'mensal' && selectedDays.length === 0) {
    alert('Selecione o dia da tarefa mensal.');
    return;
  }

  const isOneOff = taskScheduleMode === 'pontual';
  const repeatDays = isOneOff ? '' : selectedDays.join(',');
  const assignedProfile = profiles.find((profile) => profile.id === assignedTo);
  const taskSector = assignedProfile?.sector || userSector;

  try {
    await createTask({
      title: cleanTitle,
      assignedTo,
      category,
      notes: cleanNotes,
      repeatDays,
      repeatInterval: isOneOff ? 1 : repeatInterval,
      subtasks: cleanSubtasks,
      dueDate: isOneOff ? oneOffDate : null,
      sector: taskSector,
      isOneOff,
      priority: taskPriority,
    });
    await addAudit('task_created', 'task', null, cleanTitle, taskSector, `Categoria: ${category}`);
    setTaskTitle('');
    setDisplayDate('DD/MM/YYYY'); 
    setNotes(''); 
    setCategory(DEFAULT_TASK_CATEGORY);
    setSelectedDays([]); 
    setTaskPriority(DEFAULT_TASK_PRIORITY);
    setTaskScheduleMode('semanal');
    setOneOffDate(getTodayStr());
    setTempSubtasks([]); 
    setShowAssignMenu(false);
    setShowCategoryMenu(false);
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
  const shouldArchive = Boolean(task.is_one_off && !isCurrentlyDone);

  setTasks(prevTasks => prevTasks
    .map(t => t.id === task.id ? {
      ...t,
      last_done_date: newDate,
      subtasks: updatedSubtasks,
      schedule_override_date: null,
      schedule_override_type: null,
      archived_at: shouldArchive ? new Date().toISOString() : t.archived_at,
    } : t)
    .filter((t) => !t.archived_at)
  );

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
    await updateTaskCompletion(task.id, newDate, updatedSubtasks, shouldArchive);
    await addAudit(isCurrentlyDone ? 'task_reopened' : 'task_completed', 'task', task.id, task.title, task.sector);
    if (!isCurrentlyDone) {
      const profile = profiles.find(p => p.id === user.id);
      const actorName = profile?.full_name || user.email || 'Alguém';
      await createAppNotification({
        title: `${actorName} concluiu uma tarefa`,
        body: `${task.title} foi concluída no setor ${task.sector}.`,
        type: 'task_completed',
        actorId: user.id,
        sector: task.sector,
        entityType: 'task',
        entityId: task.id,
      }).catch((error) => console.error('Erro ao criar notificação:', error));
      fetchInternalNotifications();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    alert("Erro ao salvar: " + message);
    fetchTasks();
  }
}, [addAudit, fetchInternalNotifications, fetchTasks, user, profiles]);

const deleteTask = useCallback(async (taskId: string) => {
  const taskToDelete = tasks.find((task) => task.id === taskId);
  const isMeeting = taskToDelete?.category === 'Reunião';
  if (isMeeting ? !permissions.canDeleteMeetings : !permissions.canDeleteTasks) {
    const message = getPermissionDeniedMessage(isMeeting ? 'excluir reunioes' : 'excluir tarefas', 'managerOrAdmin');
    await recordPermissionBlock(isMeeting ? 'Reuniao' : 'Tarefas', isMeeting ? 'excluir reunioes' : 'excluir tarefas', message);
    alert(message);
    return;
  }
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
        headers: await getAuthHeaders(),
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
}, [addAudit, fetchTasks, permissions.canDeleteMeetings, permissions.canDeleteTasks, recordPermissionBlock, tasks, user]);

const scheduleTaskOverride = useCallback(async (task: ProcessedTask, action: 'advance' | 'postpone' | 'clear') => {
  if (!user) return;

  const todayStr = getTodayStr();
  const overrideDate = action === 'advance'
    ? todayStr
    : action === 'postpone'
      ? addDaysToDateStr(todayStr, 1)
      : null;
  const overrideType = action === 'advance'
    ? 'advanced'
    : action === 'postpone'
      ? 'postponed'
      : null;

  setTasks((prevTasks) => prevTasks.map((item) => (
    item.id === task.id
      ? { ...item, schedule_override_date: overrideDate, schedule_override_type: overrideType }
      : item
  )));

  try {
    await updateTaskScheduleOverride(task.id, overrideDate, overrideType);
    await addAudit(
      action === 'advance' ? 'task_advanced' : action === 'postpone' ? 'task_postponed' : 'task_schedule_restored',
      'task',
      task.id,
      task.title,
      task.sector,
      overrideDate ? `Data ajustada para ${overrideDate}` : 'Agenda original restaurada',
    );
  } catch (error) {
    const message = getErrorMessage(error, 'Erro desconhecido');
    alert('Erro ao ajustar a agenda da tarefa: ' + message);
    fetchTasks();
  }
}, [addAudit, fetchTasks, user]);

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

const toggleMeetingComplete = useCallback(async (task: ProcessedTask) => {
  if (!user) return;

  const meetingDate = task.due_date || task.lastOcc;
  const isCurrentlyDone = task.isDoneToday;
  const newDate = isCurrentlyDone ? null : meetingDate;

  setTasks(prevTasks => prevTasks.map(t => (
    t.id === task.id ? { ...t, last_done_date: newDate, status: newDate ? 'concluido' : 'pendente' } : t
  )));

  try {
    await updateTaskCompletion(task.id, newDate, task.subtasks || [], false);
    await addAudit(isCurrentlyDone ? 'task_reopened' : 'task_completed', 'meeting', task.id, task.title, task.sector);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    alert('Erro ao salvar reunião: ' + message);
    fetchTasks();
  }
}, [addAudit, fetchTasks, user]);

  async function updateTask() {
  if (!editingTask) return;

  const cleanTitle = editingTask.title.trim();
  const cleanNotes = (editingTask.notes || '').trim();
  const cleanSubtasks = (editingTask.subtasks || [])
    .map((subtask) => ({ ...subtask, title: subtask.title.trim() }))
    .filter((subtask) => subtask.title.length > 0);
  const isOneOff = editMode === 'pontual';
  const repeatDays = isOneOff ? '' : editingTask.repeat_days;
  const dueDate = isOneOff ? editingTask.due_date || getTodayStr() : null;

  if (!cleanTitle) {
    alert('Informe o titulo da tarefa.');
    return;
  }

  if (!editingTask.assigned_to) {
    alert('Selecione um responsavel pela tarefa.');
    return;
  }

  if (editingTask.category === MARGIN_FLOW_CATEGORY && !canUseMarginFlow) {
    alert('Fluxo de margens é exclusivo do setor de Precificação.');
    return;
  }

  if (editingTask.category === MARGIN_FLOW_CATEGORY && !parseMarginFlowTaskNotes(cleanNotes).data?.category) {
    alert('Selecione linha, departamento e categoria do fluxo de margens.');
    return;
  }

  if (!isOneOff && !repeatDays) {
    alert('Selecione ao menos um dia para a recorrencia.');
    return;
  }

  try {
    const assignedProfile = profiles.find((profile) => profile.id === editingTask.assigned_to);
    const taskSector = assignedProfile?.sector || editingTask.sector;

    await updateTaskApi({
      id: editingTask.id,
      title: cleanTitle,
      notes: cleanNotes,
      assignedTo: editingTask.assigned_to,
      category: editingTask.category,
      repeatDays,
      repeatInterval: isOneOff ? 1 : editingTask.repeat_interval,
      subtasks: cleanSubtasks,
      dueDate,
      isOneOff,
      sector: taskSector,
      priority: editingTask.priority,
    });
    setShowEditModal(false); 
    setShowAssignMenu(false);
    setShowCategoryMenu(false);
    setEditingTask(null); 
    fetchTasks(); 
    await addAudit('task_updated', 'task', editingTask.id, cleanTitle, taskSector, `Categoria: ${editingTask.category}`);
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
    () => getTaskStats({ tasks: processedTasks, dashFilter, filterUsers, userRole, userSector, userId: user?.id }),
    [processedTasks, dashFilter, filterUsers, userRole, userSector, user?.id],
  );

  const sectorStats = useMemo(
    () => getSectorStats({ tasks: processedTasks, dashFilter, userRole, userSector, userId: user?.id }),
    [processedTasks, dashFilter, userRole, userSector, user?.id],
  );

  const meetingTasks = useMemo(() => {
    return processedTasks.filter((task) => {
      if (task.category !== 'Reunião') return false;
      return userRole === 'admin' || task.sector === userSector;
    });
  }, [processedTasks, userRole, userSector]);

  const notifications = useMemo<AppNotification[]>(() => {
    if (!user) return [];

    const minuteKey = clockMinute || `${getTodayStr()}T00:00`;
    const today = minuteKey.slice(0, 10);
    const currentHour = Number(minuteKey.slice(11, 13));
    const currentMinuteOfDay = timeToMinutes(minuteKey.slice(11, 16)) ?? 0;
    const canSeeTask = (task: ProcessedTask) => {
      if (userRole === 'admin') return true;
      if (userRole === 'gerente') return task.sector === userSector;
      return task.assigned_to === user.id;
    };
    const pendingTodayTasks = processedTasks.filter((task) => {
      if (!canSeeTask(task) || task.isDoneToday || task.category === 'Reunião') return false;
      return task.lastOcc === today;
    });
    const pendingWorkTasks = processedTasks.filter((task) => {
      if (!canSeeTask(task) || task.isDoneToday || task.category === 'Reunião') return false;
      return task.lastOcc <= today && task.lastOcc !== '1970-01-01';
    });
    const pendingOneOffTasks = processedTasks
      .filter((task) => {
        if (!canSeeTask(task) || task.isDoneToday || task.category === 'Reunião' || !task.is_one_off) return false;
        return task.lastOcc <= today && task.lastOcc !== '1970-01-01';
      })
      .sort((left, right) => left.lastOcc.localeCompare(right.lastOcc));
    const todayMeetings = processedTasks
      .filter((task) => {
        if (!canSeeTask(task) || task.category !== 'Reunião') return false;
        const meetingDate = task.due_date || task.lastOcc;
        return meetingDate === today && task.last_done_date !== meetingDate;
      })
      .sort((left, right) => {
        const leftMinutes = timeToMinutes(getMeetingTimeFromNotes(left.notes)) ?? 9999;
        const rightMinutes = timeToMinutes(getMeetingTimeFromNotes(right.notes)) ?? 9999;
        return leftMinutes - rightMinutes;
      });
    const userFirstName = (profiles.find((profile) => profile.id === user.id)?.full_name || user.email || 'time').split(' ')[0];
    const scheduledNotifications: AppNotification[] = [];

    if (notificationPreferences.morningBriefing && currentHour >= 8) {
      scheduledNotifications.push({
        id: `daily-morning:${user.id}:${today}`,
        title: `Bom dia, ${userFirstName}`,
        description: pendingTodayTasks.length > 0
          ? `Você tem ${pendingTodayTasks.length} tarefa${pendingTodayTasks.length === 1 ? '' : 's'} para hoje. Vamos conferir?`
          : 'Dá uma olhada nas tarefas de hoje para começar o dia alinhado.',
        tone: 'blue',
        createdAt: `${today}T08:00:00`,
        section: 'TAREFAS',
        tab: 'HOJE',
      });
    }

    if (notificationPreferences.oneOffTasks) {
      pendingOneOffTasks.forEach((task) => {
        const isLateOneOff = task.lastOcc < today;
        scheduledNotifications.push({
          id: `one-off-task:${user.id}:${task.id}:${task.lastOcc}`,
          title: isLateOneOff ? 'Tarefa pontual vencida' : 'Tarefa pontual para hoje',
          description: task.title,
          tone: isLateOneOff ? 'red' : 'blue',
          createdAt: `${task.lastOcc}T08:10:00`,
          section: 'TAREFAS',
          tab: isLateOneOff ? 'ATRASADOS' : 'HOJE',
        });
      });
    }

    if (notificationPreferences.meetingReminders && currentHour >= 8 && todayMeetings.length > 0) {
      const firstMeetingTime = getMeetingTimeFromNotes(todayMeetings[0]?.notes);

      scheduledNotifications.push({
        id: `daily-meetings:${user.id}:${today}`,
        title: `${todayMeetings.length} reunião${todayMeetings.length === 1 ? '' : 'ões'} hoje`,
        description: firstMeetingTime
          ? `A primeira é ${todayMeetings[0].title} às ${firstMeetingTime}.`
          : `Confira a agenda de reuniões de hoje.`,
        tone: 'blue',
        createdAt: `${today}T08:05:00`,
        section: 'REUNIAO',
      });
    }

    if (notificationPreferences.meetingReminders) {
      todayMeetings.forEach((meeting) => {
        const meetingTime = getMeetingTimeFromNotes(meeting.notes);
        const meetingMinuteOfDay = timeToMinutes(meetingTime);
        if (meetingMinuteOfDay === null) return;
        if (currentMinuteOfDay < meetingMinuteOfDay - 15) return;

        scheduledNotifications.push({
          id: `meeting-reminder:${user.id}:${meeting.id}:${today}`,
          title: `Reunião às ${meetingTime}`,
          description: meeting.title,
          tone: 'amber',
          createdAt: `${today}T${meetingTime}:00`,
          section: 'REUNIAO',
        });
      });
    }

    if (notificationPreferences.closingSummary && currentHour >= 17 && pendingWorkTasks.length > 0) {
      scheduledNotifications.push({
        id: `daily-closing:${user.id}:${today}`,
        title: `${userFirstName}, você tem ${pendingWorkTasks.length} pendente${pendingWorkTasks.length === 1 ? '' : 's'}`,
        description: 'São 17h. Vamos verificar o que ainda falta antes de encerrar?',
        tone: 'amber',
        createdAt: `${today}T17:00:00`,
        section: 'TAREFAS',
        tab: 'HOJE',
      });
    }

    const recentAnnouncements = announcements
      .filter((announcement) => {
        if (userRole !== 'admin' && announcement.sector !== userSector && announcement.sector !== 'Geral') return false;
        return true;
      })
      .slice(0, 5)
      .map<AppNotification>((announcement) => ({
        id: `announcement:${announcement.id}`,
        title: `Alerta: ${announcement.title}`,
        description: announcement.content || 'Novo comunicado interno.',
        tone: 'slate',
        createdAt: announcement.created_at,
        section: 'TAREFAS',
        tab: 'COMUNICADOS',
      }));

    const internalNotifications = appNotifications
      .filter((notification) => notification.actor_id !== user.id)
      .filter((notification) => notification.type !== 'task_completed' || notificationPreferences.teamCompletions)
      .map<AppNotification>((notification) => ({
        id: `internal:${notification.id}`,
        title: notification.title,
        description: notification.body,
        tone: notification.type === 'task_completed' ? 'green' : 'slate',
        createdAt: notification.created_at,
        section: 'TAREFAS',
        tab: notification.type === 'task_completed' ? 'HOJE' : 'COMUNICADOS',
      }));

    return [...scheduledNotifications, ...recentAnnouncements, ...internalNotifications]
      .filter((notification) => !isLegacyNoisyNotificationId(notification.id))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 20);
  }, [announcements, appNotifications, clockMinute, notificationPreferences, processedTasks, profiles, user, userRole, userSector]);

  const unreadNotificationIds = useMemo(() => {
    const readSet = new Set(readNotificationIds);
    return notifications.map((notification) => notification.id).filter((id) => !readSet.has(id));
  }, [notifications, readNotificationIds]);

  const dailyOverview = useMemo(() => {
    if (!user) {
      return {
        todayTasks: 0,
        overdueTasks: 0,
        oneOffTasks: 0,
        futureTasks: 0,
        completedToday: 0,
        meetingsToday: 0,
        nextMeetingTitle: '',
        nextMeetingTime: '',
        unreadNotifications: unreadNotificationIds.length,
        focusItems: [] as Array<{ title: string; detail: string; tab: string }>,
      };
    }

    const today = getTodayStr();
    const canSeeTask = (task: ProcessedTask) => {
      if (userRole === 'admin') return true;
      if (userRole === 'gerente') return task.sector === userSector;
      return task.assigned_to === user.id;
    };
    const matchesSelectedUsers = (task: ProcessedTask) => filterUsers.length === 0 || filterUsers.includes(task.assigned_to);
    const visibleTasks = processedTasks.filter((task) => canSeeTask(task) && matchesSelectedUsers(task));
    const taskItems = visibleTasks.filter((task) => task.category !== 'Reunião');
    const todayPending = taskItems.filter((task) => !task.isDoneToday && task.lastOcc === today);
    const overduePending = taskItems.filter((task) => !task.isDoneToday && task.lastOcc < today && task.lastOcc !== '1970-01-01');
    const oneOffPending = taskItems.filter((task) => task.is_one_off && !task.isDoneToday && task.lastOcc <= today && task.lastOcc !== '1970-01-01');
    const futurePending = taskItems.filter((task) => !task.isDoneToday && task.lastOcc > today);
    const completedToday = taskItems.filter((task) => task.isDoneToday && task.last_done_date === today).length;
    const todayMeetings = visibleTasks
      .filter((task) => {
        if (task.category !== 'Reunião') return false;
        const meetingDate = task.due_date || task.lastOcc;
        return meetingDate === today && task.last_done_date !== meetingDate;
      })
      .sort((left, right) => {
        const leftMinutes = timeToMinutes(getMeetingTimeFromNotes(left.notes)) ?? 9999;
        const rightMinutes = timeToMinutes(getMeetingTimeFromNotes(right.notes)) ?? 9999;
        return leftMinutes - rightMinutes;
      });

    const focusItems = [
      ...overduePending.slice(0, 2).map((task) => ({
        title: task.title,
        detail: `Atrasada desde ${task.lastOcc}`,
        tab: 'ATRASADOS',
      })),
      ...oneOffPending.slice(0, 2).map((task) => ({
        title: task.title,
        detail: task.lastOcc < today ? 'Pontual vencida' : 'Pontual para hoje',
        tab: task.lastOcc < today ? 'ATRASADOS' : 'HOJE',
      })),
      ...todayPending.slice(0, 2).map((task) => ({
        title: task.title,
        detail: `${task.category} para hoje`,
        tab: 'HOJE',
      })),
    ].slice(0, 4);

    return {
      todayTasks: todayPending.length,
      overdueTasks: overduePending.length,
      oneOffTasks: oneOffPending.length,
      futureTasks: futurePending.length,
      completedToday,
      meetingsToday: todayMeetings.length,
      nextMeetingTitle: todayMeetings[0]?.title || '',
      nextMeetingTime: getMeetingTimeFromNotes(todayMeetings[0]?.notes) || '',
      unreadNotifications: unreadNotificationIds.length,
      focusItems,
    };
  }, [filterUsers, processedTasks, unreadNotificationIds.length, user, userRole, userSector]);

  const persistReadNotifications = useCallback((ids: string[]) => {
    if (!user?.id) return;
    const uniqueIds = Array.from(new Set(ids)).slice(-200);
    setReadNotificationIds(uniqueIds);
    window.localStorage.setItem(`wally-read-notifications:${user.id}`, JSON.stringify(uniqueIds));
  }, [user]);

  const markNotificationRead = useCallback((notificationId: string) => {
    persistReadNotifications([...readNotificationIds, notificationId]);
  }, [persistReadNotifications, readNotificationIds]);

  const markAllNotificationsRead = useCallback(() => {
    persistReadNotifications([...readNotificationIds, ...notifications.map((notification) => notification.id)]);
  }, [notifications, persistReadNotifications, readNotificationIds]);

  const selectNotification = useCallback((notification: AppNotification) => {
    markNotificationRead(notification.id);
    setActiveSection(notification.section);
    if (notification.tab) setActiveTab(notification.tab);
  }, [markNotificationRead]);

  const requestBrowserNotifications = useCallback(async () => {
    setBrowserNotificationPermission('granted');
    showSystemToast({
      title: 'Avisos internos ativados',
      description: 'Vou mostrar as notificações importantes aqui dentro do sistema.',
      tone: 'success',
    });
  }, []);

  const updateNotificationPreference = useCallback((key: keyof NotificationPreferences, value: boolean) => {
    setNotificationPreferences((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  useEffect(() => {
    if (!user?.id || browserNotificationPermission !== 'granted') return;

    const unreadSet = new Set(unreadNotificationIds);
    const nextNotifications = notifications
      .filter((notification) => unreadSet.has(notification.id) && !browserNotifiedIdsRef.current.has(notification.id))
      .filter(isFreshForBrowserNotification)
      .slice(0, 3);

    if (nextNotifications.length === 0) return;

    for (const notification of nextNotifications) {
      browserNotifiedIdsRef.current.add(notification.id);
      showSystemToast({
        title: notification.title,
        description: notification.description,
        tone: notification.tone === 'red'
          ? 'error'
          : notification.tone === 'green'
            ? 'success'
            : notification.tone === 'amber'
              ? 'warning'
              : 'info',
        durationMs: 7200,
        onClick: () => selectNotification(notification),
      });
    }

    window.localStorage.setItem(
      `wally-browser-notified:${user.id}`,
      JSON.stringify(Array.from(browserNotifiedIdsRef.current).slice(-200)),
    );
  }, [browserNotificationPermission, notificationDispatchTick, notifications, selectNotification, unreadNotificationIds, user?.id]);

  const canAccessPricing = userRole === 'admin' || ['precificacao', 'price'].includes(normalizedSector);
  const canAccessPaymentTerms = userRole === 'admin' || normalizedSector.startsWith('compras');
  const isPerfumePurchasing = isPerfumePurchasingSector(userSector);
  const canAccessTransport = isSupremeAdmin || isPerfumePurchasing;
  const canAccessReallocation = isSupremeAdmin || isPerfumePurchasing;
  const canManageBranches = userRole === 'admin' || canAccessPricing;
  const canAccessRegistries = true;
  const visibleSection =
    (activeSection === 'AUDITORIA' && userRole !== 'admin') ||
    (activeSection === 'CADASTROS' && !canAccessRegistries) ||
    (activeSection === 'COMPRAS_IA' && !canAccessPaymentTerms) ||
    (activeSection === 'PRECIFICACAO' && !canAccessPricing) ||
    (activeSection === 'PRAZOS' && !canAccessPaymentTerms) ||
    (activeSection === 'TRANSPORTE' && !canAccessTransport) ||
    (activeSection === 'BALACUBACO' && !canAccessReallocation)
      ? 'TAREFAS'
      : activeSection;
  const globalSearchItems = useMemo<GlobalSearchItem[]>(() => {
    if (!user) return [];

    const today = getTodayStr();
    const canSeeTask = (task: ProcessedTask) => {
      if (userRole === 'admin') return true;
      if (userRole === 'gerente') return task.sector === userSector;
      return task.assigned_to === user.id;
    };
    const profileById = new Map(profiles.map((profile) => [profile.id, profile.full_name || 'Usuario']));
    const items: GlobalSearchItem[] = [
      { id: 'module:TAREFAS', title: 'Tarefas', description: 'Abrir painel operacional de tarefas', section: 'TAREFAS', tab: 'HOJE', type: 'Modulo', keywords: 'tarefas hoje atrasados trade dashboard alertas historico' },
      { id: 'module:REUNIAO', title: 'Reunião', description: 'Abrir agenda mensal de reuniões', section: 'REUNIAO', type: 'Modulo', keywords: 'reuniao agenda calendario google eventos' },
    ];

    if (canAccessRegistries) items.push({ id: 'module:CADASTROS', title: 'Cadastros', description: 'Produtos, lojas e fornecedores', section: 'CADASTROS', type: 'Modulo', keywords: 'cadastros produtos lojas fornecedores' });
    if (canAccessPaymentTerms) items.push({ id: 'module:COMPRAS_IA', title: 'Compras IA', description: 'Assistente inteligente para compras', section: 'COMPRAS_IA', type: 'Modulo', keywords: 'compras ia assistente inteligencia artificial fornecedores produtos pedido cotacao' });
    if (canAccessPricing) items.push({ id: 'module:PRECIFICACAO', title: 'Price', description: 'Negociações, custos e preços', section: 'PRECIFICACAO', type: 'Modulo', keywords: 'price precificacao negociacoes custos ofertas precos' });
    if (canAccessPaymentTerms) items.push({ id: 'module:PRAZOS', title: 'Prazos', description: 'Prazos de boleto e regras comerciais', section: 'PRAZOS', type: 'Modulo', keywords: 'prazos fornecedores boleto regras comerciais' });
    if (canAccessTransport) items.push({ id: 'module:TRANSPORTE', title: 'Transporte', description: 'Controle de dívidas de transporte', section: 'TRANSPORTE', type: 'Modulo', keywords: 'transporte dividas cobranca fornecedores credito debito' });
    if (canAccessReallocation) items.push({ id: 'module:BALACUBACO', title: 'Remanejamento Inteligente', description: 'Sugestões e exportação ERP', section: 'BALACUBACO', type: 'Modulo', keywords: 'remanejamento inteligente sugestoes estoque transferencia balacubaco' });
    if (userRole === 'admin') items.push({ id: 'module:AUDITORIA', title: 'Auditoria', description: 'Histórico de alterações do sistema', section: 'AUDITORIA', type: 'Modulo', keywords: 'auditoria historico logs alteracoes' });

    processedTasks.filter(canSeeTask).forEach((task) => {
      const assignee = profileById.get(task.assigned_to) || 'Sem responsável';

      if (task.category === 'Reunião') {
        const meetingTime = getMeetingTimeFromNotes(task.notes);
        const meetingDate = task.due_date || task.lastOcc;
        items.push({
          id: `meeting:${task.id}`,
          title: task.title,
          description: `${meetingDate}${meetingTime ? ` às ${meetingTime}` : ''} • ${assignee}`,
          section: 'REUNIAO',
          type: 'Reuniao',
          keywords: `${task.title} ${task.notes} ${assignee} ${task.sector} ${meetingDate} ${meetingTime || ''}`,
        });
        return;
      }

      const tab = task.lastOcc < today && !task.isDoneToday
        ? 'ATRASADOS'
        : task.lastOcc === today && !task.isDoneToday
          ? 'HOJE'
          : task.category === 'Trade'
            ? 'Trade'
            : 'Todas';

      items.push({
        id: `task:${task.id}`,
        title: task.title,
        description: `${task.category} • ${assignee} • ${task.lastOcc === '1970-01-01' ? 'Sem data' : task.lastOcc}`,
        section: 'TAREFAS',
        tab,
        searchTerm: task.title,
        type: 'Tarefa',
        keywords: `${task.title} ${task.notes} ${task.category} ${assignee} ${task.sector} ${task.lastOcc} ${task.nextOcc}`,
      });
    });

    announcements.forEach((announcement) => {
      if (userRole !== 'admin' && announcement.sector !== userSector && announcement.sector !== 'Geral') return;
      items.push({
        id: `announcement:${announcement.id}`,
        title: announcement.title,
        description: announcement.content || 'Comunicado interno',
        section: 'TAREFAS',
        tab: 'COMUNICADOS',
        type: 'Aviso',
        keywords: `${announcement.title} ${announcement.content} ${announcement.sector}`,
      });
    });

    return items;
  }, [announcements, canAccessPaymentTerms, canAccessPricing, canAccessRegistries, canAccessReallocation, canAccessTransport, processedTasks, profiles, user, userRole, userSector]);

  const globalSearchResults = useMemo(() => {
    const query = globalSearchTerm.trim().toLowerCase();
    if (!query) return globalSearchItems.slice(0, 10);

    return globalSearchItems
      .filter((item) => `${item.title} ${item.description} ${item.keywords}`.toLowerCase().includes(query))
      .slice(0, 12);
  }, [globalSearchItems, globalSearchTerm]);

  const openGlobalSearchItem = useCallback((item: GlobalSearchItem) => {
    setActiveSection(item.section);
    if (item.tab) setActiveTab(item.tab);
    setSearchTerm(item.searchTerm || '');
    setShowCreateBox(false);
    setShowGlobalSearch(false);
    setGlobalSearchTerm('');

    const [itemType, itemId] = item.id.split(':');
    if ((itemType === 'task' || itemType === 'meeting') && itemId) {
      const task = processedTasks.find((candidate) => candidate.id === itemId);
      if (task) setViewingTask(task);
    }
  }, [processedTasks]);

  if (!user) return <Login />

  return (
    <div className={`app-responsive-root app-density-compact min-h-screen bg-[#E8EEF7] text-slate-900 font-sans overflow-x-hidden w-full ${visibleSection === 'TRANSPORTE' || visibleSection === 'REUNIAO' || visibleSection === 'BALACUBACO' || visibleSection === 'COMPRAS_IA' ? 'pb-24 md:pb-0' : 'pb-24 md:pb-20'}`}>
      <AppSidebar
        activeSection={visibleSection}
        userRole={userRole}
        userSector={userSector}
        isSupremeAdmin={isSupremeAdmin}
        onSectionChange={(section) => {
          setActiveSection(section);
          if (section === 'AUDITORIA') {
            fetchAudit();
          }
        }}
      />

      <div className="md:pl-20">
      <AppShellNav
        section={visibleSection}
        sectionTitle={SECTION_LABELS[visibleSection]}
        sectionSubtitle={visibleSection === 'TAREFAS' ? activeTab : undefined}
        showTaskTools={visibleSection === 'TAREFAS'}
        taskAction={visibleSection === 'TAREFAS' ? (
          <button
            onClick={() => {
              if (!showCreateBox) {
                setCategory(DEFAULT_TASK_CATEGORY);
                setShowCategoryMenu(false);
              }
              setShowCreateBox(!showCreateBox);
            }}
            className={`flex h-12 w-full max-w-[340px] items-center justify-center gap-3 rounded-full border-2 px-7 text-[11px] font-black uppercase tracking-[0.18em] transition-all duration-300 ${
              showCreateBox
                ? 'border-slate-200 bg-slate-100 text-slate-500 shadow-none'
                : 'border-blue-600 bg-blue-600 text-white shadow-[0_8px_18px_rgba(37,99,235,0.22)] hover:border-blue-700 hover:bg-blue-700 hover:shadow-[0_10px_22px_rgba(37,99,235,0.28)]'
            }`}
          >
            {showCreateBox ? <><X size={18} /> Cancelar Operação</> : <><Plus size={18} strokeWidth={3} /> Lançar Nova Tarefa</>}
          </button>
        ) : undefined}
        userId={user.id}
        userRole={userRole}
        profiles={profiles}
        activeTab={activeTab}
        filterUsers={filterUsers}
        userSector={userSector}
        searchTerm={searchTerm}
        theme={theme}
        onActiveTabChange={(tab) => { setActiveTab(tab); setShowCreateBox(false); }}
        onFilterUsersChange={setFilterUsers}
        onSearchTermChange={setSearchTerm}
        onThemeToggle={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
        onOpenGlobalSearch={() => setShowGlobalSearch(true)}
        onOpenProfile={() => setShowProfileModal(true)}
        onOpenSettings={() => setShowSettingsModal(true)}
        notifications={notifications}
        unreadNotificationIds={unreadNotificationIds}
        browserNotificationPermission={browserNotificationPermission}
        notificationPreferences={notificationPreferences}
        onNotificationSelect={selectNotification}
        onMarkAllNotificationsRead={markAllNotificationsRead}
        onRequestBrowserNotifications={requestBrowserNotifications}
        onNotificationPreferenceChange={updateNotificationPreference}
      />

      {showGlobalSearch && (
        <div className="fixed inset-0 z-[260] flex items-start justify-center bg-slate-900/18 px-3 pt-20 backdrop-blur-sm" onMouseDown={() => setShowGlobalSearch(false)}>
          <div
            className="flex w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white text-slate-900 shadow-[0_26px_80px_rgba(15,23,42,0.24)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
              <Search size={20} className="text-blue-600" />
              <input
                autoFocus
                value={globalSearchTerm}
                onChange={(event) => setGlobalSearchTerm(event.target.value)}
                placeholder="Buscar no sistema..."
                className="h-11 min-w-0 flex-1 bg-transparent text-sm font-black uppercase outline-none placeholder:text-slate-300"
              />
              <button
                type="button"
                onClick={() => {
                  setShowGlobalSearch(false);
                  setGlobalSearchTerm('');
                }}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition hover:bg-slate-200"
                aria-label="Fechar busca global"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[min(520px,calc(100vh-9rem))] overflow-y-auto p-2">
              {globalSearchResults.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Nada encontrado</p>
                  <p className="mt-2 text-xs font-bold text-slate-400">Tente buscar por tarefa, reunião, módulo ou aviso.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {globalSearchResults.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openGlobalSearchItem(item)}
                      className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-blue-50"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[9px] font-black uppercase text-slate-500">
                        {item.type}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-black uppercase text-slate-950">{item.title}</span>
                        <span className="mt-0.5 block truncate text-[11px] font-bold text-slate-500">{item.description}</span>
                      </span>
                      <ArrowRight size={17} className="shrink-0 text-slate-300" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-slate-400">
              <span>Ctrl K abre a busca</span>
              <span>Esc fecha</span>
            </div>
          </div>
        </div>
      )}

      {visibleSection === 'TAREFAS' ? (
        <>
      <main className="mx-auto max-w-6xl px-4 pb-6">
  {activeTab === 'DASHBOARD' ? (
    <DashboardView
      filter={dashFilter}
      onFilterChange={setDashFilter}
      stats={stats}
      sectorStats={sectorStats}
      dailyOverview={dailyOverview}
      onOpenTab={(tab) => setActiveTab(tab)}
      onOpenMeetings={() => setActiveSection('REUNIAO')}
    />
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
     {/* ----------------------------------------------------------- */}
{/* Modal flutuante: lançar nova tarefa */}
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
    taskPriority={taskPriority}
    setTaskPriority={setTaskPriority}
    taskScheduleMode={taskScheduleMode}
    setTaskScheduleMode={setTaskScheduleMode}
    oneOffDate={oneOffDate}
    setOneOffDate={setOneOffDate}
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
    marginRules={marginRules}
    showAssignMenu={showAssignMenu}
    setShowAssignMenu={setShowAssignMenu}
    showCategoryMenu={showCategoryMenu}
    setShowCategoryMenu={setShowCategoryMenu}
    onToggleDay={toggleDay}
    onClose={() => {
      setShowAssignMenu(false);
      setShowCategoryMenu(false);
      setShowCreateBox(false);
    }}
    onSave={addTask}
  />
)}
      <TaskListView
        activeTab={activeTab}
        tasks={filteredTasks}
        profiles={profiles}
        tradeNoteTaskIds={tradeNoteTaskIds}
        userRole={userRole}
        currentUser={user}
        onToggle={toggleComplete}
        onView={setViewingTask}
        onEdit={openEditTaskModal}
        onUpdate={fetchTasks}
        onDelete={deleteTask}
        canDeleteTasks={permissions.canDeleteTasks}
        onScheduleOverride={scheduleTaskOverride}
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
          onDeleteTask={deleteTask}
          canDeleteMeetings={permissions.canDeleteMeetings}
          onToggleMeeting={toggleMeetingComplete}
          onCreateMeeting={addMeeting}
          onUpdateMeeting={updateMeeting}
        />
      ) : visibleSection === 'COMPRAS_IA' ? (
        <PurchaseAssistant />
      ) : visibleSection === 'CADASTROS' ? (
        <RegistrationsManager
          canManageBranches={canManageBranches}
          canManageProducts={canManageBranches || permissions.canImportReallocationData}
          canManageMargins={canAccessPricing}
        />
      ) : visibleSection === 'PRECIFICACAO' ? (
        <PricingManager />
      ) : visibleSection === 'PRAZOS' ? (
        <PaymentTermsManager />
      ) : visibleSection === 'TRANSPORTE' ? (
        <TransportDebtManager
          canImport={permissions.canImportTransport}
          canExport={permissions.canExportTransport}
          canBulkEdit={permissions.canBulkEditTransport}
          canDeleteEntries={permissions.canDeleteTransportEntries}
          onPermissionBlocked={(action, details) => {
            void recordPermissionBlock('Transporte', action, details);
          }}
        />
      ) : visibleSection === 'BALACUBACO' ? (
        <ReallocationManager
          canImportData={permissions.canImportReallocationData}
          canGenerateSuggestions={permissions.canGenerateReallocationSuggestions}
          canExport={permissions.canExportReallocation}
          onPermissionBlocked={(action, details) => {
            void recordPermissionBlock('Remanejamento inteligente', action, details);
          }}
        />
      ) : (
        <main className="w-full p-4 pt-4">
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
    marginRules={marginRules}
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
    onClose={() => {
      setShowAssignMenu(false);
      setShowCategoryMenu(false);
      setShowEditModal(false);
      setEditingTask(null);
    }}
    onSave={updateTask}
  />
      )}<TaskDrawer
  task={viewingTask}
  profiles={profiles}
  user={user}
  userRole={userRole}
  onTradeNotesChanged={() => fetchTradeNoteIndicators(tasks)}
  onClose={() => setViewingTask(null)}
  onEdit={(task) => { openEditTaskModal(task); setViewingTask(null); }}
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


