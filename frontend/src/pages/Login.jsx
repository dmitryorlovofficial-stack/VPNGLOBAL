// Страница авторизации (пароль + Telegram Login Widget)
import { useState, useEffect, useCallback } from 'react';
import { Shield, Eye, EyeOff, Ticket } from 'lucide-react';
import toast from 'react-hot-toast';
import { auth, setToken } from '../api/client';
import TelegramLoginButton from '../components/TelegramLoginButton';

export default function Login({ onLogin }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [totpCode, setTotpCode] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [needs2fa, setNeeds2fa] = useState(false);
    const [loading, setLoading] = useState(false);

    // Telegram auth
    const [tgConfig, setTgConfig] = useState({ enabled: false, bot_username: '' });
    const [tgData, setTgData] = useState(null);
    const [inviteCode, setInviteCode] = useState('');
    const [showInvite, setShowInvite] = useState(false);

    // Загружаем конфиг Telegram при монтировании
    useEffect(() => {
        auth.telegramConfig()
            .then(data => setTgConfig(data))
            .catch(() => {}); // Если ошибка — просто не показываем кнопку
    }, []);

    // Проверяем invite из URL query string
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const invite = params.get('invite');
        if (invite) setInviteCode(invite);
    }, []);

    // Обработчик стандартного логина (пароль)
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!username || !password) {
            toast.error('Введите логин и пароль');
            return;
        }

        setLoading(true);
        try {
            const result = await auth.login(username, password, needs2fa ? totpCode : undefined);

            if (result.requires2fa) {
                setNeeds2fa(true);
                toast('Введите код 2FA');
                setLoading(false);
                return;
            }

            if (result.token) {
                setToken(result.token);
                toast.success('Добро пожаловать!');
                onLogin(result.user);
            }
        } catch (err) {
            toast.error(err.message || 'Ошибка авторизации');
        } finally {
            setLoading(false);
        }
    };

    // Обработчик Telegram авторизации
    const handleTelegramAuth = useCallback(async (user) => {
        setLoading(true);
        try {
            const result = await auth.telegramLogin(user);

            if (result.needsRegistration) {
                // Пользователь не зарегистрирован — нужен инвайт-код
                setTgData(user);
                setShowInvite(true);
                toast('Введите инвайт-код для регистрации');
                setLoading(false);
                return;
            }

            if (result.token) {
                setToken(result.token);
                toast.success('Добро пожаловать!');
                onLogin(result.user);
            }
        } catch (err) {
            toast.error(err.message || 'Ошибка авторизации через Telegram');
        } finally {
            setLoading(false);
        }
    }, [onLogin]);

    // Обработчик регистрации с инвайт-кодом
    const handleInviteSubmit = async (e) => {
        e.preventDefault();
        if (!inviteCode.trim()) {
            toast.error('Введите инвайт-код');
            return;
        }

        setLoading(true);
        try {
            const result = await auth.telegramRegister({ ...tgData, invite_code: inviteCode.trim() });

            if (result.token) {
                setToken(result.token);
                toast.success('Регистрация успешна!');
                onLogin(result.user);
            }
        } catch (err) {
            toast.error(err.message || 'Ошибка регистрации');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-dark-900 p-4">
            <div className="w-full max-w-sm animate-fade-in">
                {/* Логотип */}
                <div className="flex flex-col items-center mb-8">
                    <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-4">
                        <Shield className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-white">VPN Panel</h1>
                    <p className="text-sm text-gray-400 mt-1">Панель управления VPN</p>
                </div>

                {/* Форма инвайт-кода (после Telegram авторизации) */}
                {showInvite ? (
                    <form onSubmit={handleInviteSubmit} className="bg-dark-800 border border-dark-700 rounded-xl p-6 space-y-4">
                        <div className="text-center mb-2">
                            <Ticket className="w-8 h-8 text-blue-400 mx-auto mb-2" />
                            <p className="text-sm text-gray-300">
                                Telegram: <span className="text-white font-medium">{tgData?.first_name || tgData?.username}</span>
                            </p>
                            <p className="text-xs text-gray-500 mt-1">Для регистрации нужен инвайт-код</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1.5">Инвайт-код</label>
                            <input
                                type="text"
                                value={inviteCode}
                                onChange={e => setInviteCode(e.target.value)}
                                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 tracking-widest text-center"
                                placeholder="Введите код"
                                autoFocus
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                            {loading ? 'Регистрация...' : 'Зарегистрироваться'}
                        </button>

                        <button
                            type="button"
                            onClick={() => { setShowInvite(false); setTgData(null); }}
                            className="w-full py-2 text-gray-400 text-sm hover:text-white transition-colors"
                        >
                            Назад
                        </button>
                    </form>
                ) : (
                    <>
                        {/* Форма логина */}
                        <form onSubmit={handleSubmit} className="bg-dark-800 border border-dark-700 rounded-xl p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1.5">Логин</label>
                                <input
                                    type="text"
                                    value={username}
                                    onChange={e => setUsername(e.target.value)}
                                    className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                                    placeholder="admin"
                                    autoFocus
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1.5">Пароль</label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2.5 pr-10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                                        placeholder="Пароль"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                                    >
                                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>

                            {needs2fa && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Код 2FA</label>
                                    <input
                                        type="text"
                                        value={totpCode}
                                        onChange={e => setTotpCode(e.target.value)}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 tracking-widest text-center"
                                        placeholder="000000"
                                        maxLength={6}
                                        autoFocus
                                    />
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                            >
                                {loading ? 'Вход...' : 'Войти'}
                            </button>
                        </form>

                        {/* Telegram Login Widget */}
                        {tgConfig.enabled && tgConfig.bot_username && (
                            <div className="mt-4">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="flex-1 h-px bg-dark-600" />
                                    <span className="text-xs text-gray-500">или</span>
                                    <div className="flex-1 h-px bg-dark-600" />
                                </div>
                                <TelegramLoginButton
                                    botUsername={tgConfig.bot_username}
                                    onAuth={handleTelegramAuth}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
