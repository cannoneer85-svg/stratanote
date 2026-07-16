import React, { useState, useEffect, useRef } from 'react';
import { X, Upload, UserPlus, Trash2, AlertTriangle, Check, Users, ShieldAlert, FolderOpen, Edit2, Image, Search, Info, RefreshCw, Globe, Play, ExternalLink, Sparkles, CheckCheck } from 'lucide-react';
import { formatToMoscowTime } from '../utils/date';
import { t, type Lang } from '../utils/translations';

interface User {
  id: number;
  username: string;
  role: 'Admin' | 'Editor' | 'Viewer';
  approved: number;
  created_at: string;
}

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: { username: string; role: string };
  selectedParentFolder: string;
  token: string | null;
  onVaultReload: () => void;
  versionInfo?: {
    version: string;
    history: Array<{
      version: string;
      date: string;
      title_ru?: string;
      title_en?: string;
      title?: string;
      keynotes_ru?: string[];
      keynotes_en?: string[];
      keynotes?: string[];
    }>;
    env?: string;
    updateAvailable?: boolean;
    latestVersion?: string;
    latestReleaseUrl?: string;
    updateCheckedAt?: number;
    updateError?: string | null;
  };
  onCheckForUpdates?: () => Promise<any>;
  socket?: any;
  lang: Lang;
  onLangChange: (lang: Lang) => void;
}

const formatSize = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

interface MediaCardProps {
  file: { filename: string; size: number; updatedAt: string; isReferenced?: boolean };
  token: string | null;
  lang: Lang;
  onDeleteMedia: (filename: string) => void;
  isSelected: boolean;
  onToggleSelect: (filename: string) => void;
}

const MediaCard: React.FC<MediaCardProps> = ({ file, token, lang, onDeleteMedia, isSelected, onToggleSelect }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [videoPoster, setVideoPoster] = useState<string | null>(null);
  const [isIntersecting, setIsIntersecting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const isVideo = /\.(mp4|webm|ogg|mov|m4v|3gp)$/i.test(file.filename);
  const fileUrl = `/api/raw/assets/${encodeURIComponent(file.filename)}?token=${token}`;
  const thumbnailUrl = isVideo 
    ? fileUrl 
    : `/api/raw/assets/${encodeURIComponent(file.filename)}?token=${token}&width=300`;

  useEffect(() => {
    if (!isVideo || videoPoster) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsIntersecting(true);
        observer.disconnect();
      }
    }, { rootMargin: '150px' });

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => observer.disconnect();
  }, [isVideo, videoPoster]);

  useEffect(() => {
    if (!isIntersecting || !isVideo || videoPoster) return;

    const tempVideo = document.createElement('video');
    tempVideo.src = fileUrl;
    tempVideo.preload = 'metadata';
    tempVideo.muted = true;
    tempVideo.playsInline = true;
    tempVideo.crossOrigin = 'anonymous';

    const handleLoadedMetadata = () => {
      tempVideo.currentTime = 0.5;
    };

    const handleSeeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = tempVideo.videoWidth || 320;
        canvas.height = tempVideo.videoHeight || 180;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
          setVideoPoster(dataUrl);
        }
      } catch (err) {
        console.error('Failed to capture frame from video:', err);
      } finally {
        cleanup();
      }
    };

    const handleError = () => {
      cleanup();
    };

    const cleanup = () => {
      tempVideo.removeEventListener('loadedmetadata', handleLoadedMetadata);
      tempVideo.removeEventListener('seeked', handleSeeked);
      tempVideo.removeEventListener('error', handleError);
      tempVideo.src = '';
      tempVideo.load();
    };

    tempVideo.addEventListener('loadedmetadata', handleLoadedMetadata);
    tempVideo.addEventListener('seeked', handleSeeked);
    tempVideo.addEventListener('error', handleError);
    tempVideo.load();

    return cleanup;
  }, [isIntersecting, isVideo, fileUrl, videoPoster]);

  return (
    <div 
      ref={cardRef}
      className={`group bg-white/[0.02] hover:bg-white/[0.04] border ${
        isSelected ? 'border-primary bg-primary/[0.02] shadow-[0_0_15px_rgba(var(--primary-rgb),0.1)]' : 'border-white/5 hover:border-primary/30'
      } rounded-2xl overflow-hidden flex flex-col transition-all duration-300 hover:shadow-[0_0_15px_rgba(var(--primary-rgb),0.05)]`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Thumbnail Container */}
      <div className="h-32 bg-black/40 relative flex items-center justify-center overflow-hidden border-b border-white/5">
        {/* Checkbox Overlay */}
        <div 
          className={`absolute top-2 right-2 z-10 transition-opacity duration-200 ${
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <input 
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(file.filename)}
            className="w-4 h-4 rounded border-white/20 bg-black/60 text-primary focus:ring-0 focus:ring-offset-0 cursor-pointer"
          />
        </div>
        {isVideo ? (
          isHovered ? (
            <video 
              src={fileUrl} 
              className="w-full h-full object-cover" 
              autoPlay
              muted
              playsInline
              loop
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-black/60 relative">
              {videoPoster ? (
                <img 
                  src={videoPoster} 
                  alt={file.filename}
                  className="w-full h-full object-cover opacity-80"
                />
              ) : (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <span className="text-[10px] text-text-disabled">...</span>
                </div>
              )}
              {/* Play Button Overlay */}
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
                <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center text-white/80 group-hover:scale-110 group-hover:bg-primary group-hover:text-white transition-all duration-300 shadow-lg backdrop-blur-sm border border-white/10">
                  <Play className="w-4 h-4 fill-current translate-x-[1px]" />
                </div>
              </div>
              {/* Format Badge under the icon if poster not loaded */}
              {!videoPoster && (
                <span className="absolute bottom-2 text-[9px] text-text-muted uppercase font-bold tracking-wider">
                  {file.filename.split('.').pop()}
                </span>
              )}
            </div>
          )
        ) : (
          <a 
            href={fileUrl} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="w-full h-full block cursor-zoom-in"
            title={lang === 'en' ? 'Click to view original' : 'Кликните для просмотра оригинала'}
          >
            <img 
              src={thumbnailUrl} 
              alt={file.filename}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              loading="lazy"
            />
          </a>
        )}
        {/* Badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1 items-start">
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${isVideo ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-green-500/20 text-green-400 border border-green-500/30'}`}>
            {file.filename.split('.').pop() || 'file'}
          </span>
          {file.isReferenced === false && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-red-500/20 text-red-400 border border-red-500/30">
              {lang === 'en' ? 'Unused' : 'Не используется'}
            </span>
          )}
        </div>
      </div>

      {/* File Details */}
      <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
        <div className="space-y-1">
          <div 
            className="text-xs font-semibold text-white truncate" 
            title={file.filename}
          >
            {file.filename}
          </div>
          <div className="flex justify-between items-center text-[10px] text-text-muted">
            <span>{formatSize(file.size)}</span>
            <span>{formatToMoscowTime(file.updatedAt)}</span>
          </div>
        </div>
        <button
          onClick={() => onDeleteMedia(file.filename)}
          className="w-full py-1.5 bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white border border-red-500/20 rounded-lg text-[11px] font-medium flex items-center justify-center space-x-1.5 transition-all cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>{t('settings_media_btn_delete', lang)}</span>
        </button>
      </div>
    </div>
  );
};

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
  currentUser,
  selectedParentFolder,
  token,
  onVaultReload,
  versionInfo = { version: '1.0.0', history: [], env: 'Development' },
  onCheckForUpdates,
  socket,
  lang,
  onLangChange
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'import' | 'users' | 'media' | 'about' | 'sync' | 'trash'>('general');
  
  // AI Reindexing State
  const [reindexing, setReindexing] = useState(false);
  const [reindexProgress, setReindexProgress] = useState<{ current: number; total: number; file: string } | null>(null);
  const [reindexStatus, setReindexStatus] = useState<{ type: 'info' | 'success' | 'error'; message: string } | null>(null);
  
  // Trash Bin State
  interface TrashItem {
    id: number;
    relative_path: string;
    title: string;
    deleted_at: string;
    deleted_by: string;
  }
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashStatus, setTrashStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // ZIP / MD Upload State
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [mdFile, setMdFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  
  // Software Update Checker State
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null);

  const handleManualCheck = async () => {
    if (!onCheckForUpdates) return;
    setIsCheckingUpdates(true);
    setUpdateCheckError(null);
    try {
      await onCheckForUpdates();
    } catch (err: any) {
      setUpdateCheckError(err.message || 'Check failed');
    } finally {
      setIsCheckingUpdates(false);
    }
  };
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadProgressBytes, setUploadProgressBytes] = useState<{ loaded: number; total: number } | null>(null);

  // User Management State
  const [users, setUsers] = useState<User[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'Admin' | 'Editor' | 'Viewer'>('Viewer');
  const [userStatus, setUserStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // User Inline Editing State
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editRole, setEditRole] = useState<'Admin' | 'Editor' | 'Viewer'>('Viewer');
  const [editApproved, setEditApproved] = useState(false);

  // Media Management State
  const [mediaFiles, setMediaFiles] = useState<{ filename: string; size: number; updatedAt: string; isReferenced?: boolean }[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [mediaSearchQuery, setMediaSearchQuery] = useState('');
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'all' | 'images' | 'videos' | 'unused' | 'others'>('all');
  const [mediaStatus, setMediaStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [selectedMediaFiles, setSelectedMediaFiles] = useState<string[]>([]);

  useEffect(() => {
    setSelectedMediaFiles([]);
  }, [activeTab, isOpen]);

  // Sync Management State
  const [syncStatuses, setSyncStatuses] = useState<{
    user_id: number;
    username: string;
    device_name: string;
    last_sync_at: string;
    status: 'success' | 'error' | 'online' | 'offline';
    sync_mode: 'auto' | 'manual' | null;
    conflict_resolution?: 'suggest' | 'local-wins' | 'server-wins' | 'interactive' | null;
    error_message: string | null;
  }[]>([]);
  const [loadingSync, setLoadingSync] = useState(false);
  const [updatingConfig, setUpdatingConfig] = useState(false);
  const [triggeringSync, setTriggeringSync] = useState(false);
  const [syncLogs, setSyncLogs] = useState<string[] | null>(null);
  const [syncTriggerError, setSyncTriggerError] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<{
    stage: string;
    current: number;
    total: number;
    message: string;
  } | null>(null);

  const [customTokenDuration, setCustomTokenDuration] = useState('7d');
  const [generatedToken, setGeneratedToken] = useState<string | null>(() => {
    return localStorage.getItem('sync_agent_token');
  });

  const getExpirationText = (jwtString: string | null) => {
    if (!jwtString) return '';
    try {
      const parts = jwtString.split('.');
      if (parts.length !== 3) return '';
      const payload = JSON.parse(atob(parts[1]));
      if (!payload || !payload.exp) return '';
      
      const expDate = new Date(payload.exp * 1000);
      const remainingMs = expDate.getTime() - Date.now();
      
      if (remainingMs <= 0) {
        return lang === 'en' ? '⚠️ Token expired!' : '⚠️ Токен истек!';
      }
      
      const days = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
      const hours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      
      const timeStr = lang === 'en'
        ? `🕒 Expires: ${expDate.toLocaleDateString()} (remains: ${days > 0 ? `${days}d ` : ''}${hours}h)`
        : `🕒 Истекает: ${expDate.toLocaleDateString()} (осталось: ${days > 0 ? `${days}д ` : ''}${hours}ч)`;
        
      return timeStr;
    } catch (e) {
      return '';
    }
  };

  const handleTriggerReindex = async () => {
    try {
      setReindexing(true);
      setReindexProgress(null);
      setReindexStatus({
        type: 'info',
        message: lang === 'en' ? 'Starting search database reindexing...' : 'Запуск переиндексации поиска...'
      });

      const res = await fetch('/api/sync/reindex-embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!res.ok) {
        const data = await res.json();
        setReindexStatus({
          type: 'error',
          message: data.error || (lang === 'en' ? 'Reindexing failed' : 'Ошибка запуска переиндексации')
        });
        setReindexing(false);
      }
    } catch (err) {
      setReindexStatus({
        type: 'error',
        message: lang === 'en' ? 'Network error' : 'Сетевая ошибка'
      });
      setReindexing(false);
    }
  };

  useEffect(() => {
    if (socket) {
      const handleProgress = (data: any) => {
        if (currentUser && data.username === currentUser.username) {
          setSyncProgress({
            stage: data.stage,
            current: data.current,
            total: data.total,
            message: data.message
          });
          
          if (data.stage === 'done') {
            setTimeout(() => setSyncProgress(null), 4000);
          }
        }
      };

      const handleStatusChange = () => {
        fetchSyncStatuses();
      };

      const handleReindexProgress = (data: any) => {
        setReindexing(true);
        setReindexProgress({
          current: data.current,
          total: data.total,
          file: data.file
        });
        setReindexStatus({
          type: 'info',
          message: data.status === 'started'
            ? (lang === 'en' ? 'Initializing search index...' : 'Инициализация индекса поиска...')
            : `${lang === 'en' ? 'Indexing' : 'Индексация'}: ${data.file}`
        });
      };

      const handleReindexCompleted = (data: any) => {
        setReindexing(false);
        setReindexProgress(null);
        if (data.success) {
          setReindexStatus({
            type: 'success',
            message: lang === 'en'
              ? `Success! Updated/Created: ${data.successCount}, skipped: ${data.skipCount}.`
              : `Готово! Обновлено/Создано: ${data.successCount}, пропущено: ${data.skipCount}.`
          });
          setTimeout(() => setReindexStatus(null), 5000);
        } else {
          setReindexStatus({
            type: 'error',
            message: lang === 'en'
              ? `Search indexing failed: ${data.error}`
              : `Ошибка индексации поиска: ${data.error}`
          });
        }
      };

      socket.on('sync-server-progress', handleProgress);
      socket.on('sync-status-changed', handleStatusChange);
      socket.on('reindex-progress', handleReindexProgress);
      socket.on('reindex-completed', handleReindexCompleted);

      return () => {
        socket.off('sync-server-progress', handleProgress);
        socket.off('sync-status-changed', handleStatusChange);
        socket.off('reindex-progress', handleReindexProgress);
        socket.off('reindex-completed', handleReindexCompleted);
      };
    }
  }, [socket, currentUser, lang]);

  useEffect(() => {
    if (isOpen) {
      if (currentUser.role === 'Admin') {
        fetchUsers();
        fetchMediaFiles();
        fetchTrashItems();
      }
      fetchSyncStatuses();
    }
  }, [isOpen, currentUser]);

  useEffect(() => {
    if (isOpen) {
      if (activeTab === 'users' && currentUser.role === 'Admin') {
        fetchUsers();
      } else if (activeTab === 'media' && currentUser.role === 'Admin') {
        fetchMediaFiles();
      } else if (activeTab === 'sync') {
        fetchSyncStatuses();
      } else if (activeTab === 'trash' && currentUser.role === 'Admin') {
        fetchTrashItems();
      }
    }
  }, [activeTab, isOpen]);

  const handleGenerateCustomToken = async () => {
    try {
      const res = await fetch('/api/auth/generate-custom-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ expiresIn: customTokenDuration })
      });
      const data = await res.json();
      if (res.ok) {
        setGeneratedToken(data.token);
        localStorage.setItem('sync_agent_token', data.token);
        alert(t('sync_generate_success', lang));
      } else {
        alert(data.error || t('sync_generate_failed', lang));
      }
    } catch (err) {
      console.error('Failed to generate custom token:', err);
      alert(t('sync_network_error', lang));
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/auth/users', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setUsers(data);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    }
  };

  const fetchTrashItems = async () => {
    setTrashLoading(true);
    try {
      const res = await fetch('/api/notes/trash', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTrashItems(data.trash || []);
      }
    } catch (err) {
      console.error('Failed to fetch trash list:', err);
    } finally {
      setTrashLoading(false);
    }
  };

  const handleRestoreTrashItem = async (id: number) => {
    try {
      const res = await fetch('/api/notes/trash/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ id })
      });
      if (res.ok) {
        setTrashStatus({ type: 'success', message: t('trash_restore_success', lang) });
        fetchTrashItems();
        onVaultReload();
        setTimeout(() => setTrashStatus(null), 3000);
      } else {
        const data = await res.json();
        setTrashStatus({ type: 'error', message: data.error || t('trash_restore_failed', lang) });
      }
    } catch (err) {
      setTrashStatus({ type: 'error', message: t('sync_network_error', lang) });
    }
  };

  const handlePurgeTrashItem = async (id: number, name: string) => {
    if (!confirm(t('trash_confirm_purge', lang, { name }))) return;
    try {
      const res = await fetch(`/api/notes/trash/purge/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchTrashItems();
      } else {
        setTrashStatus({ type: 'error', message: t('trash_purge_failed', lang) });
      }
    } catch (err) {
      setTrashStatus({ type: 'error', message: t('sync_network_error', lang) });
    }
  };

  const handleClearTrash = async () => {
    if (!confirm(t('trash_confirm_clear', lang))) return;
    try {
      const res = await fetch('/api/notes/trash/clear', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchTrashItems();
      } else {
        setTrashStatus({ type: 'error', message: t('trash_clear_failed', lang) });
      }
    } catch (err) {
      setTrashStatus({ type: 'error', message: t('sync_network_error', lang) });
    }
  };

  const fetchSyncStatuses = async () => {
    setLoadingSync(true);
    try {
      const res = await fetch('/api/sync/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setSyncStatuses(data.statuses || []);
      }
    } catch (err) {
      console.error('Failed to fetch sync statuses:', err);
    } finally {
      setLoadingSync(false);
    }
  };

  const handleUpdateConfig = async (syncMode: string, conflictResolution: string) => {
    setUpdatingConfig(true);
    try {
      const res = await fetch('/api/sync/update-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ syncMode, conflictResolution })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to update configuration');
      } else {
        await fetchSyncStatuses();
      }
    } catch (err) {
      console.error('Error updating config:', err);
      alert('Network error when updating configuration');
    } finally {
      setUpdatingConfig(false);
    }
  };

  const handleTriggerSync = async () => {
    setTriggeringSync(true);
    setSyncLogs(null);
    setSyncTriggerError(null);
    setSyncProgress(null);
    try {
      const res = await fetch('/api/sync/trigger', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setSyncLogs(data.logs || [lang === 'en' ? 'Synchronization completed successfully, but no logs are available.' : 'Синхронизация завершена успешно, но логи отсутствуют.']);
        fetchSyncStatuses();
      } else {
        setSyncTriggerError(data.error || (lang === 'en' ? 'Error starting synchronization.' : 'Ошибка при запуске синхронизации.'));
      }
    } catch (err: any) {
      console.error('Failed to trigger sync:', err);
      setSyncTriggerError(lang === 'en' ? 'Network error during synchronization command.' : 'Ошибка сети при отправке команды синхронизации.');
    } finally {
      setTriggeringSync(false);
    }
  };

  const fetchMediaFiles = async () => {
    setLoadingMedia(true);
    try {
      const res = await fetch('/api/notes/media', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setMediaFiles(data);
      } else {
        setMediaStatus({ type: 'error', message: data.error || (lang === 'en' ? 'Error loading media files' : 'Ошибка при загрузке медиафайлов') });
      }
    } catch (err) {
      console.error('Failed to fetch media files:', err);
      setMediaStatus({ type: 'error', message: lang === 'en' ? 'Network error during media files fetch' : 'Ошибка сети при получении медиафайлов' });
    } finally {
      setLoadingMedia(false);
    }
  };

  const handleDeleteMedia = async (filename: string) => {
    const confirmed = confirm(t('media_confirm_delete', lang, { name: filename }) + (lang === 'en' ? ' This action is irreversible and may break links in your notes.' : ' Это действие необратимо и может сломать ссылки на этот файл в ваших заметках.'));
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/notes/media/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setMediaStatus({ type: 'success', message: lang === 'en' ? `File "${filename}" deleted successfully` : `Файл "${filename}" успешно удален` });
        fetchMediaFiles();
      } else {
        setMediaStatus({ type: 'error', message: data.error || t('media_delete_failed', lang) });
      }
    } catch (err) {
      console.error('Failed to delete media file:', err);
      setMediaStatus({ type: 'error', message: lang === 'en' ? 'Network error during file deletion' : 'Ошибка сети при удалении файла' });
    }
  };

  const handleBulkDeleteMedia = async () => {
    if (selectedMediaFiles.length === 0) return;
    
    const confirmed = confirm(
      lang === 'en'
        ? `Are you sure you want to delete ${selectedMediaFiles.length} selected files?\nThis action is irreversible and may break links in your notes.`
        : `Вы действительно хотите удалить ${selectedMediaFiles.length} выбранных файлов?\nЭто действие необратимо и может сломать ссылки на эти файлы в ваших заметках.`
    );
    if (!confirmed) return;

    try {
      const res = await fetch('/api/notes/media-bulk-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ filenames: selectedMediaFiles })
      });
      const data = await res.json();
      if (res.ok) {
        setMediaStatus({
          type: 'success',
          message: lang === 'en'
            ? `Successfully deleted ${data.deleted?.length || 0} files.`
            : `Успешно удалено ${data.deleted?.length || 0} файлов.`
        });
        setSelectedMediaFiles([]);
        fetchMediaFiles();
      } else {
        setMediaStatus({ type: 'error', message: data.error || (lang === 'en' ? 'Bulk deletion failed' : 'Сбой массового удаления') });
      }
    } catch (err) {
      console.error('Failed to perform bulk media deletion:', err);
      setMediaStatus({
        type: 'error',
        message: lang === 'en' ? 'Network error during bulk deletion' : 'Ошибка сети при массовом удалении'
      });
    }
  };



  const filteredMediaFiles = mediaFiles.filter((file) => {
    const matchesSearch = file.filename.toLowerCase().includes(mediaSearchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (mediaTypeFilter === 'all') return true;

    const ext = file.filename.split('.').pop()?.toLowerCase() || '';
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext);
    const isVideo = ['mp4', 'webm', 'ogg', 'mov', 'm4v', '3gp'].includes(ext);

    if (mediaTypeFilter === 'images') return isImage;
    if (mediaTypeFilter === 'videos') return isVideo;
    if (mediaTypeFilter === 'unused') return !file.isReferenced;
    if (mediaTypeFilter === 'others') return !isImage && !isVideo;

    return true;
  });

  if (!isOpen) return null;

  // Handle ZIP import
  const handleZipImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!zipFile) return;

    if (overwrite) {
      const confirmed = confirm(
        lang === 'en'
          ? 'WARNING! You selected the "Overwrite all" option. This will PERMANENTLY delete all your current markdown files and folders on the server before extracting the archive. Continue?'
          : 'ВНИМАНИЕ! Вы выбрали опцию "Перезаписать все". Это БЕЗВОЗВРАТНО удалит все ваши текущие markdown-файлы и папки с ними на сервере перед распаковкой архива. Продолжить?'
      );
      if (!confirmed) return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadProgressBytes({ loaded: 0, total: zipFile.size });
    setUploadStatus({ type: 'info', message: lang === 'en' ? 'Preparing archive for upload...' : 'Подготовка к загрузке архива...' });

    try {
      const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB chunks
      const totalSize = zipFile.size;
      const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);
      const uploadId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

      let uploadedBytesPrevChunks = 0;

      // Helper function to upload a single chunk using XHR
      const uploadChunk = (
        file: File,
        start: number,
        end: number,
        chunkIndex: number
      ): Promise<void> => {
        return new Promise((resolvePromise, rejectPromise) => {
          const xhr = new XMLHttpRequest();
          const chunk = file.slice(start, end);

          xhr.open('POST', '/api/notes/import-chunk', true);

          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          xhr.setRequestHeader('Content-Type', 'application/octet-stream');
          xhr.setRequestHeader('x-chunk-index', chunkIndex.toString());
          xhr.setRequestHeader('x-total-chunks', totalChunks.toString());
          xhr.setRequestHeader('x-upload-id', uploadId);
          xhr.setRequestHeader('x-overwrite', overwrite ? 'true' : 'false');
          xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));

          xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) {
              const currentLoaded = uploadedBytesPrevChunks + event.loaded;
              const pct = Math.min(99, Math.round((currentLoaded / totalSize) * 100));
              setUploadProgress(pct);
              setUploadProgressBytes({ loaded: currentLoaded, total: totalSize });
              setUploadStatus({
                type: 'info',
                message: lang === 'en'
                  ? `Uploading archive: ${pct}% (${(currentLoaded / (1024 * 1024)).toFixed(1)} MB of ${(totalSize / (1024 * 1024)).toFixed(1)} MB)...`
                  : `Загрузка архива: ${pct}% (${(currentLoaded / (1024 * 1024)).toFixed(1)} МБ из ${(totalSize / (1024 * 1024)).toFixed(1)} МБ)...`
              });
            }
          });

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolvePromise();
            } else {
              try {
                const res = JSON.parse(xhr.responseText);
                rejectPromise(new Error(res.error || (lang === 'en' ? `Server error: ${xhr.status}` : `Ошибка сервера: ${xhr.status}`)));
              } catch {
                rejectPromise(new Error(lang === 'en' ? `Server error: ${xhr.status}` : `Ошибка сервера: ${xhr.status}`));
              }
            }
          };

          xhr.onerror = () => rejectPromise(new Error(lang === 'en' ? 'Network error during chunk upload' : 'Сетевой сбой при отправке части файла'));
          xhr.onabort = () => rejectPromise(new Error(lang === 'en' ? 'Upload aborted' : 'Загрузка прервана'));

          xhr.send(chunk);
        });
      };

      // Upload chunks sequentially
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, totalSize);

        if (i === totalChunks - 1) {
          // For the last chunk, update message in advance since server processing takes time
          setUploadStatus({
            type: 'info',
            message: lang === 'en' ? 'Upload complete! Server is extracting and indexing files (this may take some time)...' : 'Загрузка завершена! Сервер распаковывает и индексирует файлы (это может занять некоторое время)...'
          });
        }

        await uploadChunk(zipFile, start, end, i);
        uploadedBytesPrevChunks += (end - start);
      }

      // Success
      setUploadProgress(100);
      setUploadProgressBytes({ loaded: totalSize, total: totalSize });
      setUploadStatus({ type: 'success', message: t('settings_import_success', lang) });
      setZipFile(null);
      onVaultReload();
    } catch (err: any) {
      console.error(err);
      setUploadStatus({ 
        type: 'error', 
        message: err.message || t('settings_import_err_network', lang) 
      });
    } finally {
      setUploading(false);
    }
  };

  // Handle Single MD Upload
  const handleMdUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mdFile) return;

    setUploadStatus({ type: 'info', message: lang === 'en' ? 'Uploading MD document...' : 'Загрузка MD-документа...' });

    try {
      const content = await mdFile.text();
      // Calculate target relative path
      const targetPath = selectedParentFolder 
        ? `${selectedParentFolder}/${mdFile.name}` 
        : mdFile.name;

      const res = await fetch(`/api/notes/upload-md?relative_path=${encodeURIComponent(targetPath)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/markdown',
        },
        body: content,
      });

      const data = await res.json();
      if (res.ok) {
        setUploadStatus({ type: 'success', message: lang === 'en' ? `File "${mdFile.name}" uploaded successfully!` : `Файл "${mdFile.name}" успешно загружен!` });
        setMdFile(null);
        onVaultReload();
      } else {
        setUploadStatus({ type: 'error', message: data.error || (lang === 'en' ? 'Error uploading MD' : 'Ошибка при загрузке MD') });
      }
    } catch (err) {
      console.error(err);
      setUploadStatus({ type: 'error', message: lang === 'en' ? 'Network error during file upload' : 'Ошибка сети при загрузке файла' });
    } finally {
      setUploading(false);
    }
  };

  // Handle Create User
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) return;

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          role: newRole,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setUserStatus({ type: 'success', message: lang === 'en' ? `User "${newUsername}" successfully created!` : `Пользователь "${newUsername}" успешно создан!` });
        setNewUsername('');
        setNewPassword('');
        setNewRole('Viewer');
        fetchUsers();
      } else {
        setUserStatus({ type: 'error', message: data.error || (lang === 'en' ? 'Error creating user' : 'Ошибка создания пользователя') });
      }
    } catch (err) {
      console.error(err);
      setUserStatus({ type: 'error', message: lang === 'en' ? 'Network error during user creation' : 'Ошибка сети при создании пользователя' });
    }
  };

  // Handle inline edit functions
  const startEditing = (user: User) => {
    setEditingUserId(user.id);
    setEditUsername(user.username);
    setEditPassword('');
    setEditRole(user.role);
    setEditApproved(!!user.approved);
  };

  const handleSaveEdit = async (userId: number) => {
    try {
      const payload: any = {
        username: editUsername.trim(),
        role: editRole,
        approved: editApproved,
      };
      if (editPassword.trim()) {
        payload.password = editPassword;
      }

      const res = await fetch(`/api/auth/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        setEditingUserId(null);
        fetchUsers();
      } else {
        alert(data.error || (lang === 'en' ? 'Error saving changes' : 'Ошибка при сохранении изменений'));
      }
    } catch (err) {
      console.error(err);
      alert(lang === 'en' ? 'Network error during save' : 'Ошибка сети при сохранении изменений');
    }
  };

  const handleApproveUser = async (userId: number) => {
    try {
      const res = await fetch(`/api/auth/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ approved: true }),
      });

      const data = await res.json();
      if (res.ok) {
        fetchUsers();
      } else {
        alert(data.error || (lang === 'en' ? 'Error approving user' : 'Ошибка при одобрении пользователя'));
      }
    } catch (err) {
      console.error(err);
      alert(lang === 'en' ? 'Network error during user approval' : 'Ошибка сети при одобрении пользователя');
    }
  };

  // Handle Delete User
  const handleDeleteUser = async (userId: number, username: string) => {
    const confirmed = confirm(t('settings_users_confirm_delete', lang, { username }));
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/auth/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();
      if (res.ok) {
        fetchUsers();
      } else {
        alert(data.error || (lang === 'en' ? 'Error deleting user' : 'Ошибка при удалении пользователя'));
      }
    } catch (err) {
      console.error(err);
      alert(lang === 'en' ? 'Network error during user deletion' : 'Ошибка сети при удалении пользователя');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in select-none">
      <div className="relative w-full max-w-3xl h-[600px] max-h-[85vh] flex flex-col bg-background-panel border border-white/10 rounded-2xl overflow-hidden shadow-glass animate-scale-up">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-black/20">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center text-primary font-bold uppercase">
              ⚙️
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">{t('settings_header_title', lang)}</h2>
              <span className="text-[10px] text-text-disabled">{t('settings_header_subtitle', lang)}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/5 rounded-lg text-text-muted hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs switcher */}
        <div className="flex border-b border-white/5 bg-black/10 px-6 py-2 space-x-2 overflow-x-auto scrollbar-none flex-nowrap shrink-0">
          <button
            onClick={() => setActiveTab('general')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer shrink-0 ${
              activeTab === 'general' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{t('settings_tab_general', lang)}</span>
          </button>
          <button
            onClick={() => setActiveTab('import')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer shrink-0 ${
              activeTab === 'import' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{t('settings_tab_import', lang)}</span>
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer shrink-0 ${
              activeTab === 'users' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>{t('settings_tab_users', lang)}</span>
          </button>
          <button
            onClick={() => setActiveTab('media')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer shrink-0 ${
              activeTab === 'media' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
            }`}
          >
            <Image className="w-3.5 h-3.5" />
            <span>{t('settings_tab_media', lang)}</span>
          </button>
          <button
            onClick={() => setActiveTab('sync')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer shrink-0 ${
              activeTab === 'sync' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t('settings_tab_sync', lang)}</span>
          </button>
          {currentUser.role === 'Admin' && (
            <button
              onClick={() => setActiveTab('trash')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer shrink-0 ${
                activeTab === 'trash' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t('settings_tab_trash', lang)}</span>
            </button>
          )}
          <button
            onClick={() => setActiveTab('about')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer shrink-0 ${
              activeTab === 'about' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
            }`}
          >
            <Info className="w-3.5 h-3.5" />
            <span>{t('settings_tab_system', lang)}</span>
          </button>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'general' ? (
            <div className="space-y-6">
              {/* Language Settings Card */}
              <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/5 space-y-4">
                <div className="flex items-center space-x-2 text-primary">
                  <Globe className="w-5 h-5" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">{t('settings_tab_general', lang)}</h3>
                </div>
                
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-text-muted">
                    {t('settings_lang_label', lang)}
                  </label>
                  <select
                    value={lang}
                    onChange={(e) => onLangChange(e.target.value as Lang)}
                    className="w-full max-w-xs px-3 py-2 bg-black/45 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-primary/50 transition-colors"
                  >
                    <option value="en">{t('settings_lang_en', lang)}</option>
                    <option value="ru">{t('settings_lang_ru', lang)}</option>
                  </select>
                  <p className="text-[10px] text-text-disabled">
                    {t('settings_lang_hint', lang)}
                  </p>
                </div>
              </div>
            </div>
          ) : activeTab === 'import' ? (
            <div className="space-y-6">
              {uploadStatus && (
                <div className={`p-4 rounded-xl text-xs flex items-start space-x-2.5 border ${
                  uploadStatus.type === 'success' 
                    ? 'bg-green-500/10 border-green-500/20 text-green-400' 
                    : uploadStatus.type === 'error'
                    ? 'bg-red-500/10 border-red-500/20 text-red-400'
                    : 'bg-primary/10 border-primary/20 text-primary'
                }`}>
                  {uploadStatus.type === 'success' ? <Check className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                  <span>{uploadStatus.message}</span>
                </div>
              )}

              {/* ZIP Import Card */}
              <div className="p-5 bg-white/[0.02] border border-white/5 rounded-2xl space-y-4 text-left">
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1">{t('settings_import_zip_title', lang)}</h3>
                  <p className="text-[11px] text-text-muted">
                    {t('settings_import_zip_desc', lang)}
                  </p>
                </div>

                <form onSubmit={handleZipImport} className="space-y-4">
                  <div className="flex items-center space-x-3">
                    <input
                      type="file"
                      accept=".zip"
                      onChange={(e) => {
                        setUploadStatus(null);
                        setZipFile(e.target.files?.[0] || null);
                        setUploadProgress(0);
                        setUploadProgressBytes(null);
                      }}
                      className="hidden"
                      id="zip-upload-input"
                      disabled={uploading}
                    />
                    <label
                      htmlFor="zip-upload-input"
                      className={`px-4 py-2 border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-medium cursor-pointer transition-colors text-white ${
                        uploading ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                    >
                      {t('settings_import_zip_select', lang)}
                    </label>
                    <span className="text-xs text-text-muted truncate max-w-xs">
                      {zipFile ? zipFile.name : t('settings_import_zip_no_file', lang)}
                    </span>
                  </div>

                  {/* Mode Option Checkbox */}
                  <div className="flex items-center space-x-2.5 bg-black/20 p-3 rounded-lg border border-white/5">
                    <input
                      type="checkbox"
                      id="overwrite-vault-checkbox"
                      checked={overwrite}
                      onChange={(e) => setOverwrite(e.target.checked)}
                      disabled={uploading}
                      className="rounded bg-black/40 border-white/10 text-primary focus:ring-0 cursor-pointer"
                    />
                    <label htmlFor="overwrite-vault-checkbox" className="text-xs font-medium text-text cursor-pointer select-none">
                      {t('settings_import_zip_overwrite', lang)}
                    </label>
                  </div>

                  {overwrite ? (
                    <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 rounded-lg text-[10.5px] flex items-start space-x-2 animate-fade-in">
                      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-yellow-500" />
                      <span>
                        {t('settings_import_zip_warning_overwrite', lang)}
                      </span>
                    </div>
                  ) : (
                    <div className="p-3 bg-primary/10 border border-primary/20 text-primary rounded-lg text-[10.5px] flex items-start space-x-2 animate-fade-in">
                      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
                      <span>
                        {t('settings_import_zip_warning_merge', lang)}
                      </span>
                    </div>
                  )}

                  {uploading && uploadProgressBytes && (
                    <div className="space-y-2 bg-black/20 p-3 rounded-lg border border-white/5 animate-fade-in">
                      <div className="flex justify-between text-[10.5px]">
                        <span className="text-text-muted font-medium">
                          {uploadProgress < 100 
                            ? t('settings_import_zip_status_uploading', lang, { pct: uploadProgress }) 
                            : t('settings_import_zip_status_extracting', lang)}
                        </span>
                        <span className="text-white font-semibold">
                          {t('settings_import_zip_status_progress', lang, {
                            loaded: (uploadProgressBytes.loaded / (1024 * 1024)).toFixed(1),
                            total: (uploadProgressBytes.total / (1024 * 1024)).toFixed(1)
                          })}
                        </span>
                      </div>
                      <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                        <div 
                          className="bg-primary h-full rounded-full transition-all duration-300 shadow-[0_0_8px_rgba(147,51,234,0.5)]" 
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={!zipFile || uploading}
                    className="w-full py-2 bg-primary hover:bg-primary-hover active:scale-[0.98] text-white text-xs font-semibold rounded-lg flex items-center justify-center space-x-2 transition-all border border-primary/20 shadow-glow cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Upload className="w-4 h-4" />
                    <span>{t('settings_import_zip_btn', lang)}</span>
                  </button>
                </form>
              </div>

              {/* MD Upload Card */}
              <div className="p-5 bg-white/[0.02] border border-white/5 rounded-2xl space-y-4 text-left">
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1">{t('settings_import_md_title', lang)}</h3>
                  <p className="text-[11px] text-text-muted">
                    {t('settings_import_md_desc', lang)}
                  </p>
                </div>

                <form onSubmit={handleMdUpload} className="space-y-4">
                  <div className="flex items-center space-x-3">
                    <input
                      type="file"
                      accept=".md"
                      onChange={(e) => {
                        setUploadStatus(null);
                        setMdFile(e.target.files?.[0] || null);
                      }}
                      className="hidden"
                      id="md-upload-input"
                      disabled={uploading}
                    />
                    <label
                      htmlFor="md-upload-input"
                      className={`px-4 py-2 border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-medium cursor-pointer transition-colors text-white ${
                        uploading ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                    >
                      {t('settings_import_md_select', lang)}
                    </label>
                    <span className="text-xs text-text-muted truncate max-w-xs">
                      {mdFile ? mdFile.name : t('settings_import_md_no_file', lang)}
                    </span>
                  </div>

                  {/* Target Folder Info */}
                  <div className="flex items-center space-x-2 bg-black/20 p-2.5 rounded-lg border border-white/5 text-[10.5px]">
                    <FolderOpen className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-text-muted font-medium">
                      {t('settings_import_md_folder', lang, { folder: selectedParentFolder || (lang === 'en' ? 'Root' : 'Корень') })}
                    </span>
                  </div>

                  <button
                    type="submit"
                    disabled={!mdFile || uploading}
                    className="w-full py-2 bg-primary hover:bg-primary-hover active:scale-[0.98] text-white text-xs font-semibold rounded-lg flex items-center justify-center space-x-2 transition-all border border-primary/20 shadow-glow cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Upload className="w-4 h-4" />
                    <span>{t('settings_import_md_btn', lang)}</span>
                  </button>
                </form>
              </div>

            </div>
          ) : activeTab === 'users' ? (
            <div className="space-y-6 text-left">
              {userStatus && (
                <div className={`p-4 rounded-xl text-xs flex items-start space-x-2.5 border ${
                  userStatus.type === 'success' 
                    ? 'bg-green-500/10 border-green-500/20 text-green-400' 
                    : 'bg-red-500/10 border-red-500/20 text-red-400'
                }`}>
                  {userStatus.type === 'success' ? <Check className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                  <span>{userStatus.message}</span>
                </div>
              )}

              {/* Create User Form */}
              <div className="p-5 bg-white/[0.02] border border-white/5 rounded-2xl space-y-4">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">{t('settings_users_create_title', lang)}</h3>
                
                <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <input
                    type="text"
                    placeholder={t('settings_users_username_placeholder', lang)}
                    value={newUsername}
                    onChange={(e) => {
                      setUserStatus(null);
                      setNewUsername(e.target.value);
                    }}
                    className="w-full px-3 py-2 bg-black/30 border border-white/5 focus:border-primary/50 focus:outline-none rounded-lg text-xs text-white"
                    required
                  />
                  <input
                    type="password"
                    placeholder={t('settings_users_password_placeholder', lang)}
                    value={newPassword}
                    onChange={(e) => {
                      setUserStatus(null);
                      setNewPassword(e.target.value);
                    }}
                    className="w-full px-3 py-2 bg-black/30 border border-white/5 focus:border-primary/50 focus:outline-none rounded-lg text-xs text-white"
                    required
                  />
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as any)}
                    className="w-full px-3 py-2 bg-black/30 border border-white/5 focus:border-primary/50 focus:outline-none rounded-lg text-xs text-white cursor-pointer"
                  >
                    <option value="Viewer" className="bg-[#1e1e1e]">{t('settings_users_role_viewer', lang)}</option>
                    <option value="Editor" className="bg-[#1e1e1e]">{t('settings_users_role_editor', lang)}</option>
                    <option value="Admin" className="bg-[#1e1e1e]">{t('settings_users_role_admin', lang)}</option>
                  </select>
                  <button
                    type="submit"
                    className="w-full py-2 bg-primary hover:bg-primary-hover active:scale-[0.98] text-white text-xs font-semibold rounded-lg flex items-center justify-center space-x-1.5 transition-all border border-primary/20 shadow-glow cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>{t('settings_users_btn_add', lang)}</span>
                  </button>
                </form>
              </div>

              {/* Users List Table */}
              <div className="bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden">
                <div className="px-5 py-3 border-b border-white/5 bg-black/10">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">{t('settings_users_list_title', lang)}</h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-white/5 text-text-disabled bg-black/5">
                        <th className="px-5 py-3 font-semibold">{t('settings_users_th_username', lang)}</th>
                        <th className="px-5 py-3 font-semibold">{t('settings_users_th_role', lang)}</th>
                        <th className="px-5 py-3 font-semibold">{t('settings_users_th_date', lang)}</th>
                        <th className="px-5 py-3 font-semibold">{t('settings_users_th_status', lang)}</th>
                        <th className="px-5 py-3 font-semibold text-right">{t('settings_users_th_actions', lang)}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {users.map((user) => {
                        const isSelf = user.username === currentUser.username;
                        const isEditing = editingUserId === user.id;

                        if (isEditing) {
                          return (
                            <tr key={user.id} className="bg-white/[0.02] border-l-2 border-primary animate-fade-in">
                              <td className="px-5 py-3">
                                <input
                                  type="text"
                                  value={editUsername}
                                  onChange={(e) => setEditUsername(e.target.value)}
                                  disabled={isSelf}
                                  className="w-full px-2 py-1 bg-black/40 border border-white/10 rounded focus:outline-none focus:border-primary/50 text-xs text-white disabled:opacity-50"
                                />
                              </td>
                              <td className="px-5 py-3">
                                <select
                                  value={editRole}
                                  disabled={isSelf}
                                  onChange={(e) => setEditRole(e.target.value as any)}
                                  className="w-full px-2 py-1 bg-black/40 border border-white/10 rounded focus:outline-none focus:border-primary/50 text-xs text-white disabled:opacity-50 cursor-pointer"
                                >
                                  <option value="Admin">Admin</option>
                                  <option value="Editor">Editor</option>
                                  <option value="Viewer">Viewer</option>
                                </select>
                              </td>
                              <td className="px-5 py-3">
                                <input
                                  type="password"
                                  placeholder={t('settings_users_edit_password_placeholder', lang)}
                                  value={editPassword}
                                  onChange={(e) => setEditPassword(e.target.value)}
                                  className="w-full px-2 py-1 bg-black/40 border border-white/10 rounded focus:outline-none focus:border-primary/50 text-xs text-white"
                                />
                              </td>
                              <td className="px-5 py-3">
                                <select
                                  value={editApproved ? "true" : "false"}
                                  disabled={isSelf}
                                  onChange={(e) => setEditApproved(e.target.value === "true")}
                                  className="w-full px-2 py-1 bg-black/40 border border-white/10 rounded focus:outline-none focus:border-primary/50 text-xs text-white disabled:opacity-50 cursor-pointer"
                                >
                                  <option value="true">{t('settings_users_status_active', lang)}</option>
                                  <option value="false">{t('settings_users_status_pending', lang)}</option>
                                </select>
                              </td>
                              <td className="px-5 py-3 text-right">
                                <div className="flex items-center justify-end space-x-1.5">
                                  <button
                                    onClick={() => handleSaveEdit(user.id)}
                                    className="p-1.5 hover:bg-green-500/20 text-green-400 rounded-lg transition-colors cursor-pointer"
                                    title={t('settings_users_tooltip_save', lang)}
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setEditingUserId(null)}
                                    className="p-1.5 hover:bg-white/10 text-text-disabled hover:text-white rounded-lg transition-colors cursor-pointer"
                                    title={t('settings_users_tooltip_cancel', lang)}
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        }

                        return (
                          <tr key={user.id} className="hover:bg-white/[0.01] animate-fade-in">
                            <td className="px-5 py-3 font-medium text-white truncate max-w-[120px]">
                              {user.username} {isSelf && <span className="text-[9px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full ml-1">{lang === 'en' ? 'You' : 'Вы'}</span>}
                            </td>
                            <td className="px-5 py-3 text-text-muted">
                              {user.role}
                            </td>
                            <td className="px-5 py-3 text-[11px] text-text-muted">
                              {formatToMoscowTime(user.created_at)}
                            </td>
                            <td className="px-5 py-3">
                              {user.approved ? (
                                <span className="text-[10px] bg-green-500/10 border border-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                                  {t('settings_users_status_active', lang)}
                                </span>
                              ) : (
                                <span className="text-[10px] bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 px-2 py-0.5 rounded-full">
                                  {t('settings_users_status_pending', lang)}
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3 text-right">
                              <div className="flex items-center justify-end space-x-1.5">
                                {!user.approved && (
                                  <button
                                    onClick={() => handleApproveUser(user.id)}
                                    className="p-1.5 hover:bg-green-500/20 text-green-400 rounded-lg transition-colors cursor-pointer"
                                    title={t('settings_users_tooltip_approve', lang)}
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  onClick={() => startEditing(user)}
                                  className="p-1.5 hover:bg-white/10 text-text-disabled hover:text-white rounded-lg transition-colors cursor-pointer"
                                  title={t('settings_users_tooltip_edit', lang)}
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteUser(user.id, user.username)}
                                  disabled={isSelf}
                                  className="p-1.5 hover:bg-red-500/20 text-text-disabled hover:text-red-400 rounded-lg transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
                                  title={isSelf ? t('settings_users_tooltip_delete_self', lang) : t('settings_users_tooltip_delete', lang)}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          ) : activeTab === 'media' ? (
            <div className="space-y-6 text-left">
              {mediaStatus && (
                <div className={`p-4 rounded-xl text-xs flex items-start space-x-2.5 border ${
                  mediaStatus.type === 'success' 
                    ? 'bg-green-500/10 border-green-500/20 text-green-400' 
                    : mediaStatus.type === 'error'
                    ? 'bg-red-500/10 border-red-500/20 text-red-400'
                    : 'bg-primary/10 border-primary/20 text-primary'
                }`}>
                  {mediaStatus.type === 'success' ? <Check className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                  <span>{mediaStatus.message}</span>
                </div>
              )}

              {/* Toolbar: Search input & Bulk Actions */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/[0.02] border border-white/5 p-4 rounded-2xl">
                <div className="flex flex-1 items-center gap-3 max-w-md">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-disabled" />
                    <input
                      type="text"
                      placeholder={t('settings_media_search_placeholder', lang)}
                      value={mediaSearchQuery}
                      onChange={(e) => setMediaSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 bg-black/30 border border-white/5 focus:border-primary/50 focus:outline-none rounded-lg text-xs text-white"
                    />
                  </div>
                  {filteredMediaFiles.length > 0 && (
                    <label className="flex items-center space-x-2 text-xs text-text-muted cursor-pointer hover:text-white shrink-0 select-none">
                      <input 
                        type="checkbox"
                        checked={filteredMediaFiles.length > 0 && filteredMediaFiles.every(f => selectedMediaFiles.includes(f.filename))}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedMediaFiles(filteredMediaFiles.map(f => f.filename));
                          } else {
                            setSelectedMediaFiles([]);
                          }
                        }}
                        className="rounded border-white/10 bg-black/40 text-primary focus:ring-0 focus:ring-offset-0 cursor-pointer"
                      />
                      <span>{lang === 'en' ? 'Select All' : 'Выбрать все'}</span>
                    </label>
                  )}
                </div>

                <div className="flex items-center gap-4 justify-between sm:justify-end">
                  {selectedMediaFiles.length > 0 && (
                    <button
                      type="button"
                      onClick={handleBulkDeleteMedia}
                      className="px-3.5 py-1.5 bg-red-500/20 hover:bg-red-500 text-red-200 hover:text-white border border-red-500/30 hover:border-red-500 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer hover:scale-[1.01] active:scale-95 shadow-glow"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>
                        {lang === 'en' 
                          ? `Delete Selected (${selectedMediaFiles.length})` 
                          : `Удалить выбранные (${selectedMediaFiles.length})`}
                      </span>
                    </button>
                  )}
                  <div className="text-xs text-text-muted shrink-0">
                    {t('settings_media_total_files', lang, { count: filteredMediaFiles.length })}
                    {selectedMediaFiles.length > 0 && (
                      <span className="text-primary ml-1.5">
                        ({lang === 'en' ? `selected ${selectedMediaFiles.length}` : `выбрано ${selectedMediaFiles.length}`})
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Category Filters */}
              <div className="flex flex-wrap items-center gap-2 bg-white/[0.01] border border-white/5 p-3 rounded-2xl">
                <button
                  type="button"
                  onClick={() => setMediaTypeFilter('all')}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                    mediaTypeFilter === 'all'
                      ? 'bg-primary text-white border border-primary/20 shadow-glow'
                      : 'bg-white/[0.02] text-text-muted hover:text-white border border-white/5'
                  }`}
                >
                  {t('settings_media_filter_all', lang, { count: mediaFiles.length })}
                </button>
                <button
                  type="button"
                  onClick={() => setMediaTypeFilter('images')}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                    mediaTypeFilter === 'images'
                      ? 'bg-primary text-white border border-primary/20 shadow-glow'
                      : 'bg-white/[0.02] text-text-muted hover:text-white border border-white/5'
                  }`}
                >
                  {t('settings_media_filter_images', lang, {
                    count: mediaFiles.filter(f => ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(f.filename.split('.').pop()?.toLowerCase() || '')).length
                  })}
                </button>
                <button
                  type="button"
                  onClick={() => setMediaTypeFilter('videos')}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                    mediaTypeFilter === 'videos'
                      ? 'bg-primary text-white border border-primary/20 shadow-glow'
                      : 'bg-white/[0.02] text-text-muted hover:text-white border border-white/5'
                  }`}
                >
                  {t('settings_media_filter_videos', lang, {
                    count: mediaFiles.filter(f => ['mp4', 'webm', 'ogg', 'mov', 'm4v', '3gp'].includes(f.filename.split('.').pop()?.toLowerCase() || '')).length
                  })}
                </button>
                <button
                  type="button"
                  onClick={() => setMediaTypeFilter('unused')}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                    mediaTypeFilter === 'unused'
                      ? 'bg-primary text-white border border-primary/20 shadow-glow'
                      : 'bg-white/[0.02] text-text-muted hover:text-white border border-white/5'
                  }`}
                >
                  {lang === 'en' ? 'Unreferenced' : 'Непривязанные'} ({mediaFiles.filter(f => !f.isReferenced).length})
                </button>
                <button
                  type="button"
                  onClick={() => setMediaTypeFilter('others')}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                    mediaTypeFilter === 'others'
                      ? 'bg-primary text-white border border-primary/20 shadow-glow'
                      : 'bg-white/[0.02] text-text-muted hover:text-white border border-white/5'
                  }`}
                >
                  {t('settings_media_filter_others', lang, {
                    count: mediaFiles.filter(f => {
                      const ext = f.filename.split('.').pop()?.toLowerCase() || '';
                      return !['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext) &&
                             !['mp4', 'webm', 'ogg', 'mov', 'm4v', '3gp'].includes(ext);
                    }).length
                  })}
                </button>
              </div>

              {/* Media Grid */}
              {loadingMedia ? (
                <div className="text-center py-12 text-text-muted text-xs">
                  {t('settings_media_loading', lang)}
                </div>
              ) : filteredMediaFiles.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-white/10 rounded-2xl text-text-muted text-xs">
                  {mediaSearchQuery ? t('settings_media_no_files_found', lang) : t('settings_media_empty', lang)}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 animate-fade-in">
                  {filteredMediaFiles.map((file) => (
                    <MediaCard
                      key={file.filename}
                      file={file}
                      token={token}
                      lang={lang}
                      onDeleteMedia={handleDeleteMedia}
                      isSelected={selectedMediaFiles.includes(file.filename)}
                      onToggleSelect={(filename) => {
                        setSelectedMediaFiles(prev => 
                          prev.includes(filename) 
                            ? prev.filter(name => name !== filename) 
                            : [...prev, filename]
                        );
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : activeTab === 'sync' ? (
            <div className="space-y-6 text-left animate-fade-in select-none">
              {/* Info card */}
              <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/5 space-y-3">
                <div className="flex items-center space-x-2.5">
                  <div className="w-9 h-9 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center text-primary text-lg">
                    🔄
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">{t('settings_sync_title', lang)}</h3>
                    <p className="text-[10px] text-text-muted">{t('settings_sync_subtitle', lang)}</p>
                  </div>
                </div>
                <p className="text-xs text-text-muted leading-relaxed">
                  {t('settings_sync_desc', lang)}
                </p>
              </div>

              {/* API Token Copy Card */}
              <div className="p-4 bg-white/[0.01] border border-white/5 rounded-xl space-y-3">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">{t('settings_sync_token_title', lang)}</h4>
                <p className="text-[10px] text-text-muted">
                  {t('settings_sync_token_desc', lang)}
                </p>
                <div className="flex items-center space-x-2">
                  <input
                    type="password"
                    readOnly
                    value={generatedToken || token || ''}
                    className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono text-text-muted focus:outline-none"
                    id="sync-token-input"
                  />
                  <button
                    onClick={() => {
                      const tVal = generatedToken || token;
                      if (tVal) {
                        navigator.clipboard.writeText(tVal);
                        alert(t('sync_copy_success', lang));
                      }
                    }}
                    className="px-3 py-1.5 bg-primary hover:bg-primary/80 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    {t('settings_sync_btn_copy', lang)}
                  </button>
                </div>
                {(generatedToken || token) && (
                  <div className="text-[9px] text-text-muted mt-1 px-1">
                    {getExpirationText(generatedToken || token)}
                  </div>
                )}
                
                <div className="flex items-center space-x-2 pt-2 border-t border-white/5">
                  <span className="text-[10px] text-text-muted">{t('settings_sync_token_lifespan', lang)}</span>
                  <select
                    value={customTokenDuration}
                    onChange={(e) => setCustomTokenDuration(e.target.value)}
                    className="bg-black/40 border border-white/10 rounded px-2 py-1 text-[10px] text-white focus:outline-none"
                  >
                    <option value="1d">{t('sync_token_days_1', lang)}</option>
                    <option value="7d">{t('sync_token_days_7', lang)}</option>
                    <option value="30d">{t('sync_token_days_30', lang)}</option>
                    <option value="90d">{t('sync_token_days_90', lang)}</option>
                    <option value="3650d">{t('sync_token_days_infinite', lang)}</option>
                  </select>
                  <button
                    onClick={handleGenerateCustomToken}
                    className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-[10px] font-semibold rounded transition-colors cursor-pointer"
                  >
                    {t('settings_sync_btn_generate', lang)}
                  </button>
                </div>
              </div>

              {/* Status and logs */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">{t('settings_sync_devices_title', lang)}</h4>
                  <button 
                    onClick={fetchSyncStatuses}
                    className="p-1 hover:bg-white/5 rounded transition-colors text-text-muted hover:text-white cursor-pointer"
                    title={lang === 'en' ? 'Refresh' : 'Обновить'}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingSync ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {loadingSync && syncStatuses.length === 0 ? (
                  <p className="text-xs text-text-muted italic">{t('settings_sync_loading', lang)}</p>
                ) : syncStatuses.length === 0 ? (
                  <div className="p-4 bg-white/[0.01] border border-white/5 rounded-xl text-center">
                    <p className="text-xs text-text-disabled">{t('settings_sync_no_agents', lang)}</p>
                    <p className="text-[10px] text-text-muted mt-1">{t('settings_sync_run_agent_hint', lang)}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {syncStatuses.map((status) => (
                      <div key={status.user_id} className="p-4 bg-white/[0.01] border border-white/5 rounded-xl space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className="text-xs font-bold text-white">{status.device_name}</span>
                            <span className="text-[10px] text-text-muted">({status.username})</span>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            status.status === 'success' || status.status === 'online'
                              ? 'bg-green-500/10 text-green-400 border border-green-500/20' 
                              : status.status === 'offline'
                              ? 'bg-white/5 text-text-muted border border-white/10'
                              : 'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}>
                            {status.status === 'success' 
                              ? t('settings_sync_status_synced', lang) 
                              : status.status === 'online'
                              ? t('settings_sync_status_connected', lang)
                              : status.status === 'offline'
                              ? t('settings_sync_status_offline', lang)
                              : t('settings_sync_status_error', lang)}
                          </span>
                        </div>
                        {status.status !== 'offline' ? (
                          <>
                            <div className="grid grid-cols-2 gap-3 p-3 bg-white/[0.02] border border-white/5 rounded-lg text-[10px] text-left">
                              <div className="space-y-1">
                                <label className="text-text-muted font-medium block">{t('settings_sync_mode_select_label', lang)}</label>
                                <select
                                  value={status.sync_mode || 'manual'}
                                  disabled={updatingConfig || triggeringSync}
                                  onChange={(e) => handleUpdateConfig(e.target.value, status.conflict_resolution || 'suggest')}
                                  className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-white text-[10px] focus:outline-none focus:border-primary transition-colors cursor-pointer"
                                >
                                  <option value="manual">{t('settings_sync_mode_manual', lang)}</option>
                                  <option value="auto">{t('settings_sync_mode_auto', lang)}</option>
                                </select>
                              </div>
                              <div className="space-y-1">
                                <label className="text-text-muted font-medium block">{t('settings_sync_conflict_resolution_label', lang)}</label>
                                <select
                                  value={status.conflict_resolution || 'suggest'}
                                  disabled={updatingConfig || triggeringSync}
                                  onChange={(e) => handleUpdateConfig(status.sync_mode || 'manual', e.target.value)}
                                  className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-white text-[10px] focus:outline-none focus:border-primary transition-colors cursor-pointer"
                                >
                                  <option value="suggest">{t('settings_sync_strategy_suggest', lang)}</option>
                                  <option value="local-wins">{t('settings_sync_strategy_local_wins', lang)}</option>
                                  <option value="server-wins">{t('settings_sync_strategy_server_wins', lang)}</option>
                                  <option value="interactive">{t('settings_sync_strategy_interactive', lang)}</option>
                                </select>
                              </div>
                            </div>
                            <div className="text-[9px] text-text-disabled text-right pr-1">
                              {t('settings_sync_activity_label', lang, { time: formatToMoscowTime(status.last_sync_at) })}
                            </div>
                          </>
                        ) : (
                          <div className="flex justify-between items-center text-[10px] text-text-disabled">
                            <span>{t('settings_sync_mode_label', lang, { mode: status.sync_mode === 'auto' ? t('settings_sync_mode_auto', lang) : t('settings_sync_mode_manual', lang) })}</span>
                            <span>{t('settings_sync_activity_label', lang, { time: formatToMoscowTime(status.last_sync_at) })}</span>
                          </div>
                        )}
                        {status.error_message && (
                          <div className="p-2 rounded bg-red-500/5 border border-red-500/10 text-[10px] text-red-400 font-mono whitespace-pre-wrap break-all">
                            {t('settings_sync_error_label', lang, { error: status.error_message })}
                          </div>
                        )}

                        {status.status !== 'offline' && status.sync_mode === 'manual' && (
                          <button
                            onClick={handleTriggerSync}
                            disabled={triggeringSync}
                            className="w-full py-1.5 bg-primary hover:bg-primary/80 disabled:bg-primary/50 text-white rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${triggeringSync ? 'animate-spin' : ''}`} />
                            <span>{triggeringSync ? t('settings_sync_status_syncing', lang) : t('settings_sync_btn_sync_now', lang)}</span>
                          </button>
                        )}

                        {/* Progress Bar UI */}
                        {syncProgress && status.status !== 'offline' && (
                          <div className="mt-2.5 space-y-1.5 p-3 rounded-xl bg-black/30 border border-white/5 animate-fade-in text-left">
                            <div className="flex justify-between items-center text-[10px] text-text-muted">
                              <span className="font-semibold text-white truncate max-w-[170px]">{syncProgress.message}</span>
                              {syncProgress.total > 0 && (
                                <span>{syncProgress.current} / {syncProgress.total}</span>
                              )}
                            </div>
                            {syncProgress.total > 0 && (
                              <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-primary transition-all duration-300 rounded-full"
                                  style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }}
                                />
                              </div>
                            )}
                          </div>
                        )}
                        
                        {status.status === 'online' && status.sync_mode === 'auto' && (
                          <div className="p-2 rounded bg-green-500/5 border border-green-500/10 text-[10px] text-green-400 text-center">
                            {t('settings_sync_bg_active', lang)}
                          </div>
                        )}
                      </div>
                    ))}

                    {syncLogs && (
                      <div className="p-4 bg-black/40 border border-white/5 rounded-xl space-y-2 animate-fade-in text-left">
                        <h5 className="text-[11px] font-bold text-white uppercase tracking-wider">{t('settings_sync_logs_title', lang)}</h5>
                        <div className="max-h-40 overflow-y-auto font-mono text-[10px] text-text-muted space-y-1 scrollbar-thin">
                          {syncLogs.map((logLine, idx) => (
                            <div key={idx} className="whitespace-pre-wrap">{logLine}</div>
                          ))}
                        </div>
                      </div>
                    )}

                    {syncTriggerError && (
                      <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs flex items-start space-x-2 animate-fade-in text-left">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{syncTriggerError}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* AI Indexing Administration (Only for Admin) */}
              {currentUser.role === 'Admin' && (
                <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl space-y-3.5 text-left select-none">
                  <div className="flex items-center space-x-2 text-primary">
                    <Sparkles className="w-4 h-4" />
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                      {lang === 'en' ? 'Search Database Indexing' : 'Индексация системы поиска'}
                    </h4>
                  </div>
                  <p className="text-[11px] text-text-muted leading-relaxed">
                    {lang === 'en' 
                      ? 'Forces re-generation of all search indexes (both full-text FTS5 and semantic AI embeddings) for all documents. Use this if you update system exclusion folders or experience search inconsistencies.' 
                      : 'Принудительно перестраивает все поисковые индексы (как полнотекстовый FTS5, так и семантические эмбеддинги ИИ) для всех заметок. Используйте это при изменении системных папок-исключений или если поиск выдает неточные результаты.'}
                  </p>

                  {reindexStatus && (
                    <div className={`p-2.5 rounded-lg border text-[11px] flex items-center gap-2 ${
                      reindexStatus.type === 'success'
                        ? 'bg-green-500/10 border-green-500/20 text-green-400'
                        : reindexStatus.type === 'error'
                        ? 'bg-red-500/10 border-red-500/20 text-red-400'
                        : 'bg-primary/10 border-primary/20 text-primary-light'
                    }`}>
                      {reindexStatus.type === 'success' ? (
                        <CheckCheck className="w-3.5 h-3.5 shrink-0 text-green-400" />
                      ) : reindexStatus.type === 'error' ? (
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-400" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin text-primary" />
                      )}
                      <span className="truncate">{reindexStatus.message}</span>
                    </div>
                  )}

                  {reindexProgress && (
                    <div className="space-y-1.5 p-3 rounded-lg bg-black/35 border border-white/5 animate-fade-in">
                      <div className="flex justify-between items-center text-[10px] text-text-muted">
                        <span className="font-semibold text-white truncate max-w-[200px]">
                          {reindexProgress.file}
                        </span>
                        <span>{reindexProgress.current} / {reindexProgress.total}</span>
                      </div>
                      <div className="w-full h-1.5 bg-black/45 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary transition-all duration-300 rounded-full"
                          style={{ width: `${(reindexProgress.current / reindexProgress.total) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {!reindexing && (
                    <button
                      onClick={handleTriggerReindex}
                      className="px-3 py-1.5 bg-primary/20 hover:bg-primary/30 border border-primary/30 hover:border-primary/50 text-[11px] font-semibold text-primary-light hover:text-white rounded-lg transition-colors cursor-pointer inline-flex items-center space-x-1.5"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>{lang === 'en' ? 'Reindex Search Database Now' : 'Переиндексировать систему поиска'}</span>
                    </button>
                  )}
                </div>
              )}

              {/* Instructions */}
              <div className="p-4 bg-white/[0.01] border border-white/5 rounded-xl space-y-3">
                <h4 className="text-xs font-bold text-white">{t('settings_sync_how_to_run', lang)}</h4>
                <ol className="list-decimal list-inside space-y-2 text-xs text-text-muted">
                  <li>{t('settings_sync_step_1', lang)}</li>
                  <li>{t('settings_sync_step_2', lang)}</li>
                  <li>{t('settings_sync_step_3', lang)}</li>
                  <li>{t('settings_sync_step_4', lang)}</li>
                  <li>{t('settings_sync_step_5', lang)}</li>
                </ol>
              </div>
            </div>
          ) : activeTab === 'trash' && currentUser.role === 'Admin' ? (
            <div className="space-y-6 text-left animate-fade-in select-none">
              <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-primary">
                    <Trash2 className="w-5 h-5" />
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">{t('trash_title', lang)}</h3>
                  </div>
                  {trashItems.length > 0 && (
                    <button
                      onClick={handleClearTrash}
                      className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/50 rounded-lg text-xs font-semibold text-red-400 hover:text-red-300 transition-colors flex items-center space-x-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{t('trash_btn_clear_all', lang)}</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-text-muted">
                  {t('trash_desc', lang)}
                </p>

                {trashStatus && (
                  <div className={`p-3 rounded-xl border text-xs flex items-center space-x-2 ${
                    trashStatus.type === 'success' 
                      ? 'bg-green-500/10 border-green-500/20 text-green-400' 
                      : 'bg-red-500/10 border-red-500/20 text-red-400'
                  }`}>
                    {trashStatus.type === 'success' ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    <span>{trashStatus.message}</span>
                  </div>
                )}

                {trashLoading ? (
                  <div className="py-12 flex items-center justify-center text-xs text-text-muted space-x-2">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{t('trash_loading', lang)}</span>
                  </div>
                ) : trashItems.length === 0 ? (
                  <div className="py-12 flex flex-col items-center justify-center border border-dashed border-white/5 rounded-xl bg-black/10">
                    <Trash2 className="w-8 h-8 text-text-disabled mb-2 opacity-40" />
                    <span className="text-xs text-text-disabled">{t('trash_empty', lang)}</span>
                  </div>
                ) : (
                  <div className="border border-white/5 rounded-xl overflow-hidden bg-black/10">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-white/5 bg-white/[0.02] text-text-muted">
                            <th className="p-3 font-semibold">{t('trash_th_name', lang)}</th>
                            <th className="p-3 font-semibold">{t('trash_th_path', lang)}</th>
                            <th className="p-3 font-semibold">{t('trash_th_deleted_by', lang)}</th>
                            <th className="p-3 font-semibold">{t('trash_th_date', lang)}</th>
                            <th className="p-3 font-semibold text-right">{t('trash_th_actions', lang)}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {trashItems.map((item) => {
                            const fileName = item.relative_path.split('/').pop() || item.title;
                            return (
                              <tr key={item.id} className="hover:bg-white/[0.01] transition-colors">
                                <td className="p-3 text-white font-medium max-w-[150px] truncate" title={fileName}>
                                  {fileName}
                                </td>
                                <td className="p-3 text-text-muted font-mono max-w-[200px] truncate" title={item.relative_path}>
                                  {item.relative_path}
                                </td>
                                <td className="p-3">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                    item.deleted_by === 'admin' 
                                      ? 'bg-primary/20 text-primary border border-primary/30' 
                                      : item.deleted_by === 'Внешняя система'
                                      ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                                      : 'bg-white/10 text-white border border-white/10'
                                  }`}>
                                    {item.deleted_by === 'Внешняя система' ? t('system_external', lang) : item.deleted_by}
                                  </span>
                                </td>
                                <td className="p-3 text-text-muted">
                                  {formatToMoscowTime(item.deleted_at)}
                                </td>
                                <td className="p-3 text-right space-x-2 whitespace-nowrap">
                                  <button
                                    onClick={() => handleRestoreTrashItem(item.id)}
                                    className="px-2.5 py-1 bg-primary/20 hover:bg-primary/30 border border-primary/30 hover:border-primary/50 text-[11px] font-semibold text-primary-light hover:text-white rounded-lg transition-colors inline-flex items-center space-x-1 cursor-pointer"
                                  >
                                    <span>{t('trash_btn_restore', lang)}</span>
                                  </button>
                                  <button
                                    onClick={() => handlePurgeTrashItem(item.id, fileName)}
                                    className="p-1 hover:bg-red-500/10 border border-transparent hover:border-red-500/30 text-text-muted hover:text-red-400 rounded-lg transition-colors inline-flex items-center cursor-pointer"
                                    title={t('trash_btn_purge', lang)}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'about' ? (
            <div className="space-y-6 text-left animate-fade-in select-none">
              {/* About Platform info card */}
              <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/5 space-y-3">
                <div className="flex items-center space-x-2.5">
                  <div className="w-9 h-9 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center text-primary text-lg">
                    📚
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">StrataNote</h3>
                    <p className="text-[10px] text-text-muted">{t('settings_about_desc', lang)}</p>
                  </div>
                </div>
                <p className="text-xs text-text-muted leading-relaxed">
                  {t('system_intro_desc', lang)}
                </p>
              </div>

              {/* Version info details */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">{t('settings_build_info', lang)}</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-white/[0.01] border border-white/5 rounded-xl flex flex-col space-y-1">
                    <span className="text-[10px] text-text-disabled uppercase">{t('settings_installed_version', lang)}</span>
                    <span className="text-lg font-extrabold text-primary">v{versionInfo.version}</span>
                  </div>
                  <div className="p-4 bg-white/[0.01] border border-white/5 rounded-xl flex flex-col space-y-1">
                    <span className="text-[10px] text-text-disabled uppercase">{t('system_env', lang)}</span>
                    <span className="text-lg font-extrabold text-white">{versionInfo.env || 'Development'}</span>
                  </div>
                </div>
              </div>

              {/* Software Update Checker Box */}
              <div className="p-4 rounded-xl bg-white/[0.01] border border-white/5 space-y-3.5">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                      {lang === 'ru' ? 'Обновление ПО' : 'Software Update'}
                    </h4>
                    <p className="text-[10px] text-text-muted">
                      {isCheckingUpdates 
                        ? t('system_update_checking', lang) 
                        : versionInfo.updateAvailable 
                          ? t('system_update_available', lang, { version: versionInfo.latestVersion || '' })
                          : t('system_update_up_to_date', lang)
                      }
                    </p>
                  </div>
                  <button
                    onClick={handleManualCheck}
                    disabled={isCheckingUpdates}
                    className="px-3 py-1.5 bg-primary/20 hover:bg-primary/35 disabled:opacity-50 text-primary text-xs font-bold rounded-lg border border-primary/35 flex items-center space-x-1.5 transition-all cursor-pointer select-none active:scale-[0.98]"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isCheckingUpdates ? 'animate-spin' : ''}`} />
                    <span>{t('system_update_btn_check', lang)}</span>
                  </button>
                </div>

                {updateCheckError && (
                  <div className="text-[10px] text-red-400 flex items-center space-x-1">
                    <span>⚠️</span>
                    <span>{t('system_update_failed', lang)}: {updateCheckError}</span>
                  </div>
                )}
                
                {versionInfo.updateError && !updateCheckError && (
                  <div className="text-[10px] text-red-400 flex items-center space-x-1">
                    <span>⚠️</span>
                    <span>{t('system_update_failed', lang)}: {versionInfo.updateError}</span>
                  </div>
                )}

                {/* Last checked timestamp */}
                {versionInfo.updateCheckedAt && (
                  <div className="text-[9px] text-text-disabled">
                    {lang === 'ru' ? 'Последняя проверка:' : 'Last checked:'} {new Date(versionInfo.updateCheckedAt).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')}
                  </div>
                )}

                {/* Action card if update is available */}
                {versionInfo.updateAvailable && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/25 rounded-lg flex items-start space-x-2 text-amber-200 animate-fade-in">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <p className="text-[10px] leading-relaxed">
                        {lang === 'ru'
                          ? `Доступна новая сборка v${versionInfo.latestVersion}. Вы можете обновиться на GitHub.`
                          : `New build v${versionInfo.latestVersion} is available. You can update it on GitHub.`}
                      </p>
                      <a
                        href={versionInfo.latestReleaseUrl || "https://github.com/cannoneer85-svg/stratanote"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center space-x-1 text-[10px] font-bold text-amber-400 hover:text-amber-300 hover:underline cursor-pointer no-underline pt-0.5"
                      >
                        <span>{t('system_update_download', lang)}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                )}
              </div>

              {/* Release Timeline */}
              <div className="space-y-4 pt-2">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">{t('system_history_title', lang)}</h4>
                {versionInfo.history.length === 0 ? (
                  <p className="text-xs text-text-disabled italic py-2">{t('system_no_history', lang)}</p>
                ) : (
                  <div className="relative pl-5 border-l border-white/5 space-y-6 py-1">
                    {versionInfo.history.map((release) => {
                      const releaseTitle = lang === 'en' 
                        ? (release.title_en || release.title || '') 
                        : (release.title_ru || release.title || '');
                      const releaseKeynotes = lang === 'en' 
                        ? (release.keynotes_en || release.keynotes || []) 
                        : (release.keynotes_ru || release.keynotes || []);

                      return (
                        <div key={release.version} className="relative">
                          {/* Timeline dot */}
                          <span className="absolute -left-[27px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background-panel border-2 border-primary shrink-0">
                            <span className="h-1 w-1 rounded-full bg-primary" />
                          </span>
                          
                          <div className="space-y-1.5">
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-bold text-white">v{release.version}</span>
                              <span className="text-[10px] text-text-muted">({release.date})</span>
                              {releaseTitle && (
                                <span className="text-[10px] text-primary font-medium">— {releaseTitle}</span>
                              )}
                            </div>
                            
                            {releaseKeynotes && releaseKeynotes.length > 0 && (
                              <ul className="space-y-1 pl-1">
                                {releaseKeynotes.map((note, nIdx) => (
                                  <li key={nIdx} className="flex items-start text-[11px] text-text-muted">
                                    <span className="text-primary mr-1.5">•</span>
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
          ) : null}
        </div>

        {/* Footer info bar */}
        <div className="px-6 py-2.5 border-t border-white/5 bg-black/20 text-[10px] text-text-disabled text-right">
          <span>{t('settings_role_label', lang)}: <strong>{currentUser.role === 'Admin' ? t('settings_role_admin', lang) : currentUser.role === 'Editor' ? t('settings_role_editor', lang) : t('settings_role_viewer', lang)}</strong></span>
        </div>

      </div>
    </div>
  );
};
