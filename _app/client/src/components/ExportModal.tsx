/**
 * @module ExportModal
 * Workspace exporter dialogue that packs files and media attachments into a ZIP archive.
 */
import React, { useState } from 'react';
import { X, Download, AlertTriangle, FileText, FolderArchive } from 'lucide-react';
import { t, type Lang } from '../utils/translations';

/**
 * Properties for the {@link ExportModal} component.
 */
interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (includeMD: boolean, includeAssets: boolean) => void;
  lang: Lang;
}

/**
 * Modal wizard component for workspace data export.
 * Allows users to choose between exporting raw Markdown text files,
 * media assets, or generating a complete ZIP archive backup.
 */
export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  onExport,
  lang,
}) => {
  const [includeMD, setIncludeMD] = useState(true);
  const [includeAssets, setIncludeAssets] = useState(true);

  if (!isOpen) return null;

  const handleExportClick = () => {
    if (!includeMD && !includeAssets) return;
    onExport(includeMD, includeAssets);
    onClose();
  };

  const isButtonDisabled = !includeMD && !includeAssets;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in select-none">
      <div className="relative w-full max-w-md flex flex-col bg-background-panel border border-white/10 rounded-2xl overflow-hidden shadow-glass animate-scale-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-black/20">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center text-primary font-bold uppercase">
              📦
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">{t('sidebar_export_vault', lang)}</h2>
              <span className="text-[10px] text-text-disabled">
                {lang === 'en' ? 'Setup ZIP archive components' : 'Настройка компонентов ZIP-архива'}
              </span>
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
        <div className="p-6 space-y-4">
          <p className="text-xs text-text-muted">
            {lang === 'en' 
              ? 'Select which data should be included in the exported archive. For large vaults, excluding the assets folder will significantly speed up the download.' 
              : 'Выберите, какие данные необходимо включить в экспортируемый архив. Для больших хранилищ исключение папки с медиафайлами значительно ускорит скачивание.'}
          </p>

          <div className="space-y-3">
            {/* MD Checkbox */}
            <label className="flex items-center space-x-3 p-3 bg-white/[0.02] border border-white/5 rounded-xl cursor-pointer hover:bg-white/[0.02] active:bg-white/[0.04] transition-colors">
              <input
                type="checkbox"
                checked={includeMD}
                onChange={(e) => setIncludeMD(e.target.checked)}
                className="w-4 h-4 rounded bg-black/40 border-white/10 text-primary focus:ring-0 cursor-pointer"
              />
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-primary" />
                <div className="text-left">
                  <div className="text-xs font-semibold text-white">
                    {lang === 'en' ? 'MD Note Files' : 'MD файлы заметок'}
                  </div>
                  <div className="text-[10px] text-text-muted">
                    {lang === 'en' ? 'All Markdown text documents in all folders' : 'Все текстовые документы Markdown во всех папках'}
                  </div>
                </div>
              </div>
            </label>

            {/* Assets Checkbox */}
            <label className="flex items-center space-x-3 p-3 bg-white/[0.02] border border-white/5 rounded-xl cursor-pointer hover:bg-white/[0.02] active:bg-white/[0.04] transition-colors">
              <input
                type="checkbox"
                checked={includeAssets}
                onChange={(e) => setIncludeAssets(e.target.checked)}
                className="w-4 h-4 rounded bg-black/40 border-white/10 text-primary focus:ring-0 cursor-pointer"
              />
              <div className="flex items-center space-x-2">
                <FolderArchive className="w-4 h-4 text-primary" />
                <div className="text-left">
                  <div className="text-xs font-semibold text-white">
                    {lang === 'en' ? 'Assets Folder' : 'Папка assets'}
                  </div>
                  <div className="text-[10px] text-text-muted">
                    {lang === 'en' ? 'Media files (images, videos, and attachments)' : 'Медиафайлы (изображения, видео и вложения)'}
                  </div>
                </div>
              </div>
            </label>
          </div>

          {/* Validation Alert */}
          {isButtonDisabled && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-[10.5px] flex items-start space-x-2 animate-fade-in">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {lang === 'en' ? 'At least one component must be selected for export.' : 'Необходимо выбрать хотя бы один компонент для экспорта.'}
              </span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-4 border-t border-white/5 bg-black/20 flex justify-end space-x-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white text-xs font-semibold rounded-lg transition-all border border-white/5 cursor-pointer"
          >
            {t('users_modal_btn_cancel', lang)}
          </button>
          <button
            onClick={handleExportClick}
            disabled={isButtonDisabled}
            className="px-4 py-2 bg-primary hover:bg-primary-hover active:scale-[0.98] disabled:opacity-30 disabled:pointer-events-none text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-all border border-primary/20 shadow-glow cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>{lang === 'en' ? 'Export' : 'Экспортировать'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
