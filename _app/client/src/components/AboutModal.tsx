import React from 'react';
import { X, Calendar, Award } from 'lucide-react';

interface Release {
  version: string;
  date: string;
  title: string;
  keynotes: string[];
}

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  versionInfo: {
    version: string;
    history: Release[];
  };
}

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose, versionInfo }) => {
  if (!isOpen) return null;

  // Format date helper: YYYY-MM-DD -> DD.MM.YYYY
  const formatDate = (dateStr: string) => {
    try {
      const [year, month, day] = dateStr.split('-');
      if (year && month && day) {
        return `${day}.${month}.${year}`;
      }
      return dateStr;
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in select-none">
      {/* Background click-away */}
      <div className="absolute inset-0 cursor-default" onClick={onClose} />
      
      {/* Dialog container */}
      <div className="relative w-full max-w-xl max-h-[80vh] flex flex-col bg-background-panel border border-white/10 rounded-2xl overflow-hidden shadow-glass animate-scale-up z-10">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-black/25">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center text-primary text-xl font-bold">
              📚
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-white">Obsidian Collab</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-primary/25 border border-primary/45 text-primary shadow-glow">
                  v{versionInfo.version}
                </span>
              </div>
              <span className="text-[10px] text-text-muted">О системе и история обновлений</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/5 rounded-lg text-text-muted hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
          {/* Platform intro */}
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">О платформе</h3>
            <p className="text-xs text-text-muted leading-relaxed">
              <strong>Obsidian Collab</strong> — это современная веб-система совместной работы над базой знаний в формате Markdown. Решение сочетает локальный контроль над файлами с облачной синхронизацией, интерактивным графом связей заметок, блокировками во избежание конфликтов редактирования и полной историей изменений.
            </p>
          </div>

          {/* Changelog timeline */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">История версий</h3>
            
            {versionInfo.history.length === 0 ? (
              <p className="text-xs text-text-disabled italic text-center py-4">История версий не найдена</p>
            ) : (
              <div className="relative pl-6 border-l border-white/5 space-y-8 py-2">
                {versionInfo.history.map((release) => (
                  <div key={release.version} className="relative">
                    {/* Timeline bullet */}
                    <span className="absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-background-panel border-2 border-primary shadow-glow shrink-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    </span>

                    {/* Content card */}
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-extrabold text-white">Версия {release.version}</span>
                        <div className="flex items-center space-x-1 text-[10px] text-text-muted">
                          <Calendar className="w-3 h-3" />
                          <span>{formatDate(release.date)}</span>
                        </div>
                      </div>
                      
                      <div className="text-xs font-semibold text-primary">{release.title}</div>
                      
                      {release.keynotes && release.keynotes.length > 0 && (
                        <ul className="space-y-1.5 pl-1.5">
                          {release.keynotes.map((note, nIdx) => (
                            <li key={nIdx} className="flex items-start text-xs text-text-muted leading-relaxed">
                              <span className="text-primary mr-2 select-none">•</span>
                              <span>{note}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-white/5 bg-black/15 text-center flex items-center justify-center space-x-1.5 text-[10px] text-text-disabled">
          <Award className="w-3.5 h-3.5 text-primary" />
          <span>Obsidian Collab Open Source Platform © 2026</span>
        </div>

      </div>
    </div>
  );
};
