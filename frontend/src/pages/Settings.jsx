// Страница настроек панели
import { useState, useEffect, useCallback } from 'react';
import { Save, Download, Upload, Shield, Key, RefreshCw, Send, Plus, Trash2, Copy, CheckCircle, XCircle, Lock, Globe, AlertTriangle, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { settings as settingsApi, auth, invites as invitesApi, ssl as sslApi } from '../api/client';
import { useUser } from '../App';
import TelegramLoginButton from '../components/TelegramLoginButton';

export default function Settings() {
    const user = useUser();
    const [config, setConfig] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [tab, setTab] = useState('general');

    // Формы
    const [passwordForm, setPasswordForm] = useState({ oldPassword: '', newPassword: '', confirm: '' });

    // Telegram
    const [tgConfig, setTgConfig] = useState({ enabled: false, bot_username: '' });
    const [inviteList, setInviteList] = useState([]);
    const [inviteForm, setInviteForm] = useState({ max_uses: 1, max_vpn_clients: 5, expires_hours: '' });
    const [creatingInvite, setCreatingInvite] = useState(false);
    const [userInfo, setUserInfo] = useState(null);

    // YooMoney
    const [yooConfig, setYooConfig] = useState({ yoomoney_wallet: '', yoomoney_secret: '' });

    // SMTP
    const [smtpConfig, setSmtpConfig] = useState({ smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '', smtp_from: '' });
    const [smtpTesting, setSmtpTesting] = useState(false);
    const [smtpTestEmail, setSmtpTestEmail] = useState('');

    // SSL
    const [sslStatus, setSslStatus] = useState(null);
    const [sslDomain, setSslDomain] = useState('');
    const [sslEmail, setSslEmail] = useState('');
    const [sslObtaining, setSslObtaining] = useState(false);
    const [sslRenewing, setSslRenewing] = useState(false);

    useEffect(() => {
        settingsApi.get()
            .then(data => setConfig(data))
            .catch(err => toast.error(err.message))
            .finally(() => setLoading(false));
    }, []);

    // Загружаем данные SSL при переключении на вкладку
    useEffect(() => {
        if (tab === 'yoomoney') {
            setYooConfig({
                yoomoney_wallet: config.yoomoney_wallet || '',
                yoomoney_secret: config.yoomoney_secret || '',
            });
        }
        if (tab === 'smtp') {
            setSmtpConfig({
                smtp_host: config.smtp_host || '',
                smtp_port: config.smtp_port || '587',
                smtp_user: config.smtp_user || '',
                smtp_pass: config.smtp_pass || '',
                smtp_from: config.smtp_from || '',
            });
        }
        if (tab === 'ssl') {
            sslApi.status()
                .then(data => {
                    setSslStatus(data);
                    if (data.domain) setSslDomain(data.domain);
                })
                .catch(() => {});
        }
    }, [tab]);

    // Загружаем данные Telegram при переключении на вкладку
    useEffect(() => {
        if (tab === 'telegram') {
            auth.telegramConfig()
                .then(data => setTgConfig(data))
                .catch(() => {});

            invitesApi.list()
                .then(data => setInviteList(data))
                .catch(() => {});

            auth.me()
                .then(data => setUserInfo(data))
                .catch(() => {});
        }
    }, [tab]);

    const handleSaveGeneral = async () => {
        setSaving(true);
        try {
            await settingsApi.update(config);
            toast.success('Настройки сохранены');
        } catch (err) { toast.error(err.message); }
        setSaving(false);
    };

    const handleChangePassword = async (e) => {
        e.preventDefault();
        if (passwordForm.newPassword !== passwordForm.confirm) {
            toast.error('Пароли не совпадают');
            return;
        }
        try {
            await auth.changePassword(passwordForm.oldPassword, passwordForm.newPassword);
            toast.success('Пароль изменён');
            setPasswordForm({ oldPassword: '', newPassword: '', confirm: '' });
        } catch (err) { toast.error(err.message); }
    };

    const handleBackup = async () => {
        try {
            const data = await settingsApi.backup();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `vpn-panel-backup-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success('Бэкап скачан');
        } catch (err) { toast.error(err.message); }
    };

    const handleRestore = async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                if (!confirm(`Восстановить ${data.clients?.length || 0} клиентов из бэкапа?`)) return;
                await settingsApi.restore(data);
                toast.success('Данные восстановлены');
            } catch (err) { toast.error(err.message); }
        };
        input.click();
    };

    // Telegram: создать инвайт
    const handleCreateInvite = async () => {
        setCreatingInvite(true);
        try {
            const data = {
                max_uses: parseInt(inviteForm.max_uses) || 1,
                max_vpn_clients: parseInt(inviteForm.max_vpn_clients) || 5,
            };
            if (inviteForm.expires_hours) data.expires_hours = parseInt(inviteForm.expires_hours);

            const invite = await invitesApi.create(data);
            setInviteList(prev => [invite, ...prev]);
            toast.success('Инвайт создан');
        } catch (err) { toast.error(err.message); }
        setCreatingInvite(false);
    };

    // Telegram: сохранить настройки бота
    const handleSaveTelegram = async () => {
        setSaving(true);
        try {
            await settingsApi.update({
                telegram_bot_token: config.telegram_bot_token || '',
                telegram_bot_username: config.telegram_bot_username || '',
            });
            // Перезагружаем конфиг Telegram
            const tg = await auth.telegramConfig();
            setTgConfig(tg);
            toast.success('Настройки Telegram сохранены');
        } catch (err) { toast.error(err.message); }
        setSaving(false);
    };

    // Telegram: удалить инвайт
    const handleDeleteInvite = async (id) => {
        try {
            await invitesApi.remove(id);
            setInviteList(prev => prev.filter(i => i.id !== id));
            toast.success('Инвайт удалён');
        } catch (err) { toast.error(err.message); }
    };

    // Telegram: копировать код
    const copyInviteCode = (code) => {
        navigator.clipboard.writeText(code);
        toast.success('Код скопирован');
    };

    // Telegram: копировать ссылку с инвайтом
    const copyInviteLink = (code) => {
        const link = `${window.location.origin}/login?invite=${code}`;
        navigator.clipboard.writeText(link);
        toast.success('Ссылка скопирована');
    };

    // SSL: получить сертификат
    const handleSslObtain = async () => {
        if (!sslDomain) {
            toast.error('Укажите домен');
            return;
        }
        setSslObtaining(true);
        try {
            const result = await sslApi.obtain(sslDomain, sslEmail);
            toast.success(result.message || 'SSL-сертификат получен');
            // Обновляем статус
            const status = await sslApi.status();
            setSslStatus(status);
        } catch (err) {
            toast.error(err.message || 'Ошибка получения сертификата');
        }
        setSslObtaining(false);
    };

    // SSL: обновить сертификат
    const handleSslRenew = async () => {
        setSslRenewing(true);
        try {
            await sslApi.renew();
            toast.success('Сертификат обновлён');
            const status = await sslApi.status();
            setSslStatus(status);
        } catch (err) {
            toast.error(err.message);
        }
        setSslRenewing(false);
    };

    // SSL: отключить
    const handleSslDisable = async () => {
        if (!confirm('Отключить SSL? Панель перейдёт на HTTP.')) return;
        try {
            await sslApi.disable();
            toast.success('SSL отключён');
            setSslStatus({ configured: false, enabled: false });
            setSslDomain('');
        } catch (err) {
            toast.error(err.message);
        }
    };

    // Telegram: привязка аккаунта
    const handleTelegramLink = useCallback(async (tgData) => {
        try {
            await auth.telegramLink(tgData);
            toast.success('Telegram привязан');
            // Обновляем данные пользователя
            const updated = await auth.me();
            setUserInfo(updated);
        } catch (err) { toast.error(err.message); }
    }, []);

    const tabs = [
        { id: 'general', label: 'Общие', icon: RefreshCw },
        { id: 'security', label: 'Безопасность', icon: Shield },
        { id: 'ssl', label: 'SSL', icon: Lock },
        { id: 'telegram', label: 'Telegram', icon: Send },
        { id: 'smtp', label: 'Почта', icon: Mail },
        { id: 'yoomoney', label: 'Оплата', icon: Globe },
        { id: 'backup', label: 'Бэкап', icon: Download },
    ];

    if (loading) {
        return <div className="flex items-center justify-center h-64 text-gray-500">Загрузка настроек...</div>;
    }

    const updateConfig = (key, value) => setConfig(prev => ({ ...prev, [key]: value }));

    return (
        <div className="space-y-6 animate-fade-in">
            <h1 className="text-2xl font-bold text-white">Настройки</h1>

            {/* Вкладки */}
            <div className="flex gap-1 bg-dark-800 border border-dark-700 rounded-lg p-1">
                {tabs.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`flex items-center gap-2 flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                            tab === t.id
                                ? 'bg-dark-700 text-white'
                                : 'text-gray-400 hover:text-white'
                        }`}
                    >
                        <t.icon className="w-4 h-4" />
                        <span className="hidden sm:inline">{t.label}</span>
                    </button>
                ))}
            </div>

            {/* Общие настройки */}
            {tab === 'general' && (
                <div className="glass-card p-5 space-y-4">
                    <h3 className="text-sm font-semibold text-white">Настройки панели</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Домен панели</label>
                            <input
                                value={config.panel_domain || ''}
                                onChange={e => updateConfig('panel_domain', e.target.value)}
                                className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
                                placeholder="vpn.example.com"
                            />
                            <p className="text-[10px] text-gray-500 mt-1">Используется для формирования ссылок подписки</p>
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Название панели</label>
                            <input
                                value={config.panel_name || ''}
                                onChange={e => updateConfig('panel_name', e.target.value)}
                                className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
                                placeholder="VPN Panel"
                            />
                        </div>
                    </div>
                    <button onClick={handleSaveGeneral} disabled={saving} className="flex items-center gap-2 px-4 py-2.5 btn-primary disabled:opacity-50">
                        <Save className="w-4 h-4" /> {saving ? 'Сохранение...' : 'Сохранить'}
                    </button>
                </div>
            )}

            {/* Безопасность */}
            {tab === 'security' && (
                <div className="space-y-4">
                    <div className="glass-card p-5">
                        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                            <Key className="w-4 h-4" /> Смена пароля
                        </h3>
                        <form onSubmit={handleChangePassword} className="space-y-3 max-w-sm">
                            <input
                                type="password"
                                value={passwordForm.oldPassword}
                                onChange={e => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
                                placeholder="Текущий пароль"
                                className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500"
                            />
                            <input
                                type="password"
                                value={passwordForm.newPassword}
                                onChange={e => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                                placeholder="Новый пароль"
                                className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500"
                            />
                            <input
                                type="password"
                                value={passwordForm.confirm}
                                onChange={e => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
                                placeholder="Подтверждение нового пароля"
                                className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500"
                            />
                            <button type="submit" className="px-4 py-2 btn-primary">
                                Сменить пароль
                            </button>
                        </form>
                    </div>

                    <div className="glass-card p-5">
                        <h3 className="text-sm font-semibold text-white mb-3">Безопасность панели</h3>
                        <div className="space-y-3 max-w-sm">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Белый список IP (через запятую)</label>
                                <input
                                    value={config.ip_whitelist || ''}
                                    onChange={e => updateConfig('ip_whitelist', e.target.value)}
                                    placeholder="Оставьте пустым для доступа отовсюду"
                                    className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Макс. попыток входа</label>
                                <input
                                    type="number"
                                    value={config.max_login_attempts || '5'}
                                    onChange={e => updateConfig('max_login_attempts', e.target.value)}
                                    className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
                                />
                            </div>
                            <button onClick={handleSaveGeneral} className="px-4 py-2 btn-primary">
                                Сохранить
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* SSL / HTTPS */}
            {tab === 'ssl' && (
                <div className="space-y-4">
                    {/* Статус SSL */}
                    <div className="glass-card p-5">
                        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                            <Lock className="w-4 h-4" /> HTTPS (Let's Encrypt)
                            {sslStatus?.enabled ? (
                                <span className="ml-auto flex items-center gap-1.5 text-xs text-green-400">
                                    <CheckCircle className="w-3.5 h-3.5" /> Активен
                                </span>
                            ) : (
                                <span className="ml-auto flex items-center gap-1.5 text-xs text-gray-500">
                                    <XCircle className="w-3.5 h-3.5" /> Не активен
                                </span>
                            )}
                        </h3>

                        {/* Информация о сертификате */}
                        {sslStatus?.hasCert && (
                            <div className="mb-4 p-3 rounded-lg bg-dark-700/50 border border-dark-600 space-y-1">
                                <div className="flex items-center gap-2 text-sm text-white">
                                    <Globe className="w-4 h-4 text-accent-400" />
                                    <span className="font-mono">{sslStatus.domain}</span>
                                </div>
                                <div className="flex items-center gap-4 text-xs text-gray-400">
                                    <span>Истекает: {new Date(sslStatus.validTo).toLocaleDateString()}</span>
                                    <span className={sslStatus.daysLeft <= 14 ? 'text-yellow-400' : 'text-green-400'}>
                                        {sslStatus.daysLeft} дн.
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Форма */}
                        <div className="space-y-3 max-w-lg">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Домен</label>
                                <input
                                    value={sslDomain}
                                    onChange={e => setSslDomain(e.target.value.trim())}
                                    placeholder="example.com"
                                    disabled={sslObtaining}
                                    className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500 font-mono disabled:opacity-50"
                                />
                                <p className="text-xs text-gray-600 mt-1">A-запись домена должна указывать на IP этого сервера</p>
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Email (необязательно)</label>
                                <input
                                    value={sslEmail}
                                    onChange={e => setSslEmail(e.target.value.trim())}
                                    placeholder="admin@example.com"
                                    disabled={sslObtaining}
                                    className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500 disabled:opacity-50"
                                />
                                <p className="text-xs text-gray-600 mt-1">Let's Encrypt отправит уведомление перед истечением</p>
                            </div>

                            {sslObtaining && (
                                <div className="flex items-center gap-2 p-3 rounded-lg bg-accent-500/10 border border-accent-500/20 text-accent-400 text-sm">
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    <span>Получение сертификата... Панель будет недоступна ~30 сек</span>
                                </div>
                            )}

                            <div className="flex flex-wrap gap-2 pt-1">
                                <button
                                    onClick={handleSslObtain}
                                    disabled={sslObtaining || !sslDomain}
                                    className="flex items-center gap-2 px-4 py-2 btn-primary disabled:opacity-50"
                                >
                                    <Lock className="w-4 h-4" />
                                    {sslObtaining ? 'Получение...' : sslStatus?.hasCert ? 'Переиздать' : 'Получить сертификат'}
                                </button>

                                {sslStatus?.hasCert && (
                                    <button
                                        onClick={handleSslRenew}
                                        disabled={sslRenewing}
                                        className="flex items-center gap-2 px-4 py-2 bg-dark-700 text-white border border-dark-600 rounded-lg text-sm hover:bg-dark-600 disabled:opacity-50"
                                    >
                                        <RefreshCw className={`w-4 h-4 ${sslRenewing ? 'animate-spin' : ''}`} />
                                        {sslRenewing ? 'Обновление...' : 'Обновить'}
                                    </button>
                                )}

                                {sslStatus?.enabled && (
                                    <button
                                        onClick={handleSslDisable}
                                        className="flex items-center gap-2 px-4 py-2 text-red-400 border border-red-500/30 rounded-lg text-sm hover:bg-red-500/10"
                                    >
                                        <XCircle className="w-4 h-4" />
                                        Отключить SSL
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Подсказка */}
                    <div className="glass-card p-5">
                        <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-yellow-400" /> Требования
                        </h3>
                        <ul className="text-xs text-gray-400 space-y-1 list-disc list-inside">
                            <li>Домен должен указывать на IP этого сервера (A-запись в DNS)</li>
                            <li>Порт 80 должен быть доступен извне (для проверки Let's Encrypt)</li>
                            <li>Панель будет недоступна ~30 секунд при получении сертификата</li>
                            <li>Сертификат обновляется автоматически (каждые 12 часов проверка)</li>
                            <li>После включения HTTPS — панель доступна по https://домен</li>
                        </ul>
                    </div>
                </div>
            )}

            {/* Telegram */}
            {tab === 'telegram' && (
                <div className="space-y-4">
                    {/* Настройки бота */}
                    <div className="glass-card p-5">
                        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                            <Send className="w-4 h-4" /> Telegram бот
                            {tgConfig.enabled ? (
                                <span className="ml-auto flex items-center gap-1.5 text-xs text-green-400">
                                    <CheckCircle className="w-3.5 h-3.5" /> Активен
                                </span>
                            ) : (
                                <span className="ml-auto flex items-center gap-1.5 text-xs text-gray-500">
                                    <XCircle className="w-3.5 h-3.5" /> Не настроен
                                </span>
                            )}
                        </h3>
                        <div className="space-y-3 max-w-lg">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Bot Token</label>
                                <input
                                    type="password"
                                    value={config.telegram_bot_token || ''}
                                    onChange={e => updateConfig('telegram_bot_token', e.target.value)}
                                    placeholder="123456:ABC-DEF..."
                                    className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500 font-mono"
                                />
                                <p className="text-xs text-gray-600 mt-1">Получите у @BotFather в Telegram</p>
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Bot Username</label>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-gray-500">@</span>
                                    <input
                                        value={config.telegram_bot_username || ''}
                                        onChange={e => updateConfig('telegram_bot_username', e.target.value)}
                                        placeholder="my_vpn_bot"
                                        className="flex-1 bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500"
                                    />
                                </div>
                            </div>
                            <button onClick={handleSaveTelegram} disabled={saving} className="flex items-center gap-2 px-4 py-2 btn-primary disabled:opacity-50">
                                <Save className="w-4 h-4" /> {saving ? 'Сохранение...' : 'Сохранить'}
                            </button>
                        </div>
                    </div>

                    {/* Привязка Telegram к текущему аккаунту */}
                    {tgConfig.enabled && (
                        <div className="glass-card p-5">
                            <h3 className="text-sm font-semibold text-white mb-3">Ваш аккаунт</h3>
                            {userInfo?.telegram_id ? (
                                <div className="flex items-center gap-3">
                                    {userInfo.telegram_photo_url && (
                                        <img src={userInfo.telegram_photo_url} alt="" className="w-8 h-8 rounded-full" />
                                    )}
                                    <div>
                                        <p className="text-sm text-white">Telegram привязан</p>
                                        <p className="text-xs text-gray-400">@{userInfo.telegram_username || userInfo.telegram_id}</p>
                                    </div>
                                    <CheckCircle className="w-4 h-4 text-green-400 ml-auto" />
                                </div>
                            ) : (
                                <div>
                                    <p className="text-xs text-gray-400 mb-3">Привяжите Telegram для входа без пароля</p>
                                    <TelegramLoginButton
                                        botUsername={tgConfig.bot_username}
                                        onAuth={handleTelegramLink}
                                        size="medium"
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {/* Управление инвайтами */}
                    <div className="glass-card p-5">
                        <h3 className="text-sm font-semibold text-white mb-4">Инвайт-коды</h3>

                        {/* Форма создания */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Макс. исп.</label>
                                <input
                                    type="number"
                                    value={inviteForm.max_uses}
                                    onChange={e => setInviteForm({ ...inviteForm, max_uses: e.target.value })}
                                    className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
                                    min="1"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">VPN лимит</label>
                                <input
                                    type="number"
                                    value={inviteForm.max_vpn_clients}
                                    onChange={e => setInviteForm({ ...inviteForm, max_vpn_clients: e.target.value })}
                                    className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
                                    min="1"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Срок (часы)</label>
                                <input
                                    type="number"
                                    value={inviteForm.expires_hours}
                                    onChange={e => setInviteForm({ ...inviteForm, expires_hours: e.target.value })}
                                    className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500"
                                    placeholder="Без срока"
                                    min="1"
                                />
                            </div>
                            <div className="flex items-end">
                                <button
                                    onClick={handleCreateInvite}
                                    disabled={creatingInvite}
                                    className="w-full flex items-center justify-center gap-2 px-3 py-2 btn-primary disabled:opacity-50"
                                >
                                    <Plus className="w-4 h-4" />
                                    {creatingInvite ? '...' : 'Создать'}
                                </button>
                            </div>
                        </div>

                        {/* Список инвайтов */}
                        {inviteList.length === 0 ? (
                            <p className="text-sm text-gray-500 text-center py-4">Нет инвайт-кодов</p>
                        ) : (
                            <div className="space-y-2">
                                {inviteList.map(inv => {
                                    const expired = inv.expires_at && new Date(inv.expires_at) < new Date();
                                    const exhausted = inv.used_count >= inv.max_uses;
                                    const inactive = expired || exhausted;

                                    return (
                                        <div key={inv.id} className={`flex items-center gap-3 p-3 rounded-lg border ${inactive ? 'bg-dark-900/50 border-dark-700/50' : 'bg-dark-700/50 border-dark-600'}`}>
                                            <code className={`text-sm font-mono ${inactive ? 'text-gray-600' : 'text-accent-400'}`}>
                                                {inv.code}
                                            </code>

                                            <div className="flex items-center gap-2 ml-auto text-xs text-gray-400">
                                                <span>{inv.used_count}/{inv.max_uses}</span>
                                                <span>VPN: {inv.max_vpn_clients}</span>
                                                {inv.expires_at && (
                                                    <span className={expired ? 'text-red-400' : ''}>
                                                        {expired ? 'Истёк' : new Date(inv.expires_at).toLocaleDateString()}
                                                    </span>
                                                )}
                                            </div>

                                            <button
                                                onClick={() => copyInviteCode(inv.code)}
                                                className="p-1.5 text-gray-400 hover:text-white transition-colors"
                                                title="Копировать код"
                                            >
                                                <Copy className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={() => copyInviteLink(inv.code)}
                                                className="p-1.5 text-gray-400 hover:text-accent-400 transition-colors"
                                                title="Копировать ссылку"
                                            >
                                                <Send className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteInvite(inv.id)}
                                                className="p-1.5 text-gray-400 hover:text-red-400 transition-colors"
                                                title="Удалить"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Бэкап */}


            {tab === 'yoomoney' && (
                <div className="glass-card p-6 space-y-4">
                    <h2 className="text-lg font-semibold text-white">ЮMoney</h2>
                    <p className="text-xs text-gray-400">Приём платежей через кошелёк ЮMoney</p>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Номер кошелька</label>
                            <input
                                value={yooConfig.yoomoney_wallet}
                                onChange={e => setYooConfig(p => ({ ...p, yoomoney_wallet: e.target.value }))}
                                className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
                                placeholder="4100123456789"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Секрет для уведомлений</label>
                            <input
                                type="password"
                                value={yooConfig.yoomoney_secret}
                                onChange={e => setYooConfig(p => ({ ...p, yoomoney_secret: e.target.value }))}
                                className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
                                placeholder="Секрет из настроек ЮMoney"
                            />
                            <p className="text-[10px] text-gray-500 mt-1">ЮMoney → Настройки → HTTP-уведомления → Секрет</p>
                        </div>
                        <div className="bg-dark-700/50 rounded-lg p-3 text-xs text-gray-400 space-y-1">
                            <p className="font-medium text-gray-300">URL для уведомлений (вставьте в ЮMoney):</p>
                            <code className="block bg-dark-900 px-2 py-1 rounded text-accent-300 break-all">
                                {window.location.origin}/api/payments/yoomoney-webhook
                            </code>
                        </div>
                    </div>

                    <button
                        onClick={async () => {
                            setSaving(true);
                            try {
                                await settingsApi.update(yooConfig);
                                toast.success('ЮMoney сохранён');
                            } catch (err) { toast.error(err.message); }
                            finally { setSaving(false); }
                        }}
                        disabled={saving}
                        className="px-4 py-2 btn-primary disabled:opacity-50 flex items-center gap-2"
                    >
                        <Save className="w-4 h-4" /> Сохранить
                    </button>
                </div>
            )}

            {tab === 'smtp' && (
                <div className="glass-card p-6 space-y-4">
                    <h2 className="text-lg font-semibold text-white">SMTP настройки</h2>
                    <p className="text-xs text-gray-400">Для отправки кодов авторизации пользователям через email</p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">SMTP сервер</label>
                            <input
                                value={smtpConfig.smtp_host}
                                onChange={e => setSmtpConfig(p => ({ ...p, smtp_host: e.target.value }))}
                                className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
                                placeholder="smtp.gmail.com"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Порт</label>
                            <input
                                value={smtpConfig.smtp_port}
                                onChange={e => setSmtpConfig(p => ({ ...p, smtp_port: e.target.value }))}
                                className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
                                placeholder="587"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Логин (email)</label>
                            <input
                                value={smtpConfig.smtp_user}
                                onChange={e => setSmtpConfig(p => ({ ...p, smtp_user: e.target.value }))}
                                className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
                                placeholder="user@gmail.com"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Пароль</label>
                            <input
                                type="password"
                                value={smtpConfig.smtp_pass}
                                onChange={e => setSmtpConfig(p => ({ ...p, smtp_pass: e.target.value }))}
                                className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
                                placeholder="••••••••"
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <label className="block text-xs text-gray-400 mb-1">Отправитель (From)</label>
                            <input
                                value={smtpConfig.smtp_from}
                                onChange={e => setSmtpConfig(p => ({ ...p, smtp_from: e.target.value }))}
                                className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
                                placeholder="VPN Panel <noreply@example.com>"
                            />
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={async () => {
                                setSaving(true);
                                try {
                                    await settingsApi.update(smtpConfig);
                                    toast.success('SMTP сохранён');
                                } catch (err) { toast.error(err.message); }
                                finally { setSaving(false); }
                            }}
                            disabled={saving}
                            className="px-4 py-2 btn-primary disabled:opacity-50 flex items-center gap-2"
                        >
                            <Save className="w-4 h-4" /> Сохранить
                        </button>
                        <button
                            onClick={async () => {
                                setSmtpTesting(true);
                                try {
                                    // Сначала сохраняем
                                    await settingsApi.update(smtpConfig);
                                    const result = await fetch('/api/settings/smtp/test', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('vpn_panel_token') },
                                    }).then(r => r.json());
                                    if (result.success) toast.success('SMTP подключение успешно!');
                                    else toast.error(result.error);
                                } catch (err) { toast.error(err.message); }
                                finally { setSmtpTesting(false); }
                            }}
                            disabled={smtpTesting}
                            className="px-4 py-2 bg-dark-600 text-white rounded-lg text-sm hover:bg-dark-500 disabled:opacity-50 flex items-center gap-2"
                        >
                            {smtpTesting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                            Тест подключения
                        </button>
                    </div>

                    {/* Тестовое письмо */}
                    <div className="border-t border-dark-600 pt-4 mt-4">
                        <h3 className="text-sm font-medium text-white mb-2">Отправить тестовое письмо</h3>
                        <div className="flex gap-2">
                            <input
                                type="email"
                                value={smtpTestEmail}
                                onChange={e => setSmtpTestEmail(e.target.value)}
                                className="flex-1 bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
                                placeholder="test@example.com"
                            />
                            <button
                                onClick={async () => {
                                    if (!smtpTestEmail) { toast.error('Введите email'); return; }
                                    try {
                                        const result = await fetch('/api/settings/smtp/send-test', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('vpn_panel_token') },
                                            body: JSON.stringify({ email: smtpTestEmail }),
                                        }).then(r => r.json());
                                        if (result.success) toast.success(result.message);
                                        else toast.error(result.error);
                                    } catch (err) { toast.error(err.message); }
                                }}
                                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 flex items-center gap-2"
                            >
                                <Send className="w-4 h-4" /> Отправить
                            </button>
                        </div>
                    </div>

                    {/* Инструкция */}
                    <div className="bg-dark-700/50 rounded-lg p-3 text-xs text-gray-400 space-y-1">
                        <p className="font-medium text-gray-300">Gmail:</p>
                        <p>Сервер: smtp.gmail.com, Порт: 587</p>
                        <p>Пароль: App Password (Настройки Google → Безопасность → Пароли приложений)</p>
                        <p className="font-medium text-gray-300 mt-2">Yandex:</p>
                        <p>Сервер: smtp.yandex.ru, Порт: 465</p>
                        <p>Пароль: Пароль приложения (Настройки Яндекс ID → Пароли)</p>
                    </div>
                </div>
            )}

            {tab === 'backup' && (
                <div className="glass-card p-5">
                    <h3 className="text-sm font-semibold text-white mb-4">Резервное копирование</h3>
                    <div className="space-y-4">
                        <div className="flex flex-col sm:flex-row gap-3">
                            <button
                                onClick={handleBackup}
                                className="flex items-center justify-center gap-2 px-4 py-3 bg-green-600/20 text-green-400 border border-green-600/30 rounded-lg text-sm hover:bg-green-600/30 transition-colors"
                            >
                                <Download className="w-5 h-5" />
                                <div className="text-left">
                                    <p className="font-medium">Экспорт бэкапа</p>
                                    <p className="text-xs text-green-400/70">Скачать JSON со всеми данными</p>
                                </div>
                            </button>
                            <button
                                onClick={handleRestore}
                                className="flex items-center justify-center gap-2 px-4 py-3 bg-yellow-600/20 text-yellow-400 border border-yellow-600/30 rounded-lg text-sm hover:bg-yellow-600/30 transition-colors"
                            >
                                <Upload className="w-5 h-5" />
                                <div className="text-left">
                                    <p className="font-medium">Импорт бэкапа</p>
                                    <p className="text-xs text-yellow-400/70">Восстановить из JSON-файла</p>
                                </div>
                            </button>
                        </div>
                        <p className="text-xs text-gray-500">
                            Бэкап включает: клиентов, настройки, серверы.
                            Приватные ключи сохраняются в зашифрованном виде.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
