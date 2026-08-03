/**
 * @module TemplateModal
 * Modal overlay for selecting a note template and applying it to the active editor cursor position.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { X, Search, LayoutTemplate } from 'lucide-react';
import { t, type Lang } from '../utils/translations';

interface TemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  notes: any[];
  templatesFolder: string;
  lang: Lang;
  onSelectTemplate: (relativePath: string) => void;
}

export const TemplateModal: React.FC<TemplateModalProps> = ({
  isOpen,
  onClose,
  notes,
  templatesFolder,
  lang,
  onSelectTemplate
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  // Reset search query when modal opens or closes
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Filter templates list
  const templates = useMemo(() => {
    if (!templatesFolder) return [];
    const prefix = templatesFolder.endsWith('/') ? templatesFolder : templatesFolder + '/';
    
    return notes.filter(n => {
      const isFile = !n.is_directory;
      const isInsideTemplatesFolder = n.relative_path.startsWith(prefix);
      const matchesSearch = n.title.toLowerCase().includes(searchQuery.toLowerCase());
      return isFile && isInsideTemplatesFolder && matchesSearch;
    });
  }, [notes, templatesFolder, searchQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in select-none">
      {/* Backdrop click close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Modal Container */}
      <div className="relative w-full max-w-md bg-zinc-900/90 border border-white/10 rounded-2xl shadow-glow overflow-hidden flex flex-col max-h-[80vh] backdrop-blur-md animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-white/[0.01]">
          <div className="flex items-center space-x-2 text-primary">
            <LayoutTemplate className="w-5 h-5" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider font-sans">
              {t('template_modal_title', lang)}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/5 rounded-lg text-text-disabled hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex-1 flex flex-col space-y-4 overflow-y-auto min-h-0">
          {!templatesFolder ? (
            <div className="text-center py-8 px-4 text-xs text-red-400 bg-red-500/5 border border-red-500/10 rounded-xl space-y-3 font-sans">
              <p>{t('template_modal_not_configured', lang)}</p>
            </div>
          ) : (
            <>
              {/* Search input */}
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-disabled" />
                <input
                  type="text"
                  placeholder={t('template_modal_search_placeholder', lang)}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-text-disabled focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20 transition-all font-sans"
                  autoFocus
                />
              </div>

              {/* Templates list */}
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-[150px]">
                {templates.length === 0 ? (
                  <div className="text-center py-12 text-xs text-text-disabled border border-dashed border-white/5 rounded-xl font-sans text-wrap break-all px-4">
                    {t('template_modal_no_templates', lang, { folder: templatesFolder })}
                  </div>
                ) : (
                  templates.map(tmpl => (
                    <div
                      key={tmpl.relative_path}
                      onClick={() => onSelectTemplate(tmpl.relative_path)}
                      className="flex items-center justify-between p-3 bg-white/[0.02] hover:bg-primary/[0.08] border border-white/5 hover:border-primary/30 rounded-xl cursor-pointer transition-all hover:scale-[1.01]"
                    >
                      <div className="truncate pr-4 flex-1">
                        <div className="text-xs font-semibold text-white truncate font-sans">
                          {tmpl.title}
                        </div>
                        <div className="text-[10px] text-text-disabled truncate font-sans">
                          {tmpl.relative_path}
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectTemplate(tmpl.relative_path);
                        }}
                        className="px-2.5 py-1.5 bg-primary hover:bg-primary-hover text-white text-[10px] font-semibold rounded-lg shadow-sm transition-all cursor-pointer font-sans"
                      >
                        {t('template_modal_insert_btn', lang)}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/5 bg-white/[0.01] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white text-xs font-semibold rounded-xl border border-white/5 hover:border-white/10 transition-all cursor-pointer font-sans"
          >
            {t('template_modal_btn_close', lang)}
          </button>
        </div>
      </div>
    </div>
  );
};
