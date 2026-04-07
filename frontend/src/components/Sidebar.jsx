// Боковая навигация
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { CreditCard, LayoutDashboard, Wifi, Server, Activity, GitBranch, Settings, LogOut, Shield, X, UserCog, KeyRound, Layers } from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { auth } from '../api/client';

// Элементы навигации: adminOnly = true — только для admin
const NAV_ITEMS = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/clients', icon: Wifi, label: 'VPN' },
    { to: '/servers', icon: Server, label: 'Серверы', adminOnly: true },
    { to: '/monitoring', icon: Activity, label: 'Мониторинг', adminOnly: true },
    { to: '/routing', icon: GitBranch, label: 'Маршрутизация', adminOnly: true },
    { to: '/adguard', icon: Shield, label: 'AdGuard DNS', adminOnly: true },
    { to: '/groups', icon: Layers, label: 'Группы', adminOnly: true },
    { to: '/users', icon: UserCog, label: 'Пользователи', adminOnly: true },
    { to: '/tariffs', icon: CreditCard, label: 'Тарифы', adminOnly: true },
        { to: '/settings', icon: Settings, label: 'Настройки', adminOnly: true },
];

export default function Sidebar({ isOpen, onClose, onLogout, user }) {
    const location = useLocation();
    const isAdmin = user?.role === 'admin';
    const [showPwModal, setShowPwModal] = useState(false);
    const [pwForm, setPwForm] = useState({ old: '', new: '', confirm: '' });
    const [pwLoading, setPwLoading] = useState(false);

    // Фильтруем пункты меню по роли
    const visibleItems = NAV_ITEMS.filter(item => !item.adminOnly || isAdmin);

    const handleChangePassword = async (e) => {
        e.preventDefault();
        if (pwForm.new !== pwForm.confirm) {
            toast.error('Пароли не совпадают');
            return;
        }
        if (pwForm.new.length < 6) {
            toast.error('Минимум 6 символов');
            return;
        }
        setPwLoading(true);
        try {
            await auth.changePassword(pwForm.old, pwForm.new);
            toast.success('Пароль изменён');
            setShowPwModal(false);
            setPwForm({ old: '', new: '', confirm: '' });
        } catch (err) {
            toast.error(err.message);
        }
        setPwLoading(false);
    };

    return (
        <>
            {/* Оверлей для мобильных */}
            {isOpen && (
                <div className="lg:hidden fixed inset-0 bg-black/50 z-40" onClick={onClose} />
            )}

            <aside className={clsx(
                'fixed lg:static inset-y-0 left-0 z-50 w-64 bg-dark-800 border-r border-dark-700',
                'flex flex-col transition-transform duration-300 ease-in-out',
                isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
            )}>
                {/* Логотип */}
                <div className="flex items-center justify-between p-4 border-b border-dark-700">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-gradient-to-br from-accent-400 to-accent-600 rounded-lg flex items-center justify-center shadow-glow-sm">
                            <Shield className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-white">VPN Panel</h1>
                            <p className="text-xs text-dark-300">
                                {user?.username || '...'} {isAdmin ? '' : '(user)'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="lg:hidden text-gray-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Навигация */}
                <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                    {visibleItems.map(({ to, icon: Icon, label }) => (
                        <NavLink
                            key={to}
                            to={to}
                            end={to === '/'}
                            onClick={onClose}
                            className={({ isActive }) => clsx(
                                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                                isActive
                                    ? 'bg-accent-500/10 text-accent-400 border-l-2 border-accent-400 shadow-glow-sm'
                                    : 'text-gray-400 hover:text-accent-300 hover:bg-dark-700/50 border-l-2 border-transparent'
                            )}
                        >
                            <Icon className="w-5 h-5 flex-shrink-0" />
                            {label}
                        </NavLink>
                    ))}
                </nav>

                {/* Лимиты для обычных пользователей */}
                {!isAdmin && user && (
                    <div className="px-4 py-3 border-t border-dark-700 text-xs text-gray-500 space-y-1">
                        <div>VPN: {user.vpn_count ?? 0} / {user.max_vpn_clients}</div>
                    </div>
                )}

                {/* Смена пароля + Выход */}
                <div className="p-3 border-t border-dark-700 space-y-1">
                    <button
                        onClick={() => setShowPwModal(true)}
                        className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-dark-700 transition-colors"
                    >
                        <KeyRound className="w-5 h-5" />
                        Сменить пароль
                    </button>
                    <button
                        onClick={onLogout}
                        className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-dark-700 transition-colors"
                    >
                        <LogOut className="w-5 h-5" />
                        Выйти
                    </button>
                </div>
            </aside>

            {/* Модалка смены пароля */}
            {showPwModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={() => setShowPwModal(false)}>
                    <div className="glass-card w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-dark-700">
                            <h2 className="text-lg font-semibold text-white">Смена пароля</h2>
                        </div>
                        <form onSubmit={handleChangePassword} className="p-5 space-y-4">
                            <div>
                                <label className="block text-sm text-gray-300 mb-1">Текущий пароль</label>
                                <input
                                    type="password"
                                    value={pwForm.old}
                                    onChange={e => setPwForm({ ...pwForm, old: e.target.value })}
                                    className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-300 mb-1">Новый пароль</label>
                                <input
                                    type="password"
                                    value={pwForm.new}
                                    onChange={e => setPwForm({ ...pwForm, new: e.target.value })}
                                    className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500"
                                    placeholder="мин. 6 символов"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-300 mb-1">Подтверждение</label>
                                <input
                                    type="password"
                                    value={pwForm.confirm}
                                    onChange={e => setPwForm({ ...pwForm, confirm: e.target.value })}
                                    className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500"
                                    required
                                />
                            </div>
                            <div className="flex gap-3">
                                <button type="button" onClick={() => setShowPwModal(false)} className="flex-1 px-4 py-2.5 bg-dark-700 text-gray-300 rounded-lg text-sm hover:bg-dark-600">
                                    Отмена
                                </button>
                                <button type="submit" disabled={pwLoading} className="flex-1 px-4 py-2.5 bg-gradient-to-r from-accent-500 to-accent-600 text-white shadow-glow-sm rounded-lg text-sm hover:bg-accent-600 disabled:opacity-50">
                                    {pwLoading ? 'Сохранение...' : 'Сохранить'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
}
