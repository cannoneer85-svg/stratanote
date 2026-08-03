/**
 * @module ChangeOwnerModal
 * Modal overlay for transferring document ownership (created_by) to another user or External System.
 */
import React, { useState, useEffect } from 'react';
import { X, UserCheck, Loader2, Folder, FileText, CheckCircle2 } from 'lucide-react';
import { t, type Lang } from '../utils/translations';

/**
 * User interface item representing system user in change owner dropdown.
 */
export interface SystemUser {
  id: number | string;
  username: string;
  role: string;
}

/**
 * Props for {@link ChangeOwnerModal} component.
 */
export interface ChangeOwnerModalProps {
  /** Controls modal visibility */
  isOpen: boolean;
  /** Callback triggered when modal is requested to close */
  onClose: () => void;
  /** Relative path of target note or directory */
  relativePath: string;
  /** Title or display name of target item */
  title: string;
  /** Current owner username of item */
  currentOwner: string;
  /** Whether target item is a directory */
  isDirectory: boolean;
  /** Interface language */
  lang: Lang;
  /** Authentication JWT token */
  token: string;
  /** Callback executed when owner is successfully updated */
  onOwnerChanged: (relativePath: string, newOwner: string, recursive: boolean) => void;
}

/**
 * ChangeOwnerModal component rendering the dialog for transferring note or folder ownership.
 *
 * @param props - Component properties {@link ChangeOwnerModalProps}
 * @returns React modal component or null if not open
 * 
 * @example
 * ```tsx
 * <ChangeOwnerModal
 *   isOpen={isModalOpen}
 *   onClose={() => setModalOpen(false)}
 *   relativePath="Project/Note.md"
 *   title="Note.md"
 *   currentOwner="Внешняя система"
 *   isDirectory={false}
 *   lang="ru"
 *   token={authToken}
 *   onOwnerChanged={(path, newOwner) => console.log('Updated', path, newOwner)}
 * />
 * ```
 */
export const ChangeOwnerModal: React.FC<ChangeOwnerModalProps> = ({
  isOpen,
  onClose,
  relativePath,
  title,
  currentOwner,
  isDirectory,
  lang,
  token,
  onOwnerChanged
}) => {
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [selectedOwner, setSelectedOwner] = useState<string>(currentOwner || 'Внешняя система');
  const [recursive, setRecursive] = useState<boolean>(true);
  const [loadingUsers, setLoadingUsers] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fetch users on modal open
  useEffect(() => {
    if (!isOpen) return;

    setSelectedOwner(currentOwner || 'Внешняя система');
    setRecursive(true);
    setErrorMsg(null);

    const fetchUsers = async () => {
      setLoadingUsers(true);
      try {
        const res = await fetch('/api/auth/users', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setUsers(data);
        } else {
          console.warn('[ChangeOwnerModal] Failed to fetch users list');
        }
      } catch (err) {
        console.error('[ChangeOwnerModal] Network error fetching users:', err);
      } finally {
        setLoadingUsers(false);
      }
    };

    fetchUsers();
  }, [isOpen, currentOwner, token]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOwner) return;

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/notes/owner', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          relative_path: relativePath,
          new_owner: selectedOwner,
          recursive: Boolean(isDirectory) ? recursive : false
        })
      });

      let data: any = {};
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        data = { error: text || res.statusText || `Server error (${res.status})` };
      }

      if (res.ok) {
        onOwnerChanged(relativePath, selectedOwner, Boolean(isDirectory) ? recursive : false);
        onClose();
      } else {
        setErrorMsg(data.error || `Failed to update owner (${res.status})`);
      }
    } catch (err: any) {
      console.error('[ChangeOwnerModal] Error updating owner:', err);
      setErrorMsg(err.message || 'Network error while updating owner');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in select-none">
      {/* Backdrop click close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Modal Container */}
      <div className="relative w-full max-w-md bg-zinc-900/95 border border-white/10 rounded-2xl shadow-glow overflow-hidden flex flex-col backdrop-blur-md animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-white/[0.01]">
          <div className="flex items-center space-x-2.5 text-primary">
            <UserCheck className="w-5 h-5 shrink-0" />
            <h3 className="text-sm font-semibold text-white">
              {t('change_owner_title', lang)}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/5 rounded-lg text-text-muted hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Target File/Folder Info */}
          <div className="p-3 bg-white/[0.03] border border-white/5 rounded-xl flex items-center space-x-3">
            <div className="p-2 bg-primary/10 rounded-lg text-primary shrink-0">
              {Boolean(isDirectory) ? <Folder className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white truncate" title={title || relativePath}>
                {title || relativePath}
              </p>
              <p className="text-[10px] text-text-muted truncate mt-0.5" title={relativePath}>
                {relativePath}
              </p>
            </div>
          </div>

          <p className="text-xs text-text-muted leading-relaxed">
            {t('change_owner_desc', lang)}
          </p>

          {errorMsg && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl">
              {errorMsg}
            </div>
          )}

          {/* Select User Dropdown */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text-muted block">
              {t('select_new_owner', lang)}
            </label>
            <div className="relative">
              <select
                value={selectedOwner}
                onChange={(e) => setSelectedOwner(e.target.value)}
                disabled={loadingUsers || submitting}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all disabled:opacity-50 cursor-pointer"
              >
                <option value="Внешняя система" className="bg-zinc-900 text-white">
                  {t('system_external', lang)} (Внешняя система)
                </option>
                {users.map((u) => (
                  <option key={u.id} value={u.username} className="bg-zinc-900 text-white">
                    {u.username} ({u.role})
                  </option>
                ))}
              </select>
              {loadingUsers && (
                <div className="absolute right-3 top-2.5">
                  <Loader2 className="w-4 h-4 text-primary animate-spin" />
                </div>
              )}
            </div>
          </div>

          {/* Recursive checkbox for directories */}
          {Boolean(isDirectory) && (
            <label className="flex items-center space-x-2.5 pt-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(e) => setRecursive(e.target.checked)}
                className="w-4 h-4 rounded bg-black/40 border-white/10 text-primary focus:ring-primary focus:ring-offset-zinc-900 cursor-pointer"
              />
              <span className="text-xs text-text-muted hover:text-white transition-colors">
                {t('apply_recursive', lang)}
              </span>
            </label>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end space-x-2 pt-3 border-t border-white/5">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-xs font-medium text-text-muted hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-all disabled:opacity-50 cursor-pointer"
            >
              {lang === 'en' ? 'Cancel' : 'Отмена'}
            </button>
            <button
              type="submit"
              disabled={submitting || loadingUsers}
              className="flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-primary hover:bg-primary-hover rounded-xl shadow-lg shadow-primary/20 transition-all disabled:opacity-50 cursor-pointer"
            >
              {submitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              <span>{t('change_owner_btn', lang)}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
