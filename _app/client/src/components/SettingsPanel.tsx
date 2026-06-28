import React, { useState, useEffect } from 'react';
import { X, Upload, UserPlus, Trash2, AlertTriangle, Check, Users, ShieldAlert, FolderOpen, Edit2, Image, Search, Info } from 'lucide-react';
import { formatToMoscowTime } from '../utils/date';

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
      title: string;
      keynotes: string[];
    }>;
    env?: string;
  };
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
  currentUser,
  selectedParentFolder,
  token,
  onVaultReload,
  versionInfo = { version: '1.0.0', history: [], env: 'Development' }
}) => {
  const [activeTab, setActiveTab] = useState<'import' | 'users' | 'media' | 'about'>('import');
  
  // ZIP / MD Upload State
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [mdFile, setMdFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
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
  const [mediaFiles, setMediaFiles] = useState<{ filename: string; size: number; updatedAt: string }[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [mediaSearchQuery, setMediaSearchQuery] = useState('');
  const [mediaStatus, setMediaStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  useEffect(() => {
    if (isOpen && currentUser.role === 'Admin') {
      fetchUsers();
      fetchMediaFiles();
    }
  }, [isOpen, currentUser]);

  useEffect(() => {
    if (isOpen && currentUser.role === 'Admin') {
      if (activeTab === 'users') {
        fetchUsers();
      } else if (activeTab === 'media') {
        fetchMediaFiles();
      }
    }
  }, [activeTab]);

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
        setMediaStatus({ type: 'error', message: data.error || 'Ошибка при загрузке медиафайлов' });
      }
    } catch (err) {
      console.error('Failed to fetch media files:', err);
      setMediaStatus({ type: 'error', message: 'Ошибка сети при получении медиафайлов' });
    } finally {
      setLoadingMedia(false);
    }
  };

  const handleDeleteMedia = async (filename: string) => {
    const confirmed = confirm(`Вы уверены, что хотите удалить файл "${filename}"? Это действие необратимо и может сломать ссылки на этот файл в ваших заметках.`);
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/notes/media/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setMediaStatus({ type: 'success', message: `Файл "${filename}" успешно удален` });
        fetchMediaFiles();
      } else {
        setMediaStatus({ type: 'error', message: data.error || 'Не удалось удалить файл' });
      }
    } catch (err) {
      console.error('Failed to delete media file:', err);
      setMediaStatus({ type: 'error', message: 'Ошибка сети при удалении файла' });
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const filteredMediaFiles = mediaFiles.filter((file) =>
    file.filename.toLowerCase().includes(mediaSearchQuery.toLowerCase())
  );

  if (!isOpen) return null;

  // Handle ZIP import
  const handleZipImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!zipFile) return;

    if (overwrite) {
      const confirmed = confirm(
        'ВНИМАНИЕ! Вы выбрали опцию "Перезаписать все". Это БЕЗВОЗВРАТНО удалит все ваши текущие markdown-файлы и папки с ними на сервере перед распаковкой архива. Продолжить?'
      );
      if (!confirmed) return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadProgressBytes({ loaded: 0, total: zipFile.size });
    setUploadStatus({ type: 'info', message: 'Подготовка к загрузке архива...' });

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
                message: `Загрузка архива: ${pct}% (${(currentLoaded / (1024 * 1024)).toFixed(1)} МБ из ${(totalSize / (1024 * 1024)).toFixed(1)} МБ)...`
              });
            }
          });

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolvePromise();
            } else {
              try {
                const res = JSON.parse(xhr.responseText);
                rejectPromise(new Error(res.error || `Ошибка сервера: ${xhr.status}`));
              } catch {
                rejectPromise(new Error(`Ошибка сервера: ${xhr.status}`));
              }
            }
          };

          xhr.onerror = () => rejectPromise(new Error('Сетевой сбой при отправке части файла'));
          xhr.onabort = () => rejectPromise(new Error('Загрузка прервана'));

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
            message: 'Загрузка завершена! Сервер распаковывает и индексирует файлы (это может занять некоторое время)...'
          });
        }

        await uploadChunk(zipFile, start, end, i);
        uploadedBytesPrevChunks += (end - start);
      }

      // Success
      setUploadProgress(100);
      setUploadProgressBytes({ loaded: totalSize, total: totalSize });
      setUploadStatus({ type: 'success', message: 'Хранилище успешно импортировано!' });
      setZipFile(null);
      onVaultReload();
    } catch (err: any) {
      console.error(err);
      setUploadStatus({ 
        type: 'error', 
        message: err.message || 'Ошибка сети при импорте архива' 
      });
    } finally {
      setUploading(false);
    }
  };

  // Handle Single MD Upload
  const handleMdUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mdFile) return;

    setUploading(true);
    setUploadStatus({ type: 'info', message: 'Загрузка MD-документа...' });

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
        setUploadStatus({ type: 'success', message: `Файл "${mdFile.name}" успешно загружен!` });
        setMdFile(null);
        onVaultReload();
      } else {
        setUploadStatus({ type: 'error', message: data.error || 'Ошибка при загрузке MD' });
      }
    } catch (err) {
      console.error(err);
      setUploadStatus({ type: 'error', message: 'Ошибка сети при загрузке файла' });
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
        setUserStatus({ type: 'success', message: `Пользователь "${newUsername}" успешно создан!` });
        setNewUsername('');
        setNewPassword('');
        setNewRole('Viewer');
        fetchUsers();
      } else {
        setUserStatus({ type: 'error', message: data.error || 'Ошибка создания пользователя' });
      }
    } catch (err) {
      console.error(err);
      setUserStatus({ type: 'error', message: 'Ошибка сети при создании пользователя' });
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
        alert(data.error || 'Ошибка при сохранении изменений');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка сети при сохранении изменений');
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
        alert(data.error || 'Ошибка при одобрении пользователя');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка сети при одобрении пользователя');
    }
  };

  // Handle Delete User
  const handleDeleteUser = async (userId: number, username: string) => {
    const confirmed = confirm(`Вы действительно хотите БЕЗВОЗВРАТНО удалить пользователя "${username}"?`);
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
        alert(data.error || 'Ошибка при удалении пользователя');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка сети при удалении пользователя');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in select-none">
      <div className="relative w-full max-w-3xl h-[600px] flex flex-col bg-background-panel border border-white/10 rounded-2xl overflow-hidden shadow-glass animate-scale-up">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-black/20">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center text-primary font-bold uppercase">
              ⚙️
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Панель управления администратора</h2>
              <span className="text-[10px] text-text-disabled">Импорт документов и настройки доступа</span>
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
        <div className="flex border-b border-white/5 bg-black/10 px-6 py-2 space-x-2">
          <button
            onClick={() => setActiveTab('import')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer ${
              activeTab === 'import' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Импорт & Загрузка</span>
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer ${
              activeTab === 'users' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Пользователи и Роли</span>
          </button>
          <button
            onClick={() => setActiveTab('media')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer ${
              activeTab === 'media' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
            }`}
          >
            <Image className="w-3.5 h-3.5" />
            <span>Мультимедиа</span>
          </button>
          <button
            onClick={() => setActiveTab('about')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer ${
              activeTab === 'about' ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-white'
            }`}
          >
            <Info className="w-3.5 h-3.5" />
            <span>О системе</span>
          </button>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'import' ? (
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
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1">Импортировать хранилище (.ZIP)</h3>
                  <p className="text-[11px] text-text-muted">
                    Загрузите архив `.zip` с вашим деревом заметок. Система распакует его в хранилище.
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
                      Выбрать ZIP-файл
                    </label>
                    <span className="text-xs text-text-muted truncate max-w-xs">
                      {zipFile ? zipFile.name : 'Файл не выбран'}
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
                      Перезаписать все (удалить все текущие md-файлы и папки перед импортом)
                    </label>
                  </div>

                  {overwrite ? (
                    <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 rounded-lg text-[10.5px] flex items-start space-x-2 animate-fade-in">
                      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-yellow-500" />
                      <span>
                        <strong>Внимание:</strong> При импорте все существующие заметки и папки в корневом каталоге будут <strong>полностью и навсегда удалены</strong> перед распаковкой новых файлов. Служебная папка `_app` и картинки из `assets` будут сохранены.
                      </span>
                    </div>
                  ) : (
                    <div className="p-3 bg-primary/10 border border-primary/20 text-primary rounded-lg text-[10.5px] flex items-start space-x-2 animate-fade-in">
                      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
                      <span>
                        <strong>Режим слияния:</strong> новые файлы из архива будут добавлены, а существующие перезапишутся. Текущие заметки, которых нет в архиве, не пострадают.
                      </span>
                    </div>
                  )}

                  {uploading && uploadProgressBytes && (
                    <div className="space-y-2 bg-black/20 p-3 rounded-lg border border-white/5 animate-fade-in">
                      <div className="flex justify-between text-[10.5px]">
                        <span className="text-text-muted font-medium">
                          {uploadProgress < 100 
                            ? `Загрузка архива: ${uploadProgress}%` 
                            : 'Распаковка и индексирование на сервере...'}
                        </span>
                        <span className="text-white font-semibold">
                          {(uploadProgressBytes.loaded / (1024 * 1024)).toFixed(1)} МБ из {(uploadProgressBytes.total / (1024 * 1024)).toFixed(1)} МБ
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
                    <span>Начать импорт архива</span>
                  </button>
                </form>
              </div>

              {/* MD Upload Card */}
              <div className="p-5 bg-white/[0.02] border border-white/5 rounded-2xl space-y-4 text-left">
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1">Загрузить один документ (.MD)</h3>
                  <p className="text-[11px] text-text-muted">
                    Загрузите файл `.md` напрямую в выбранную папку без перезаписи проекта.
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
                      Выбрать MD-файл
                    </label>
                    <span className="text-xs text-text-muted truncate max-w-xs">
                      {mdFile ? mdFile.name : 'Файл не выбран'}
                    </span>
                  </div>

                  {/* Target Folder Info */}
                  <div className="flex items-center space-x-2 bg-black/20 p-2.5 rounded-lg border border-white/5 text-[10.5px]">
                    <FolderOpen className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-text-muted font-medium">
                      Загрузить в директорию: <strong className="text-white">{selectedParentFolder || 'Корень'}</strong>
                    </span>
                  </div>

                  <button
                    type="submit"
                    disabled={!mdFile || uploading}
                    className="w-full py-2 bg-primary hover:bg-primary-hover active:scale-[0.98] text-white text-xs font-semibold rounded-lg flex items-center justify-center space-x-2 transition-all border border-primary/20 shadow-glow cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Загрузить MD-файл</span>
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
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Создать нового пользователя</h3>
                
                <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <input
                    type="text"
                    placeholder="Логин"
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
                    placeholder="Пароль"
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
                    <option value="Viewer" className="bg-[#1e1e1e]">Viewer (Читатель)</option>
                    <option value="Editor" className="bg-[#1e1e1e]">Editor (Редактор)</option>
                    <option value="Admin" className="bg-[#1e1e1e]">Admin (Администратор)</option>
                  </select>
                  <button
                    type="submit"
                    className="w-full py-2 bg-primary hover:bg-primary-hover active:scale-[0.98] text-white text-xs font-semibold rounded-lg flex items-center justify-center space-x-1.5 transition-all border border-primary/20 shadow-glow cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Добавить</span>
                  </button>
                </form>
              </div>

              {/* Users List Table */}
              <div className="bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden">
                <div className="px-5 py-3 border-b border-white/5 bg-black/10">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Зарегистрированные пользователи</h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-white/5 text-text-disabled bg-black/5">
                        <th className="px-5 py-3 font-semibold">Логин</th>
                        <th className="px-5 py-3 font-semibold">Роль в проекте</th>
                        <th className="px-5 py-3 font-semibold">Дата / Пароль</th>
                        <th className="px-5 py-3 font-semibold">Статус</th>
                        <th className="px-5 py-3 font-semibold text-right">Действия</th>
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
                                  placeholder="Новый пароль"
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
                                  <option value="true">Активен</option>
                                  <option value="false">Ожидает</option>
                                </select>
                              </td>
                              <td className="px-5 py-3 text-right">
                                <div className="flex items-center justify-end space-x-1.5">
                                  <button
                                    onClick={() => handleSaveEdit(user.id)}
                                    className="p-1.5 hover:bg-green-500/20 text-green-400 rounded-lg transition-colors cursor-pointer"
                                    title="Сохранить"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setEditingUserId(null)}
                                    className="p-1.5 hover:bg-white/10 text-text-disabled hover:text-white rounded-lg transition-colors cursor-pointer"
                                    title="Отмена"
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
                              {user.username} {isSelf && <span className="text-[9px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full ml-1">Вы</span>}
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
                                  Активен
                                </span>
                              ) : (
                                <span className="text-[10px] bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 px-2 py-0.5 rounded-full">
                                  Ожидает одобрения
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3 text-right">
                              <div className="flex items-center justify-end space-x-1.5">
                                {!user.approved && (
                                  <button
                                    onClick={() => handleApproveUser(user.id)}
                                    className="p-1.5 hover:bg-green-500/20 text-green-400 rounded-lg transition-colors cursor-pointer"
                                    title="Одобрить пользователя"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  onClick={() => startEditing(user)}
                                  className="p-1.5 hover:bg-white/10 text-text-disabled hover:text-white rounded-lg transition-colors cursor-pointer"
                                  title="Редактировать пользователя"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteUser(user.id, user.username)}
                                  disabled={isSelf}
                                  className="p-1.5 hover:bg-red-500/20 text-text-disabled hover:text-red-400 rounded-lg transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
                                  title={isSelf ? 'Вы не можете удалить свой собственный аккаунт' : 'Удалить пользователя'}
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

              {/* Toolbar: Search input */}
              <div className="flex items-center justify-between gap-4 bg-white/[0.02] border border-white/5 p-4 rounded-2xl">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-disabled" />
                  <input
                    type="text"
                    placeholder="Поиск файлов по названию..."
                    value={mediaSearchQuery}
                    onChange={(e) => setMediaSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-black/30 border border-white/5 focus:border-primary/50 focus:outline-none rounded-lg text-xs text-white"
                  />
                </div>
                <div className="text-xs text-text-muted">
                  Всего файлов: <strong className="text-white">{filteredMediaFiles.length}</strong>
                </div>
              </div>

              {/* Media Grid */}
              {loadingMedia ? (
                <div className="text-center py-12 text-text-muted text-xs">
                  Загрузка списка медиафайлов...
                </div>
              ) : filteredMediaFiles.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-white/10 rounded-2xl text-text-muted text-xs">
                  {mediaSearchQuery ? 'Файлы не найдены' : 'В хранилище нет загруженных медиафайлов'}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 animate-fade-in">
                  {filteredMediaFiles.map((file) => {
                    const isVideo = /\.(mp4|webm|ogg|mov|m4v|3gp)$/i.test(file.filename);
                    const fileUrl = `/api/raw/assets/${encodeURIComponent(file.filename)}?token=${token}`;
                    return (
                      <div 
                        key={file.filename} 
                        className="group bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 hover:border-primary/30 rounded-2xl overflow-hidden flex flex-col transition-all duration-300 hover:shadow-[0_0_15px_rgba(var(--primary-rgb),0.05)]"
                      >
                        {/* Thumbnail Container */}
                        <div className="h-32 bg-black/40 relative flex items-center justify-center overflow-hidden border-b border-white/5">
                          {isVideo ? (
                            <video 
                              src={fileUrl} 
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                              preload="metadata"
                              muted
                              playsInline
                            />
                          ) : (
                            <img 
                              src={fileUrl} 
                              alt={file.filename}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                              loading="lazy"
                            />
                          )}
                          {/* Badges */}
                          <div className="absolute top-2 left-2 flex gap-1">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${isVideo ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-green-500/20 text-green-400 border border-green-500/30'}`}>
                              {file.filename.split('.').pop() || 'file'}
                            </span>
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
                            onClick={() => handleDeleteMedia(file.filename)}
                            className="w-full py-1.5 bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white border border-red-500/20 rounded-lg text-[11px] font-medium flex items-center justify-center space-x-1.5 transition-all cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Удалить файл</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
                    <h3 className="text-sm font-bold text-white">Obsidian Collab</h3>
                    <p className="text-[10px] text-text-muted">Разработка системы ведения заметок и совместного редактирования</p>
                  </div>
                </div>
                <p className="text-xs text-text-muted leading-relaxed">
                  Платформа предназначена для командной работы с базой знаний Obsidian на основе Markdown. Данный раздел настроек показывает текущую установленную версию системы и подробный Changelog доработок и улучшений.
                </p>
              </div>

              {/* Version info details */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Информация о сборке</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-white/[0.01] border border-white/5 rounded-xl flex flex-col space-y-1">
                    <span className="text-[10px] text-text-disabled uppercase">Установленная версия</span>
                    <span className="text-lg font-extrabold text-primary">v{versionInfo.version}</span>
                  </div>
                  <div className="p-4 bg-white/[0.01] border border-white/5 rounded-xl flex flex-col space-y-1">
                    <span className="text-[10px] text-text-disabled uppercase">Среда выполнения</span>
                    <span className="text-lg font-extrabold text-white">{versionInfo.env || 'Development'}</span>
                  </div>
                </div>
              </div>

              {/* Release Timeline */}
              <div className="space-y-4 pt-2">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">История версий</h4>
                {versionInfo.history.length === 0 ? (
                  <p className="text-xs text-text-disabled italic py-2">История релизов пуста</p>
                ) : (
                  <div className="relative pl-5 border-l border-white/5 space-y-6 py-1">
                    {versionInfo.history.map((release) => (
                      <div key={release.version} className="relative">
                        {/* Timeline dot */}
                        <span className="absolute -left-[27px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background-panel border-2 border-primary shrink-0">
                          <span className="h-1 w-1 rounded-full bg-primary" />
                        </span>
                        
                        <div className="space-y-1.5">
                          <div className="flex items-center space-x-2">
                            <span className="text-xs font-bold text-white">v{release.version}</span>
                            <span className="text-[10px] text-text-muted">({release.date})</span>
                            <span className="text-[10px] text-primary font-medium">— {release.title}</span>
                          </div>
                          
                          {release.keynotes && release.keynotes.length > 0 && (
                            <ul className="space-y-1 pl-1">
                              {release.keynotes.map((note, nIdx) => (
                                <li key={nIdx} className="flex items-start text-[11px] text-text-muted">
                                  <span className="text-primary mr-1.5">•</span>
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
          ) : null}
        </div>

        {/* Footer info bar */}
        <div className="px-6 py-2.5 border-t border-white/5 bg-black/20 text-[10px] text-text-disabled text-right">
          <span>Ваша роль: <strong>{currentUser.role}</strong></span>
        </div>

      </div>
    </div>
  );
};
