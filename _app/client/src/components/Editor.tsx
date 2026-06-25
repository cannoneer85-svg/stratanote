import React, { useState, useEffect, useRef, useMemo } from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { WidgetType, Decoration, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { Range } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { 
  Heading1, Heading2, Heading3, Bold, Italic, List, CheckSquare, 
  Link as LinkIcon, Image as ImageIcon, Eye, Code, Save, FileLock, User
} from 'lucide-react';
import mermaid from 'mermaid';

console.log('Mermaid object:', mermaid);
console.log('Mermaid keys:', Object.keys(mermaid));

// @ts-ignore
window.mermaid = mermaid;

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
});

class ImagePreviewWidget extends WidgetType {
  url: string;
  filename: string;

  constructor(url: string, filename: string) {
    super();
    this.url = url;
    this.filename = filename;
  }

  eq(other: ImagePreviewWidget) { return other.url === this.url; }

  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "block my-2 p-1.5 bg-black/40 rounded-lg border border-white/10 select-none max-w-xs w-fit";
    
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.m4v'];
    const isVideo = videoExtensions.some(ext => this.url.toLowerCase().includes(ext));

    if (isVideo) {
      const video = document.createElement("video");
      video.src = this.url;
      video.controls = true;
      video.preload = "metadata";
      video.className = "max-w-full max-h-32 rounded-lg object-contain bg-black/20";
      wrap.appendChild(video);
    } else {
      const img = document.createElement("img");
      img.src = this.url;
      img.alt = this.filename;
      img.className = "max-w-full max-h-32 rounded-lg object-contain bg-black/20";
      wrap.appendChild(img);
    }

    const label = document.createElement("div");
    label.className = "text-[9px] text-white/40 italic mt-1 truncate max-w-[200px]";
    label.textContent = this.filename;
    wrap.appendChild(label);

    return wrap;
  }
}

const imagePreviewPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.getDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.getDecorations(update.view);
    }
  }

  getDecorations(view: EditorView) {
    const deco: Range<Decoration>[] = [];
    const doc = view.state.doc;
    const token = localStorage.getItem('token') || '';

    // Standard markdown image: !\[(.*?)\]\((.*?)\)
    const mdRegex = /!\[(.*?)\]\((.*?)\)/g;
    // Wiki-link embed: !\[\[(.*?)\]\]
    const wikiRegex = /!\[\[(.*?)\]\]/g;

    for (const { from, to } of view.visibleRanges) {
      const text = doc.sliceString(from, to);
      
      let match;
      while ((match = mdRegex.exec(text)) !== null) {
        const [full, alt, path] = match;
        const start = from + match.index;
        const end = start + full.length;

        if (/^https?:\/\//i.test(path)) {
          deco.push(Decoration.widget({
            widget: new ImagePreviewWidget(path, alt || path),
            side: 1
          }).range(end));
        } else {
          const cleanPath = path.startsWith('/') ? path.slice(1) : path;
          const mediaUrl = `/api/raw/${cleanPath}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
          deco.push(Decoration.widget({
            widget: new ImagePreviewWidget(mediaUrl, alt || path),
            side: 1
          }).range(end));
        }
      }

      while ((match = wikiRegex.exec(text)) !== null) {
        const [full, content] = match;
        const start = from + match.index;
        const end = start + full.length;

        const parts = content.split('|');
        const filename = parts[0].trim();
        const relativePath = `assets/${filename}`;
        
        const mediaUrl = `/api/raw/${relativePath}${token ? `?token=${encodeURIComponent(token)}` : ''}`;

        deco.push(Decoration.widget({
          widget: new ImagePreviewWidget(mediaUrl, filename),
          side: 1
        }).range(end));
      }
    }

    deco.sort((a, b) => a.from - b.from);
    return Decoration.set(deco, true);
  }
}, {
  decorations: v => v.decorations
});

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
  const [mode, setMode] = useState<'edit' | 'preview'>(() => {
    const savedMode = localStorage.getItem('editor_mode');
    return (savedMode === 'edit' || savedMode === 'preview') ? savedMode : 'edit';
  });

  // Persist mode changes
  useEffect(() => {
    localStorage.setItem('editor_mode', mode);
  }, [mode]);

  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [prevNotePath, setPrevNotePath] = useState(notePath);
  const [prevInitialContent, setPrevInitialContent] = useState(initialContent);

  // Sync state with prop updates during render to avoid transient rendering of old content
  if (notePath !== prevNotePath || initialContent !== prevInitialContent) {
    setPrevNotePath(notePath);
    setPrevInitialContent(initialContent);
    setContent(initialContent);
  }
  const [renderedDiagrams, setRenderedDiagrams] = useState<Record<string, string>>({});
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
  const previewRef = useRef<HTMLDivElement>(null);

  // Keep refs of props to avoid stale closures in CodeMirror extensions
  const isReadOnlyRef = useRef(isReadOnly);
  const lockedByRef = useRef(lockedBy);
  const contentRef = useRef(content);
  useEffect(() => {
    isReadOnlyRef.current = isReadOnly;
    lockedByRef.current = lockedBy;
    contentRef.current = content;
  }, [isReadOnly, lockedBy, content]);

  // Handle Drag-and-Drop and Copy-Paste for media files inside CodeMirror
  const mediaEvents = useMemo(() => {
    return EditorView.domEventHandlers({
      drop: (e: DragEvent, view: EditorView) => {
        if (isReadOnlyRef.current || lockedByRef.current) return;
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;

        const file = files[0];
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');
        if (!isImage && !isVideo) return;

        e.preventDefault();

        const reader = new FileReader();
        reader.onload = async () => {
          const base64Data = (reader.result as string).split(',')[1];
          try {
            const res = await fetch('/api/notes/upload-media', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
              },
              body: JSON.stringify({ filename: file.name, base64Data })
            });
            let data;
            try {
              data = await res.json();
            } catch (jsonErr) {
              data = { error: `Ошибка HTTP ${res.status}: ${res.statusText}` };
            }
            if (res.ok) {
              const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
              const insertPos = pos !== null ? pos : view.state.selection.main.head;
              
              view.focus();
              const linkText = `![${file.name}](${data.url})`;
              view.dispatch({
                changes: { from: insertPos, to: insertPos, insert: linkText },
                selection: { anchor: insertPos + linkText.length }
              });
              setContent(view.state.doc.toString());
            } else {
              alert('Не удалось загрузить медиафайл: ' + data.error);
            }
          } catch (err) {
            console.error(err);
            alert('Ошибка сети при загрузке медиафайла');
          }
        };
        reader.readAsDataURL(file);
        return true;
      },
      paste: (e: ClipboardEvent, view: EditorView) => {
        if (isReadOnlyRef.current || lockedByRef.current) return;
        const items = e.clipboardData?.items;
        if (!items) return;

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/') || item.type.startsWith('video/')) {
            const file = item.getAsFile();
            if (!file) continue;

            e.preventDefault();

            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hour = String(now.getHours()).padStart(2, '0');
            const minute = String(now.getMinutes()).padStart(2, '0');
            const second = String(now.getSeconds()).padStart(2, '0');
            const extension = file.type.startsWith('image/') ? 'png' : 'mp4';
            const filename = `Pasted image ${year}${month}${day}${hour}${minute}${second}.${extension}`;

            const reader = new FileReader();
            reader.onload = async () => {
              const base64Data = (reader.result as string).split(',')[1];
              try {
                const res = await fetch('/api/notes/upload-media', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                  },
                  body: JSON.stringify({ filename, base64Data })
                });
                let data;
                try {
                  data = await res.json();
                } catch (jsonErr) {
                  data = { error: `Ошибка HTTP ${res.status}: ${res.statusText}` };
                }
                if (res.ok) {
                  view.focus();
                  const insertPos = view.state.selection.main.head;
                  const linkText = `![${filename}](${data.url})`;
                  view.dispatch({
                    changes: { from: insertPos, to: insertPos, insert: linkText },
                    selection: { anchor: insertPos + linkText.length }
                  });
                  setContent(view.state.doc.toString());
                } else {
                  alert('Не удалось загрузить медиафайл: ' + data.error);
                }
              } catch (err) {
                console.error(err);
                alert('Ошибка сети при загрузке медиафайла');
              }
            };
            reader.readAsDataURL(file);
            return true;
          }
        }
      }
    });
  }, []);

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

  // Render Mermaid diagrams on preview mode change or content update, using MutationObserver to handle async React re-renders
  useEffect(() => {
    if (mode !== 'preview' || !previewRef.current) return;

    let isMounted = true;
    let observer: MutationObserver | null = null;
    let isRunning = false;
    let timeoutId: any = null;

    const renderMermaid = async () => {
      console.log('[Mermaid Debug] renderMermaid called. isMounted:', isMounted, 'isRunning:', isRunning, 'notePath:', notePath);
      if (!isMounted || isRunning) return;
      
      const allMermaid = previewRef.current?.querySelectorAll('.mermaid');
      const unrendered = Array.from(allMermaid || []).filter(el => {
        const status = el.getAttribute('data-processed');
        if (status === 'true' || status === 'failed') return false;
        if (el.closest('[data-processed="true"]')) return false;
        return true;
      });

      console.log('[Mermaid Debug] Found .mermaid elements:', allMermaid?.length || 0, 'unrendered:', unrendered.length);

      if (unrendered.length > 0) {
        isRunning = true;
        
        // Temporarily disconnect observer to avoid observing our own mutations
        if (observer) {
          observer.disconnect();
        }

        const newRendered: Record<string, string> = {};
        try {
          console.log('[Mermaid Debug] Running manual mermaid.render loop with', unrendered.length, 'elements.');
          for (let i = 0; i < unrendered.length; i++) {
            const el = unrendered[i] as HTMLElement;
            const code = el.textContent || '';
            const uniqueId = `mermaid-svg-${Math.random().toString(36).substring(2, 11)}`;
            console.log('[Mermaid Debug] Processing element', i, 'id:', uniqueId);
            
            try {
              const { svg } = await mermaid.render(uniqueId, code);
              console.log('[Mermaid Debug] mermaid.render succeeded for', uniqueId);
              newRendered[code] = svg;
            } catch (err: any) {
              console.error('[Mermaid Debug] Individual mermaid.render error:', err);
              newRendered[code] = 'failed';
            }
          }
          if (Object.keys(newRendered).length > 0) {
            setRenderedDiagrams(prev => ({ ...prev, ...newRendered }));
          }
          console.log('[Mermaid Debug] Manual mermaid.render completed.');
        } catch (err: any) {
          console.error('[Mermaid Debug] General mermaid render loop error:', err);
        } finally {
          if (!isMounted) {
            console.log('[Mermaid Debug] renderMermaid finally exited because not mounted.');
            return;
          }

          // Safety fallback: mark any remaining unprocessed elements to avoid infinite loops
          unrendered.forEach(el => {
            if (!el.getAttribute('data-processed')) {
              el.setAttribute('data-processed', 'failed');
            }
          });
          isRunning = false;
          
          // Reconnect observer after a small delay to let the DOM settle
          timeoutId = setTimeout(() => {
            if (isMounted && previewRef.current && observer) {
              console.log('[Mermaid Debug] Re-connecting observer.');
              observer.observe(previewRef.current, {
                childList: true,
                subtree: true
              });
            }
          }, 50);
        }
      }
    };

    // Set up observer
    observer = new MutationObserver(() => {
      console.log('[Mermaid Debug] Observer mutation detected.');
      if (isMounted) {
        renderMermaid();
      }
    });

    // Run initially
    renderMermaid();

    // Start observing
    if (previewRef.current) {
      console.log('[Mermaid Debug] Initial observer start.');
      observer.observe(previewRef.current, {
        childList: true,
        subtree: true
      });
    }

    return () => {
      console.log('[Mermaid Debug] useEffect cleanup called. notePath:', notePath);
      isMounted = false;
      if (observer) {
        observer.disconnect();
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [mode, content, notePath]);

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

  // Format image/video media tags
  const handleMediaUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = (reader.result as string).split(',')[1];
        try {
          const res = await fetch('/api/notes/upload-media', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ filename: file.name, base64Data })
          });
          let data;
          try {
            data = await res.json();
          } catch (jsonErr) {
            data = { error: `Ошибка HTTP ${res.status}: ${res.statusText}` };
          }
          if (res.ok) {
            insertText(`![${file.name}](${data.url})`);
          } else {
            alert('Не удалось загрузить медиафайл: ' + data.error);
          }
        } catch (err) {
          console.error(err);
          alert('Ошибка сети при загрузке медиафайла');
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const parseMarkdown = (md: string) => {
    const placeholders: string[] = [];
    const renderMediaHtml = (path: string, alt: string, options: string[]) => {
      const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.m4v'];
      const lowercasePath = path.toLowerCase();
      const isVideo = videoExtensions.some(ext => lowercasePath.endsWith(ext));

      let mediaUrl = path;
      if (!/^https?:\/\//i.test(path)) {
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        const token = localStorage.getItem('token') || '';
        mediaUrl = `/api/raw/${cleanPath}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      }

      if (isVideo) {
        const hasAutoplay = options.includes('autoplay');
        const hasLoop = options.includes('loop');
        const hasMuted = options.includes('muted') || hasAutoplay;

        const videoAttrs = [
          'controls',
          'preload="metadata"',
          'class="max-w-full max-h-96 rounded-lg border border-white/10 shadow-lg object-contain"',
          hasAutoplay ? 'autoplay' : '',
          hasLoop ? 'loop' : '',
          hasMuted ? 'muted' : ''
        ].filter(Boolean).join(' ');

        return `<div class="my-3"><video src="${mediaUrl}" ${videoAttrs}></video></div>`;
      } else {
        let width = '';
        let height = '';
        for (const option of options) {
          if (/^\d+$/.test(option)) {
            width = `${option}px`;
          } else if (/^\d+x\d+$/.test(option)) {
            const [w, h] = option.split('x');
            width = `${w}px`;
            height = `${h}px`;
          }
        }

        let altText = alt || '';
        if (options.length > 0) {
          const nonSizeOptions = options.filter((opt: string) => !/^\d+(x\d+)?$/.test(opt) && opt !== 'autoplay' && opt !== 'loop' && opt !== 'muted');
          if (nonSizeOptions.length > 0) {
            altText = nonSizeOptions[0];
          }
        }

        const imgStyle = [
          width ? `width: ${width};` : '',
          height ? `height: ${height};` : ''
        ].filter(Boolean).join(' ');

        const styleAttr = imgStyle ? ` style="${imgStyle}"` : '';

        return `<div class="my-3"><img src="${mediaUrl}" alt="${altText}"${styleAttr} class="max-w-full max-h-96 rounded-lg border border-white/10 shadow-lg object-contain" />${altText ? `<span class="text-[10px] text-text-disabled italic block mt-1">${altText}</span>` : ''}</div>`;
      }
    };

    const parseTables = (text: string): string => {
      const lines = text.split('\n');
      const result: string[] = [];
      let inTable = false;
      let tableHeaders: string[] = [];
      let tableRows: string[][] = [];
      let alignments: string[] = [];

      const isDelimiterLine = (line: string): boolean => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (!trimmed.includes('|')) return false;
        return /^[|\-\s:]+$/.test(trimmed);
      };

      const parseRow = (line: string): string[] => {
        let trimmed = line.trim();
        if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
        if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
        return trimmed.split('|').map(cell => cell.trim());
      };

      const getAlignments = (cells: string[]) => {
        return cells.map(cell => {
          const trimmed = cell.trim();
          const left = trimmed.startsWith(':');
          const right = trimmed.endsWith(':');
          if (left && right) return 'center';
          if (right) return 'right';
          if (left) return 'left';
          return '';
        });
      };

      const renderTableHtml = (headers: string[], rows: string[][], aligns: string[]): string => {
        const formatCell = (align: string) => align ? ` align="${align}" style="text-align: ${align};"` : '';
        const headHtml = headers.map((h, idx) => `<th${formatCell(aligns[idx] || '')} class="border border-white/10 px-4 py-2 bg-white/5 font-semibold text-left">${h}</th>`).join('');
        const rowsHtml = rows.map(row => {
          const cellsHtml = row.map((cell, idx) => `<td${formatCell(aligns[idx] || '')} class="border border-white/10 px-4 py-2">${cell}</td>`).join('');
          return `<tr class="hover:bg-white/[0.02] transition-colors">${cellsHtml}</tr>`;
        }).join('');

        return `<div class="my-4 overflow-x-auto rounded-xl border border-white/10 bg-black/20"><table class="w-full border-collapse text-xs text-left"><thead><tr class="border-b border-white/10">${headHtml}</tr></thead><tbody class="divide-y divide-white/5">${rowsHtml}</tbody></table></div>`;
      };

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!inTable) {
          const nextLine = lines[i + 1];
          if (trimmed.includes('|') && nextLine && isDelimiterLine(nextLine)) {
            inTable = true;
            tableHeaders = parseRow(line);
            alignments = getAlignments(parseRow(nextLine));
            tableRows = [];
            i++; // skip the delimiter line
          } else {
            result.push(line);
          }
        } else {
          if (trimmed === '' || !line.includes('|')) {
            result.push(renderTableHtml(tableHeaders, tableRows, alignments));
            inTable = false;
            result.push(line);
          } else {
            tableRows.push(parseRow(line));
          }
        }
      }

      if (inTable) {
        result.push(renderTableHtml(tableHeaders, tableRows, alignments));
      }

      return result.join('\n');
    };

    const unescapeHtml = (str: string) => {
      return str
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
    };

    const getCalloutConfig = (type: string) => {
      const t = type.toLowerCase();
      let colorClass = 'info';
      let iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
      
      if (t === 'note' || t === 'info' || t === 'todo') {
        colorClass = 'info';
        iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
      } else if (t === 'tip' || t === 'success' || t === 'check' || t === 'done') {
        colorClass = 'success';
        iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
      } else if (t === 'important' || t === 'example') {
        colorClass = 'important';
        iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
      } else if (t === 'warning' || t === 'question' || t === 'help' || t === 'faq') {
        colorClass = 'warning';
        iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
      } else if (t === 'caution' || t === 'danger' || t === 'error' || t === 'failure' || t === 'fail' || t === 'bug') {
        colorClass = 'danger';
        iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><octagon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
      } else if (t === 'quote' || t === 'cite') {
        colorClass = 'quote';
        iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1zm11 0c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/></svg>`;
      }
      return { colorClass, iconSvg };
    };

    const renderBlockquote = (lines: string[]): string => {
      if (lines.length === 0) return '';

      const firstLine = lines[0].trim();
      const calloutMatch = firstLine.match(/^\[!(IMPORTANT|NOTE|WARNING|TIP|CAUTION|INFO|TODO|ALERT|DANGER|ERROR|SUCCESS|QUESTION|HELP|FAILURE|BUG|EXAMPLE|QUOTE|CITE)\](?:\s+(.*))?$/i);

      let isCallout = false;
      let calloutType = '';
      let calloutTitle = '';
      let contentLines = lines;

      if (calloutMatch) {
        isCallout = true;
        calloutType = calloutMatch[1].toLowerCase();
        calloutTitle = calloutMatch[2] ? calloutMatch[2].trim() : calloutMatch[1].toUpperCase();
        contentLines = lines.slice(1);
      }

      // Join content lines, unescape HTML, and parse them recursively
      const innerMd = unescapeHtml(contentLines.join('\n'));
      const innerHtml = parseMarkdown(innerMd);

      if (isCallout) {
        const { colorClass, iconSvg } = getCalloutConfig(calloutType);
        return `<div class="visual-callout visual-callout-${colorClass}">
          <div class="visual-callout-header">
            <span class="visual-callout-icon">${iconSvg}</span>
            <span>${calloutTitle}</span>
          </div>
          <div class="visual-callout-content">
            ${innerHtml}
          </div>
        </div>`;
      } else {
        return `<blockquote class="visual-blockquote">
          ${innerHtml}
        </blockquote>`;
      }
    };

    const parseBlockquotes = (text: string): string => {
      const lines = text.split('\n');
      const result: string[] = [];
      let inBlockquote = false;
      let blockquoteLines: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Note: HTML escaping runs before this, so > has become &gt;
        const match = line.match(/^(\s*)&gt;\s?(.*)$/);

        if (match) {
          inBlockquote = true;
          blockquoteLines.push(match[2]);
        } else {
          if (inBlockquote) {
            const placeholder = `<!--PLACEHOLDER_${placeholders.length}-->`;
            placeholders.push(renderBlockquote(blockquoteLines));
            blockquoteLines = [];
            inBlockquote = false;
            result.push(placeholder);
          }
          result.push(line);
        }
      }

      if (inBlockquote) {
        const placeholder = `<!--PLACEHOLDER_${placeholders.length}-->`;
        placeholders.push(renderBlockquote(blockquoteLines));
        result.push(placeholder);
      }

      return result.join('\n');
    };

    // 1. Escaping HTML to prevent XSS
    let html = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Parse blockquotes and callouts
    html = parseBlockquotes(html);

    // 2. Extract code blocks and mermaid diagrams into placeholders
    
    // Extract mermaid first
    html = html.replace(/```\s*mermaid\s*([\s\S]*?)```/g, (_match, code) => {
      let rawCode = code
        .replace(/&amp;/g, '&')
        // Unescape only specific Mermaid syntax arrows and HTML line breaks
        .replace(/&lt;br\s*\/?&gt;/gi, '<br/>')
        .replace(/&lt;--&gt;/g, '<-->')
        .replace(/&lt;==&gt;/g, '<==>')
        .replace(/&lt;--/g, '<--')
        .replace(/&lt;==/g, '<==')
        .replace(/--&gt;/g, '-->')
        .replace(/==&gt;/g, '==>')
        .replace(/-\.-&gt;/g, '-.->')
        .replace(/-&gt;/g, '->')
        // Normalize bidirectional arrows (handles em-dash, en-dash, minus, hyphens, and spaces)
        .replace(/<\s*[\u2014\u2013\u2212-]+\s*>/g, '<-->')
        // Normalize right-pointing arrows (excluding dotted links)
        .replace(/(?<!\.)[\u2014\u2013\u2212-]+\s*>/g, '-->')
        .replace(/\bgraph\b/g, 'flowchart');

      // Process line-by-line to avoid cross-matching subgraph lines with node/edge parsing rules
      const lines = rawCode.split('\n');
      const processedLines = lines.map((line: string) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('subgraph ')) {
          // Extract the content after 'subgraph '
          const content = trimmed.substring(9).trim();
          
          // Check if it already has a label in brackets, e.g. ID [Label] or ID ["Label"]
          const bracketMatch = content.match(/^([^[]+)\s*\[(.*?)\]$/);
          if (bracketMatch) {
            const id = bracketMatch[1].trim();
            const label = bracketMatch[2].trim();
            const cleanId = id.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9\u0400-\u04FF_-]/g, '_');
            let cleanLabel = label;
            if ((cleanLabel.startsWith('"') && cleanLabel.endsWith('"')) || 
                (cleanLabel.startsWith("'") && cleanLabel.endsWith("'"))) {
              cleanLabel = cleanLabel.slice(1, -1);
            }
            cleanLabel = cleanLabel.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            const indent = line.match(/^\s*/)?.[0] || '';
            return `${indent}subgraph ${cleanId} ["${cleanLabel}"]`;
          }
          
          // If no brackets, check if it's already in quotes
          if ((content.startsWith('"') && content.endsWith('"')) ||
              (content.startsWith("'") && content.endsWith("'"))) {
            let cleanLabel = content.slice(1, -1);
            cleanLabel = cleanLabel.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            const indent = line.match(/^\s*/)?.[0] || '';
            return `${indent}subgraph ${cleanLabel} ["${cleanLabel}"]`;
          }
          
          // Otherwise, it's just 'subgraph Label' or 'subgraph ID'
          const cleanId = content.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9\u0400-\u04FF_-]/g, '_');
          const cleanLabel = content.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const indent = line.match(/^\s*/)?.[0] || '';
          return `${indent}subgraph ${cleanId} ["${cleanLabel}"]`;
        } else {
          let processedLine = line;
          
          // 3. Wrap node labels in quotes to support slashes and special characters
          processedLine = processedLine.replace(/([a-zA-Z0-9_-]+)\[(.*?)\]/g, (_m: string, id: string, content: string) => {
            let cleanContent = content.trim();
            if (cleanContent.startsWith('(') && cleanContent.endsWith(')')) {
              let dbText = cleanContent.slice(1, -1).trim();
              if (dbText.startsWith('"') && dbText.endsWith('"')) {
                dbText = dbText.slice(1, -1);
              }
              dbText = dbText.replace(/\\/g, '\\\\');
              return `${id}[("${dbText}")]`;
            }
            if (cleanContent.startsWith('"') && cleanContent.endsWith('"')) {
              cleanContent = cleanContent.slice(1, -1);
            }
            cleanContent = cleanContent.replace(/\\/g, '\\\\');
            return `${id}["${cleanContent}"]`;
          });

          // 4. Wrap round brackets node labels in quotes
          processedLine = processedLine.replace(/([a-zA-Z0-9_-]+)\(([^)]+)\)/g, (m: string, id: string, content: string) => {
            if (id === 'subgraph') return m;
            let cleanContent = content.trim();
            if (cleanContent.startsWith('"') && cleanContent.endsWith('"')) {
              cleanContent = cleanContent.slice(1, -1);
            }
            cleanContent = cleanContent.replace(/\\/g, '\\\\');
            return `${id}("${cleanContent}")`;
          });

          // 5. Wrap edge labels in quotes to support slashes
          processedLine = processedLine.replace(/\|(.*?)\|/g, (_m: string, text: string) => {
            let cleanText = text.trim();
            if (cleanText.startsWith('"') && cleanText.endsWith('"')) {
              cleanText = cleanText.slice(1, -1);
            }
            cleanText = cleanText.replace(/\\/g, '\\\\');
            return `|"${cleanText}"|`;
          });

          return processedLine;
        }
      });
      rawCode = processedLines.join('\n');

      const placeholder = `<!--PLACEHOLDER_${placeholders.length}-->`;
      const escapedCode = rawCode
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      if (renderedDiagrams[rawCode]) {
        if (renderedDiagrams[rawCode] === 'failed') {
          placeholders.push(`<div class="mermaid" data-processed="failed">${escapedCode}</div>`);
        } else {
          placeholders.push(`<div class="mermaid" data-processed="true">${renderedDiagrams[rawCode]}</div>`);
        }
      } else {
        placeholders.push(`<div class="mermaid">${escapedCode}</div>`);
      }
      return placeholder;
    });

    // Extract other code blocks
    html = html.replace(/```([\s\S]*?)```/g, (_match, code) => {
      const placeholder = `<!--PLACEHOLDER_${placeholders.length}-->`;
      placeholders.push(`<pre class="bg-black/30 p-3 rounded-lg border border-white/5 font-mono text-xs overflow-x-auto my-2">${code}</pre>`);
      return placeholder;
    });

    // Extract inline code
    html = html.replace(/`([^`]+)`/g, (_match, code) => {
      const placeholder = `<!--PLACEHOLDER_${placeholders.length}-->`;
      placeholders.push(`<code class="bg-white/5 px-1 py-0.5 rounded font-mono text-xs text-primary">${code}</code>`);
      return placeholder;
    });

    // 2.5. Parse markdown tables
    html = parseTables(html);

    // 3. Apply standard markdown replacements on the remaining text
    html = html
      // Horizontal Rules
      .replace(/^\s*([-*_])\s*(?:\1\s*){2,}$/gm, '<hr class="border-t border-white/10 my-6" />')
      // Headers
      .replace(/^# (.*?)$/gm, '<h1 class="visual-h1">$1</h1>')
      .replace(/^## (.*?)$/gm, '<h2 class="visual-h2">$1</h2>')
      .replace(/^### (.*?)$/gm, '<h3 class="visual-h3">$1</h3>')
      // Unordered Lists
      .replace(/^\s*[-*+]\s+\[\s*\]\s+(.*?)$/gm, '<div class="flex items-center space-x-2 my-1"><input type="checkbox" disabled class="rounded bg-black/40 border-white/10 text-primary focus:ring-0" /> <span class="text-text-muted">$1</span></div>')
      .replace(/^\s*[-*+]\s+\[x\]\s+(.*?)$/gm, '<div class="flex items-center space-x-2 my-1"><input type="checkbox" checked disabled class="rounded bg-black/40 border-white/10 text-primary focus:ring-0" /> <span class="line-through text-text-disabled">$1</span></div>')
      .replace(/^\s*[-*+]\s+(.*?)$/gm, '<li class="list-disc list-inside ml-4 text-text">$1</li>')
      // Ordered Lists
      .replace(/^\s*(\d+)\.\s+(.*?)$/gm, '<li class="list-decimal list-inside ml-4 text-text" value="$1">$2</li>')
      // Bold & Italic
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Standard Images (or video)
      .replace(/!\[(.*?)\]\((.*?)\)/g, (_match, alt, path) => renderMediaHtml(path, alt, []))
      // WikiLink Embeds ![[media]] (must run before standard wiki-links!)
      .replace(/!\[\[([^\]]+)\]\]/g, (_match, content) => {
        const parts = content.split('|');
        const filename = parts[0].trim();
        const options = parts.slice(1).map((opt: string) => opt.trim());
        const relativePath = `assets/${filename}`;
        return renderMediaHtml(relativePath, filename, options);
      })
      // Standard links
      .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" class="text-primary hover:underline">$1</a>')
      // Obsidian WikiLinks [[RelativePath]] or [[RelativePath|Label]]
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, path, label) => {
        const cleanPath = path.trim();
        const displayLabel = label ? label.trim() : cleanPath.replace(/\.md$/, '');
        return `<a href="#" data-wikilink="${cleanPath}" class="text-primary hover:underline border-b border-primary/20">${displayLabel}</a>`;
      })
      // Paragraph line breaks
      .replace(/\n\n/g, '</p><p>');

    html = `<p>${html}</p>`;

    // 4. Restore code and mermaid blocks from placeholders
    for (let i = 0; i < placeholders.length; i++) {
      html = html.replace(`<!--PLACEHOLDER_${i}-->`, placeholders[i]);
    }

    return html;
  };

  // Handle WikiLink click inside HTML preview
  const handlePreviewClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    
    // Lightbox image zoom support
    if (target.tagName === 'IMG') {
      const src = target.getAttribute('src');
      if (src) {
        setLightboxSrc(src);
        return;
      }
    }

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
            onClick={handleMediaUpload}
            disabled={mode === 'preview' || isReadOnly || !!lockedBy}
            className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer disabled:opacity-30"
            title="Загрузить медиафайл (Изображение или Видео)"
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
              extensions={[markdown({ base: markdownLanguage }), EditorView.lineWrapping, mediaEvents, imagePreviewPlugin]}
              theme="dark" // UIW standard dark theme
              editable={!isReadOnly && !lockedBy}
              onChange={handleEditorChange}
              className="h-full border-0 focus:outline-none"
              placeholder="Начните писать markdown или используйте панель форматирования..."
            />
          </div>
        ) : (
          <div 
            ref={previewRef}
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

      {lightboxSrc && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm cursor-zoom-out select-none transition-opacity duration-300"
          onClick={() => setLightboxSrc(null)}
        >
          <img 
            src={lightboxSrc} 
            alt="Enlarged Preview" 
            className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl border border-white/10 object-contain animate-in fade-in zoom-in-95 duration-200"
          />
          <button 
            className="absolute top-4 right-4 text-white/50 hover:text-white p-2 hover:bg-white/10 rounded-full transition-colors cursor-pointer"
            onClick={() => setLightboxSrc(null)}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};
