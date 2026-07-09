import React, { useState } from 'react';
import { Lock, User, PlusCircle, ArrowRight } from 'lucide-react';
import { t, type Lang } from '../utils/translations';

interface AuthProps {
  onLoginSuccess: (token: string, user: { id: number; username: string; role: string }) => void;
  lang: Lang;
}

export const Auth: React.FC<AuthProps> = ({ onLoginSuccess, lang }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('Editor');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const url = isRegister ? '/api/auth/register' : '/api/auth/login';
    const payload = isRegister ? { username, password, role } : { username, password };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        let errMsg = data.error;
        if (errMsg === 'Пользователь не найден или ожидает одобрения') {
          errMsg = t('auth_approval_pending', lang);
        } else if (errMsg === 'Неверный пароль' || errMsg === 'Пользователь не найден') {
          errMsg = t('auth_invalid_credentials', lang);
        }
        throw new Error(errMsg || (lang === 'en' ? 'Something went wrong' : 'Что-то пошло не так'));
      }

      if (isRegister) {
        setIsRegister(false);
        setError(t('auth_register_success', lang));
        setPassword('');
      } else {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        onLoginSuccess(data.token, data.user);
      }
    } catch (err: any) {
      setError(err.message || (lang === 'en' ? 'Server connection error' : 'Ошибка подключения к серверу'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md">
      <div className="w-full max-w-md p-8 rounded-2xl glass-panel shadow-glass text-center border border-white/10 glow-active mx-4">
        <div className="flex justify-center mb-4">
          <img src="/logo_icon.png" className="w-20 h-20 object-contain" alt="StrataNote Logo" />
        </div>

        <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2 bg-gradient-to-r from-white via-primary to-primary-hover bg-clip-text text-transparent">
          StrataNote
        </h1>
        <p className="text-text-muted text-sm mb-6">
          {isRegister 
            ? (lang === 'en' ? 'Create an account to work in a team' : 'Создайте учетную запись для работы в команде') 
            : (lang === 'en' ? 'Sign in to collaborative knowledge base' : 'Вход в совместную базу знаний')}
        </p>

        {error && (
          <div className={`p-3 text-sm rounded-lg mb-4 text-center border ${
            error.includes('успешна') || error.includes('successful')
              ? 'bg-green-500/10 border-green-500/20 text-green-400' 
              : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
            <input
              type="text"
              placeholder={t('auth_username', lang)}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-black/30 border border-white/5 rounded-xl text-text placeholder-text-disabled focus:outline-none focus:border-primary/50 transition-colors"
              required
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
            <input
              type="password"
              placeholder={t('auth_password', lang)}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-black/30 border border-white/5 rounded-xl text-text placeholder-text-disabled focus:outline-none focus:border-primary/50 transition-colors"
              required
            />
          </div>

          {isRegister && (
            <div className="flex flex-col text-left space-y-1">
              <label className="text-xs text-text-muted ml-1">{t('auth_role', lang)}</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full px-3 py-3 bg-background-panel border border-white/5 rounded-xl text-text focus:outline-none focus:border-primary/50 transition-colors"
              >
                <option value="Editor">{lang === 'en' ? 'Editor' : 'Редактор (Editor)'}</option>
                <option value="Viewer">{lang === 'en' ? 'Viewer' : 'Читатель (Viewer)'}</option>
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-primary to-primary-hover hover:opacity-90 active:scale-[0.98] text-white font-semibold rounded-xl flex items-center justify-center space-x-2 transition-all cursor-pointer border border-primary/20 shadow-glow"
          >
            <span>{loading ? (lang === 'en' ? 'Loading...' : 'Загрузка...') : isRegister ? t('auth_btn_register', lang) : t('auth_btn_login', lang)}</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </form>

        <div className="mt-6 border-t border-white/5 pt-4 text-sm text-text-muted">
          {isRegister ? (
            <p>
              {lang === 'en' ? 'Already have an account?' : 'Уже есть аккаунт?'}{' '}
              <button
                onClick={() => { setIsRegister(false); setError(''); }}
                className="text-primary hover:underline cursor-pointer"
              >
                {t('auth_btn_login', lang)}
              </button>
            </p>
          ) : (
            <p>
              {lang === 'en' ? 'No account?' : 'Нет аккаунта?'}{' '}
              <button
                onClick={() => { setIsRegister(true); setError(''); }}
                className="text-primary hover:underline cursor-pointer flex items-center justify-center mx-auto mt-1 space-x-1"
              >
                <PlusCircle className="w-4 h-4" />
                <span>{lang === 'en' ? 'Create new account' : 'Создать новый аккаунт'}</span>
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
