import React, { useState, useEffect, useRef, useMemo } from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { WidgetType, Decoration, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { Range } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { 
  Heading1, Heading2, Heading3, Bold, Italic, List, CheckSquare, 
  Link as LinkIcon, Image as ImageIcon, Eye, Code, Save, FileLock, User,
  Download, GitBranch, GitPullRequest, Check, X, MessageSquare, ArrowLeft
} from 'lucide-react';
import { DiffViewer } from './DiffViewer';
import { t, type Lang } from '../utils/translations';
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

const stripMarkdown = (text: string) => {
  return text
    .replace(/^#+\s+/, '') // strip headers
    .replace(/^[-*+]\s+/, '') // strip list items
    .replace(/^\d+\.\s+/, '') // strip numbered list items
    .replace(/[\*_`~]/g, '') // strip bold, italic, code formatting
    .replace(/\[\[([^\]]+)\]\]/g, '$1') // strip wiki-links
    .replace(/\[([^\]]+)\]\((.*?)\)/g, '$1') // strip links
    .trim();
};

interface Note {
  relative_path: string;
  title: string;
  is_directory: boolean;
  created_by?: string;
}

const MermaidZoomModal: React.FC<{ svgHtml: string; onClose: () => void; lang: Lang }> = ({ svgHtml, onClose, lang }) => {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [animate, setAnimate] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const offsetRef = useRef(offset);
  const scaleRef = useRef(scale);

  // Keep refs in sync with React state updates (e.g. from initial fit or buttons)
  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  // Extract SVG ID
  const svgId = useMemo(() => {
    const match = svgHtml.match(/<svg[^>]*\bid="([^"]*)"/i);
    return match ? match[1] : '';
  }, [svgHtml]);

  // Clean and prepare SVG
  const cleanedSvgHtml = useMemo(() => {
    try {
      let cleaned = svgHtml;
      const svgTagMatch = cleaned.match(/^<svg[^>]*>/i);
      if (svgTagMatch) {
        let svgTag = svgTagMatch[0];
        // Remove style="..." from the root tag only
        svgTag = svgTag.replace(/\bstyle="[^"]*"/i, '');
        // Replace or add width="100%"
        if (svgTag.match(/\bwidth="[^"]*"/i)) {
          svgTag = svgTag.replace(/\bwidth="[^"]*"/i, 'width="100%"');
        } else {
          svgTag = svgTag.replace(/<svg/i, '<svg width="100%"');
        }
        // Replace or add height="100%"
        if (svgTag.match(/\bheight="[^"]*"/i)) {
          svgTag = svgTag.replace(/\bheight="[^"]*"/i, 'height="100%"');
        } else {
          svgTag = svgTag.replace(/<svg/i, '<svg height="100%"');
        }
        
        cleaned = cleaned.replace(/^<svg[^>]*>/i, svgTag);
      }
      return cleaned;
    } catch (e) {
      console.error('Failed to clean SVG using regex:', e);
    }
    return svgHtml;
  }, [svgHtml]);

  // Find dynamic style block generated by Mermaid in document head
  const styleHtml = useMemo(() => {
    if (!svgId) return '';
    try {
      const styles = document.querySelectorAll('style');
      for (let i = 0; i < styles.length; i++) {
        const styleEl = styles[i];
        if (styleEl.id && styleEl.id.includes(svgId)) {
          return styleEl.outerHTML;
        }
        if (styleEl.textContent && styleEl.textContent.includes(`#${svgId}`)) {
          return styleEl.outerHTML;
        }
      }
    } catch (e) {
      console.error('Failed to find mermaid style element:', e);
    }
    return '';
  }, [svgId]);

  // Extract dimensions
  const dimensions = useMemo(() => {
    let width = 800;
    let height = 600;
    try {
      const wMatch = svgHtml.match(/<svg[^>]*\bwidth="([^"]*)"/i);
      const hMatch = svgHtml.match(/<svg[^>]*\bheight="([^"]*)"/i);
      const vbMatch = svgHtml.match(/<svg[^>]*\bviewBox="([^"]*)"/i);

      let wVal = wMatch ? wMatch[1] : '';
      let hVal = hMatch ? hMatch[1] : '';

      if (wVal && !wVal.includes('%')) {
        width = parseFloat(wVal);
      } else if (vbMatch) {
        const parts = vbMatch[1].trim().split(/\s+/);
        if (parts.length === 4) width = parseFloat(parts[2]);
      }

      if (hVal && !hVal.includes('%')) {
        height = parseFloat(hVal);
      } else if (vbMatch) {
        const parts = vbMatch[1].trim().split(/\s+/);
        if (parts.length === 4) height = parseFloat(parts[3]);
      }
    } catch (e) {
      console.error('Failed to extract dimensions:', e);
    }
    return { width, height };
  }, [svgHtml]);

  // Set initial scale to fit screen
  useEffect(() => {
    if (!containerRef.current) return;
    const containerWidth = window.innerWidth * 0.95;
    const containerHeight = window.innerHeight * 0.85;
    
    const scaleX = containerWidth / dimensions.width;
    const scaleY = containerHeight / dimensions.height;
    const fitScale = Math.min(Math.min(scaleX, scaleY), 1.5);
    
    setAnimate(false);
    setScale(fitScale);
    setOffset({ x: 0, y: 0 });
  }, [dimensions]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // only left click
    setAnimate(false);
    setIsDragging(true);
    setDragStart({ x: e.clientX - offsetRef.current.x, y: e.clientY - offsetRef.current.y });
    e.preventDefault();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;
    
    offsetRef.current = { x: newX, y: newY };
    
    if (contentRef.current) {
      contentRef.current.style.transform = `translate(${newX}px, ${newY}px) scale(${scaleRef.current})`;
    }
  };

  const handleMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
      setOffset(offsetRef.current);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    setAnimate(false);
    const zoomFactor = 1.15;
    const currentScale = scaleRef.current;
    const nextScale = e.deltaY < 0 ? currentScale * zoomFactor : currentScale / zoomFactor;
    const clampedScale = Math.max(0.1, Math.min(10, nextScale));
    
    let newOffset = offsetRef.current;
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;
      
      const factor = clampedScale / currentScale;
      newOffset = {
        x: mouseX - (mouseX - offsetRef.current.x) * factor,
        y: mouseY - (mouseY - offsetRef.current.y) * factor
      };
      
      offsetRef.current = newOffset;
    }
    
    scaleRef.current = clampedScale;
    
    if (contentRef.current) {
      contentRef.current.style.transform = `translate(${newOffset.x}px, ${newOffset.y}px) scale(${clampedScale})`;
    }
    
    setScale(clampedScale);
    setOffset(newOffset);
  };

  const handleZoomIn = () => {
    setAnimate(true);
    setScale(s => Math.min(10, s * 1.25));
  };

  const handleZoomOut = () => {
    setAnimate(true);
    setScale(s => Math.max(0.1, s / 1.25));
  };

  const handleReset = () => {
    setAnimate(true);
    const containerWidth = window.innerWidth * 0.95;
    const containerHeight = window.innerHeight * 0.85;
    const scaleX = containerWidth / dimensions.width;
    const scaleY = containerHeight / dimensions.height;
    const fitScale = Math.min(Math.min(scaleX, scaleY), 1.5);
    setScale(fitScale);
    setOffset({ x: 0, y: 0 });
  };

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md select-none transition-opacity duration-300">
      {/* Header controls */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between text-white z-10">
        <h3 className="text-sm font-semibold text-white/80">{lang === 'en' ? 'Interactive Diagram Viewer' : 'Интерактивный просмотр диаграммы'}</h3>
        <div className="flex items-center space-x-2 bg-black/60 border border-white/10 rounded-lg p-1">
          <button 
            onClick={handleZoomIn}
            className="p-1.5 hover:bg-white/10 rounded text-white/80 hover:text-white transition-colors cursor-pointer"
            title={lang === 'en' ? "Zoom In" : "Увеличить"}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button 
            onClick={handleZoomOut}
            className="p-1.5 hover:bg-white/10 rounded text-white/80 hover:text-white transition-colors cursor-pointer"
            title={lang === 'en' ? "Zoom Out" : "Уменьшить"}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <button 
            onClick={handleReset}
            className="p-1.5 hover:bg-white/10 rounded text-white/80 hover:text-white transition-colors cursor-pointer"
            title={lang === 'en' ? "Reset scale & position" : "Сбросить масштаб и положение"}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v5h5" />
            </svg>
          </button>
          <div className="h-4 w-px bg-white/10 mx-1" />
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded text-white/80 hover:text-white transition-colors cursor-pointer"
            title={lang === 'en' ? "Close (Esc)" : "Закрыть (Esc)"}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main View Area */}
      <div 
        ref={containerRef}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        className="w-full h-full flex items-center justify-center overflow-hidden markdown-preview prose prose-invert"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <div
          ref={contentRef}
          style={{
            width: dimensions.width,
            height: dimensions.height,
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: 'center center',
            transition: animate ? 'transform 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none',
          }}
          className={`flex items-center justify-center ${isDragging ? 'pointer-events-none' : ''}`}
          dangerouslySetInnerHTML={{ __html: styleHtml + cleanedSvgHtml }}
        />
      </div>

      {/* Footer tips */}
      <div className="absolute bottom-4 text-xs text-white/40 pointer-events-none">
        {lang === 'en' ? 'Use mouse wheel to zoom, drag to move.' : 'Используйте колесо мыши для масштабирования, перетаскивайте мышкой для перемещения.'}
      </div>
    </div>
  );
};

interface EditorProps {
  notePath: string;
  initialContent: string;
  onSave: (content: string) => Promise<void>;
  isReadOnly: boolean;
  lockedBy: string | null;
  currentUser: { id: number; username: string; role: string };
  allNotes: Note[];
  socket: any;
  autoOpenSuggestion?: any | null;
  onClearAutoOpenSuggestion?: () => void;
  lang: Lang;
}

export const Editor: React.FC<EditorProps> = ({
  notePath,
  initialContent,
  onSave,
  isReadOnly,
  lockedBy,
  currentUser,
  allNotes,
  socket,
  autoOpenSuggestion = null,
  onClearAutoOpenSuggestion,
  lang
}) => {
  const [content, setContent] = useState(initialContent);
  const [mode, setMode] = useState<'edit' | 'preview'>(() => {
    const savedMode = localStorage.getItem('editor_mode');
    return (savedMode === 'edit' || savedMode === 'preview') ? savedMode : 'edit';
  });

  // Scroll synchronization states
  const [pendingEditorScrollPos, setPendingEditorScrollPos] = useState<number | null>(null);
  const [pendingPreviewScrollText, setPendingPreviewScrollText] = useState<string | null>(null);
  const [pendingScrollPct, setPendingScrollPct] = useState<number | null>(null);

  // Suggest mode states
  const [isSuggestMode, setIsSuggestMode] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState<any | null>(null);
  const [suggestionViewMode, setSuggestionViewMode] = useState<'original' | 'preview' | 'diff'>('diff');
  const [showSuggestionsSidebar, setShowSuggestionsSidebar] = useState(false);
  const [conflictData, setConflictData] = useState<{ id: number; mergedText: string } | null>(null);

  const [renderedDiagrams, setRenderedDiagrams] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadingFilesCount, setUploadingFilesCount] = useState<number>(0);
  const [uploadingFileIndex, setUploadingFileIndex] = useState<number>(0);
  const [conflictFile, setConflictFile] = useState<{
    file: File;
    resolve: (action: 'overwrite' | 'rename' | 'cancel') => void;
  } | null>(null);
  const [wikiDropdownOpen, setWikiDropdownOpen] = useState(false);
  const [wikiSearch, setWikiSearch] = useState('');
  const [wikiSelectedIndex, setWikiSelectedIndex] = useState(0);
  const [editorSelection, setEditorSelection] = useState<{ anchor: number; head: number } | null>(null);
  const [dropdownCoords, setDropdownCoords] = useState<{ top: number; left: number } | null>(null);

  // Persist mode changes
  useEffect(() => {
    localStorage.setItem('editor_mode', mode);
  }, [mode]);

  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [activeMermaidSvg, setActiveMermaidSvg] = useState<string | null>(null);
  const [prevNotePath, setPrevNotePath] = useState(notePath);
  const [prevInitialContent, setPrevInitialContent] = useState(initialContent);

  // Sync state with prop updates during render to avoid transient rendering of old content
  if (notePath !== prevNotePath || initialContent !== prevInitialContent) {
    setPrevNotePath(notePath);
    setPrevInitialContent(initialContent);
    setContent(initialContent);
    setIsSuggestMode(false);
    setSelectedSuggestion(null);
    setConflictData(null);
    setShowSuggestionsSidebar(false);
  }

  const currentNote = useMemo(() => allNotes.find(n => n.relative_path === notePath), [allNotes, notePath]);
  const rawNoteCreator = currentNote?.created_by || 'system';
  const noteCreator = rawNoteCreator === 'system' || rawNoteCreator === 'Внешняя система'
    ? t('system_external', lang)
    : rawNoteCreator;
  const canReview = currentUser.username === rawNoteCreator || currentUser.role === 'Admin';
  
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
  const isSuggestModeRef = useRef(isSuggestMode);
  const langRef = useRef(lang);
  const uploadMultipleFilesSequentiallyRef = useRef<any>(null);

  useEffect(() => {
    isReadOnlyRef.current = isReadOnly;
    lockedByRef.current = lockedBy;
    contentRef.current = content;
    isSuggestModeRef.current = isSuggestMode;
    langRef.current = lang;
  }, [isReadOnly, lockedBy, content, isSuggestMode, lang]);

  // Reset pending scroll states when note changes to prevent jumping in other files
  useEffect(() => {
    setPendingEditorScrollPos(null);
    setPendingPreviewScrollText(null);
    setPendingScrollPct(null);
  }, [notePath]);

  // Save preview scroll position
  const handlePreviewScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target && mode === 'preview') {
      if (!(window as any).__previewScrollPositions) {
        (window as any).__previewScrollPositions = {};
      }
      (window as any).__previewScrollPositions[notePath] = target.scrollTop;
    }
  };

  // Restore preview scroll position on tab switch or content load
  useEffect(() => {
    if (mode === 'preview' && previewRef.current && pendingPreviewScrollText === null && pendingScrollPct === null) {
      const savedScroll = (window as any).__previewScrollPositions?.[notePath] || 0;
      const timer = setTimeout(() => {
        if (previewRef.current && pendingPreviewScrollText === null && pendingScrollPct === null) {
          previewRef.current.scrollTop = savedScroll;
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [notePath, mode, content, pendingPreviewScrollText, pendingScrollPct]);

  // Handle editor instance creation from CodeMirror and restore scroll position
  const handleCreateEditor = (view: any) => {
    console.log('[ScrollSync] CodeMirror created, restoring scroll. Pos:', pendingEditorScrollPos, 'Pct:', pendingScrollPct);
    if (pendingEditorScrollPos !== null) {
      const pos = Math.min(pendingEditorScrollPos, view.state.doc.length);
      setTimeout(() => {
        view.dispatch({
          selection: { anchor: pos, head: pos },
          effects: EditorView.scrollIntoView(pos, { y: 'center' })
        });
        view.focus();
      }, 80);
      setPendingEditorScrollPos(null);
      setPendingScrollPct(null);
    } else if (pendingScrollPct !== null) {
      setTimeout(() => {
        const scroller = view.scrollDOM;
        if (scroller) {
          scroller.scrollTop = pendingScrollPct * (scroller.scrollHeight - scroller.clientHeight);
        }
      }, 80);
      setPendingScrollPct(null);
    }
  };

  // Restore Preview scroll position when switching to preview mode
  useEffect(() => {
    if (mode === 'preview' && previewRef.current) {
      const container = previewRef.current;
      
      const doScroll = () => {
        if (pendingPreviewScrollText) {
          let parsed: { type: string; text?: string; words?: string[] };
          try {
            parsed = JSON.parse(pendingPreviewScrollText);
          } catch (e) {
            parsed = { type: 'plain', text: pendingPreviewScrollText };
          }
          
          console.log('[ScrollSync] Restoring preview scroll. Parsed:', parsed, 'Pct:', pendingScrollPct);
          const elements = container.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, td, th, pre, blockquote');
          let bestElement: HTMLElement | null = null;
          
          if (parsed.type === 'heading' && parsed.text) {
            const searchText = parsed.text.toLowerCase();
            for (const el of Array.from(elements) as HTMLElement[]) {
              if (el.tagName.startsWith('H') && el.innerText.toLowerCase().includes(searchText)) {
                bestElement = el;
                break;
              }
            }
          } else if (parsed.type === 'text' && parsed.words) {
            const words = parsed.words.map(w => w.toLowerCase());
            for (const el of Array.from(elements) as HTMLElement[]) {
              const txt = el.innerText.toLowerCase();
              if (words.every(w => txt.includes(w))) {
                bestElement = el;
                break;
              }
            }
          } else if (parsed.text) {
            const searchText = parsed.text.toLowerCase();
            for (const el of Array.from(elements) as HTMLElement[]) {
              if (el.innerText.toLowerCase().includes(searchText)) {
                bestElement = el;
                break;
              }
            }
          }

          if (bestElement) {
            const containerRect = container.getBoundingClientRect();
            const elementRect = bestElement.getBoundingClientRect();
            const relativeTop = elementRect.top - containerRect.top + container.scrollTop;
            console.log('[ScrollSync] Found element for preview scroll:', bestElement.tagName, bestElement.innerText);
            container.scrollTo({
              top: Math.max(0, relativeTop - 80),
              behavior: 'auto'
            });
          } else if (pendingScrollPct !== null) {
            container.scrollTop = pendingScrollPct * (container.scrollHeight - container.clientHeight);
          }
        } else if (pendingScrollPct !== null) {
          container.scrollTop = pendingScrollPct * (container.scrollHeight - container.clientHeight);
        }
        
        setPendingPreviewScrollText(null);
        setPendingScrollPct(null);
      };

      const timer = setTimeout(doScroll, 120);
      return () => clearTimeout(timer);
    }
  }, [mode, pendingPreviewScrollText, pendingScrollPct]);

  const switchToPreview = () => {
    const view = editorRef.current?.view;
    if (view) {
      const scroller = view.scrollDOM;
      const scrollTop = scroller.scrollTop;
      
      // Determine the line that is currently visible at the top of the scrolled editor viewport
      let pos = view.state.selection.main.from;
      try {
        const lineBlock = view.lineBlockAtHeight(scrollTop + 20);
        pos = lineBlock.from;
      } catch (err) {
        console.warn('[ScrollSync] Failed to get line block at scroll height, using cursor fallback:', err);
      }
      
      const line = view.state.doc.lineAt(pos);
      const currentLineText = line.text.trim();
      
      let headingText = '';
      let currentLineNum = line.number;
      while (currentLineNum >= 1) {
        const curLineText = view.state.doc.line(currentLineNum).text.trim();
        if (curLineText.startsWith('#')) {
          headingText = curLineText.replace(/^#+\s+/, '').trim();
          break;
        }
        currentLineNum--;
      }

      console.log('[ScrollSync] Switching to Preview. Line:', currentLineText, 'Heading:', headingText);

      if (currentLineText.startsWith('#')) {
        const cleanHeading = currentLineText.replace(/^#+\s+/, '').trim();
        setPendingPreviewScrollText(JSON.stringify({ type: 'heading', text: cleanHeading }));
      } else if (currentLineText.length > 8) {
        const cleaned = stripMarkdown(currentLineText);
        const words = cleaned.split(/\s+/).filter(w => w.length > 2).slice(0, 3);
        if (words.length >= 2) {
          setPendingPreviewScrollText(JSON.stringify({ type: 'text', words }));
        } else if (headingText) {
          setPendingPreviewScrollText(JSON.stringify({ type: 'heading', text: headingText }));
        } else {
          const scroller = view.scrollDOM;
          const pct = scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight);
          setPendingScrollPct(pct);
        }
      } else if (headingText) {
        setPendingPreviewScrollText(JSON.stringify({ type: 'heading', text: headingText }));
      } else {
        const scroller = view.scrollDOM;
        const pct = scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight);
        setPendingScrollPct(pct);
      }
    }
    setMode('preview');
  };

  const switchToEdit = () => {
    if (previewRef.current) {
      const container = previewRef.current;
      const rect = container.getBoundingClientRect();
      
      const children = container.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, tr, pre, blockquote');
      let bestElement: HTMLElement | null = null;
      let bestDist = Infinity;
      const targetY = rect.top + 80;
      
      for (const child of Array.from(children) as HTMLElement[]) {
        const childRect = child.getBoundingClientRect();
        const dist = Math.abs(childRect.top - targetY);
        if (dist < bestDist) {
          bestDist = dist;
          bestElement = child;
        }
      }
      
      if (bestElement) {
        const isHeading = bestElement.tagName.startsWith('H');
        const text = bestElement.innerText || '';
        const cleanSearch = text.split('\n')[0].trim();
        
        console.log('[ScrollSync] Switching to Edit. Best Preview element:', bestElement.tagName, cleanSearch);

        if (isHeading) {
          const headingClean = cleanSearch.toLowerCase();
          const lines = content.split('\n');
          const idx = lines.findIndex(l => l.trim().startsWith('#') && l.toLowerCase().includes(headingClean));
          if (idx !== -1) {
            const charIdx = lines.slice(0, idx).join('\n').length + (idx > 0 ? 1 : 0);
            console.log('[ScrollSync] Found matching heading in markdown at line:', idx);
            setPendingEditorScrollPos(charIdx);
            setMode('edit');
            return;
          }
        }
        
        const cleaned = stripMarkdown(cleanSearch);
        const words = cleaned.split(/\s+/).filter(w => w.length > 2).slice(0, 3);
        if (words.length >= 2) {
          const lines = content.split('\n');
          const idx = lines.findIndex(line => words.every(word => line.toLowerCase().includes(word.toLowerCase())));
          if (idx !== -1) {
            const charIdx = lines.slice(0, idx).join('\n').length + (idx > 0 ? 1 : 0);
            console.log('[ScrollSync] Found matching paragraph words in markdown at line:', idx);
            setPendingEditorScrollPos(charIdx);
            setMode('edit');
            return;
          }
        }
        
        const pct = container.scrollTop / Math.max(1, container.scrollHeight - container.clientHeight);
        console.log('[ScrollSync] No exact match in markdown, using fallback percentage:', pct);
        setPendingScrollPct(pct);
      } else {
        const pct = container.scrollTop / Math.max(1, container.scrollHeight - container.clientHeight);
        setPendingScrollPct(pct);
      }
    }
    setMode('edit');
  };

  // Upload media file in 5MB chunks with progress callback
  const uploadMediaChunked = (
    file: File,
    onProgress: (pct: number) => void,
    overwrite = false
  ): Promise<{ url: string; filename: string }> => {
    return new Promise((resolvePromise, rejectPromise) => {
      const token = localStorage.getItem('token');
      const chunkSize = 5 * 1024 * 1024; // 5MB chunks
      const totalSize = file.size;
      const totalChunks = Math.ceil(totalSize / chunkSize);
      const uploadId = `media_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

      let currentChunk = 0;
      let uploadedBytesPrevChunks = 0;

      const uploadNextChunk = () => {
        const start = currentChunk * chunkSize;
        const end = Math.min(start + chunkSize, totalSize);
        const chunk = file.slice(start, end);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/notes/upload-media-chunk', true);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('x-chunk-index', currentChunk.toString());
        xhr.setRequestHeader('x-total-chunks', totalChunks.toString());
        xhr.setRequestHeader('x-upload-id', uploadId);
        xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
        if (overwrite) {
          xhr.setRequestHeader('x-overwrite', 'true');
        }

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const currentLoaded = uploadedBytesPrevChunks + event.loaded;
            const pct = Math.min(99, Math.round((currentLoaded / totalSize) * 100));
            onProgress(pct);
          }
        });

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            uploadedBytesPrevChunks += (end - start);
            currentChunk++;
            if (currentChunk < totalChunks) {
              const overallPct = Math.round((currentChunk / totalChunks) * 100);
              onProgress(overallPct);
              uploadNextChunk();
            } else {
              onProgress(100);
              try {
                const response = JSON.parse(xhr.responseText);
                resolvePromise(response);
              } catch (e) {
                rejectPromise(new Error(xhr.responseText || 'Invalid response from server'));
              }
            }
          } else {
            let errMsg = `HTTP ${xhr.status}`;
            try {
              const resJson = JSON.parse(xhr.responseText);
              errMsg = resJson.error || errMsg;
            } catch (_) {}
            rejectPromise(new Error(errMsg));
          }
        };

        xhr.onerror = () => {
          rejectPromise(new Error('Network error'));
        };

        xhr.send(chunk);
      };

      onProgress(0);
      uploadNextChunk();
    });
  };

  // Wrapper that checks for name conflicts and prompts the user if necessary
  const uploadMediaWithConflictCheck = (
    file: File,
    onProgress: (pct: number) => void
  ): Promise<{ url: string; filename: string }> => {
    const token = localStorage.getItem('token');
    const cleanedName = file.name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
    const cleanedFile = new File([file], cleanedName, { type: file.type });

    return fetch(`/api/notes/media-exists?filename=${encodeURIComponent(cleanedName)}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
      .then(res => res.json())
      .then((data: { exists: boolean }) => {
        if (data.exists) {
          return new Promise<{ url: string; filename: string }>((resolvePromise, rejectPromise) => {
            setConflictFile({
              file: cleanedFile,
              resolve: (action) => {
                setConflictFile(null);
                if (action === 'cancel') {
                  rejectPromise(new Error(lang === 'en' ? 'Upload cancelled' : 'Загрузка отменена'));
                } else {
                  const isOverwrite = action === 'overwrite';
                  uploadMediaChunked(cleanedFile, onProgress, isOverwrite)
                    .then(resolvePromise)
                    .catch(rejectPromise);
                }
              }
            });
          });
        } else {
          return uploadMediaChunked(cleanedFile, onProgress, false);
        }
      })
      .catch(err => {
        console.error('Conflict check failed, falling back to auto-rename:', err);
        return uploadMediaChunked(cleanedFile, onProgress, false);
      });
  };

  // Handle Drag-and-Drop and Copy-Paste for media files inside CodeMirror
  const mediaEvents = useMemo(() => {
    return EditorView.domEventHandlers({
      drop: (e: DragEvent, view: EditorView) => {
        if (isReadOnlyRef.current || (lockedByRef.current && !isSuggestModeRef.current)) return;
        const files = Array.from(e.dataTransfer?.files || []) as File[];
        if (files.length === 0) return;

        const mediaFiles = files.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
        if (mediaFiles.length === 0) return;

        e.preventDefault();
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (uploadMultipleFilesSequentiallyRef.current) {
          uploadMultipleFilesSequentiallyRef.current(mediaFiles, view, pos);
        }
        return true;
      },
      paste: (e: ClipboardEvent, view: EditorView) => {
        if (isReadOnlyRef.current || (lockedByRef.current && !isSuggestModeRef.current)) return;
        const items = e.clipboardData?.items;
        if (!items) return;

        const mediaFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/') || item.type.startsWith('video/')) {
            const file = item.getAsFile();
            if (file) {
              mediaFiles.push(file);
            }
          }
        }

        if (mediaFiles.length === 0) return;
        e.preventDefault();

        // Convert Pasted images to files with clean names
        const renamedFiles = mediaFiles.map((file, idx) => {
          const now = new Date();
          const year = now.getFullYear();
          const month = String(now.getMonth() + 1).padStart(2, '0');
          const day = String(now.getDate()).padStart(2, '0');
          const hour = String(now.getHours()).padStart(2, '0');
          const minute = String(now.getMinutes()).padStart(2, '0');
          const second = String(now.getSeconds()).padStart(2, '0');
          const suffix = idx > 0 ? `_${idx}` : '';
          const extension = file.type.startsWith('image/') ? 'png' : 'mp4';
          const filename = `Pasted image ${year}${month}${day}${hour}${minute}${second}${suffix}.${extension}`;
          return new File([file], filename, { type: file.type });
        });

        if (uploadMultipleFilesSequentiallyRef.current) {
          uploadMultipleFilesSequentiallyRef.current(renamedFiles, view);
        }
        return true;
      }
    });
  }, []);

  // Request lock when entering edit mode
  useEffect(() => {
    if (socket && notePath && !isReadOnly && !lockedBy) {
      socket.emit('lock-note', { relative_path: notePath, username: currentUser.username, userId: currentUser.id });
      socket.emit('view-note', notePath);
      
      // Auto-unlock when unmounting
      return () => {
        socket.emit('unlock-note', { relative_path: notePath });
        socket.emit('view-note', null);
      };
    }
  }, [notePath, isReadOnly, socket, currentUser]);

  // Handle autoOpenSuggestion from notifications
  useEffect(() => {
    if (autoOpenSuggestion && autoOpenSuggestion.relative_path === notePath) {
      setSelectedSuggestion(autoOpenSuggestion);
      setSuggestionViewMode('diff');
      setShowSuggestionsSidebar(true);
      if (onClearAutoOpenSuggestion) {
        onClearAutoOpenSuggestion();
      }
    }
  }, [autoOpenSuggestion, notePath, onClearAutoOpenSuggestion]);

  // Auto save every 10 seconds if modified (disabled in Suggest Mode)
  useEffect(() => {
    const timer = setInterval(() => {
      if (content !== initialContent && !isReadOnly && !lockedBy && !isSuggestMode && !saving) {
        handleSave();
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [content, initialContent, isReadOnly, lockedBy, isSuggestMode, saving]);

  // Listen for Ctrl+S / Cmd+S to save (using capture phase to intercept CodeMirror and layout-independent code verification)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isS = e.key.toLowerCase() === 's' || e.code === 'KeyS' || e.key === 'ы' || e.key === 'Ы';
      if ((e.ctrlKey || e.metaKey) && isS) {
        e.preventDefault();
        e.stopPropagation();
        if (content !== initialContent && !saving) {
          handleSave();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [content, initialContent, saving]);

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

  // Load suggestions
  const loadSuggestions = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/notes/suggestions?relative_path=${encodeURIComponent(notePath)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data);
      }
    } catch (err) {
      console.error('Failed to load suggestions:', err);
    }
  };

  // Load suggestions on mount and file change
  useEffect(() => {
    if (notePath) {
      loadSuggestions();
    }
  }, [notePath]);

  // Listen to socket events for suggestions
  useEffect(() => {
    if (socket) {
      const handleSuggestionChange = (data: any) => {
        if (data.relative_path === notePath) {
          loadSuggestions();
        }
      };
      socket.on('suggestion:changed', handleSuggestionChange);
      return () => {
        socket.off('suggestion:changed', handleSuggestionChange);
      };
    }
  }, [socket, notePath]);

  const handleAcceptSuggestion = async (id: number) => {
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/notes/suggestions/${id}/accept`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const data = await res.json();
      if (res.ok) {
        setSelectedSuggestion(null);
        setContent(data.mergedText);
        loadSuggestions();
      } else if (res.status === 409 && data.hasConflict) {
        setConflictData({ id, mergedText: data.mergedText });
        setContent(data.mergedText);
        setSelectedSuggestion(null);
        setMode('edit');
        alert(lang === 'en' 
          ? 'Merge conflicts detected! They are marked in the editor with <<<<<<< and >>>>>>> symbols. Please resolve conflicts manually and save the file.' 
          : 'Обнаружены конфликты слияния! Они отмечены в редакторе символами <<<<<<< и >>>>>>>. Пожалуйста, разрешите конфликты вручную и сохраните файл.');
      } else {
        alert(data.error || (lang === 'en' ? 'Failed to accept suggestion' : 'Не удалось принять предложение'));
      }
    } catch (err) {
      console.error('Failed to accept suggestion:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleRejectSuggestion = async (id: number) => {
    if (!confirm(t('suggest_reject_confirm', lang))) return;
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/notes/suggestions/${id}/reject`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        setSelectedSuggestion(null);
        loadSuggestions();
      } else {
        const data = await res.json();
        alert(data.error || (lang === 'en' ? 'Failed to reject suggestion' : 'Не удалось отклонить предложение'));
      }
    } catch (err) {
      console.error('Failed to reject suggestion:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleResolveConflict = async () => {
    if (!conflictData) return;
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/notes/suggestions/${conflictData.id}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ resolved_content: content })
      });
      const data = await res.json();
      if (res.ok) {
        setConflictData(null);
        setContent(data.mergedText);
        loadSuggestions();
      } else {
        alert(data.error || 'Не удалось сохранить разрешение конфликта');
      }
    } catch (err) {
      console.error('Failed to resolve conflict:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (isReadOnly || saving) return;
    if (lockedBy && !isSuggestMode) return; // Allow save in suggest mode even if file is locked
    setSaving(true);
    try {
      if (isSuggestMode) {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/notes/suggest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ relative_path: notePath, suggested_content: content })
        });
        if (res.ok) {
          // Sync initialContent with content locally so the Save button becomes disabled again
          // (assuming there's a dirty state check)
          console.log('Suggestion saved successfully');
        } else {
          alert(lang === 'en' ? 'Failed to save suggestion' : 'Не удалось сохранить предложение');
        }
      } else {
        await onSave(content);
      }
    } catch (err) {
      console.error('Error saving:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
    try {
      const fileName = notePath.split('/').pop() || 'note.md';
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading note:', err);
    }
  };

  // Helper to insert text at current cursor selection
  const insertText = (before: string, after: string = '') => {
    const view = editorRef.current?.view;
    if (!view) return;

    view.focus();

    const selection = view.state.selection.main;
    const selectedText = view.state.sliceDoc(selection.from, selection.to);
    
    const replacement = before + selectedText + after;
    
    view.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: replacement
      },
      selection: { anchor: selection.from + before.length + selectedText.length },
      scrollIntoView: true
    });
    
    // Update local content state
    setContent(view.state.doc.toString());
  };

  // Sequentially upload and insert multiple files
  const uploadMultipleFilesSequentially = async (files: File[], view: any, dragDropPos: number | null = null) => {
    setUploadingFilesCount(files.length);
    view.focus();
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadingFileIndex(i);
      setUploadProgress(0);

      try {
        const data = await uploadMediaWithConflictCheck(file, (pct) => setUploadProgress(pct));
        setUploadProgress(null);
        
        view.focus();
        if (i === 0 && dragDropPos !== null) {
          view.dispatch({
            selection: { anchor: dragDropPos }
          });
        }

        const currentPos = view.state.selection.main.head;
        const linkText = `![${data.filename}](${data.url})`;
        
        // If we are uploading multiple files, we append \n\n after each file
        const textToInsert = files.length > 1 ? `${linkText}\n\n` : linkText;
        
        view.dispatch({
          changes: { from: currentPos, to: currentPos, insert: textToInsert },
          selection: { anchor: currentPos + textToInsert.length },
          scrollIntoView: true
        });
        
        setContent(view.state.doc.toString());
      } catch (err: any) {
        setUploadProgress(null);
        if (err.message !== 'Upload cancelled' && err.message !== 'Загрузка отменена') {
          console.error(err);
          alert((langRef.current === 'en' ? 'Failed to upload file ' : 'Не удалось загрузить файл ') + file.name + ': ' + err.message);
        }
      }
    }
    
    setUploadingFilesCount(0);
    setUploadingFileIndex(0);
  };

  // Assign to the ref so the event handlers always call the latest version
  uploadMultipleFilesSequentiallyRef.current = uploadMultipleFilesSequentially;

  // Format image/video media tags
  const handleMediaUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.multiple = true;
    input.onchange = async (e: any) => {
      const files = Array.from(e.target.files || []) as File[];
      if (files.length === 0) return;

      const view = editorRef.current?.view;
      if (!view) return;

      const mediaFiles = files.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
      if (mediaFiles.length === 0) return;

      uploadMultipleFilesSequentially(mediaFiles, view);
    };
    input.click();
  };

  const parseMarkdown = (md: string) => {
    const placeholders: string[] = [];
    const documentIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text inline-block mr-1.5 align-middle opacity-70"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`;
    const renderMediaHtml = (path: string, alt: string, options: string[]) => {
      const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.m4v'];
      const lowercasePath = path.toLowerCase();
      const isVideo = videoExtensions.some(ext => lowercasePath.endsWith(ext));

      let parsedOptions = [...options];
      let cleanAlt = alt || '';
      if (alt && alt.includes('|')) {
        const parts = alt.split('|');
        cleanAlt = parts[0].trim();
        parsedOptions = [...parsedOptions, ...parts.slice(1).map((opt: string) => opt.trim())];
      }

      let requestedWidth = 800; // default optimized width for preview
      let width = '';
      let height = '';

      for (const option of parsedOptions) {
        if (/^\d+$/.test(option)) {
          requestedWidth = parseInt(option, 10);
          width = `${option}px`;
        } else if (/^\d+x\d+$/.test(option)) {
          const [w, h] = option.split('x');
          requestedWidth = parseInt(w, 10);
          width = `${w}px`;
          height = `${h}px`;
        }
      }

      let mediaUrl = path;
      if (!/^https?:\/\//i.test(path)) {
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        const token = localStorage.getItem('token') || '';
        
        const params = [];
        if (token) params.push(`token=${encodeURIComponent(token)}`);
        if (!isVideo) {
          params.push(`width=${requestedWidth}`);
        }
        
        mediaUrl = `/api/raw/${cleanPath}${params.length > 0 ? `?${params.join('&')}` : ''}`;
      }

      if (isVideo) {
        const hasAutoplay = parsedOptions.includes('autoplay');
        const hasLoop = parsedOptions.includes('loop');
        const hasMuted = parsedOptions.includes('muted') || hasAutoplay;

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
        let altText = cleanAlt;
        if (parsedOptions.length > 0) {
          const nonSizeOptions = parsedOptions.filter((opt: string) => !/^\d+(x\d+)?$/.test(opt) && opt !== 'autoplay' && opt !== 'loop' && opt !== 'muted');
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

      // Pre-process content lines to insert line break placeholders for consecutive lines
      let inCode = false;
      const processedLines = contentLines.map((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('```')) {
          inCode = !inCode;
          return line;
        }
        if (inCode) {
          return line;
        }
        if (
          trimmed.startsWith('#') || 
          trimmed === '---' || 
          trimmed === '***' || 
          trimmed === '___' || 
          trimmed.includes('|') || // Skip table lines containing pipe character
          /^\s*([-*+]\s|\d+\.\s)/.test(line) ||
          idx === contentLines.length - 1 ||
          !trimmed
        ) {
          return line;
        }
        return line + ' [BR_PLACEHOLDER]';
      });

      // Join content lines, unescape HTML, and parse them recursively
      const innerMd = unescapeHtml(processedLines.join('\n'));
      let innerHtml = parseMarkdown(innerMd);
      
      // Restore line breaks
      innerHtml = innerHtml.replace(/ \[BR_PLACEHOLDER\]/g, '<br />');

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
        .replace(/&lt;\|--/g, '<|--')
        .replace(/&lt;\|../g, '<|..')
        .replace(/\.\.\|&gt;/g, '..|>')
        .replace(/\.\.&gt;/g, '..>')
        .replace(/--&gt;&gt;/g, '-->>')
        .replace(/--&gt;/g, '-->')
        .replace(/-&gt;&gt;/g, '->>')
        .replace(/-&gt;/g, '->')
        .replace(/&lt;--/g, '<--')
        .replace(/&lt;==/g, '<==')
        .replace(/==&gt;/g, '==>')
        .replace(/-\.-&gt;/g, '-.->');

      // Process line-by-line only for flowcharts/graphs to avoid breaking other diagram types (e.g. erDiagram, sequenceDiagram)
      const trimmedCode = rawCode.trim();
      const isFlowchart = trimmedCode.startsWith('flowchart') || trimmedCode.startsWith('graph');
      const isGantt = trimmedCode.startsWith('gantt');

      if (isFlowchart) {
        // Normalize bidirectional and right-pointing arrows for flowcharts/graphs
        rawCode = rawCode
          .replace(/<\s*[\u2014\u2013\u2212-]+\s*>/g, '<-->')
          .replace(/(?<!\.)[\u2014\u2013\u2212-]+\s*>/g, '-->')
          .replace(/\bgraph\b/g, 'flowchart');

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
              const cleanId = cleanLabel.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9\u0400-\u04FF_-]/g, '_');
              cleanLabel = cleanLabel.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
              const indent = line.match(/^\s*/)?.[0] || '';
              return `${indent}subgraph ${cleanId} ["${cleanLabel}"]`;
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

            // 4a. Wrap double round brackets node labels (circle nodes) in quotes
            processedLine = processedLine.replace(/([a-zA-Z0-9_-]+)\(\(([^)]+)\)\)/g, (_m: string, id: string, content: string) => {
              let cleanContent = content.trim();
              if (cleanContent.startsWith('"') && cleanContent.endsWith('"')) {
                cleanContent = cleanContent.slice(1, -1);
              }
              cleanContent = cleanContent.replace(/\\/g, '\\\\');
              return `${id}(("${cleanContent}"))`;
            });

            // 4b. Wrap oval shape node labels in quotes
            processedLine = processedLine.replace(/([a-zA-Z0-9_-]+)\(\[([^\]]+)\]\)/g, (_m: string, id: string, content: string) => {
              let cleanContent = content.trim();
              if (cleanContent.startsWith('"') && cleanContent.endsWith('"')) {
                cleanContent = cleanContent.slice(1, -1);
              }
              cleanContent = cleanContent.replace(/\\/g, '\\\\');
              return `${id}(["${cleanContent}"])`;
            });

            // 4c. Wrap single round brackets node labels in quotes
            processedLine = processedLine.replace(/([a-zA-Z0-9_-]+)\((?!\(|\[)([^)]+)(?<!\]|\))\)/g, (m: string, id: string, content: string) => {
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
      } else if (isGantt) {
        const lines = rawCode.split('\n');
        const processedLines = lines.map((line: string) => {
          const trimmed = line.trim();
          const lowerTrimmed = trimmed.toLowerCase();
          if (
            lowerTrimmed.startsWith('gantt') ||
            lowerTrimmed.startsWith('title') ||
            lowerTrimmed.startsWith('dateformat') ||
            lowerTrimmed.startsWith('axisformat') ||
            lowerTrimmed.startsWith('tickinterval') ||
            lowerTrimmed.startsWith('weekday') ||
            lowerTrimmed.startsWith('todaymarker') ||
            lowerTrimmed.startsWith('section') ||
            lowerTrimmed.startsWith('excludes') ||
            lowerTrimmed.startsWith('click') ||
            trimmed.startsWith('%%')
          ) {
            return line;
          }
          // If there is more than one colon in the line
          const colonCount = (line.match(/:/g) || []).length;
          if (colonCount > 1) {
            const lastColonIndex = line.lastIndexOf(':');
            const taskPart = line.substring(0, lastColonIndex);
            const metaPart = line.substring(lastColonIndex);
            const cleanTaskPart = taskPart.replace(/:/g, ' - ');
            return cleanTaskPart + metaPart;
          }
          return line;
        });
        rawCode = processedLines.join('\n')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&');
      } else if (trimmedCode.startsWith('erDiagram')) {
        const lines = rawCode.split('\n');
        const processedLines = lines.map((line: string) => {
          // Remove spaces between PK, FK, UK key combinations
          return line.replace(/\b(PK|FK|UK)\s*,\s*(PK|FK|UK)\b/gi, '$1,$2');
        });
        rawCode = processedLines.join('\n')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&');
      } else if (trimmedCode.startsWith('timeline') || trimmedCode.startsWith('chronology')) {
        const lines = rawCode.split('\n');
        const processedLines = lines.map((line: string) => {
          let processedLine = line;
          const trimmed = line.trim();
          if (trimmed.startsWith('chronology')) {
            processedLine = line.replace('chronology', 'timeline');
            return processedLine;
          }
          if (
            trimmed.startsWith('timeline') ||
            trimmed.startsWith('title') ||
            trimmed.startsWith('section') ||
            trimmed.startsWith('%%')
          ) {
            return processedLine;
          }

          // If there is at least one colon
          const colonCount = (line.match(/:/g) || []).length;
          if (colonCount > 1) {
            // Find the separator colon index
            // Look for a colon with spaces around it first
            let separatorIndex = line.search(/(?:\s+:\s*|\s*:\s+)/);
            if (separatorIndex === -1) {
              separatorIndex = line.indexOf(':');
            }
            if (separatorIndex !== -1) {
              const leftPart = line.substring(0, separatorIndex);
              const rightPart = line.substring(separatorIndex);
              // Replace all colons in the left part with fullwidth colons U+FF1A
              const cleanLeftPart = leftPart.replace(/:/g, '：');
              return cleanLeftPart + rightPart;
            }
          }
          return processedLine;
        });
        rawCode = processedLines.join('\n')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&');
      } else if (trimmedCode.startsWith('sequenceDiagram')) {
        const lines = rawCode.split('\n');
        const processedLines = lines.map((line: string) => {
          // Replace em-dash, en-dash, minus with standard hyphens in arrows
          let processedLine = line.replace(/[\u2014\u2013\u2212]/g, '-');
          
          const trimmed = processedLine.trim();
          const lowerTrimmed = trimmed.toLowerCase();
          
          // Skip keywords and non-message lines
          if (
            lowerTrimmed.startsWith('sequencediagram') ||
            lowerTrimmed.startsWith('participant') ||
            lowerTrimmed.startsWith('actor') ||
            lowerTrimmed.startsWith('note ') ||
            lowerTrimmed.startsWith('autonumber') ||
            lowerTrimmed.startsWith('activate') ||
            lowerTrimmed.startsWith('deactivate') ||
            lowerTrimmed.startsWith('loop') ||
            lowerTrimmed.startsWith('alt') ||
            lowerTrimmed.startsWith('else') ||
            lowerTrimmed.startsWith('opt') ||
            lowerTrimmed.startsWith('end') ||
            lowerTrimmed.startsWith('rect') ||
            lowerTrimmed.startsWith('critical') ||
            trimmed.startsWith('%%')
          ) {
            return processedLine;
          }
          
          // If it is a message line (contains a colon)
          const colonIndex = processedLine.indexOf(':');
          if (colonIndex !== -1) {
            const participantPart = processedLine.substring(0, colonIndex);
            const messagePart = processedLine.substring(colonIndex + 1);
            // Replace double quotes in messagePart with &quot;
            // Also escape semicolons to &#59; to prevent statement splitting
            const cleanMessagePart = messagePart
              .replace(/"/g, '&quot;')
              .replace(/;/g, '&#59;');
            return participantPart + ':' + cleanMessagePart;
          }
          
          return processedLine;
        });
        rawCode = processedLines.join('\n')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&');
      } else {
        // For other diagram types (sequenceDiagram, erDiagram, etc.), restore all raw comparison and special operators
        rawCode = rawCode
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&');
      }

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
      // Headers (with id slugs for anchor navigation; longest prefix first to avoid greedy matching)
      .replace(/^###### (.*?)$/gm, (_m: string, title: string) => { const slug = title.replace(/<[^>]*>/g, '').replace(/[^\w\u0400-\u04FF\s-]/g, '').trim().toLowerCase().replace(/\s+/g, '-'); return `<h6 id="${slug}" class="visual-h6">${title}</h6>`; })
      .replace(/^##### (.*?)$/gm, (_m: string, title: string) => { const slug = title.replace(/<[^>]*>/g, '').replace(/[^\w\u0400-\u04FF\s-]/g, '').trim().toLowerCase().replace(/\s+/g, '-'); return `<h5 id="${slug}" class="visual-h5">${title}</h5>`; })
      .replace(/^#### (.*?)$/gm, (_m: string, title: string) => { const slug = title.replace(/<[^>]*>/g, '').replace(/[^\w\u0400-\u04FF\s-]/g, '').trim().toLowerCase().replace(/\s+/g, '-'); return `<h4 id="${slug}" class="visual-h4">${title}</h4>`; })
      .replace(/^### (.*?)$/gm, (_m: string, title: string) => { const slug = title.replace(/<[^>]*>/g, '').replace(/[^\w\u0400-\u04FF\s-]/g, '').trim().toLowerCase().replace(/\s+/g, '-'); return `<h3 id="${slug}" class="visual-h3">${title}</h3>`; })
      .replace(/^## (.*?)$/gm, (_m: string, title: string) => { const slug = title.replace(/<[^>]*>/g, '').replace(/[^\w\u0400-\u04FF\s-]/g, '').trim().toLowerCase().replace(/\s+/g, '-'); return `<h2 id="${slug}" class="visual-h2">${title}</h2>`; })
      .replace(/^# (.*?)$/gm, (_m: string, title: string) => { const slug = title.replace(/<[^>]*>/g, '').replace(/[^\w\u0400-\u04FF\s-]/g, '').trim().toLowerCase().replace(/\s+/g, '-'); return `<h1 id="${slug}" class="visual-h1">${title}</h1>`; })
      // Unordered Lists
      .replace(/^(\s*)[-*+]\s+\[\s*\]\s+(.*?)$/gm, (_match, spaces, content) => {
        const spaceCount = spaces.replace(/\t/g, '    ').length;
        const indentLevel = Math.floor(spaceCount / 2);
        const marginStyle = indentLevel > 0 ? ` style="margin-left: ${indentLevel * 1.25 + 1}rem;"` : ' class="ml-4"';
        return `<div class="flex items-center space-x-2 my-1"${marginStyle.startsWith(' class') ? marginStyle : marginStyle}><input type="checkbox" disabled class="rounded bg-black/40 border-white/10 text-primary focus:ring-0" /> <span class="text-text-muted">${content}</span></div>`;
      })
      .replace(/^(\s*)[-*+]\s+\[x\]\s+(.*?)$/gm, (_match, spaces, content) => {
        const spaceCount = spaces.replace(/\t/g, '    ').length;
        const indentLevel = Math.floor(spaceCount / 2);
        const marginStyle = indentLevel > 0 ? ` style="margin-left: ${indentLevel * 1.25 + 1}rem;"` : ' class="ml-4"';
        return `<div class="flex items-center space-x-2 my-1"${marginStyle.startsWith(' class') ? marginStyle : marginStyle}><input type="checkbox" checked disabled class="rounded bg-black/40 border-white/10 text-primary focus:ring-0" /> <span class="line-through text-text-disabled">${content}</span></div>`;
      })
      .replace(/^(\s*)[-*+]\s+(.*?)$/gm, (_match, spaces, content) => {
        const spaceCount = spaces.replace(/\t/g, '    ').length;
        const indentLevel = Math.floor(spaceCount / 2);
        const marginStyle = indentLevel > 0 ? ` style="margin-left: ${indentLevel * 1.25 + 1}rem;"` : ' class="ml-4"';
        return `<li class="list-disc list-inside text-text"${marginStyle.startsWith(' class') ? marginStyle : marginStyle}>${content}</li>`;
      })
      // Ordered Lists
      .replace(/^(\s*)(\d+)\.\s+(.*?)$/gm, (_match, spaces, num, content) => {
        const spaceCount = spaces.replace(/\t/g, '    ').length;
        const indentLevel = Math.floor(spaceCount / 2);
        const marginStyle = indentLevel > 0 ? ` style="margin-left: ${indentLevel * 1.25 + 1}rem;"` : ' class="ml-4"';
        return `<li class="list-decimal list-inside text-text"${marginStyle.startsWith(' class') ? marginStyle : marginStyle} value="${num}">${content}</li>`;
      })
      // Bold & Italic
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Standard Images (or video)
      .replace(/!\[([^\]]*)\]\((.*?)\)/g, (_match, alt, path) => renderMediaHtml(path, alt, []))
      // WikiLink Embeds ![[media]] (must run before standard wiki-links!)
      .replace(/!\[\[([^\]]+)\]\]/g, (_match, content) => {
        const parts = content.split('|');
        const filename = parts[0].trim();
        const options = parts.slice(1).map((opt: string) => opt.trim());
        const relativePath = `assets/${filename}`;
        return renderMediaHtml(relativePath, filename, options);
      })
      // Standard links (anchor links stay in-page, external links open in new tab)
      .replace(/\[([^\]]+)\]\((.*?)\)/g, (_match: string, text: string, url: string) => {
        if (url.startsWith('#')) {
          return `<a href="${url}" data-anchor="true" class="text-primary hover:underline">${text}</a>`;
        }
        const isExternal = /^https?:\/\//i.test(url);
        if (!isExternal && (url.endsWith('.md') || !url.includes('.'))) {
          return `<a href="#" data-wikilink="${url}" class="text-primary hover:underline">${documentIconSvg}${text}</a>`;
        }
        return `<a href="${url}" target="_blank" class="text-primary hover:underline">${text}</a>`;
      })
      // Obsidian WikiLinks [[RelativePath]] or [[RelativePath|Label]]
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, path, label) => {
        const cleanPath = path.trim();
        const displayLabel = label ? label.trim() : cleanPath.replace(/\.md$/, '');
        return `<a href="#" data-wikilink="${cleanPath}" class="text-primary hover:underline">${documentIconSvg}${displayLabel}</a>`;
      })
      // Paragraph line breaks (double newline = new paragraph)
      .replace(/\n\n/g, '</p><p>')
      // Single line breaks → <br /> (Obsidian-style strict line breaks)
      // Skip lines that are already block-level HTML elements
      .replace(/(?<!\>)\n(?!\s*<\/?(?:h[1-6]|li|div|hr|table|thead|tbody|tr|th|td|p|ul|ol|blockquote|pre|code)[\s>\/])/gi, '<br />\n');

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
    
    // In-page anchor link scroll support
    const anchorLink = target.closest('a[data-anchor="true"]') as HTMLAnchorElement | null;
    if (anchorLink) {
      e.preventDefault();
      const hash = anchorLink.getAttribute('href');
      if (hash && hash.startsWith('#')) {
        const targetId = decodeURIComponent(hash.slice(1));
        const previewContainer = anchorLink.closest('.markdown-preview, [class*="overflow-y-auto"]');
        const targetEl = previewContainer?.querySelector(`[id="${targetId}"]`) || document.getElementById(targetId);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
      return;
    }

    // Mermaid diagram zoom support
    const mermaidDiv = target.closest('.mermaid[data-processed="true"]');
    if (mermaidDiv) {
      const svgEl = mermaidDiv.querySelector('svg');
      if (svgEl) {
        setActiveMermaidSvg(svgEl.outerHTML);
        return;
      }
    }

    // Lightbox image zoom support (loads original full-quality file by stripping width param)
    if (target.tagName === 'IMG') {
      const src = target.getAttribute('src');
      if (src) {
        const originalSrc = src.replace(/([?&])width=\d+(&?)/, '$1$2').replace(/[?&]$/, '');
        setLightboxSrc(originalSrc);
        return;
      }
    }

    const wikilinkEl = target.closest('a[data-wikilink]') as HTMLAnchorElement | null;
    if (wikilinkEl) {
      e.preventDefault();
      const wikilink = wikilinkEl.getAttribute('data-wikilink');
      if (wikilink) {
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
    <div className="flex flex-col h-full bg-background-panel border border-white/5 rounded-xl overflow-hidden shadow-glass relative">
      {uploadProgress !== null && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-[100] flex flex-col items-center justify-center space-y-4 select-none">
          <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin shadow-glow" />
          <div className="text-sm font-semibold text-white">
            {uploadingFilesCount > 1
              ? (lang === 'en' 
                ? `Uploading media files (${uploadingFileIndex + 1}/${uploadingFilesCount})...` 
                : `Загрузка медиафайлов (${uploadingFileIndex + 1}/${uploadingFilesCount})...`)
              : (lang === 'en' 
                ? 'Uploading media file...' 
                : 'Загрузка медиафайла...')}
          </div>
          <div className="w-64 bg-white/10 h-2 rounded-full overflow-hidden border border-white/5">
            <div 
              className="bg-primary h-full transition-all duration-300 shadow-glow"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <div className="text-xs text-text-muted font-mono">{uploadProgress}%</div>
        </div>
      )}

      {conflictFile && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-[110] flex items-center justify-center p-4 select-none">
          <div className="bg-background-panel/95 border border-white/10 p-6 rounded-2xl max-w-sm w-full shadow-2xl flex flex-col items-center text-center space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-12 h-12 rounded-full bg-yellow-500/10 border border-yellow-500/25 flex items-center justify-center text-yellow-400">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            
            <div className="space-y-1.5">
              <h3 className="text-sm font-bold text-white">
                {lang === 'en' ? 'File Already Exists' : 'Файл уже существует'}
              </h3>
              <p className="text-xs text-text-muted break-all px-2 leading-relaxed">
                {lang === 'en' 
                  ? `File "${conflictFile.file.name}" is already uploaded. What would you like to do?` 
                  : `Файл "${conflictFile.file.name}" уже загружен на сервер. Что вы хотите сделать?`}
              </p>
            </div>
            
            <div className="flex flex-col space-y-2 w-full pt-2">
              <button
                onClick={() => conflictFile.resolve('overwrite')}
                className="w-full py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 rounded-lg text-xs font-semibold cursor-pointer transition-all hover:scale-[1.01]"
              >
                {lang === 'en' ? 'Overwrite Existing' : 'Перезаписать существующий'}
              </button>
              <button
                onClick={() => conflictFile.resolve('rename')}
                className="w-full py-2 bg-primary/20 hover:bg-primary/30 border border-primary/45 text-primary rounded-lg text-xs font-semibold cursor-pointer transition-all hover:scale-[1.01] shadow-glow"
              >
                {lang === 'en' ? 'Keep Both (Rename)' : 'Создать копию (Переименовать)'}
              </button>
              <button
                onClick={() => conflictFile.resolve('cancel')}
                className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-lg text-xs font-semibold cursor-pointer transition-all"
              >
                {lang === 'en' ? 'Cancel' : 'Отмена'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Editor Toolbar */}
      {selectedSuggestion ? (
        // Specialized Toolbar for Suggestion Review
        <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-3 border-b border-primary/20 bg-primary/5 select-none gap-2">
          <div className="flex items-center space-x-2.5">
            <GitPullRequest className="w-5 h-5 text-primary animate-pulse" />
            <div>
              <div className="text-xs font-bold text-white">Предложение от {selectedSuggestion.author_name}</div>
              <div className="text-[10px] text-text-disabled">Создано: {new Date(selectedSuggestion.created_at).toLocaleString()}</div>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            <div className="flex border border-white/10 rounded-lg p-0.5 bg-black/30 shrink-0">
              <button
                onClick={() => setSuggestionViewMode('original')}
                className={`p-1 px-3 rounded text-[11px] flex items-center space-x-1 transition-all cursor-pointer ${
                  suggestionViewMode === 'original' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
                }`}
              >
                <span>{lang === 'en' ? 'Original' : 'Оригинал'}</span>
              </button>
              <button
                onClick={() => setSuggestionViewMode('preview')}
                className={`p-1 px-3 rounded text-[11px] flex items-center space-x-1 transition-all cursor-pointer ${
                  suggestionViewMode === 'preview' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
                }`}
              >
                <span>{lang === 'en' ? 'Result' : 'Результат'}</span>
              </button>
              <button
                onClick={() => setSuggestionViewMode('diff')}
                className={`p-1 px-3 rounded text-[11px] flex items-center space-x-1 transition-all cursor-pointer ${
                  suggestionViewMode === 'diff' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
                }`}
              >
                <span>{lang === 'en' ? 'Diff' : 'Разница'}</span>
              </button>
            </div>

            {canReview && (
              <div className="flex space-x-1.5 border-l border-white/10 pl-2.5">
                <button
                  onClick={() => handleAcceptSuggestion(selectedSuggestion.id)}
                  disabled={saving}
                  className="p-1 px-3 bg-green-500/20 border border-green-500/30 hover:bg-green-500/40 text-green-400 rounded-lg text-[11px] font-semibold flex items-center space-x-1 transition-colors cursor-pointer disabled:opacity-30"
                  title={lang === 'en' ? 'Accept suggestion' : 'Принять предложение'}
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'Accept' : 'Принять'}</span>
                </button>
                <button
                  onClick={() => handleRejectSuggestion(selectedSuggestion.id)}
                  disabled={saving}
                  className="p-1 px-3 bg-red-500/20 border border-red-500/30 hover:bg-red-500/40 text-red-400 rounded-lg text-[11px] font-semibold flex items-center space-x-1 transition-colors cursor-pointer disabled:opacity-30"
                  title={lang === 'en' ? 'Reject suggestion' : 'Отклонить предложение'}
                >
                  <X className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'Reject' : 'Отклонить'}</span>
                </button>
              </div>
            )}

            <button
              onClick={() => setSelectedSuggestion(null)}
              className="p-1.5 bg-white/5 border border-white/10 hover:bg-white/10 text-text-muted hover:text-white rounded-lg transition-colors cursor-pointer"
              title={lang === 'en' ? 'Close view' : 'Закрыть просмотр'}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        // Standard Toolbar
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 py-2 border-b border-white/5 bg-black/10 select-none gap-2">
          {/* Formatting Actions */}
          <div className="flex items-center space-x-1 overflow-x-auto scrollbar-none flex-nowrap w-full sm:w-auto pb-1 sm:pb-0 pr-2">
            <button
              onClick={() => insertText('# ', '')}
              disabled={mode === 'preview' || isReadOnly || (!!lockedBy && !isSuggestMode)}
              className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer disabled:opacity-30 shrink-0"
              title={lang === 'en' ? 'Heading 1' : 'Заголовок H1'}
            >
              <Heading1 className="w-4 h-4" />
            </button>
            <button
              onClick={() => insertText('## ', '')}
              disabled={mode === 'preview' || isReadOnly || (!!lockedBy && !isSuggestMode)}
              className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer disabled:opacity-30 shrink-0"
              title={lang === 'en' ? 'Heading 2' : 'Заголовок H2'}
            >
              <Heading2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => insertText('### ', '')}
              disabled={mode === 'preview' || isReadOnly || (!!lockedBy && !isSuggestMode)}
              className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer disabled:opacity-30 shrink-0"
              title={lang === 'en' ? 'Heading 3' : 'Заголовок H3'}
            >
              <Heading3 className="w-4 h-4" />
            </button>
            <div className="w-[1px] h-4 bg-white/10 mx-1 shrink-0" />
            <button
              onClick={() => insertText('**', '**')}
              disabled={mode === 'preview' || isReadOnly || (!!lockedBy && !isSuggestMode)}
              className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer disabled:opacity-30 shrink-0"
              title={lang === 'en' ? 'Bold text' : 'Жирный текст'}
            >
              <Bold className="w-4 h-4" />
            </button>
            <button
              onClick={() => insertText('*', '*')}
              disabled={mode === 'preview' || isReadOnly || (!!lockedBy && !isSuggestMode)}
              className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer disabled:opacity-30 shrink-0"
              title={lang === 'en' ? 'Italic text' : 'Курсив'}
            >
              <Italic className="w-4 h-4" />
            </button>
            <div className="w-[1px] h-4 bg-white/10 mx-1 shrink-0" />
            <button
              onClick={() => insertText('- ', '')}
              disabled={mode === 'preview' || isReadOnly || (!!lockedBy && !isSuggestMode)}
              className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer disabled:opacity-30 shrink-0"
              title={lang === 'en' ? 'Bullet list' : 'Маркированный список'}
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => insertText('- [ ] ', '')}
              disabled={mode === 'preview' || isReadOnly || (!!lockedBy && !isSuggestMode)}
              className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer disabled:opacity-30 shrink-0"
              title={lang === 'en' ? 'Task checklist' : 'Чек-лист'}
            >
              <CheckSquare className="w-4 h-4" />
            </button>
            <button
              onClick={() => insertText('[[', ']]')}
              disabled={mode === 'preview' || isReadOnly || (!!lockedBy && !isSuggestMode)}
              className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white font-bold text-xs transition-colors cursor-pointer disabled:opacity-30 shrink-0"
              title={lang === 'en' ? 'Insert Wiki Link' : 'Вставить Вики-ссылку'}
            >
              [[ ]]
            </button>
            <button
              onClick={() => insertText('[ссылка](', ')') }
              disabled={mode === 'preview' || isReadOnly || (!!lockedBy && !isSuggestMode)}
              className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer disabled:opacity-30 shrink-0"
              title={lang === 'en' ? 'Insert standard link' : 'Вставить ссылку'}
            >
              <LinkIcon className="w-4 h-4" />
            </button>
            <button
              onClick={handleMediaUpload}
              disabled={mode === 'preview' || isReadOnly || (!!lockedBy && !isSuggestMode)}
              className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer disabled:opacity-30 shrink-0"
              title={lang === 'en' ? 'Upload media file (Image or Video)' : 'Загрузить медиафайл (Изображение или Видео)'}
            >
              <ImageIcon className="w-4 h-4" />
            </button>
          </div>

          {/* Status and Action Buttons */}
          <div className="flex items-center justify-between sm:justify-end space-x-2.5 w-full sm:w-auto overflow-x-auto scrollbar-none flex-nowrap pb-1 sm:pb-0">
            {/* Suggest mode toggle */}
            {!isReadOnly && (
              <button
                onClick={() => {
                  const nextMode = !isSuggestMode;
                  setIsSuggestMode(nextMode);
                  if (nextMode) {
                    setMode('edit');
                  }
                }}
                className={`p-1.5 border rounded-lg flex items-center space-x-1.5 transition-all cursor-pointer shrink-0 ${
                  isSuggestMode 
                    ? 'bg-primary/20 border-primary/45 text-primary shadow-glow font-semibold font-mono text-[11px]' 
                    : 'bg-white/5 border-white/10 text-text-muted hover:text-white text-[11px]'
                }`}
                title={isSuggestMode ? (lang === 'en' ? "Suggestions mode active. Saving will record changes as a suggestion." : "Режим предложений активен. Сохранение запишет изменения как предложение.") : (lang === 'en' ? "Enable suggestions mode" : "Включить режим предложений (рецензирование)")}
              >
                <GitBranch className="w-3.5 h-3.5 text-primary" />
                <span className="text-[11px] hidden md:inline">{lang === 'en' ? 'Review' : 'Рецензирование'}</span>
              </button>
            )}

            {/* Suggestions counter sidebar toggle */}
            {suggestions.length > 0 && (
              <button
                onClick={() => setShowSuggestionsSidebar(!showSuggestionsSidebar)}
                className={`p-1.5 border rounded-lg flex items-center space-x-1.5 transition-all cursor-pointer relative shrink-0 ${
                  showSuggestionsSidebar 
                    ? 'bg-primary/20 border-primary/45 text-primary shadow-glow font-semibold text-[11px]' 
                    : 'bg-white/5 border-white/10 text-text-muted hover:text-white text-[11px]'
                }`}
                title={lang === 'en' ? "Show suggestions list" : "Показать список предложений"}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="text-[11px] hidden md:inline">{lang === 'en' ? 'Suggestions' : 'Предложения'}</span>
                <span className="absolute -top-1.5 -right-1.5 bg-primary text-white text-[9px] font-bold w-4.5 h-4.5 rounded-full flex items-center justify-center border border-background-editor shadow-glow animate-pulse">
                  {suggestions.length}
                </span>
              </button>
            )}

            {/* Normal Lock / Saving Status Indicator */}
            {isSuggestMode ? (
              <div className="flex items-center space-x-1.5 text-xs text-primary bg-primary/10 px-2.5 py-1 rounded-full border border-primary/20 shrink-0">
                <GitBranch className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{lang === 'en' ? 'Reviewing Mode' : 'Режим рецензирования'}</span>
                <span className="inline sm:hidden">{lang === 'en' ? 'Review' : 'Рецензия'}</span>
              </div>
            ) : lockedBy ? (
              <div className="flex items-center space-x-1.5 text-xs text-yellow-400 bg-yellow-400/10 px-2.5 py-1 rounded-full border border-yellow-400/20 shrink-0">
                <FileLock className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{lang === 'en' ? `Editing: ${lockedBy} (ReadOnly)` : `Редактирует: ${lockedBy} (ReadOnly)`}</span>
                <span className="inline sm:hidden">{lang === 'en' ? `Lock: ${lockedBy}` : `Блок: ${lockedBy}`}</span>
              </div>
            ) : isReadOnly ? (
              <div className="flex items-center space-x-1.5 text-xs text-text-muted bg-white/5 px-2.5 py-1 rounded-full shrink-0">
                <User className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{lang === 'en' ? 'Reading Mode (ReadOnly)' : 'Режим чтения (ReadOnly)'}</span>
                <span className="inline sm:hidden">{lang === 'en' ? 'Read' : 'Чтение'}</span>
              </div>
            ) : (
              <div className="flex items-center space-x-1.5 text-xs text-green-400 bg-green-500/10 px-2.5 py-1 rounded-full border border-green-500/20 shrink-0">
                <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-ping" />
                <span className="hidden sm:inline">{lang === 'en' ? 'Sync is active' : 'Синхронизация активна'}</span>
                <span className="inline sm:hidden">{lang === 'en' ? 'Sync' : 'Синхронизация'}</span>
              </div>
            )}

            <div className="flex border border-white/10 rounded-lg p-0.5 bg-black/30 shrink-0">
              <button
                onClick={switchToEdit}
                disabled={selectedSuggestion !== null}
                className={`p-1 px-3 rounded text-xs flex items-center space-x-1.5 transition-all cursor-pointer disabled:opacity-30 ${
                  mode === 'edit' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
                }`}
              >
                <Code className="w-3.5 h-3.5" />
                <span>{lang === 'en' ? 'Code' : 'Код'}</span>
              </button>
              <button
                onClick={switchToPreview}
                disabled={selectedSuggestion !== null}
                className={`p-1 px-3 rounded text-xs flex items-center space-x-1.5 transition-all cursor-pointer disabled:opacity-30 ${
                  mode === 'preview' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>{lang === 'en' ? 'Preview' : 'Просмотр'}</span>
              </button>
            </div>

            <button
              onClick={handleDownload}
              className="p-1.5 bg-white/5 border border-white/10 hover:bg-white/10 text-text-muted hover:text-white rounded-lg transition-colors cursor-pointer shrink-0"
              title={t('editor_btn_download', lang)}
            >
              <Download className="w-4 h-4" />
            </button>

            {/* Resolve conflict or save button */}
            {conflictData ? (
              <button
                onClick={handleResolveConflict}
                disabled={saving}
                className="p-1.5 bg-green-600/35 border border-green-500/50 hover:bg-green-500/60 text-green-300 rounded-lg transition-colors cursor-pointer flex items-center space-x-1 shrink-0 font-semibold text-xs animate-pulse"
                title={lang === 'en' ? 'Save conflict resolution' : 'Сохранить разрешение конфликтов'}
              >
                <Check className="w-4 h-4" />
                <span className="hidden sm:inline">{lang === 'en' ? 'Merge Conflicts' : 'Слить конфликты'}</span>
              </button>
            ) : (
              (!isReadOnly && (!lockedBy || isSuggestMode) && (
                <button
                  onClick={handleSave}
                  disabled={saving || content === initialContent}
                  className="p-1.5 bg-primary/20 border border-primary/30 hover:bg-primary/40 text-primary rounded-lg transition-colors cursor-pointer disabled:opacity-30 shrink-0"
                  title={lang === 'en' ? 'Save (Ctrl + S)' : 'Сохранить (Ctrl + S)'}
                >
                  <Save className="w-4 h-4" />
                </button>
              ))
            )}

            {conflictData && (
              <button
                onClick={() => {
                  setConflictData(null);
                  setContent(initialContent);
                }}
                className="p-1.5 bg-red-600/20 border border-red-500/30 hover:bg-red-500/40 text-red-400 rounded-lg transition-colors cursor-pointer shrink-0"
                title={lang === 'en' ? 'Cancel resolution' : 'Отменить разрешение'}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Editor Main Area */}
      <div className="flex-1 flex flex-row relative overflow-hidden bg-background-editor text-sm min-h-[300px]">
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
                  {t('sidebar_no_notes', lang)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Left Side: Editor, Preview or Diff */}
        <div className="flex-1 h-full min-w-0 relative flex flex-col">
          {selectedSuggestion ? (
            suggestionViewMode === 'diff' ? (
              <DiffViewer
                versionId={selectedSuggestion.id}
                versionDate={selectedSuggestion.created_at}
                authorName={selectedSuggestion.author_name}
                historicContent={selectedSuggestion.base_content}
                currentContent={selectedSuggestion.suggested_content}
                onClose={() => setSelectedSuggestion(null)}
                onRestore={() => handleAcceptSuggestion(selectedSuggestion.id)}
                isReadOnly={!canReview}
                lang={lang}
              />
            ) : suggestionViewMode === 'original' ? (
              <div 
                className="w-full h-full p-4 sm:p-8 overflow-y-auto markdown-preview text-text select-text text-left prose prose-invert bg-black/10"
                dangerouslySetInnerHTML={{ __html: parseMarkdown(selectedSuggestion.base_content) }}
              />
            ) : (
              <div 
                className="w-full h-full p-4 sm:p-8 overflow-y-auto markdown-preview text-text select-text text-left prose prose-invert bg-black/10"
                dangerouslySetInnerHTML={{ __html: parseMarkdown(selectedSuggestion.suggested_content) }}
              />
            )
          ) : (
            mode === 'edit' ? (
              <div className="w-full h-full text-left">
                <CodeMirror
                  ref={editorRef}
                  value={content}
                  height="100%"
                  extensions={[markdown({ base: markdownLanguage }), EditorView.lineWrapping, mediaEvents, imagePreviewPlugin]}
                  theme="dark" // UIW standard dark theme
                  editable={!isReadOnly && (!lockedBy || isSuggestMode)}
                  onChange={handleEditorChange}
                  onCreateEditor={handleCreateEditor}
                  className="h-full border-0 focus:outline-none"
                  placeholder="Начните писать markdown или используйте панель форматирования..."
                />
              </div>
            ) : (
              <div 
                ref={previewRef}
                onClick={handlePreviewClick}
                onScroll={handlePreviewScroll}
                className="w-full h-full p-4 sm:p-8 overflow-y-auto markdown-preview text-text select-text text-left prose prose-invert"
                dangerouslySetInnerHTML={{ __html: parseMarkdown(content) }}
              />
            )
          )}
        </div>

        {/* Right Side: Suggestions List Panel */}
        {showSuggestionsSidebar && suggestions.length > 0 && (
          <div className="w-72 border-l border-white/5 bg-black/30 backdrop-blur-md flex flex-col h-full select-none shrink-0 overflow-y-auto p-4 space-y-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider border-b border-white/5 pb-2 flex items-center space-x-1.5">
              <GitPullRequest className="w-4 h-4 text-primary" />
              <span>{lang === 'en' ? 'Proposed Edits' : 'Предложенные правки'}</span>
            </h3>
            <div className="space-y-2">
              {suggestions.map((s) => (
                <div 
                  key={s.id} 
                  onClick={() => {
                    setSelectedSuggestion(s);
                    setSuggestionViewMode('diff');
                  }}
                  className={`p-3 rounded-xl border transition-all cursor-pointer text-left hover:scale-[1.02] active:scale-95 ${
                    selectedSuggestion?.id === s.id 
                      ? 'bg-primary/10 border-primary shadow-glow' 
                      : 'bg-white/[0.02] border-white/5 hover:bg-white/5 hover:border-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-white flex items-center space-x-1">
                      <User className="w-3 h-3 text-primary/75" />
                      <span>{s.author_name}</span>
                    </span>
                    <span className="text-[9px] text-text-disabled">
                      {new Date(s.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-[10px] text-text-muted truncate">
                    {lang === 'en' ? 'Click to view diff and approve.' : 'Кликните для просмотра разницы и принятия правок.'}
                  </p>
                  {canReview && (
                    <div className="flex items-center justify-end space-x-2 mt-2 pt-2 border-t border-white/5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAcceptSuggestion(s.id);
                        }}
                        className="px-2 py-0.5 bg-green-500/10 hover:bg-green-500/20 text-green-400 rounded text-[9px] font-semibold flex items-center space-x-0.5 transition-colors cursor-pointer"
                      >
                        <Check className="w-2.5 h-2.5" />
                        <span>{lang === 'en' ? 'Accept' : 'Принять'}</span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRejectSuggestion(s.id);
                        }}
                        className="px-2 py-0.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded text-[9px] font-semibold flex items-center space-x-0.5 transition-colors cursor-pointer"
                      >
                        <X className="w-2.5 h-2.5" />
                        <span>{lang === 'en' ? 'Reject' : 'Отклонить'}</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="px-4 py-1.5 border-t border-white/5 bg-black/20 text-[10px] text-text-disabled flex justify-between select-none">
        <span>{lang === 'en' ? 'Path' : 'Путь'}: {notePath} | {lang === 'en' ? 'Owner' : 'Владелец'}: <span className="text-primary font-semibold">{noteCreator}</span></span>
        <span>{lang === 'en' ? 'Characters' : 'Символов'}: {content.length} | {lang === 'en' ? 'Lines' : 'Строк'}: {content.split('\n').length}</span>
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

      {activeMermaidSvg && (
        <MermaidZoomModal 
          svgHtml={activeMermaidSvg} 
          onClose={() => setActiveMermaidSvg(null)} 
          lang={lang}
        />
      )}
    </div>
  );
};
