/**
 * @module SearchModal
 * Popover search component combining title search, FTS5 full-text search, and AI semantic vector query.
 */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, FileText, Sparkles, CornerDownLeft, X, Loader2, Folder, ChevronDown } from 'lucide-react';
import { type Lang } from '../utils/translations';

interface SearchResult {
  relative_path: string;
  title: string;
  snippet?: string;
  score?: number;
}

interface Note {
  relative_path: string;
  title: string;
  is_directory: boolean;
  parent_path: string;
}

/**
 * Properties for the {@link SearchModal} component.
 */
interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  token: string | null;
  lang: Lang;
  notes: Note[];
}

/**
 * Global search overlay modal dialog component.
 * Supports multiple search queries: Full-Text search (FTS5 with match highlights),
 * Semantic AI search (local vector similarity matching), and Title-only search.
 * Features full keyboard navigation (arrows, Enter, Escape) and folder tree filtering.
 */
export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  token,
  lang,
  notes
}) => {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'fts' | 'semantic' | 'title'>('fts');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // States and refs for folder filtering
  const [excludedFolders, setExcludedFolders] = useState<Set<string>>(new Set());
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Extract root folders from notes list
  const rootFolders = useMemo(() => {
    const folders = new Set<string>();
    let hasRootFiles = false;
    notes.forEach(note => {
      if (note.is_directory) return;
      const parts = note.relative_path.split('/');
      if (parts.length > 1) {
        folders.add(parts[0]);
      } else {
        hasRootFiles = true;
      }
    });
    const sorted = Array.from(folders).sort();
    if (hasRootFiles) {
      return ['__root__', ...sorted];
    }
    return sorted;
  }, [notes]);

  // Handle outside clicks to close the dropdown
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsFilterOpen(false);
      }
    };
    if (isFilterOpen) {
      window.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isFilterOpen]);

  const handleToggleFolder = (folder: string) => {
    setExcludedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folder)) {
        next.delete(folder);
      } else {
        next.add(folder);
      }
      return next;
    });
    setSelectedIndex(0);
  };

  const handleSelectAll = () => {
    setExcludedFolders(new Set());
    setSelectedIndex(0);
  };

  const handleClearAll = () => {
    setExcludedFolders(new Set(rootFolders));
    setSelectedIndex(0);
  };

  // Filtered results list based on folder selection
  const filteredResults = useMemo(() => {
    return results.filter(result => {
      const parts = result.relative_path.split('/');
      if (parts.length > 1) {
        const rootFolder = parts[0];
        return !excludedFolders.has(rootFolder);
      }
      return !excludedFolders.has('__root__');
    });
  }, [results, excludedFolders]);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Debounced search query
  useEffect(() => {
    if (!isOpen) return;
    
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    const delayDebounce = setTimeout(async () => {
      try {
        const excludedParam = Array.from(excludedFolders).join(',');
        const res = await fetch(`/api/notes/search?q=${encodeURIComponent(query)}&mode=${mode}&exclude=${encodeURIComponent(excludedParam)}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (res.ok && active) {
          const data = await res.json();
          setResults(data);
          setSelectedIndex(0);
        } else if (active) {
          console.error('Search failed');
        }
      } catch (err) {
        if (active) {
          console.error('Search API error:', err);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(delayDebounce);
    };
  }, [query, mode, isOpen, token, excludedFolders]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => {
          const next = Math.min(prev + 1, filteredResults.length - 1);
          scrollToItem(next);
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => {
          const next = Math.max(prev - 1, 0);
          scrollToItem(next);
          return next;
        });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredResults[selectedIndex]) {
          onSelect(filteredResults[selectedIndex].relative_path);
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredResults, selectedIndex, onClose, onSelect]);

  const scrollToItem = (index: number) => {
    if (!resultsContainerRef.current) return;
    const container = resultsContainerRef.current;
    const items = container.getElementsByTagName('div');
    const selectedItem = items[index];

    if (selectedItem) {
      const containerTop = container.scrollTop;
      const containerBottom = containerTop + container.clientHeight;
      const itemTop = (selectedItem as HTMLElement).offsetTop;
      const itemBottom = itemTop + (selectedItem as HTMLElement).clientHeight;

      if (itemTop < containerTop) {
        container.scrollTop = itemTop;
      } else if (itemBottom > containerBottom) {
        container.scrollTop = itemBottom - container.clientHeight;
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-background/75 backdrop-blur-md z-[100] flex items-center justify-center px-4 transition-all"
    >
      <div 
        className="bg-background-panel border border-white/10 rounded-2xl shadow-glass shadow-2xl w-full max-w-3xl h-[600px] max-h-[85vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Search Header */}
        <div className="flex items-center justify-between border-b border-white/10 p-3.5 gap-2.5">
          <Search className="w-5 h-5 text-text-muted shrink-0" />
          
          <input
            ref={inputRef}
            type="text"
            className="bg-transparent border-0 outline-none text-white placeholder-text-disabled text-sm flex-1 py-1"
            placeholder={
              lang === 'en' 
                ? "Search notes by text, AI meaning or title..." 
                : "Поиск по тексту, смыслу (ИИ) или названию..."
            }
            value={query}
            onChange={e => setQuery(e.target.value)}
          />

          {loading && <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />}

          <button 
            onClick={onClose}
            className="p-1 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Selector */}
        <div className="flex items-center justify-between border-b border-white/10 p-2 bg-slate-950/40 text-xs text-text-muted gap-1 select-none">
          <div className="flex gap-1">
            <button
              onClick={() => setMode('fts')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all duration-250 ${
                mode === 'fts' 
                  ? 'bg-primary text-white border border-primary/20 shadow-glow' 
                  : 'text-text-muted hover:text-white hover:bg-white/5'
              }`}
            >
              {lang === 'en' ? "Full-Text Search" : "Полнотекстовый поиск"}
            </button>
            
            <button
              onClick={() => setMode('semantic')}
              className={`px-3 py-1.5 rounded-lg font-medium flex items-center gap-1 transition-all duration-250 ${
                mode === 'semantic' 
                  ? 'bg-primary text-white border border-primary/20 shadow-glow' 
                  : 'text-text-muted hover:text-white hover:bg-white/5'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {lang === 'en' ? "Semantic (AI)" : "Смысловой (ИИ)"}
            </button>

            <button
              onClick={() => setMode('title')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all duration-250 ${
                mode === 'title' 
                  ? 'bg-primary text-white border border-primary/20 shadow-glow' 
                  : 'text-text-muted hover:text-white hover:bg-white/5'
              }`}
            >
              {lang === 'en' ? "By Title" : "По названию"}
            </button>
          </div>

          {/* Folder Filter Dropdown */}
          {rootFolders.length > 0 && (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                className={`px-2.5 py-1.5 rounded-md font-medium flex items-center gap-1.5 border transition-all cursor-pointer ${
                  excludedFolders.size > 0
                    ? 'bg-primary/20 text-primary border-primary/40 hover:bg-primary/30'
                    : 'bg-transparent text-text-muted border-white/5 hover:bg-white/5 hover:text-white'
                }`}
                title={lang === 'en' ? 'Filter Folders' : 'Фильтр папок'}
              >
                <Folder className="w-3.5 h-3.5" />
                <span>
                  {lang === 'en' ? 'Folders' : 'Папки'}
                  {excludedFolders.size > 0 && ` (${rootFolders.length - excludedFolders.size})`}
                </span>
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isFilterOpen ? 'rotate-180' : ''}`} />
              </button>

              {isFilterOpen && (
                <div className="absolute right-0 mt-1.5 w-56 bg-[#121214] border border-white/10 rounded-lg shadow-2xl z-50 p-2 text-xs flex flex-col gap-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
                  <div className="flex items-center justify-between px-1.5 py-0.5 border-b border-white/5 pb-1.5 select-none">
                    <span className="font-bold text-white uppercase tracking-wider text-[9px]">
                      {lang === 'en' ? 'Folders Filter' : 'Фильтр папок'}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={handleSelectAll}
                        className="text-primary hover:underline text-[10px] font-medium"
                      >
                        {lang === 'en' ? 'All' : 'Все'}
                      </button>
                      <button
                        onClick={handleClearAll}
                        className="text-text-disabled hover:text-white hover:underline text-[10px] font-medium"
                      >
                        {lang === 'en' ? 'Clear' : 'Сброс'}
                      </button>
                    </div>
                  </div>

                  <div className="max-h-48 overflow-y-auto space-y-0.5 py-1 select-none">
                    {rootFolders.map(folder => {
                      const isChecked = !excludedFolders.has(folder);
                      const displayName = folder === '__root__'
                        ? (lang === 'en' ? '/ (Root)' : '/ (Корень)')
                        : folder;
                      return (
                        <label
                          key={folder}
                          className="flex items-center space-x-2 px-1.5 py-1 rounded hover:bg-white/5 cursor-pointer text-text-muted hover:text-white transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleFolder(folder)}
                            className="rounded border-white/10 text-primary bg-black/40 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 accent-[#9333ea] cursor-pointer"
                          />
                          <span className="truncate">{displayName}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Results Container */}
        <div 
          ref={resultsContainerRef}
          className="flex-1 overflow-y-auto p-2 min-h-0"
        >
          {query.trim().length < 2 ? (
            <div className="flex flex-col items-center justify-center h-48 text-text-disabled text-xs">
              <Search className="w-8 h-8 mb-2 opacity-30" />
              <span>
                {lang === 'en' 
                  ? "Enter at least 2 characters to search..." 
                  : "Введите минимум 2 символа для поиска..."}
              </span>
            </div>
          ) : filteredResults.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center h-48 text-text-disabled text-xs">
              <X className="w-8 h-8 mb-2 opacity-30" />
              <span>
                {lang === 'en' 
                  ? "No results found" 
                  : "Ничего не найдено"}
              </span>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredResults.map((result, index) => {
                const isSelected = index === selectedIndex;
                const pathParts = result.relative_path.split('/');
                pathParts.pop();
                const dirPath = pathParts.join('/');

                return (
                  <div
                    key={`${result.relative_path}-${index}`}
                    onClick={() => {
                      onSelect(result.relative_path);
                      onClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`group flex flex-col p-3 rounded-lg cursor-pointer transition-all border ${
                      isSelected 
                        ? 'bg-primary/20 border-primary/40 text-white' 
                        : 'border-transparent text-text-muted hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2 truncate">
                        <FileText className={`w-4 h-4 shrink-0 ${
                          isSelected ? 'text-primary' : 'text-text-muted'
                        }`} />
                        <span className="font-medium text-sm truncate">{result.title}</span>
                        {dirPath && (
                          <span className="text-text-disabled text-[10px] truncate">
                            ({dirPath})
                          </span>
                        )}
                      </div>

                      {/* Display semantic score badge */}
                      {mode === 'semantic' && result.score !== undefined && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${
                          isSelected ? 'bg-primary/30 text-white' : 'bg-white/5 text-text-muted'
                        }`}>
                          {Math.round(result.score * 100)}% {lang === 'en' ? 'similarity' : 'сходство'}
                        </span>
                      )}

                      {/* Return Enter hint for selected */}
                      {isSelected && (
                        <span className="text-[10px] text-text-disabled flex items-center gap-0.5 shrink-0 select-none">
                          <CornerDownLeft className="w-3 h-3" />
                          <span>Enter</span>
                        </span>
                      )}
                    </div>

                    {/* Display FTS snippet with highlight mark */}
                    {mode === 'fts' && result.snippet && (
                      <p 
                        className="text-xs text-text-disabled mt-1.5 line-clamp-2 select-text group-hover:text-text-muted transition-colors leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: result.snippet }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Hints */}
        <div className="border-t border-white/10 p-2.5 bg-slate-950/20 flex justify-between text-[10px] text-text-disabled select-none">
          <div className="flex gap-3">
            <span>↑↓ {lang === 'en' ? "Navigate" : "Навигация"}</span>
            <span>Enter {lang === 'en' ? "Open" : "Открыть"}</span>
            <span>Esc {lang === 'en' ? "Close" : "Закрыть"}</span>
          </div>
          <div>
            <span>{lang === 'en' ? "Global Search" : "Глобальный поиск"} v1.0</span>
          </div>
        </div>
      </div>
    </div>
  );
};
