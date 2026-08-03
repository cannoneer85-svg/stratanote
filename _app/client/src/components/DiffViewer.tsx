/**
 * @module DiffViewer
 * Comparison utility that visualizes diff changes between historical note versions.
 */
import React from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { formatToMoscowTime } from '../utils/date';
import { type Lang } from '../utils/translations';

/**
 * Properties for the {@link DiffViewer} component.
 */
interface DiffViewerProps {
  versionId: number;
  versionDate: string;
  authorName: string;
  historicContent: string;
  currentContent: string;
  onClose: () => void;
  onRestore: () => void;
  isReadOnly: boolean;
  lang: Lang;
  isCurrent?: boolean;
}

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
}

/**
 * DiffViewer component.
 * Renders a side-by-side or inline text comparison highlighting lines that
 * have been added, removed, or remain unchanged between the historic note version and current note version.
 */
export const DiffViewer: React.FC<DiffViewerProps> = ({
  versionId,
  versionDate,
  authorName,
  historicContent,
  currentContent,
  onClose,
  onRestore,
  isReadOnly,
  lang,
  isCurrent
}) => {
  // Helper: line-by-line LCS (Longest Common Subsequence) Diff Algorithm
  const getDiff = (oldText: string, newText: string): DiffLine[] => {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');

    const m = oldLines.length;
    const n = newLines.length;

    // dp[i][j] stores the length of LCS of oldLines[0..i-1] and newLines[0..j-1]
    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    const diffResult: DiffLine[] = [];
    let i = m, j = n;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        diffResult.unshift({ type: 'unchanged', text: oldLines[i - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        diffResult.unshift({ type: 'added', text: newLines[j - 1] });
        j--;
      } else {
        diffResult.unshift({ type: 'removed', text: oldLines[i - 1] });
        i--;
      }
    }

    return diffResult;
  };

  const diffLines = getDiff(historicContent, currentContent);

  return (
    <div className="flex flex-col h-full bg-background-panel border-l border-white/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/5 bg-black/20">
        <div className="flex items-center space-x-3">
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/5 rounded-lg text-text-muted hover:text-white transition-colors cursor-pointer"
            title={lang === 'en' ? 'Back' : 'Назад'}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-sm font-semibold text-white">
              {lang === 'en' ? 'View Changes' : 'Просмотр изменений'}
            </h2>
            <p className="text-xs text-text-muted flex items-center">
              <span>
                {lang === 'en' 
                  ? `Version #${versionId} from ${formatToMoscowTime(versionDate)} (${authorName})` 
                  : `Версия #${versionId} от ${formatToMoscowTime(versionDate)} (${authorName})`}
              </span>
              {isCurrent && (
                <span className="ml-2 text-[10px] text-green-400 font-bold bg-green-500/10 border border-green-500/20 px-1.5 py-0.5 rounded select-none">
                  {lang === 'en' ? 'Current Version' : 'Текущая версия'}
                </span>
              )}
            </p>
          </div>
        </div>

        {!isReadOnly && !isCurrent && (
          <button
            onClick={onRestore}
            className="px-3 py-1.5 bg-primary hover:bg-primary-hover hover:opacity-90 active:scale-95 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-all cursor-pointer shadow-glow border border-primary/20"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{lang === 'en' ? 'Restore version' : 'Восстановить версию'}</span>
          </button>
        )}
      </div>

      {/* Diff Content List */}
      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed space-y-0.5 select-text">
        {diffLines.map((line, idx) => {
          let lineBg = 'hover:bg-white/[0.01] text-text-muted';
          let indicator = ' ';

          if (line.type === 'added') {
            lineBg = 'bg-green-500/10 border-l-2 border-green-500 text-green-300 px-1';
            indicator = '+';
          } else if (line.type === 'removed') {
            lineBg = 'bg-red-500/10 border-l-2 border-red-500 text-red-300 line-through px-1';
            indicator = '-';
          }

          return (
            <div
              key={idx}
              className={`flex items-start rounded-sm py-0.5 transition-colors ${lineBg}`}
            >
              <span className={`w-6 select-none font-bold text-center text-[10px] ${
                line.type === 'added' ? 'text-green-500' : line.type === 'removed' ? 'text-red-500' : 'text-text-disabled'
              }`}>
                {indicator}
              </span>
              <pre className="flex-1 whitespace-pre-wrap break-all font-mono">
                {line.text || ' '}
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
};
