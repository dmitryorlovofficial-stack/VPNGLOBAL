// Страница управления пользователями панели (только для admin)
import { useState, useEffect } from 'react';
import { UserPlus, Trash2, Edit2, Save, X, Users as UsersIcon, Shuffle, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { users } from '../api/client';

// Генерация случайного пароля
function generatePassword(length = 16) {
    const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&';
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, b => chars[b % chars.length]).join('');
}

export default function UsersPage() {
    const [userList, setUserList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [editId, setEditId] = useState(null);
    const [form, setForm] = useState({ username: '', password: '', max_vpn_clients: 5 });
    const [editForm, setEditForm] = useState({ max_vpn_clients: 5, password: '' });
    const [showFormPassword, setShowFormPassword] = useState(false);
    const [showEditPassword, setShowEditPassword] = useState(false);

    const fetchUsers = async () => {
        try {
            const data = await users.list();
            setUserList(data);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchUsers(); }, []);

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!form.username || !form.password) {
            toast.error('Заполните логин и пароль');
            return;
        }
        try {
            await users.create(form);
            toast.success('Пользователь создан');
            setShowCreate(false);
            setForm({ username: '', password: '', max_vpn_clients: 5 });
            setShowFormPassword(false);
            fetchUsers();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleUpdate = async (id) => {
        try {
            const data = {};
            if (editForm.max_vpn_clients !== undefined) data.max_vpn_clients = editForm.max_vpn_clients;
            if (editForm.password) data.password = editForm.password;
            await users.update(id, data);
            toast.success('Пользователь обновлён');
            setEditId(null);
            setShowEditPassword(false);
            fetchUsers();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleDelete = async (id, username) => {
        if (!confirm(`Удалить пользователя ${username}? Все его VPN-клиенты будут удалены!`)) return;
        try {
            await users.remove(id);
            toast.success('Пользователь удалён');
            fetchUsers();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const startEdit = (user) => {
        setEditId(user.id);
        setEditForm({
            max_vpn_clients: user.max_vpn_clients,
            password: '',
        });
        setShowEditPassword(false);
    };

    const handleGenFormPassword = () => {
        const pw = generatePassword();
        setForm({...form, password: pw});
        setShowFormPassword(true);
    };

    const handleGenEditPassword = () => {
        const pw = generatePassword();
        setEditForm({...editForm, password: pw});
        setShowEditPassword(true);
    };

    if (loading) return <div className="text-gray-400 p-8">Загрузка...</div>;

    return (
        <div className="space-y-6">
            {/* Заголовок */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <UsersIcon className="w-6 h-6 text-accent-400" />
                    <h1 className="text-xl font-bold text-white">Пользователи панели</h1>
                    <span className="text-sm text-gray-400">({userList.length})</span>
                </div>
                <button
                    onClick={() => setShowCreate(!showCreate)}
                    className="flex items-center gap-2 px-4 py-2 btn-primary"
                >
                    <UserPlus className="w-4 h-4" />
                    Создать
                </button>
            </div>

            {/* Форма создания */}
            {showCreate && (
                <form onSubmit={handleCreate} className="glass-card p-5 space-y-4">
                    <h3 className="text-sm font-medium text-gray-300">Новый пользователь</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Логин</label>
                            <input
                                type="text"
                                value={form.username}
                                onChange={e => setForm({...form, username: e.target.value})}
                                className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
                                placeholder="username"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Пароль</label>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <input
                                        type={showFormPassword ? 'text' : 'password'}
                                        value={form.password}
                                        onChange={e => setForm({...form, password: e.target.value})}
                                        className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 pr-9 text-sm text-white focus:outline-none focus:border-accent-500"
                                        placeholder="min 6 символов"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowFormPassword(!showFormPassword)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                                    >
                                        {showFormPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleGenFormPassword}
                                    className="px-2.5 py-2 bg-dark-600 text-gray-300 rounded-lg hover:bg-dark-500 transition-colors"
                                    title="Сгенерировать пароль"
                                >
                                    <Shuffle className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Лимит VPN-клиентов</label>
                            <input
                                type="number"
                                value={form.max_vpn_clients}
                                onChange={e => setForm({...form, max_vpn_clients: parseInt(e.target.value) || 0})}
                                className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
                                min="0" max="100"
                            />
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button type="submit" className="px-4 py-2 btn-primary">
                            Создать
                        </button>
                        <button type="button" onClick={() => { setShowCreate(false); setShowFormPassword(false); }} className="px-4 py-2 bg-dark-700 text-gray-300 rounded-lg text-sm hover:bg-dark-600">
                            Отмена
                        </button>
                    </div>
                </form>
            )}

            {/* Таблица пользователей */}
            <div className="glass-card overflow-hidden">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-dark-700">
                            <th className="text-left px-4 py-3 text-gray-400 font-medium">Пользователь</th>
                            <th className="text-left px-4 py-3 text-gray-400 font-medium">Роль</th>
                            <th className="text-center px-4 py-3 text-gray-400 font-medium">VPN</th>
                            <th className="text-right px-4 py-3 text-gray-400 font-medium">Действия</th>
                        </tr>
                    </thead>
                    <tbody>
                        {userList.map(user => (
                            <tr key={user.id} className="border-b border-dark-700/50 hover:bg-dark-700/30">
                                <td className="px-4 py-3 text-white font-medium">{user.username}</td>
                                <td className="px-4 py-3">
                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                        user.role === 'admin' ? 'bg-red-600/20 text-red-400' : 'bg-accent-500/15 text-accent-400'
                                    }`}>
                                        {user.role === 'admin' ? 'Админ' : 'Пользователь'}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                    {editId === user.id ? (
                                        <input
                                            type="number" min="0" max="100"
                                            value={editForm.max_vpn_clients}
                                            onChange={e => setEditForm({...editForm, max_vpn_clients: parseInt(e.target.value) || 0})}
                                            className="w-16 bg-dark-700 border border-dark-600 rounded px-2 py-1 text-sm text-white text-center"
                                        />
                                    ) : (
                                        <span className="text-gray-300">
                                            {user.role === 'admin' ? <span title="Без ограничений">{user.vpn_count ?? '-'} / &infin;</span>
                                                : <>{user.vpn_count ?? '-'} / {user.max_vpn_clients}</>}
                                        </span>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-right">
                                    {user.role !== 'admin' && (
                                        <div className="flex items-center justify-end gap-1">
                                            {editId === user.id ? (
                                                <>
                                                    <div className="flex items-center gap-1">
                                                        <div className="relative">
                                                            <input
                                                                type={showEditPassword ? 'text' : 'password'}
                                                                placeholder="Новый пароль"
                                                                value={editForm.password}
                                                                onChange={e => setEditForm({...editForm, password: e.target.value})}
                                                                className="w-32 bg-dark-700 border border-dark-600 rounded px-2 py-1 pr-7 text-sm text-white"
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => setShowEditPassword(!showEditPassword)}
                                                                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                                                            >
                                                                {showEditPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                                            </button>
                                                        </div>
                                                        <button onClick={handleGenEditPassword} className="p-1.5 text-gray-400 hover:text-accent-400 hover:bg-dark-600 rounded" title="Сгенерировать">
                                                            <Shuffle className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                    <button onClick={() => handleUpdate(user.id)} className="p-1.5 text-green-400 hover:bg-dark-600 rounded">
                                                        <Save className="w-4 h-4" />
                                                    </button>
                                                    <button onClick={() => { setEditId(null); setShowEditPassword(false); }} className="p-1.5 text-gray-400 hover:bg-dark-600 rounded">
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button onClick={() => startEdit(user)} className="p-1.5 text-accent-400 hover:bg-dark-600 rounded" title="Редактировать">
                                                        <Edit2 className="w-4 h-4" />
                                                    </button>
                                                    <button onClick={() => handleDelete(user.id, user.username)} className="p-1.5 text-red-400 hover:bg-dark-600 rounded" title="Удалить">
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {userList.length === 0 && (
                    <div className="text-center text-gray-500 py-8">Нет пользователей</div>
                )}
            </div>
        </div>
    );
}
