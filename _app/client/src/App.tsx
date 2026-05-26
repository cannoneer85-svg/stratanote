import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { GraphView } from './components/GraphView';
import { DiffViewer } from './components/DiffViewer';
import { Auth } from './components/Auth';
import { 
  Network, FileText, History, X, HelpCircle
} from 'lucide-react';

interface Note {
  relative_path: string;
  title: string;
  is_directory: boolean;
  parent_path: string;
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
}

export default function App() {
  // Auth state
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [currentUser, setCurrentUser] = useState<any>(
    localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!) : null
  );

  // Layout and view state
  const [activeTab, setActiveTab] = useState<'editor' | 'graph'>('editor');
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteContents, setNoteContents] = useState<Record<string, string>>({});
  const [openedTabs, setOpenedTabs] = useState<string[]>([]);
  const [activeNotePath, setActiveNotePath] = useState<string | null>(null);

  // Real-time synchronization
  const [socket, setSocket] = useState<any>(null);
  const [activeUsers, setActiveUsers] = useState<UserPresence[]>([]);
  const [locks, setLocks] = useState<Record<string, string>>({}); // path -> username locking it

  // History and Diff state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryItem[]>([]);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<HistoryItem | null>(null);
  const [historicContent, setHistoricContent] = useState<string>('');

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
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [notes]);

  // Establish WebSockets and Load data on Login
  useEffect(() => {
    if (!token) return;

    // Load initial note index
    loadNotes();

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

    return () => {
      socketInstance.disconnect();
    };
  }, [token]);

  // Load physical notes index from database
  const loadNotes = async () => {
    try {
      const res = await fetch('/api/notes', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
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

    // Fetch file content if not already cached
    if (noteContents[path] === undefined) {
      try {
        const res = await fetch(`/api/notes/content?relative_path=${encodeURIComponent(path)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
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
        throw new Error(data.error || 'Ошибка при сохранении заметки');
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
        throw new Error(data.error || 'Ошибка создания');
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
        throw new Error(data.error || 'Ошибка удаления');
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
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Restore history version content
  const handleRestoreHistory = async () => {
    if (!selectedHistoryItem || !activeNotePath) return;

    if (confirm(`Вы действительно хотите восстановить версию от ${new Date(selectedHistoryItem.created_at).toLocaleString()}?`)) {
      await saveNote(historicContent);
      setHistoryOpen(false);
      setSelectedHistoryItem(null);
    }
  };

  // Export Zip vault download
  const handleExportVault = () => {
    window.open(`/api/notes/export?token=${token}`, '_blank');
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
    return <Auth onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      
      {/* Side Navigation panel */}
      <div className="w-80 h-full flex-shrink-0 select-none">
        <Sidebar
          notes={notes}
          activeNotePath={activeNotePath}
          onNoteSelect={openNote}
          onCreateResource={handleCreateResource}
          onDeleteResource={handleDeleteResource}
          activeUsers={activeUsers}
          currentUser={currentUser}
          onLogout={handleLogout}
          onExport={handleExportVault}
        />
      </div>

      {/* Main workspace container */}
      <div className="flex-1 h-full flex flex-col overflow-hidden min-w-0">
        
        {/* Top Navbar / Opened tabs */}
        <div className="h-12 border-b border-white/5 bg-black/20 flex items-center justify-between px-4 select-none">
          <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none flex-1 pr-4">
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
              <span className="text-xs text-text-disabled italic">Нет открытых вкладок</span>
            )}
          </div>

          {/* Tab switches & History triggers */}
          <div className="flex items-center space-x-2">
            <div className="flex border border-white/10 rounded-lg p-0.5 bg-black/30">
              <button
                onClick={() => setActiveTab('editor')}
                className={`p-1 px-3.5 rounded text-xs flex items-center space-x-1.5 transition-all cursor-pointer ${
                  activeTab === 'editor' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Заметки</span>
              </button>
              <button
                onClick={() => setActiveTab('graph')}
                className={`p-1 px-3.5 rounded text-xs flex items-center space-x-1.5 transition-all cursor-pointer ${
                  activeTab === 'graph' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
                }`}
              >
                <Network className="w-3.5 h-3.5" />
                <span>Граф</span>
              </button>
            </div>

            {activeNotePath && activeTab === 'editor' && (
              <button
                onClick={toggleHistoryPanel}
                className={`p-1.5 border rounded-lg text-text-muted hover:text-white cursor-pointer transition-colors ${
                  historyOpen ? 'bg-primary/20 border-primary/40 text-primary' : 'bg-black/30 border-white/10'
                }`}
                title="История изменений"
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
                      versionId={selectedHistoryItem.id}
                      versionDate={selectedHistoryItem.created_at}
                      authorName={selectedHistoryItem.author_name}
                      historicContent={historicContent}
                      currentContent={noteContents[activeNotePath] || ''}
                      onClose={() => setSelectedHistoryItem(null)}
                      onRestore={handleRestoreHistory}
                      isReadOnly={currentUser.role === 'Viewer'}
                    />
                  ) : (
                    <Editor
                      notePath={activeNotePath}
                      initialContent={noteContents[activeNotePath] || ''}
                      onSave={saveNote}
                      isReadOnly={currentUser.role === 'Viewer'}
                      lockedBy={locks[activeNotePath] || null}
                      currentUser={currentUser}
                      allNotes={notes}
                      socket={socket}
                    />
                  )}
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-center space-y-4">
                  <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl max-w-sm glass-card">
                    <HelpCircle className="w-12 h-12 text-primary/70 mx-auto mb-3 animate-pulse" />
                    <h2 className="text-lg font-bold text-white mb-1">Совместная база Obsidian</h2>
                    <p className="text-xs text-text-muted">
                      Выберите существующий markdown-документ в левом сайдбаре или создайте новый, чтобы приступить к редактированию.
                    </p>
                  </div>
                </div>
              )
            ) : (
              <GraphView
                notes={notes}
                noteContents={noteContents}
                onNoteSelect={openNote}
                activeNotePath={activeNotePath}
              />
            )}
          </div>

          {/* Slide-out Version History Panel */}
          {historyOpen && activeNotePath && activeTab === 'editor' && !selectedHistoryItem && (
            <div className="w-80 h-full bg-background-panel border-l border-white/5 flex flex-col overflow-hidden animate-slide-in shrink-0">
              <div className="p-4 border-b border-white/5 flex items-center justify-between bg-black/10 select-none">
                <span className="text-xs font-bold text-white uppercase tracking-wider">История версий</span>
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
                    История пуста.
                  </div>
                ) : (
                  historyList.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => handleViewHistoryItem(item)}
                      className="p-3 bg-white/[0.02] hover:bg-white/5 border border-white/5 hover:border-white/10 rounded-xl cursor-pointer transition-all active:scale-[0.98]"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-white">Версия #{item.id}</span>
                        <span className="text-[9px] text-primary bg-primary/10 border border-primary/20 px-1.5 rounded-full font-bold">
                          {item.author_name}
                        </span>
                      </div>
                      <p className="text-[10px] text-text-muted">
                        {new Date(item.created_at).toLocaleString()}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
