import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Folder, FolderOpen, FileText, Plus, FolderPlus, Download, 
  Search, LogOut, Users, ChevronRight, ChevronDown, Trash2, Edit2, Settings, Bell, X, CheckCheck, EyeOff
} from 'lucide-react';
import { t, type Lang } from '../utils/translations';

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

interface SidebarProps {
  notes: Note[];
  activeNotePath: string | null;
  onNoteSelect: (path: string) => void;
  onCreateResource: (name: string, isDir: boolean, parentPath: string) => void;
  onDeleteResource: (path: string) => void;
  onRenameResource: (oldPath: string, newName: string) => void;
  activeUsers: UserPresence[];
  currentUser: { username: string; role: string };
  onLogout: () => void;
  onOpenExport: () => void;
  selectedParentFolder: string;
  onSelectedParentFolderChange: (folder: string) => void;
  onOpenSettings?: () => void;
  systemVersion?: string;
  versionInfo?: any;
  onOpenAbout?: () => void;
  pendingSuggestions?: any[];
  pendingComments?: any[];
  notificationReads?: Record<string, { is_read: boolean; is_dismissed: boolean }>;
  onNotificationClick?: (notification: any) => void;
  onDismissNotification?: (type: string, id: number) => void;
  onMarkAllRead?: () => void;
  onDismissAll?: () => void;
  onOpenSearch?: () => void;
  lang: Lang;
}

export const Sidebar: React.FC<SidebarProps> = ({
  notes,
  activeNotePath,
  onNoteSelect,
  onCreateResource,
  onDeleteResource,
  onRenameResource,
  activeUsers,
  currentUser,
  onLogout,
  onOpenExport,
  selectedParentFolder,
  onSelectedParentFolderChange,
  onOpenSettings,
  systemVersion = '1.0.0',
  versionInfo,
  onOpenAbout,
  pendingSuggestions = [],
  pendingComments = [],
  notificationReads = {},
  onNotificationClick,
  onDismissNotification,
  onMarkAllRead,
  onDismissAll,
  onOpenSearch,
  lang
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [showNotifications, setShowNotifications] = useState(false);

  // Auto-expand all parent folders when the active note changes
  useEffect(() => {
    if (activeNotePath) {
      const parts = activeNotePath.split('/');
      if (parts.length > 1) {
        setExpandedFolders(prev => {
          const next = { ...prev };
          let currentPath = '';
          for (let i = 0; i < parts.length - 1; i++) {
            currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
            next[currentPath] = true;
          }
          return next;
        });
      }
    }
  }, [activeNotePath]);

  const prevSearchQuery = useRef('');
  const savedExpandedState = useRef<Record<string, boolean>>({});

  // Auto-expand folders when searching & restore state on clear
  useEffect(() => {
    // If search just started, save the state
    if (searchQuery && !prevSearchQuery.current) {
      savedExpandedState.current = { ...expandedFolders };
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matched = notes.filter(n => n.title.toLowerCase().includes(query));
      setExpandedFolders(prev => {
        const next = { ...prev };
        matched.forEach(n => {
          let parent = n.parent_path;
          while (parent) {
            next[parent] = true;
            const parts = parent.split('/');
            parts.pop();
            parent = parts.join('/');
          }
        });
        return next;
      });
    } else if (!searchQuery && prevSearchQuery.current) {
      // Restore previous state when search is cleared
      setExpandedFolders(savedExpandedState.current);
      savedExpandedState.current = {};
    }

    prevSearchQuery.current = searchQuery;
  }, [searchQuery, notes]);

  // Normalize path helpers
  const normalizePath = (p: string) => p.replace(/\\/g, '/');



  // Handle Note/Folder Creations
  const handleCreate = (isDir: boolean) => {
    if (currentUser.role === 'Viewer') return;
    
    const rootLabel = lang === 'en' ? 'Root' : 'Корень';
    const promptMsg = isDir 
      ? (lang === 'en' ? `Enter folder name in folder "${selectedParentFolder || rootLabel}":` : `Введите название папки в каталоге "${selectedParentFolder || rootLabel}":`)
      : (lang === 'en' ? `Enter file name in folder "${selectedParentFolder || rootLabel}":` : `Введите название файла в каталоге "${selectedParentFolder || rootLabel}":`);
    
    const name = prompt(promptMsg);
    if (!name || name.trim() === '') return;

    const trimmedName = name.trim();
    
    // Block illegal OS filesystem characters (\ / : * ? " < > |)
    const illegalChars = /[\\/:*?"<>|]/;
    if (illegalChars.test(trimmedName)) {
      alert(lang === 'en' ? "Name cannot contain filesystem special characters: \\ / : * ? \" < > |" : "Название не может содержать специальные символы файловой системы: \\ / : * ? \" < > |");
      return;
    }

    // Verify file name has .md extension
    let relativePath = selectedParentFolder 
      ? `${selectedParentFolder}/${trimmedName}` 
      : trimmedName;
    
    if (!isDir && !relativePath.endsWith('.md')) {
      relativePath += '.md';
    }

    onCreateResource(relativePath, isDir, selectedParentFolder);
  };

  // Handle Note/Folder Deletion
  const handleDelete = (path: string, isDir: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentUser.role === 'Viewer') return;

    const confirmMsg = isDir 
      ? t('sidebar_confirm_delete_folder', lang, { name: path })
      : t('sidebar_confirm_delete_note', lang, { name: path });
    
    if (confirm(confirmMsg)) {
      onDeleteResource(path);
    }
  };

  // Handle Note/Folder Rename
  const handleRename = (path: string, isDir: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentUser.role === 'Viewer') return;

    const currentName = path.split('/').pop()?.replace('.md', '') || '';
    const newName = prompt(
      lang === 'en' ? `Enter new name for ${isDir ? 'folder' : 'file'}:` : `Введите новое имя для ${isDir ? 'папки' : 'файла'}:`, 
      currentName
    );
    if (!newName || newName.trim() === '' || newName.trim() === currentName) return;

    const trimmedName = newName.trim();
    // Block illegal OS filesystem characters (\ / : * ? " < > |)
    const illegalChars = /[\\/:*?"<>|]/;
    if (illegalChars.test(trimmedName)) {
      alert(lang === 'en' ? "Name cannot contain filesystem special characters: \\ / : * ? \" < > |" : "Название не может содержать специальные символы файловой системы: \\ / : * ? \" < > |");
      return;
    }

    onRenameResource(path, trimmedName);
  };

  // Expand all folders in the file tree
  const expandAllFolders = () => {
    const folders = notes.filter(n => n.is_directory);
    const next: Record<string, boolean> = {};
    folders.forEach(f => {
      next[f.relative_path] = true;
    });
    setExpandedFolders(next);
  };

  // Collapse all folders in the file tree
  const collapseAllFolders = () => {
    setExpandedFolders({});
  };
  const filteredNotes = useMemo(() => {
    if (!searchQuery) return notes;
    const query = searchQuery.toLowerCase();
    
    // Find all notes/folders that match the query
    const matched = notes.filter(n => n.title.toLowerCase().includes(query));
    
    // Collect all ancestor paths of the matched items
    const ancestorPaths = new Set<string>();
    matched.forEach(n => {
      let parent = n.parent_path;
      while (parent) {
        ancestorPaths.add(parent);
        // Go up one level
        const parts = parent.split('/');
        parts.pop();
        parent = parts.join('/');
      }
    });

    // Filter notes to include matched items AND their ancestor folders
    return notes.filter(n => 
      n.title.toLowerCase().includes(query) || 
      (n.is_directory && ancestorPaths.has(n.relative_path))
    );
  }, [notes, searchQuery]);

  // Recursively reconstruct and render folder tree
  const renderTree = (parentPath: string, depth: number = 0) => {
    // Select folders and files residing directly in this parent folder
    const levelItems = filteredNotes.filter(n => {
      const normParent = normalizePath(n.parent_path);
      const normTarget = normalizePath(parentPath);
      return normParent === normTarget;
    });

    if (levelItems.length === 0) return null;

    return (
      <ul className="space-y-1 mt-1 pl-3 select-none">
        {levelItems.map((item) => {
          const isDir = item.is_directory;
          const isExpanded = expandedFolders[item.relative_path] || false;
          const isActiveFile = item.relative_path === activeNotePath;
          const isSelectedParent = item.relative_path === selectedParentFolder;

          if (isDir) {
            return (
              <li key={item.relative_path} className="group/dir">
                <div
                  onClick={() => {
                    onSelectedParentFolderChange(item.relative_path);
                    setExpandedFolders(prev => ({
                      ...prev,
                      [item.relative_path]: !prev[item.relative_path]
                    }));
                  }}
                  className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                    isSelectedParent 
                      ? 'bg-primary/20 text-white border border-primary/30 shadow-sm shadow-primary/10' 
                      : 'text-text-muted hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <div className="flex items-center space-x-1.5 truncate flex-1">
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-text-disabled shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-text-disabled shrink-0" />
                    )}
                    {isExpanded ? (
                      <FolderOpen className="w-4 h-4 text-primary shrink-0" />
                    ) : (
                      <Folder className="w-4 h-4 text-primary shrink-0" />
                    )}
                    <span className="truncate">{item.title}</span>
                  </div>

                  {currentUser.role !== 'Viewer' && (
                    <div className="flex items-center space-x-1 opacity-0 group-hover/dir:opacity-100 transition-all shrink-0">
                      <button
                        onClick={(e) => handleRename(item.relative_path, true, e)}
                        className="p-0.5 hover:bg-white/5 hover:text-primary text-text-disabled rounded cursor-pointer transition-colors"
                        title={lang === 'en' ? 'Rename folder' : 'Переименовать папку'}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(item.relative_path, true, e)}
                        className="p-0.5 hover:bg-red-500/20 hover:text-red-400 text-text-disabled rounded cursor-pointer transition-colors"
                        title={lang === 'en' ? 'Delete folder' : 'Удалить папку'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {isExpanded && (
                  <div className="border-l border-white/5 ml-3">
                    {renderTree(item.relative_path, depth + 1)}
                  </div>
                )}
              </li>
            );
          } else {
            return (
              <li key={item.relative_path} className="group/file">
                <div
                  onClick={() => onNoteSelect(item.relative_path)}
                  className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                    isActiveFile 
                      ? 'bg-primary text-white font-semibold shadow-glow border border-primary/20' 
                      : 'text-text-muted hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate flex-1">
                    <FileText className={`w-3.5 h-3.5 shrink-0 ${isActiveFile ? 'text-white' : 'text-text-muted'}`} />
                    <span className="truncate">{item.title}</span>
                  </div>

                  {currentUser.role !== 'Viewer' && (
                    <div className="flex items-center space-x-1 opacity-0 group-hover/file:opacity-100 transition-all shrink-0">
                      <button
                        onClick={(e) => handleRename(item.relative_path, false, e)}
                        className="p-0.5 hover:bg-white/5 hover:text-primary text-text-disabled rounded cursor-pointer transition-colors"
                        title={lang === 'en' ? 'Rename file' : 'Переименовать файл'}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(item.relative_path, false, e)}
                        className="p-0.5 hover:bg-red-500/20 hover:text-red-400 text-text-disabled rounded cursor-pointer transition-colors"
                        title={lang === 'en' ? 'Delete file' : 'Удалить файл'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          }
        })}
      </ul>
    );
  };

  return (
    <div className="flex flex-col h-full w-full bg-background-panel border-r border-white/5 overflow-visible text-left select-none">
      
      {/* User Info Header */}
      <div className="p-4 border-b border-white/5 bg-black/10 flex items-center justify-between">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center text-primary font-bold uppercase shrink-0">
            {currentUser.username[0]}
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-white truncate">{currentUser.username}</h3>
            <span className="text-[10px] text-primary/80 uppercase font-extrabold tracking-wider">{currentUser.role}</span>
          </div>
        </div>
        
        <div className="flex items-center space-x-1.5">
          {/* Notifications Bell & Popover */}
          {(() => {
            // Filter out dismissed notifications
            const visibleSuggestions = pendingSuggestions.filter(s => !notificationReads[`suggestion:${s.id}`]?.is_dismissed);
            const visibleComments = pendingComments.filter(c => !notificationReads[`comment:${c.id}`]?.is_dismissed);
            const totalVisible = visibleSuggestions.length + visibleComments.length;
            const unreadCount = visibleSuggestions.filter(s => !notificationReads[`suggestion:${s.id}`]?.is_read).length
              + visibleComments.filter(c => !notificationReads[`comment:${c.id}`]?.is_read).length;

            if (currentUser.role === 'Viewer' && visibleComments.length === 0 && visibleSuggestions.length === 0) return null;

            return (
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className={`p-1.5 hover:bg-white/5 rounded-lg transition-colors cursor-pointer relative ${
                  unreadCount > 0 ? 'text-primary animate-pulse' : totalVisible > 0 ? 'text-primary/60' : 'text-text-disabled hover:text-white'
                }`}
                title={t('sidebar_notifications_tooltip', lang)}
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute top-0 right-0 bg-primary w-2 h-2 rounded-full ring-2 ring-background-panel" />
                )}
              </button>

              {showNotifications && (
                <div className="absolute left-0 mt-2 w-80 bg-background-panel border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden text-xs">
                  {/* Header */}
                  <div className="p-3 border-b border-white/5 bg-black/20">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-white">{t('sidebar_notifications_title', lang)}</span>
                      <div className="flex items-center space-x-1.5">
                        {unreadCount > 0 && (
                          <span className="bg-primary/20 text-primary text-[10px] px-2 py-0.5 rounded-full font-bold">
                            {unreadCount}
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowNotifications(false);
                          }}
                          className="p-1 hover:bg-white/10 hover:text-white text-text-disabled rounded transition-colors cursor-pointer"
                          title={t('sidebar_notifications_close', lang)}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {/* Action buttons row */}
                    {totalVisible > 0 && (
                      <div className="flex items-center space-x-2 mt-2">
                        {unreadCount > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onMarkAllRead?.();
                            }}
                            className="flex items-center space-x-1 text-[9px] text-primary/70 hover:text-primary transition-colors cursor-pointer"
                          >
                            <CheckCheck className="w-3 h-3" />
                            <span>{t('sidebar_notifications_mark_all_read', lang)}</span>
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDismissAll?.();
                          }}
                          className="flex items-center space-x-1 text-[9px] text-text-disabled hover:text-red-400 transition-colors cursor-pointer"
                        >
                          <EyeOff className="w-3 h-3" />
                          <span>{t('sidebar_notifications_dismiss_all', lang)}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="max-h-72 overflow-y-auto">
                    {totalVisible === 0 ? (
                      <div className="p-4 text-center text-text-disabled">
                        {t('sidebar_notifications_empty', lang)}
                      </div>
                    ) : (
                      <>
                        {/* Suggestions section */}
                        {visibleSuggestions.length > 0 && (
                          <>
                            <div className="px-3 py-1.5 bg-black/30 border-b border-white/5">
                              <span className="text-[9px] text-text-disabled uppercase font-bold tracking-wider">
                                {t('sidebar_notifications_suggestions_section', lang)} ({visibleSuggestions.length})
                              </span>
                            </div>
                            {visibleSuggestions.map((s: any) => {
                              const isRead = !!notificationReads[`suggestion:${s.id}`]?.is_read;
                              return (
                                <div
                                  key={`s-${s.id}`}
                                  className={`relative group border-b border-white/5 transition-colors ${
                                    isRead ? 'opacity-50 hover:opacity-70' : 'border-l-2 border-l-primary'
                                  }`}
                                >
                                  <button
                                    onClick={() => {
                                      if (onNotificationClick) onNotificationClick(s);
                                      setShowNotifications(false);
                                    }}
                                    className="w-full p-3 hover:bg-white/5 transition-colors text-left flex flex-col space-y-1 cursor-pointer"
                                  >
                                    <div className="flex justify-between items-start">
                                      <span className={`font-semibold truncate max-w-[160px] ${isRead ? 'text-text-muted' : 'text-white'}`}>
                                        {s.title}
                                      </span>
                                      <span className="text-[9px] text-text-disabled shrink-0 bg-white/5 px-1.5 py-0.5 rounded">
                                        {s.author_name}
                                      </span>
                                    </div>
                                    <span className="text-[10px] text-text-disabled truncate">
                                      {t('sidebar_notifications_path', lang)}: {s.relative_path}
                                    </span>
                                    <span className={`text-[9px] uppercase font-semibold ${isRead ? 'text-primary/50' : 'text-primary/80'}`}>
                                      {t('sidebar_notifications_click_tip', lang)}
                                    </span>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onDismissNotification?.('suggestion', s.id);
                                    }}
                                    className="absolute bottom-2 right-2 p-0.5 hover:bg-white/10 text-text-disabled hover:text-red-400 rounded transition-all cursor-pointer opacity-0 group-hover:opacity-100"
                                    title={t('sidebar_notifications_dismiss', lang)}
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              );
                            })}
                          </>
                        )}
                        {/* Comments section */}
                        {visibleComments.length > 0 && (
                          <>
                            <div className="px-3 py-1.5 bg-black/30 border-b border-white/5">
                              <span className="text-[9px] text-text-disabled uppercase font-bold tracking-wider">
                                {t('sidebar_notifications_comments_section', lang)} ({visibleComments.length})
                              </span>
                            </div>
                            {visibleComments.slice(0, 10).map((c: any) => {
                              const isRead = !!notificationReads[`comment:${c.id}`]?.is_read;
                              return (
                                <div
                                  key={`c-${c.id}`}
                                  className={`relative group border-b border-white/5 transition-colors ${
                                    isRead ? 'opacity-50 hover:opacity-70' : 'border-l-2 border-l-primary'
                                  }`}
                                >
                                  <button
                                    onClick={() => {
                                      if (onNotificationClick) onNotificationClick({ relative_path: c.relative_path, type: 'comment', id: c.id });
                                      setShowNotifications(false);
                                    }}
                                    className="w-full p-3 hover:bg-white/5 transition-colors text-left flex flex-col space-y-1 cursor-pointer"
                                  >
                                    <div className="flex justify-between items-start">
                                      <span className={`font-semibold truncate max-w-[160px] ${isRead ? 'text-text-muted' : 'text-white'}`}>
                                        {c.note_title || c.relative_path}
                                      </span>
                                      <span className="text-[9px] text-text-disabled shrink-0 bg-white/5 px-1.5 py-0.5 rounded">
                                        {c.author_name}
                                      </span>
                                    </div>
                                    <span className="text-[10px] text-text-muted truncate">
                                      {c.content?.slice(0, 80)}{c.content?.length > 80 ? '...' : ''}
                                    </span>
                                    <span className={`text-[9px] uppercase font-semibold ${isRead ? 'text-primary/50' : 'text-primary/80'}`}>
                                      {c.parent_id ? t('sidebar_notifications_new_reply', lang) : t('sidebar_notifications_new_comment', lang)}
                                    </span>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onDismissNotification?.('comment', c.id);
                                    }}
                                    className="absolute bottom-2 right-2 p-0.5 hover:bg-white/10 text-text-disabled hover:text-red-400 rounded transition-all cursor-pointer opacity-0 group-hover:opacity-100"
                                    title={t('sidebar_notifications_dismiss', lang)}
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              );
                            })}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
            );
          })()}

          {currentUser.role === 'Admin' && onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="p-1.5 hover:bg-white/5 hover:text-primary text-text-disabled rounded-lg transition-colors cursor-pointer"
              title={t('sidebar_settings', lang)}
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onLogout}
            className="p-1.5 hover:bg-white/5 hover:text-red-400 text-text-disabled rounded-lg transition-colors cursor-pointer"
            title={t('sidebar_logout', lang)}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Creation Tools */}
      {currentUser.role !== 'Viewer' && (
        <div className="p-3 grid grid-cols-2 gap-2 border-b border-white/5 bg-black/5">
          <button
            onClick={() => handleCreate(false)}
            className="flex items-center justify-center space-x-1 py-1.5 bg-white/5 hover:bg-white/10 active:scale-95 text-xs text-white rounded-lg transition-all cursor-pointer border border-white/5"
          >
            <Plus className="w-3.5 h-3.5 text-primary" />
            <span>{t('sidebar_new_note', lang)}</span>
          </button>
          <button
            onClick={() => handleCreate(true)}
            className="flex items-center justify-center space-x-1 py-1.5 bg-white/5 hover:bg-white/10 active:scale-95 text-xs text-white rounded-lg transition-all cursor-pointer border border-white/5"
          >
            <FolderPlus className="w-3.5 h-3.5 text-primary" />
            <span>{t('sidebar_new_folder', lang)}</span>
          </button>
        </div>
      )}

      {/* Search Input */}
      <div className="px-3 py-2 flex items-center space-x-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder={t('sidebar_search_placeholder', lang)}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 bg-black/30 border border-white/5 rounded-lg text-xs text-text placeholder-text-disabled focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>
        {onOpenSearch && (
          <button
            onClick={onOpenSearch}
            className="p-1.5 bg-black/30 border border-white/5 rounded-lg text-text-muted hover:text-white hover:border-primary/50 transition-all cursor-pointer flex items-center justify-center shrink-0"
            title={lang === 'en' ? 'Global Search (Ctrl+P)' : 'Глобальный поиск (Ctrl+P)'}
          >
            <Search className="w-4 h-4 text-primary" />
          </button>
        )}
      </div>

      {/* Mirrored File Tree Root */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        <div className="flex items-center justify-between px-2 py-1.5 rounded text-[10px] font-bold text-text-disabled uppercase tracking-wider select-none">
          <span>{t('sidebar_explorer', lang)}</span>
          <div className="flex items-center space-x-2.5 normal-case font-medium">
            <button
              onClick={expandAllFolders}
              className="hover:text-white text-text-disabled transition-colors cursor-pointer flex items-center"
              title={lang === 'en' ? 'Expand all folders' : 'Развернуть все папки'}
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={collapseAllFolders}
              className="hover:text-white text-text-disabled transition-colors cursor-pointer flex items-center"
              title={lang === 'en' ? 'Collapse all folders' : 'Свернуть все папки'}
            >
              <Folder className="w-3.5 h-3.5" />
            </button>
            {selectedParentFolder && (
              <button 
                onClick={() => onSelectedParentFolderChange('')}
                className="text-primary hover:underline hover:text-white cursor-pointer border-l border-white/10 pl-2 ml-1"
                title={lang === 'en' ? 'Reset folder filter to Root' : 'Сбросить выбор папки на Корень'}
              >
                {lang === 'en' ? 'Root' : 'Корень'}
              </button>
            )}
          </div>
        </div>
        {notes.length === 0 ? (
          <div className="text-center text-text-disabled text-xs mt-8">
            {lang === 'en' ? 'Vault is empty.' : 'Хранилище пусто.'} <br /> {lang === 'en' ? 'Create your first file!' : 'Создайте свой первый файл!'}
          </div>
        ) : filteredNotes.length === 0 ? (
          <div className="text-center text-text-disabled text-xs mt-8 font-medium">
            {t('sidebar_no_notes', lang)}
          </div>
        ) : (
          renderTree('')
        )}
      </div>

      {/* Active Team Sockets Presence presence panel */}
      <div className="border-t border-white/5 bg-black/10 p-3 max-h-36 overflow-y-auto">
        <div className="flex items-center space-x-1 text-[10px] font-bold text-text-disabled uppercase tracking-wider mb-2">
          <Users className="w-3.5 h-3.5 text-primary" />
          <span>{lang === 'en' ? `Online (${activeUsers.length})` : `В сети (${activeUsers.length})`}</span>
        </div>
        <div className="space-y-1.5">
          {activeUsers.map((user, idx) => (
            <div key={idx} className="flex items-center justify-between text-xs">
              <div className="flex items-center space-x-1.5 truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                <span className="font-semibold text-white truncate max-w-[80px]">{user.username}</span>
                <span className="text-[9px] text-text-disabled uppercase bg-white/5 px-1 rounded shrink-0">{user.role}</span>
              </div>
              {user.currentNote && (
                <span className="text-[10px] text-primary/70 italic truncate max-w-[100px]" title={user.currentNote}>
                  {lang === 'en' ? 'edit: ' : 'ред: '}{user.currentNote.split('/').pop()?.replace('.md', '')}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Operations Utilities */}
      <div className="p-3 border-t border-white/5 bg-black/20 flex flex-col space-y-2">
        <button
          onClick={onOpenExport}
          className="w-full py-2 bg-primary hover:bg-primary-hover active:scale-[0.98] text-white text-xs font-semibold rounded-lg flex items-center justify-center space-x-2 transition-all border border-primary/20 shadow-glow cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>{t('sidebar_export_vault', lang)} (.zip)</span>
        </button>
      </div>

      {/* System Version Footer */}
      {onOpenAbout && (
        <div className="px-4 pb-3.5 bg-black/20 flex items-center justify-between text-[10px] text-text-disabled border-t border-white/5 pt-2 select-none">
          <span className="font-medium">StrataNote</span>
          <button
            onClick={onOpenAbout}
            className={`flex items-center space-x-0.5 transition-colors cursor-pointer underline font-bold ${
              versionInfo?.updateAvailable 
                ? 'text-amber-500 hover:text-amber-400 font-extrabold' 
                : 'hover:text-primary'
            }`}
            title={
              versionInfo?.updateAvailable 
                ? `${t('sidebar_about', lang)} (${t('system_update_available', lang, { version: versionInfo.latestVersion })})` 
                : t('sidebar_about', lang)
            }
          >
            {versionInfo?.updateAvailable && (
              <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-500 text-black text-[9px] font-black mr-0.5 select-none no-underline border border-black/10">
                !
              </span>
            )}
            <span>v{systemVersion}</span>
          </button>
        </div>
      )}

    </div>
  );
};
