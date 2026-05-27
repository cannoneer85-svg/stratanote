import React, { useState, useEffect, useRef, useMemo } from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { 
  Heading1, Heading2, Heading3, Bold, Italic, List, CheckSquare, 
  Link as LinkIcon, Image as ImageIcon, Eye, Code, Save, FileLock, User
} from 'lucide-react';

interface Note {
  relative_path: string;
  title: string;
  is_directory: boolean;
}

interface EditorProps {
  notePath: string;
  initialContent: string;
  onSave: (content: string) => Promise<void>;
  isReadOnly: boolean;
  lockedBy: string | null;
  currentUser: { username: string };
  allNotes: Note[];
  socket: any;
}

export const Editor: React.FC<EditorProps> = ({
  notePath,
  initialContent,
  onSave,
  isReadOnly,
  lockedBy,
  currentUser,
  allNotes,
  socket
}) => {
  const [content, setContent] = useState(initialContent);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);
  const [wikiDropdownOpen, setWikiDropdownOpen] = useState(false);
  const [wikiSearch, setWikiSearch] = useState('');
  const [wikiSelectedIndex, setWikiSelectedIndex] = useState(0);
  const [editorSelection, setEditorSelection] = useState<{ anchor: number; head: number } | null>(null);
  const [dropdownCoords, setDropdownCoords] = useState<{ top: number; left: number } | null>(null);
  
  const filteredDropdownNotes = useMemo(() => {
    return allNotes
      .filter(n => !n.is_directory && n.relative_path !== notePath)
      .filter(n => n.title.toLowerCase().includes(wikiSearch.toLowerCase()))
      .slice(0, 8);
  }, [allNotes, notePath, wikiSearch]);

  // Reset selected index when search changes
  useEffect(() => {
    setWikiSelectedIndex(0);
  }, [wikiSearch]);
  
  const editorRef = useRef<any>(null);

  // Sync state with prop updates
  useEffect(() => {
    setContent(initialContent);
  }, [initialContent, notePath]);

  // Request lock when entering edit mode
  useEffect(() => {
    if (socket && notePath && !isReadOnly && !lockedBy) {
      socket.emit('lock-note', { relative_path: notePath, username: currentUser.username, userId: 1 });
      socket.emit('view-note', notePath);
      
      // Auto-unlock when unmounting
      return () => {
        socket.emit('unlock-note', { relative_path: notePath });
        socket.emit('view-note', null);
      };
    }
  }, [notePath, isReadOnly, lockedBy, socket, currentUser]);

  // Auto save every 10 seconds if modified
  useEffect(() => {
    const timer = setInterval(() => {
      if (content !== initialContent && !isReadOnly && !lockedBy && !saving) {
        handleSave();
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [content, initialContent, isReadOnly, lockedBy, saving]);

  const handleSave = async () => {
    if (isReadOnly || lockedBy || saving) return;
    setSaving(true);
    try {
      await onSave(content);
    } catch (err) {
      console.error('Error saving:', err);
    } finally {
      setSaving(false);
    }
  };

  // Helper to insert text at current cursor selection
  const insertText = (before: string, after: string = '') => {
    const view = editorRef.current?.view;
    if (!view) return;

    const selection = view.state.selection.main;
    const selectedText = view.state.sliceDoc(selection.from, selection.to);
    
    const replacement = before + selectedText + after;
    
    view.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: replacement
      },
      selection: { anchor: selection.from + before.length + selectedText.length }
    });
    
    // Update local content state
    setContent(view.state.doc.toString());
  };

  // Format image tags
  const handleImageUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = (reader.result as string).split(',')[1];
        try {
          const res = await fetch('/api/notes/upload-image', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ filename: file.name, base64Data })
          });
          const data = await res.json();
          if (res.ok) {
            insertText(`![${file.name}](${data.url})`);
          } else {
            alert('Не удалось загрузить изображение: ' + data.error);
          }
        } catch (err) {
          console.error(err);
          alert('Ошибка сети при загрузке изображения');
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  // Render HTML preview using Regex Markdown Parser
  const parseMarkdown = (md: string) => {
    let html = md
      // Escaping HTML to prevent XSS
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Headers
      .replace(/^# (.*?)$/gm, '<h1 class="visual-h1">$1</h1>')
      .replace(/^## (.*?)$/gm, '<h2 class="visual-h2">$1</h2>')
      .replace(/^### (.*?)$/gm, '<h3 class="visual-h3">$1</h3>')
      // Blockquotes
      .replace(/^> (.*?)$/gm, '<blockquote class="visual-blockquote">$1</blockquote>')
      // Unordered Lists
      .replace(/^\s*-\s+\[\s*\]\s+(.*?)$/gm, '<div class="flex items-center space-x-2 my-1"><input type="checkbox" disabled class="rounded bg-black/40 border-white/10 text-primary focus:ring-0" /> <span class="text-text-muted">$1</span></div>')
      .replace(/^\s*-\s+\[x\]\s+(.*?)$/gm, '<div class="flex items-center space-x-2 my-1"><input type="checkbox" checked disabled class="rounded bg-black/40 border-white/10 text-primary focus:ring-0" /> <span class="line-through text-text-disabled">$1</span></div>')
      .replace(/^\s*-\s+(.*?)$/gm, '<li class="list-disc list-inside ml-4 text-text">$1</li>')
      // Bold & Italic
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Code blocks
      .replace(/```([\s\S]*?)```/g, '<pre class="bg-black/30 p-3 rounded-lg border border-white/5 font-mono text-xs overflow-x-auto my-2">$1</pre>')
      .replace(/`([^`]+)`/g, '<code class="bg-white/5 px-1 py-0.5 rounded font-mono text-xs text-primary">$1</code>')
      // Standard Images
      .replace(/!\[(.*?)\]\((.*?)\)/g, '<div class="my-3"><img src="/$2" alt="$1" class="max-w-full max-h-96 rounded-lg border border-white/10 shadow-lg object-contain" /><span class="text-[10px] text-text-disabled italic">$1</span></div>')
      // Standard links
      .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" class="text-primary hover:underline">$1</a>')
      // Obsidian WikiLinks [[RelativePath]] or [[RelativePath|Label]]
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, path, label) => {
        const cleanPath = path.trim();
        const displayLabel = label ? label.trim() : cleanPath.replace(/\.md$/, '');
        return `<a href="#" data-wikilink="${cleanPath}" class="text-primary hover:underline border-b border-primary/20">[[${displayLabel}]]</a>`;
      })
      // Paragraph line breaks
      .replace(/\n\n/g, '</p><p>');

    return `<p>${html}</p>`;
  };

  // Handle WikiLink click inside HTML preview
  const handlePreviewClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const wikilink = target.getAttribute('data-wikilink');
    if (wikilink) {
      e.preventDefault();
      // Auto resolve paths and find matching note
      let targetPath = wikilink.endsWith('.md') ? wikilink : `${wikilink}.md`;
      let note = allNotes.find(n => n.relative_path.toLowerCase() === targetPath.toLowerCase());
      if (!note) {
        note = allNotes.find(n => n.title.toLowerCase() === wikilink.toLowerCase());
      }
      if (note) {
        socket.emit('unlock-note', { relative_path: notePath });
        window.location.hash = `#${note.relative_path}`; // Fallback or route reload
      } else {
        alert(`Заметка "${wikilink}" не найдена. Создайте её в боковом меню.`);
      }
    }
  };

  // Keyboard navigation for CodeMirror editor (intercepting typing '[[')
  const handleEditorChange = (value: string, viewUpdate: any) => {
    setContent(value);
    
    const state = viewUpdate.state;
    const selection = state.selection.main;
    const pos = selection.from;
    const view = viewUpdate.view;
    
    // Check if user just typed '[['
    const textBefore = state.sliceDoc(Math.max(0, pos - 2), pos);
    
    if (textBefore === '[[') {
      setWikiDropdownOpen(true);
      setWikiSearch('');
      setWikiSelectedIndex(0);
      setEditorSelection({ anchor: pos, head: pos });
      
      // Get coordinates of cursor to display popup exactly there!
      if (view) {
        const coords = view.coordsAtPos(pos);
        if (coords) {
          setDropdownCoords({
            top: coords.bottom + 8, // Place popup 8px below cursor
            left: coords.left
          });
        }
      }
    } else if (wikiDropdownOpen && editorSelection) {
      const triggerPos = editorSelection.anchor - 2;
      const currentTriggerText = state.sliceDoc(triggerPos, triggerPos + 2);
      const textAfterBracket = state.sliceDoc(editorSelection.anchor, pos);
      
      // If brackets are deleted, or line break occurs, or link is closed -> close dropdown
      if (currentTriggerText !== '[[' || textAfterBracket.includes('\n') || textAfterBracket.includes(']]')) {
        setWikiDropdownOpen(false);
        setDropdownCoords(null);
      } else {
        setWikiSearch(textAfterBracket);
        
        // Update coords dynamically as cursor moves
        if (view) {
          const coords = view.coordsAtPos(pos);
          if (coords) {
            setDropdownCoords({
              top: coords.bottom + 8,
              left: coords.left
            });
          }
        }
      }
    }
  };

  const insertWikiLink = (noteTitle: string) => {
    const view = editorRef.current?.view;
    if (!view || !editorSelection) return;

    const pos = view.state.selection.main.from;
    const from = editorSelection.anchor; // Right after '[['

    // Detect if closing brackets ']]' already exist right after the cursor
    // (e.g. from auto-close settings or toolbar buttons)
    const textAfter = view.state.sliceDoc(pos, pos + 2);
    const hasClosingBrackets = textAfter === ']]';

    view.dispatch({
      changes: {
        from: from,
        to: hasClosingBrackets ? pos + 2 : pos,
        insert: `${noteTitle}]]`
      },
      selection: { anchor: from + noteTitle.length + 2 }
    });

    setContent(view.state.doc.toString());
    setWikiDropdownOpen(false);
  };

  const handleWikiKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setWikiSelectedIndex(prev => (prev + 1) % Math.max(1, filteredDropdownNotes.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setWikiSelectedIndex(prev => (prev - 1 + filteredDropdownNotes.length) % Math.max(1, filteredDropdownNotes.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selectedNote = filteredDropdownNotes[wikiSelectedIndex];
      if (selectedNote) {
        insertWikiLink(selectedNote.title);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setWikiDropdownOpen(false);
      setDropdownCoords(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background-panel border border-white/5 rounded-xl overflow-hidden shadow-glass">
      
      {/* Editor Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2 border-b border-white/5 bg-black/10 select-none">
        
        {/* Formatting Actions */}
        <div className="flex items-center space-x-1">
          <button
            onClick={() => insertText('# ', '')}
            disabled={mode === 'preview' || isReadOnly || !!lockedBy}
            className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer disabled:opacity-30"
            title="Заголовок H1"
          >
            <Heading1 className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('## ', '')}
            disabled={mode === 'preview' || isReadOnly || !!lockedBy}
            className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer disabled:opacity-30"
            title="Заголовок H2"
          >
            <Heading2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('### ', '')}
            disabled={mode === 'preview' || isReadOnly || !!lockedBy}
            className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer disabled:opacity-30"
            title="Заголовок H3"
          >
            <Heading3 className="w-4 h-4" />
          </button>
          <div className="w-[1px] h-4 bg-white/10 mx-1" />
          <button
            onClick={() => insertText('**', '**')}
            disabled={mode === 'preview' || isReadOnly || !!lockedBy}
            className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer disabled:opacity-30"
            title="Жирный текст"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('*', '*')}
            disabled={mode === 'preview' || isReadOnly || !!lockedBy}
            className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer disabled:opacity-30"
            title="Курсив"
          >
            <Italic className="w-4 h-4" />
          </button>
          <div className="w-[1px] h-4 bg-white/10 mx-1" />
          <button
            onClick={() => insertText('- ', '')}
            disabled={mode === 'preview' || isReadOnly || !!lockedBy}
            className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer disabled:opacity-30"
            title="Маркированный список"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('- [ ] ', '')}
            disabled={mode === 'preview' || isReadOnly || !!lockedBy}
            className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer disabled:opacity-30"
            title="Чек-лист"
          >
            <CheckSquare className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('[[', ']]')}
            disabled={mode === 'preview' || isReadOnly || !!lockedBy}
            className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white font-bold text-xs transition-colors cursor-pointer disabled:opacity-30"
            title="Вставить Вики-ссылку"
          >
            [[ ]]
          </button>
          <button
            onClick={() => insertText('[ссылка](', ')') }
            disabled={mode === 'preview' || isReadOnly || !!lockedBy}
            className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer disabled:opacity-30"
            title="Вставить ссылку"
          >
            <LinkIcon className="w-4 h-4" />
          </button>
          <button
            onClick={handleImageUpload}
            disabled={mode === 'preview' || isReadOnly || !!lockedBy}
            className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer disabled:opacity-30"
            title="Загрузить изображение"
          >
            <ImageIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Lock / Saving Status Indicator */}
        <div className="flex items-center space-x-3 mt-1 sm:mt-0">
          {lockedBy ? (
            <div className="flex items-center space-x-1.5 text-xs text-yellow-400 bg-yellow-400/10 px-2.5 py-1 rounded-full border border-yellow-400/20">
              <FileLock className="w-3.5 h-3.5" />
              <span>Редактирует: {lockedBy} (ReadOnly)</span>
            </div>
          ) : isReadOnly ? (
            <div className="flex items-center space-x-1.5 text-xs text-text-muted bg-white/5 px-2.5 py-1 rounded-full">
              <User className="w-3.5 h-3.5" />
              <span>Режим чтения (ReadOnly)</span>
            </div>
          ) : (
            <div className="flex items-center space-x-1.5 text-xs text-green-400 bg-green-500/10 px-2.5 py-1 rounded-full border border-green-500/20">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-ping" />
              <span>Синхронизация активна</span>
            </div>
          )}

          <div className="flex border border-white/10 rounded-lg p-0.5 bg-black/30">
            <button
              onClick={() => setMode('edit')}
              className={`p-1 px-3.5 rounded text-xs flex items-center space-x-1.5 transition-all cursor-pointer ${
                mode === 'edit' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              <span>Код</span>
            </button>
            <button
              onClick={() => setMode('preview')}
              className={`p-1 px-3.5 rounded text-xs flex items-center space-x-1.5 transition-all cursor-pointer ${
                mode === 'preview' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Просмотр</span>
            </button>
          </div>

          {!isReadOnly && !lockedBy && (
            <button
              onClick={handleSave}
              disabled={saving || content === initialContent}
              className="p-1.5 bg-primary/20 border border-primary/30 hover:bg-primary/40 text-primary rounded-lg transition-colors cursor-pointer disabled:opacity-30"
              title="Сохранить (Ctrl + S)"
            >
              <Save className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Editor Main Area */}
      <div className="flex-1 relative overflow-hidden bg-background-editor text-sm min-h-[300px]">
        {/* Floating WikiLinks Autocomplete Dropdown */}
        {wikiDropdownOpen && dropdownCoords && (
          <div 
            className="fixed z-50 w-64 glass-panel border border-primary/30 rounded-xl shadow-glass overflow-hidden flex flex-col glow-active"
            style={{ 
              top: `${dropdownCoords.top}px`, 
              left: `${dropdownCoords.left}px` 
            }}
          >
            <div className="p-2 border-b border-white/5 bg-black/30">
              <input
                type="text"
                placeholder="Поиск заметки..."
                autoFocus
                value={wikiSearch}
                onChange={(e) => setWikiSearch(e.target.value)}
                onKeyDown={handleWikiKeyDown}
                className="w-full px-2.5 py-1.5 bg-black/40 border border-white/5 rounded-lg text-xs text-text placeholder-text-disabled focus:outline-none focus:border-primary/50"
              />
            </div>
            <div className="max-h-48 overflow-y-auto p-1.5 space-y-0.5">
              {filteredDropdownNotes.map((note, index) => {
                const isSelected = index === wikiSelectedIndex;
                return (
                  <button
                    key={note.relative_path}
                    onClick={() => insertWikiLink(note.title)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer truncate ${
                      isSelected 
                        ? 'bg-primary text-white font-semibold shadow-sm' 
                        : 'text-text-muted hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    [[{note.title}]]
                  </button>
                );
              })}
              {filteredDropdownNotes.length === 0 && (
                <div className="p-3 text-center text-xs text-text-disabled">
                  Ничего не найдено
                </div>
              )}
            </div>
          </div>
        )}

        {mode === 'edit' ? (
          <div className="w-full h-full text-left">
            <CodeMirror
              ref={editorRef}
              value={content}
              height="100%"
              extensions={[markdown({ base: markdownLanguage }), EditorView.lineWrapping]}
              theme="dark" // UIW standard dark theme
              editable={!isReadOnly && !lockedBy}
              onChange={handleEditorChange}
              className="h-full border-0 focus:outline-none"
              placeholder="Начните писать markdown или используйте панель форматирования..."
            />
          </div>
        ) : (
          <div 
            onClick={handlePreviewClick}
            className="w-full h-full p-8 overflow-y-auto markdown-preview text-text select-text text-left prose prose-invert"
            dangerouslySetInnerHTML={{ __html: parseMarkdown(content) }}
          />
        )}
      </div>

      {/* Footer Info */}
      <div className="px-4 py-1.5 border-t border-white/5 bg-black/20 text-[10px] text-text-disabled flex justify-between select-none">
        <span>Путь: {notePath}</span>
        <span>Символов: {content.length} | Строк: {content.split('\n').length}</span>
      </div>
    </div>
  );
};
