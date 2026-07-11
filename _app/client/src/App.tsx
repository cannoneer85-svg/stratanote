import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { GraphView } from './components/GraphView';
import { DiffViewer } from './components/DiffViewer';
import { Auth } from './components/Auth';
import { SettingsPanel } from './components/SettingsPanel';
import { AboutModal } from './components/AboutModal';
import { ExportModal } from './components/ExportModal';
import { formatToMoscowTime } from './utils/date';
import { t, type Lang } from './utils/translations';
import { 
  Network, FileText, History, X, HelpCircle, Menu
} from 'lucide-react';

interface Note {
  relative_path: string;
  title: string;
  is_directory: boolean;
  parent_path: string;
  created_by?: string;
}

interface UserPresence {
  username: string;
  role: string;
  currentNote: string | null;
}

interface HistoryItem {
  id: number;
  relative_path: string;
  author_name: string;
  created_at: string;
  version_number?: number;
}

export default function App() {
  // Auth state
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [currentUser, setCurrentUser] = useState<any>(
    localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!) : null
  );

  // Suggestions notifications state
  const [pendingSuggestions, setPendingSuggestions] = useState<any[]>([]);
  const [autoOpenSuggestion, setAutoOpenSuggestion] = useState<any | null>(null);

  // Comments notifications state  
  const [pendingComments, setPendingComments] = useState<any[]>([]);
  const [autoOpenComments, setAutoOpenComments] = useState<boolean>(false);

  // Notification reads/dismissals tracking
  const [notificationReads, setNotificationReads] = useState<Record<string, { is_read: boolean; is_dismissed: boolean }>>({}); 

  const loadPendingSuggestions = async () => {
    if (!token || !currentUser || currentUser?.role === 'Viewer') return;
    try {
      const res = await fetch('/api/notes/suggestions/pending', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPendingSuggestions(data);
      }
    } catch (err) {
      console.error('Failed to load pending suggestions:', err);
    }
  };

  const loadPendingComments = async () => {
    if (!token || !currentUser) return;
    try {
      const res = await fetch('/api/comments/pending/all', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPendingComments(data);
      }
    } catch (err) {
      console.error('Failed to load pending comments:', err);
    }
  };

  const loadNotificationReads = async () => {
    if (!token || !currentUser) return;
    try {
      const res = await fetch('/api/notifications/reads', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const map: Record<string, { is_read: boolean; is_dismissed: boolean }> = {};
        for (const r of data.reads) {
          map[`${r.notification_type}:${r.notification_id}`] = {
            is_read: !!r.is_read,
            is_dismissed: !!r.is_dismissed,
          };
        }
        setNotificationReads(map);
      }
    } catch (err) {
      console.error('Failed to load notification reads:', err);
    }
  };

  const markNotificationRead = async (type: string, id: number) => {
    const key = `${type}:${id}`;
    setNotificationReads(prev => ({ ...prev, [key]: { ...prev[key], is_read: true, is_dismissed: prev[key]?.is_dismissed || false } }));
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ notification_type: type, notification_id: id })
      });
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  };

  const dismissNotification = async (type: string, id: number) => {
    const key = `${type}:${id}`;
    setNotificationReads(prev => ({ ...prev, [key]: { is_read: true, is_dismissed: true } }));
    try {
      await fetch('/api/notifications/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ notification_type: type, notification_id: id })
      });
    } catch (err) {
      console.error('Failed to dismiss notification:', err);
    }
  };

  const markAllNotificationsRead = async () => {
    const items: { type: string; id: number }[] = [];
    for (const s of pendingSuggestions) items.push({ type: 'suggestion', id: s.id });
    for (const c of pendingComments) items.push({ type: 'comment', id: c.id });
    const newReads = { ...notificationReads };
    for (const item of items) {
      newReads[`${item.type}:${item.id}`] = { is_read: true, is_dismissed: newReads[`${item.type}:${item.id}`]?.is_dismissed || false };
    }
    setNotificationReads(newReads);
    try {
      await fetch('/api/notifications/read-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ items })
      });
    } catch (err) {
      console.error('Failed to mark all read:', err);
    }
  };

  const dismissAllNotifications = async () => {
    const items: { type: string; id: number }[] = [];
    for (const s of pendingSuggestions) items.push({ type: 'suggestion', id: s.id });
    for (const c of pendingComments) items.push({ type: 'comment', id: c.id });
    const newReads = { ...notificationReads };
    for (const item of items) {
      newReads[`${item.type}:${item.id}`] = { is_read: true, is_dismissed: true };
    }
    setNotificationReads(newReads);
    try {
      await fetch('/api/notifications/dismiss-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ items })
      });
    } catch (err) {
      console.error('Failed to dismiss all:', err);
    }
  };

  // Layout and view state
  const [activeTab, setActiveTab] = useState<'editor' | 'graph'>('editor');
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteContents, setNoteContents] = useState<Record<string, string>>({});
  const [openedTabs, setOpenedTabs] = useState<string[]>([]);
  const [activeNotePath, setActiveNotePath] = useState<string | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return typeof window !== 'undefined' ? window.innerWidth > 768 : true;
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebar_width');
    return saved ? parseInt(saved, 10) : 320;
  });

  const sidebarRef = useRef<HTMLDivElement>(null);

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    
    // Create temporary full-screen overlay to block selections and capture events
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '9999';
    overlay.style.cursor = 'col-resize';
    overlay.style.userSelect = 'none';
    document.body.appendChild(overlay);

    // Create the ghost line indicator
    const ghostLine = document.createElement('div');
    ghostLine.style.position = 'fixed';
    ghostLine.style.top = '0';
    ghostLine.style.bottom = '0';
    ghostLine.style.width = '2px';
    ghostLine.style.backgroundColor = '#9d4edd'; // Primary neon purple color
    ghostLine.style.boxShadow = '0 0 8px #9d4edd, 0 0 15px #9d4edd'; // neon glow!
    ghostLine.style.zIndex = '10000';
    ghostLine.style.pointerEvents = 'none';
    
    // Position it initially at the current border position
    const currentSidebarNode = sidebarRef.current;
    const initialLeft = currentSidebarNode ? currentSidebarNode.getBoundingClientRect().right : startX;
    ghostLine.style.left = `${initialLeft}px`;
    document.body.appendChild(ghostLine);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const currentX = moveEvent.clientX;
      const boundedX = Math.max(200, Math.min(600, currentX));
      ghostLine.style.left = `${boundedX}px`;
    };
    
    const handleMouseUp = (moveEvent: MouseEvent) => {
      const finalX = moveEvent.clientX;
      const boundedWidth = Math.max(200, Math.min(600, finalX));
      
      setSidebarWidth(boundedWidth);
      localStorage.setItem('sidebar_width', boundedWidth.toString());
      
      // Update DOM width directly at the end of resize to match state immediately and prevent single-frame snap delays
      if (sidebarRef.current) {
        sidebarRef.current.style.width = `${boundedWidth}px`;
      }
      
      if (document.body.contains(overlay)) {
        document.body.removeChild(overlay);
      }
      if (document.body.contains(ghostLine)) {
        document.body.removeChild(ghostLine);
      }
      
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };
  
  // Admin & settings states
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [selectedParentFolder, setSelectedParentFolder] = useState('');

  // Real-time synchronization
  const [socket, setSocket] = useState<any>(null);
  const [activeUsers, setActiveUsers] = useState<UserPresence[]>([]);
  const [locks, setLocks] = useState<Record<string, string>>({}); // path -> username locking it

  // History and Diff state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryItem[]>([]);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<HistoryItem | null>(null);
  const [historicContent, setHistoricContent] = useState<string>('');
  const [previousContent, setPreviousContent] = useState<string>('');

  // System Version & About state
  const [aboutOpen, setAboutOpen] = useState(false);
  const [versionInfo, setVersionInfo] = useState<{
    version: string;
    history: any[];
    env?: string;
    updateAvailable?: boolean;
    latestVersion?: string;
    latestReleaseUrl?: string;
    updateCheckedAt?: number;
    updateError?: string | null;
  }>({
    version: '1.0.0',
    history: [],
    env: 'Development'
  });

  // System Language
  const [lang, setLang] = useState<Lang>(() => {
    return (localStorage.getItem('stratanote_lang') as Lang) || 'en';
  });

  const handleSetLang = (newLang: Lang) => {
    setLang(newLang);
    localStorage.setItem('stratanote_lang', newLang);
  };

  // Auto hash navigation for external link clicks
  useEffect(() => {
    const handleHashChange = () => {
      try {
        const hash = decodeURIComponent(window.location.hash.slice(1));
        if (hash && notes.some(n => n.relative_path === hash)) {
          openNote(hash);
        }
      } catch (err) {
        console.error('Error decoding hash navigation:', err);
      }
    };
    
    // Check initial hash on mount or when notes list is updated
    handleHashChange();
    
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [notes]);

  // Establish WebSockets and Load data on Login
  useEffect(() => {
    if (!token) return;

    // Load initial note index & version info
    loadNotes();
    fetchVersionInfo();
    loadPendingSuggestions();
    loadPendingComments();
    loadNotificationReads();

    // Setup Socket
    const socketInstance = io(window.location.origin);
    setSocket(socketInstance);

    // Identify user on socket
    socketInstance.emit('user-login', { 
      username: currentUser.username, 
      role: currentUser.role 
    });

    // Setup Socket event listeners
    socketInstance.on('active-presence', (users: UserPresence[]) => {
      setActiveUsers(users);
    });

    socketInstance.on('note-locked', ({ relative_path, username }: { relative_path: string; username: string }) => {
      setLocks(prev => ({ ...prev, [relative_path]: username }));
    });

    socketInstance.on('note-unlocked', ({ relative_path }: { relative_path: string }) => {
      setLocks(prev => {
        const next = { ...prev };
        delete next[relative_path];
        return next;
      });
    });

    socketInstance.on('vault-reload', () => {
      loadNotes();
      setOpenedTabs([]);
      setActiveNotePath(null);
      setNoteContents({});
    });

    socketInstance.on('file-create', () => {
      loadNotes();
    });

    socketInstance.on('file-update', ({ relative_path, content }: { relative_path: string; content: string }) => {
      // Reload notes list and if we have this note opened, update content
      loadNotes();
      setNoteContents(prev => {
        if (prev[relative_path] !== undefined) {
          return { ...prev, [relative_path]: content };
        }
        return prev;
      });
    });

    socketInstance.on('file-delete', ({ relative_path }: { relative_path: string }) => {
      loadNotes();
      // Remove from tabs if deleted
      setOpenedTabs(prev => prev.filter(t => t !== relative_path));
      setActiveNotePath(prev => prev === relative_path ? null : prev);
    });

    socketInstance.on('file-rename', ({ old_path, new_path }: { old_path: string; new_path: string }) => {
      loadNotes();
      
      // Update tabs lists (including children if it was a directory rename)
      setOpenedTabs(prev => prev.map(t => {
        if (t === old_path) return new_path;
        if (t.startsWith(old_path + '/')) {
          return new_path + t.slice(old_path.length);
        }
        return t;
      }));

      // Update active note path (including nested notes)
      setActiveNotePath(prev => {
        if (!prev) return null;
        if (prev === old_path) return new_path;
        if (prev.startsWith(old_path + '/')) {
          return new_path + prev.slice(old_path.length);
        }
        return prev;
      });
    });

    socketInstance.on('suggestion:changed', () => {
      loadPendingSuggestions();
    });

    socketInstance.on('comment:created', () => {
      loadPendingComments();
    });
    socketInstance.on('comment:resolved', () => {
      loadPendingComments();
    });
    socketInstance.on('comment:deleted', () => {
      loadPendingComments();
    });
    socketInstance.on('comment:approved', () => {
      loadPendingComments();
    });

    return () => {
      socketInstance.disconnect();
    };
  }, [token]);

  // Load system version info from server
  const fetchVersionInfo = async () => {
    try {
      const res = await fetch('/api/version', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setVersionInfo(data);
      }
    } catch (err) {
      console.error('Failed to load version info:', err);
    }
  };

  // Trigger manual update check on server
  const triggerVersionCheck = async () => {
    try {
      const res = await fetch('/api/version/check', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setVersionInfo(prev => ({
          ...prev,
          updateAvailable: data.updateAvailable,
          latestVersion: data.latestVersion,
          latestReleaseUrl: data.latestReleaseUrl,
          updateCheckedAt: data.updateCheckedAt,
          updateError: data.updateError
        }));
        return data;
      } else {
        const errData = await res.json();
        throw new Error(errData.error || 'Check failed');
      }
    } catch (err: any) {
      console.error('Failed to run update check:', err);
      setVersionInfo(prev => ({
        ...prev,
        updateError: err.message || 'Check failed'
      }));
      throw err;
    }
  };

  // Load physical notes index from database
  const loadNotes = async () => {
    try {
      const res = await fetch('/api/notes', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }
      const data = await res.json();
      if (res.ok) {
        setNotes(data);
      }
    } catch (err) {
      console.error('Failed to load notes:', err);
    }
  };

  // Open note file
  const openNote = async (path: string) => {
    // Check if tab is already open
    if (!openedTabs.includes(path)) {
      setOpenedTabs(prev => [...prev, path]);
    }
    setActiveNotePath(path);
    setHistoryOpen(false);
    setSelectedHistoryItem(null);
    if (window.innerWidth < 768) {
      setSidebarOpen(false);
    }

    // Fetch file content if not already cached
    if (noteContents[path] === undefined) {
      try {
        const res = await fetch(`/api/notes/content?relative_path=${encodeURIComponent(path)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401 || res.status === 403) {
          handleLogout();
          return;
        }
        const data = await res.json();
        if (res.ok) {
          setNoteContents(prev => ({ ...prev, [path]: data.content }));
        }
      } catch (err) {
        console.error('Failed to load note content:', err);
      }
    }

    // Set browser hash silently
    window.history.replaceState(null, '', `#${path}`);
  };

  const handleNotificationClick = (notification: any) => {
    openNote(notification.relative_path);
    // Only auto-open suggestion review for actual suggestions (not comments)
    if (notification.type !== 'comment') {
      setAutoOpenSuggestion(notification);
      markNotificationRead('suggestion', notification.id);
    } else {
      setAutoOpenComments(true);
      markNotificationRead('comment', notification.id);
    }
  };

  // Save note file
  const saveNote = async (content: string) => {
    if (!activeNotePath) return;

    try {
      const res = await fetch('/api/notes', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ relative_path: activeNotePath, content })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || (lang === 'en' ? 'Failed to save note' : 'Ошибка при сохранении заметки'));
      }

      setNoteContents(prev => ({ ...prev, [activeNotePath]: content }));
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Close opened tab
  const closeTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Unlock note explicitly on tab close
    if (socket && path === activeNotePath && !locks[path]) {
      socket.emit('unlock-note', { relative_path: path });
    }

    const nextTabs = openedTabs.filter(t => t !== path);
    setOpenedTabs(nextTabs);
    
    if (activeNotePath === path) {
      const nextActive = nextTabs.length > 0 ? nextTabs[nextTabs.length - 1] : null;
      setActiveNotePath(nextActive);
      if (!nextActive) {
        window.history.replaceState(null, '', ' ');
      } else {
        window.history.replaceState(null, '', `#${nextActive}`);
      }
    }
  };

  // Create physical folder or note on disk
  const handleCreateResource = async (relativePath: string, isDir: boolean) => {
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ relative_path: relativePath, is_directory: isDir })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || (lang === 'en' ? 'Failed to create resource' : 'Ошибка создания'));
      }

      await loadNotes();
      if (!isDir) {
        openNote(data.relative_path);
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Delete folder or note
  const handleDeleteResource = async (relativePath: string) => {
    try {
      const res = await fetch(`/api/notes?relative_path=${encodeURIComponent(relativePath)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || (lang === 'en' ? 'Failed to delete resource' : 'Ошибка удаления'));
      }

      await loadNotes();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Rename folder or note
  const handleRenameResource = async (oldPath: string, newName: string) => {
    try {
      const res = await fetch('/api/notes/rename', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ relative_path: oldPath, new_name: newName })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || (lang === 'en' ? 'Failed to rename resource' : 'Ошибка переименования'));
      }

      // If active note was renamed, update it reactively
      if (oldPath === activeNotePath) {
        setActiveNotePath(data.new_path);
        setOpenedTabs(prev => prev.map(t => t === oldPath ? data.new_path : t));
        window.location.hash = encodeURIComponent(data.new_path);
      } else if (openedTabs.includes(oldPath)) {
        // If note is open but not active, just update the tab
        setOpenedTabs(prev => prev.map(t => t === oldPath ? data.new_path : t));
      } else {
        // Handle child files when a parent directory was renamed
        setOpenedTabs(prev => prev.map(t => {
          if (t.startsWith(oldPath + '/')) {
            return data.new_path + t.slice(oldPath.length);
          }
          return t;
        }));
        setActiveNotePath(prev => {
          if (prev && prev.startsWith(oldPath + '/')) {
            const nextPath = data.new_path + prev.slice(oldPath.length);
            window.location.hash = encodeURIComponent(nextPath);
            return nextPath;
          }
          return prev;
        });
      }

      await loadNotes();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Fetch note's history list
  const toggleHistoryPanel = async () => {
    if (!activeNotePath) return;
    
    if (!historyOpen) {
      try {
        const res = await fetch(`/api/history?relative_path=${encodeURIComponent(activeNotePath)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (res.ok) {
          setHistoryList(data);
          setHistoryOpen(true);
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      setHistoryOpen(false);
      setSelectedHistoryItem(null);
    }
  };

  // View content of a historic note version
  const handleViewHistoryItem = async (item: HistoryItem) => {
    try {
      const res = await fetch(`/api/history/version?id=${item.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setSelectedHistoryItem(item);
        setHistoricContent(data.content);
        setPreviousContent(data.previousContent || '');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Restore history version content
  const handleRestoreHistory = async () => {
    if (!selectedHistoryItem || !activeNotePath) return;

    if (confirm(lang === 'en' ? `Are you sure you want to restore the version from ${formatToMoscowTime(selectedHistoryItem.created_at)}?` : `Вы действительно хотите восстановить версию от ${formatToMoscowTime(selectedHistoryItem.created_at)}?`)) {
      await saveNote(historicContent);
      setHistoryOpen(false);
      setSelectedHistoryItem(null);
    }
  };

  // Export Zip vault download
  const handleExportVault = (includeMD: boolean, includeAssets: boolean) => {
    window.open(`/api/notes/export?token=${token}&includeMD=${includeMD}&includeAssets=${includeAssets}`, '_blank');
  };

  // Handle successful login
  const handleLoginSuccess = (token: string, user: any) => {
    setToken(token);
    setCurrentUser(user);
  };

  // Handle logout
  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setCurrentUser(null);
    setOpenedTabs([]);
    setActiveNotePath(null);
    setNoteContents({});
  };

  // Render Auth overlay if not authenticated
  if (!token || !currentUser) {
    return <Auth onLoginSuccess={handleLoginSuccess} lang={lang} />;//
  }
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background relative">
      
      {/* Sidebar Overlay backdrop on mobile */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div 
        ref={sidebarRef}
        className={`
          fixed inset-y-0 left-0 h-full z-40 transition-transform duration-300 ease-in-out select-none
          md:relative md:translate-x-0 md:transition-none
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          ${sidebarOpen ? 'md:flex' : 'md:hidden'}
        `}
        style={{
          width: typeof window !== 'undefined' && window.innerWidth > 768 
            ? (sidebarOpen ? `${sidebarWidth}px` : '0px') 
            : '20rem'
        }}
      >
        <div className="flex-1 h-full w-full min-w-0">
          <Sidebar
            notes={notes}
            activeNotePath={activeNotePath}
            onNoteSelect={openNote}
            onCreateResource={handleCreateResource}
            onDeleteResource={handleDeleteResource}
            onRenameResource={handleRenameResource}
            activeUsers={activeUsers}
            currentUser={currentUser}
            onLogout={handleLogout}
            pendingSuggestions={pendingSuggestions}
            pendingComments={pendingComments}
            notificationReads={notificationReads}
            onNotificationClick={handleNotificationClick}
            onDismissNotification={dismissNotification}
            onMarkAllRead={markAllNotificationsRead}
            onDismissAll={dismissAllNotifications}
            onOpenExport={() => setExportModalOpen(true)}
            selectedParentFolder={selectedParentFolder}
            onSelectedParentFolderChange={setSelectedParentFolder}
            onOpenSettings={() => {
              setSettingsOpen(true);
              if (window.innerWidth < 768) setSidebarOpen(false);
            }}
            systemVersion={versionInfo.version}
            versionInfo={versionInfo}
            onOpenAbout={() => {
              setAboutOpen(true);
              if (window.innerWidth < 768) setSidebarOpen(false);
            }}
            lang={lang}
          />
        </div>

        {/* Desktop Resize handle */}
        <div
          onMouseDown={startResizing}
          className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-primary/40 active:bg-primary transition-colors z-50 hidden md:block"
          title={lang === 'en' ? "Drag to resize sidebar" : "Перетащите для изменения ширины"}
        />
      </div>

      {/* Main workspace container */}
      <div className="flex-1 h-full flex flex-col overflow-hidden min-w-0">
        
        {/* Top Navbar / Opened tabs */}
        <div className="h-12 border-b border-white/5 bg-black/20 flex items-center justify-between px-4 select-none">
          <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none flex-1 pr-4">
            {/* Sidebar toggle button */}
            <button
              onClick={() => setSidebarOpen(prev => !prev)}
              className="p-1.5 hover:bg-white/5 rounded-lg text-text-muted hover:text-white transition-colors cursor-pointer mr-1"
              title={sidebarOpen 
                ? (lang === 'en' ? "Collapse sidebar" : "Скрыть панель") 
                : (lang === 'en' ? "Expand sidebar" : "Показать панель")
              }
            >
              <Menu className="w-5 h-5" />
            </button>

            {openedTabs.map((tabPath) => {
              const note = notes.find(n => n.relative_path === tabPath);
              const title = note ? note.title : tabPath.split('/').pop()?.replace('.md', '');
              const isActive = tabPath === activeNotePath;

              return (
                <div
                  key={tabPath}
                  onClick={() => openNote(tabPath)}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-t-lg border-t border-x text-xs cursor-pointer transition-colors max-w-[150px] truncate ${
                    isActive 
                      ? 'bg-background-panel border-white/10 text-white font-semibold shadow-inner' 
                      : 'border-transparent text-text-muted hover:bg-white/[0.02] hover:text-text'
                  }`}
                >
                  <FileText className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-primary' : ''}`} />
                  <span className="truncate">{title}</span>
                  <button
                    onClick={(e) => closeTab(tabPath, e)}
                    className="p-0.5 hover:bg-white/10 hover:text-white rounded text-text-disabled transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}

            {openedTabs.length === 0 && (
              <span className="text-xs text-text-disabled italic">{lang === 'en' ? 'No open tabs' : 'Нет открытых вкладок'}</span>
            )}
          </div>

          {/* Tab switches & History triggers */}
          <div className="flex items-center space-x-2">
            <div className="flex border border-white/10 rounded-lg p-0.5 bg-black/30">
              <button
                onClick={() => setActiveTab('editor')}
                className={`p-1 px-2.5 sm:px-3.5 rounded text-xs flex items-center space-x-1.5 transition-all cursor-pointer ${
                  activeTab === 'editor' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('tab_notes', lang)}</span>
              </button>
              <button
                onClick={() => setActiveTab('graph')}
                className={`p-1 px-2.5 sm:px-3.5 rounded text-xs flex items-center space-x-1.5 transition-all cursor-pointer ${
                  activeTab === 'graph' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
                }`}
              >
                <Network className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('tab_graph', lang)}</span>
              </button>
            </div>

            {activeNotePath && activeTab === 'editor' && (
              <button
                onClick={toggleHistoryPanel}
                className={`p-1.5 border rounded-lg text-text-muted hover:text-white cursor-pointer transition-colors ${
                  historyOpen ? 'bg-primary/20 border-primary/40 text-primary' : 'bg-black/30 border-white/10'
                }`}
                title={t('btn_history', lang)}
              >
                <History className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Content Pane */}
        <div className="flex-1 overflow-hidden flex min-w-0">
          
          {/* Main workspace (Editor or Graph View) */}
          <div className="flex-1 h-full min-w-0 p-4 relative">
            {activeTab === 'editor' ? (
              activeNotePath ? (
                <div className="w-full h-full relative">
                  {selectedHistoryItem ? (
                    <DiffViewer
                      versionId={selectedHistoryItem.version_number || selectedHistoryItem.id}
                      versionDate={selectedHistoryItem.created_at}
                      authorName={selectedHistoryItem.author_name}
                      historicContent={previousContent}
                      currentContent={historicContent}
                      onClose={() => setSelectedHistoryItem(null)}
                      onRestore={handleRestoreHistory}
                      isReadOnly={currentUser.role === 'Viewer'}
                      lang={lang}
                      isCurrent={historyList.length > 0 && selectedHistoryItem.id === historyList[0].id}
                    />
                  ) : (
                    <Editor
                      notePath={activeNotePath}
                      initialContent={noteContents[activeNotePath] || ''}
                      onSave={saveNote}
                      isReadOnly={currentUser.role === 'Viewer'}
                      lockedBy={locks[activeNotePath] && locks[activeNotePath] !== currentUser?.username ? locks[activeNotePath] : null}
                      currentUser={currentUser}
                      allNotes={notes}
                      socket={socket}
                      autoOpenSuggestion={autoOpenSuggestion}
                      onClearAutoOpenSuggestion={() => setAutoOpenSuggestion(null)}
                      autoOpenComments={autoOpenComments}
                      onClearAutoOpenComments={() => setAutoOpenComments(false)}
                      lang={lang}
                    />
                  )}
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-center space-y-4">
                  <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl max-w-sm glass-card">
                    <HelpCircle className="w-12 h-12 text-primary/70 mx-auto mb-3 animate-pulse" />
                    <h2 className="text-lg font-bold text-white mb-1">{t('app_title', lang)}</h2>
                    <p className="text-xs text-text-muted">
                      {t('editor_select_note', lang)}
                    </p>
                  </div>
                </div>
              )
            ) : (
              <GraphView
                notes={notes}
                onNoteSelect={openNote}
                activeNotePath={activeNotePath}
                lang={lang}
              />
            )}
          </div>

          {/* Slide-out Version History Panel */}
          {historyOpen && activeNotePath && activeTab === 'editor' && !selectedHistoryItem && (() => {
            const currentNote = notes.find(n => n.relative_path === activeNotePath);
            const rawNoteCreator = currentNote?.created_by || 'system';
            const noteCreator = rawNoteCreator === 'system' || rawNoteCreator === 'Внешняя система'
              ? t('system_external', lang)
              : rawNoteCreator;
            return (
              <div className="w-80 h-full bg-background-panel border-l border-white/5 flex flex-col overflow-hidden animate-slide-in shrink-0">
                <div className="p-4 border-b border-white/5 flex items-center justify-between bg-black/10 select-none">
                  <div>
                    <span className="text-xs font-bold text-white uppercase tracking-wider">{t('history_title', lang)}</span>
                    <div className="text-[10px] text-text-disabled mt-0.5">{t('history_owner', lang)}: <span className="text-primary font-semibold">{noteCreator}</span></div>
                  </div>
                  <button
                    onClick={() => setHistoryOpen(false)}
                    className="p-1 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2 select-none">
                  {historyList.length === 0 ? (
                    <div className="text-center text-text-disabled text-xs mt-8">
                      {t('history_empty', lang)}
                    </div>
                  ) : (
                    historyList.map((item) => {
                      const isCurrent = item.id === historyList[0].id;
                      return (
                        <div
                          key={item.id}
                          onClick={() => handleViewHistoryItem(item)}
                          className={`p-3 border rounded-xl cursor-pointer transition-all active:scale-[0.98] ${
                            isCurrent
                              ? 'bg-primary/5 border-primary/20 hover:bg-primary/10 hover:border-primary/30'
                              : 'bg-white/[0.02] border-white/5 hover:bg-white/5 hover:border-white/10'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center">
                              <span className="text-xs font-semibold text-white">
                                {t('history_version', lang, { id: item.version_number || item.id })}
                              </span>
                              {isCurrent && (
                                <span className="ml-1.5 text-[9px] text-green-400 bg-green-500/10 border border-green-500/20 px-1.5 rounded-full font-bold">
                                  {lang === 'en' ? 'Current' : 'Текущая'}
                                </span>
                              )}
                            </div>
                            <span className="text-[9px] text-primary bg-primary/10 border border-primary/20 px-1.5 rounded-full font-bold">
                              {item.author_name === 'Внешняя система' || item.author_name === 'system' 
                                ? t('system_external', lang) 
                                : item.author_name}
                            </span>
                          </div>
                          <p className="text-[10px] text-text-muted">
                            {formatToMoscowTime(item.created_at)}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}

        </div>
      </div>
      
      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentUser={currentUser}
        selectedParentFolder={selectedParentFolder}
        token={token}
        onVaultReload={loadNotes}
        versionInfo={versionInfo}
        onCheckForUpdates={triggerVersionCheck}
        socket={socket}
        lang={lang}
        onLangChange={handleSetLang}
      />

      <AboutModal
        isOpen={aboutOpen}
        onClose={() => setAboutOpen(false)}
        versionInfo={versionInfo}
        lang={lang}
      />

      <ExportModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        onExport={handleExportVault}
        lang={lang}
      />
    </div>
  );
}
