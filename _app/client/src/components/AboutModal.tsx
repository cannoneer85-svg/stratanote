/**
 * @module AboutModal
 * Renders the application's diagnostic version information, changelog history and GitHub update banner.
 */
import React from 'react';
import { X, Calendar, Award, AlertTriangle, ExternalLink } from 'lucide-react';
import { t, type Lang } from '../utils/translations';

interface Release {
  version: string;
  date: string;
  title?: string;
  title_ru?: string;
  title_en?: string;
  keynotes?: string[];
  keynotes_ru?: string[];
  keynotes_en?: string[];
}

/**
 * Properties for the {@link AboutModal} component.
 */
interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  versionInfo: {
    version: string;
    history: Release[];
    env?: string;
    updateAvailable?: boolean;
    latestVersion?: string;
    latestReleaseUrl?: string;
  };
  lang: Lang;
}

/**
 * Modal dialog that displays information about the application.
 * Shows the current version, environment description, license status,
 * and releases changelog list. If a new version is available on GitHub,
 * displays a download alert banner.
 */
export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose, versionInfo, lang }) => {
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
                <h2 className="text-base font-bold text-white">StrataNote</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-primary/25 border border-primary/45 text-primary shadow-glow">
                  v{versionInfo.version}
                </span>
              </div>
              <span className="text-[10px] text-text-muted">{t('system_title', lang)}</span>
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
          {/* Update Alert Banner */}
          {versionInfo.updateAvailable && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start space-x-3 text-amber-200">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <div className="text-xs font-bold">
                  {t('system_update_available', lang, { version: versionInfo.latestVersion || '' })}
                </div>
                <p className="text-[11px] text-text-muted leading-relaxed">
                  {lang === 'ru' 
                    ? 'Доступна новая версия StrataNote. Рекомендуется обновиться для получения последних исправлений и функций.'
                    : 'A new version of StrataNote is available. It is recommended to update for the latest fixes and features.'}
                </p>
                <div className="pt-1">
                  <a
                    href={versionInfo.latestReleaseUrl || "https://github.com/cannoneer85-svg/stratanote"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-1 px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/35 active:scale-[0.98] text-amber-400 hover:text-amber-300 text-[10px] font-bold rounded-lg border border-amber-500/35 transition-all cursor-pointer no-underline"
                  >
                    <span>{t('system_update_download', lang)}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Platform intro */}
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">{t('system_intro_title', lang)}</h3>
            <p className="text-xs text-text-muted leading-relaxed">
              {t('system_intro_desc', lang)}
            </p>
          </div>

          {/* Changelog timeline */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">{t('system_history_title', lang)}</h3>
            
            {versionInfo.history.length === 0 ? (
              <p className="text-xs text-text-disabled italic text-center py-4">{t('system_no_history', lang)}</p>
            ) : (
              <div className="relative pl-6 border-l border-white/5 space-y-8 py-2">
                {versionInfo.history.map((release) => {
                  const releaseTitle = lang === 'en' 
                    ? (release.title_en || release.title || '') 
                    : (release.title_ru || release.title || '');
                  const releaseKeynotes = lang === 'en' 
                    ? (release.keynotes_en || release.keynotes || []) 
                    : (release.keynotes_ru || release.keynotes || []);

                  return (
                    <div key={release.version} className="relative">
                      {/* Timeline bullet */}
                      <span className="absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-background-panel border-2 border-primary shadow-glow shrink-0">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      </span>

                      {/* Content card */}
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-extrabold text-white">
                            {t('about_version_label', lang, { version: release.version })}
                          </span>
                          <div className="flex items-center space-x-1 text-[10px] text-text-muted">
                            <Calendar className="w-3 h-3" />
                            <span>{formatDate(release.date)}</span>
                          </div>
                        </div>
                        
                        <div className="text-xs font-semibold text-primary">{releaseTitle}</div>
                        
                        {releaseKeynotes && releaseKeynotes.length > 0 && (
                          <ul className="space-y-1.5 pl-1.5">
                            {releaseKeynotes.map((note, nIdx) => (
                              <li key={nIdx} className="flex items-start text-xs text-text-muted leading-relaxed">
                                <span className="text-primary mr-2 select-none">•</span>
                                <span>{note}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-white/5 bg-black/15 text-center flex items-center justify-center space-x-1.5 text-[10px] text-text-disabled">
          <Award className="w-3.5 h-3.5 text-primary" />
          <span>{t('system_footer', lang)}</span>
        </div>

      </div>
    </div>
  );
};
