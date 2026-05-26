import React, { useState, useMemo, useEffect } from 'react';
import { 
  Folder, FolderOpen, FileText, Plus, FolderPlus, Download, 
  Search, LogOut, Users, ChevronRight, ChevronDown, Trash2
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

interface SidebarProps {
  notes: Note[];
  activeNotePath: string | null;
  onNoteSelect: (path: string) => void;
  onCreateResource: (name: string, isDir: boolean, parentPath: string) => void;
  onDeleteResource: (path: string) => void;
  activeUsers: UserPresence[];
  currentUser: { username: string; role: string };
  onLogout: () => void;
  onExport: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  notes,
  activeNotePath,
  onNoteSelect,
  onCreateResource,
  onDeleteResource,
  activeUsers,
  currentUser,
  onLogout,
  onExport
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [selectedParentFolder, setSelectedParentFolder] = useState<string>(''); // Currently selected target folder for new creations

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

  // Normalize path helpers
  const normalizePath = (p: string) => p.replace(/\\/g, '/');

  // Toggle folder expansion
  const toggleFolder = (folderPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolders(prev => ({
      ...prev,
      [folderPath]: !prev[folderPath]
    }));
  };

  // Handle Note/Folder Creations
  const handleCreate = (isDir: boolean) => {
    if (currentUser.role === 'Viewer') return;
    
    const promptMsg = isDir 
      ? `Введите название папки в каталоге "${selectedParentFolder || 'Корень'}":`
      : `Введите название файла в каталоге "${selectedParentFolder || 'Корень'}":`;
    
    const name = prompt(promptMsg);
    if (!name || name.trim() === '') return;

    const trimmedName = name.trim();
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
      ? `Вы действительно хотите удалить папку "${path}" и ВСЕ входящие файлы? Это действие необратимо!`
      : `Вы действительно хотите удалить заметку "${path}"?`;
    
    if (confirm(confirmMsg)) {
      onDeleteResource(path);
    }
  };

  // Filter notes by search query
  const filteredNotes = useMemo(() => {
    if (!searchQuery) return notes;
    return notes.filter(n => n.title.toLowerCase().includes(searchQuery.toLowerCase()));
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
                  onClick={() => setSelectedParentFolder(item.relative_path)}
                  className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                    isSelectedParent 
                      ? 'bg-primary/20 text-white border border-primary/30' 
                      : 'text-text-muted hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <div className="flex items-center space-x-1.5 truncate flex-1" onClick={(e) => toggleFolder(item.relative_path, e)}>
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
                    <button
                      onClick={(e) => handleDelete(item.relative_path, true, e)}
                      className="opacity-0 group-hover/dir:opacity-100 p-0.5 hover:bg-red-500/20 hover:text-red-400 text-text-disabled rounded transition-all cursor-pointer"
                      title="Удалить папку"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
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
                    <button
                      onClick={(e) => handleDelete(item.relative_path, false, e)}
                      className="opacity-0 group-hover/file:opacity-100 p-0.5 hover:bg-red-500/20 hover:text-red-400 text-text-disabled rounded transition-all cursor-pointer"
                      title="Удалить файл"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
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
    <div className="flex flex-col h-full bg-background-panel border-r border-white/5 overflow-hidden text-left select-none">
      
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
        
        <button
          onClick={onLogout}
          className="p-1.5 hover:bg-white/5 hover:text-red-400 text-text-disabled rounded-lg transition-colors cursor-pointer"
          title="Выйти"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      {/* Creation Tools */}
      {currentUser.role !== 'Viewer' && (
        <div className="p-3 grid grid-cols-2 gap-2 border-b border-white/5 bg-black/5">
          <button
            onClick={() => handleCreate(false)}
            className="flex items-center justify-center space-x-1 py-1.5 bg-white/5 hover:bg-white/10 active:scale-95 text-xs text-white rounded-lg transition-all cursor-pointer border border-white/5"
          >
            <Plus className="w-3.5 h-3.5 text-primary" />
            <span>Новый файл</span>
          </button>
          <button
            onClick={() => handleCreate(true)}
            className="flex items-center justify-center space-x-1 py-1.5 bg-white/5 hover:bg-white/10 active:scale-95 text-xs text-white rounded-lg transition-all cursor-pointer border border-white/5"
          >
            <FolderPlus className="w-3.5 h-3.5 text-primary" />
            <span>Новая папка</span>
          </button>
        </div>
      )}

      {/* Search Input */}
      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Поиск по названию..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-black/30 border border-white/5 rounded-lg text-xs text-text placeholder-text-disabled focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>
      </div>

      {/* Mirrored File Tree Root */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        <div className="flex items-center justify-between px-2 py-1 rounded text-[10px] font-bold text-text-disabled uppercase tracking-wider">
          <span>Проводник заметок</span>
          {selectedParentFolder && (
            <button 
              onClick={() => setSelectedParentFolder('')}
              className="text-primary hover:underline hover:text-white cursor-pointer"
              title="Сбросить выбор папки на Корень"
            >
              Корень
            </button>
          )}
        </div>
        {notes.length === 0 ? (
          <div className="text-center text-text-disabled text-xs mt-8">
            Хранилище пусто. <br /> Создайте свой первый файл!
          </div>
        ) : (
          renderTree('')
        )}
      </div>

      {/* Active Team Sockets Presence presence panel */}
      <div className="border-t border-white/5 bg-black/10 p-3 max-h-36 overflow-y-auto">
        <div className="flex items-center space-x-1 text-[10px] font-bold text-text-disabled uppercase tracking-wider mb-2">
          <Users className="w-3.5 h-3.5 text-primary" />
          <span>В сети ({activeUsers.length})</span>
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
                  ред: {user.currentNote.split('/').pop()?.replace('.md', '')}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Operations Utilities */}
      <div className="p-3 border-t border-white/5 bg-black/20 flex flex-col space-y-2">
        <button
          onClick={onExport}
          className="w-full py-2 bg-primary hover:bg-primary-hover active:scale-[0.98] text-white text-xs font-semibold rounded-lg flex items-center justify-center space-x-2 transition-all border border-primary/20 shadow-glow cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>Экспорт хранилища (.zip)</span>
        </button>
      </div>

    </div>
  );
};
