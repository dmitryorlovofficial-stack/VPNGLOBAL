// Модальное окно добавления/редактирования сервера
import { useState } from 'react';
import { X, Loader2, CheckCircle, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { servers } from '../api/client';

const AUTH_TYPES = [
    { value: 'password', label: 'Пароль' },
    { value: 'key', label: 'SSH-ключ' },
];

export default function ServerModal({ server, onClose, onSaved }) {
    const isEdit = !!server;
    const [form, setForm] = useState({
        name: server?.name || '',
        description: server?.description || '',
        host: server?.host || '',
        domain: server?.domain || '',
        ssh_port: server?.ssh_port || 22,
        ssh_user: server?.ssh_user || 'root',
        ssh_auth_type: server?.ssh_auth_type || 'password',
        ssh_password: '',
        ssh_key: server?.ssh_key || '',
        ssh_key_passphrase: server?.ssh_key_passphrase || '',
    });
    const [loading, setLoading] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [testing, setTesting] = useState(false);

    const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

    const handleTest = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            let result;
            if (isEdit) {
                result = await servers.test(server.id);
            } else {
                result = await servers.testNew({
                    host: form.host,
                    ssh_port: form.ssh_port,
                    ssh_user: form.ssh_user,
                    ssh_auth_type: form.ssh_auth_type,
                    ssh_password: form.ssh_password,
                    ssh_key: form.ssh_key,
                    ssh_key_passphrase: form.ssh_key_passphrase,
                });
            }
            setTestResult(result);
            if (result.connected) {
                toast.success('Подключение успешно');
            } else {
                toast.error(result.error || 'Не удалось подключиться');
            }
        } catch (err) {
            setTestResult({ connected: false, error: err.message });
            toast.error(err.message);
        }
        setTesting(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) {
            toast.error('Введите имя сервера');
            return;
        }
        if (!form.host.trim()) {
            toast.error('Введите IP-адрес сервера');
            return;
        }

        setLoading(true);
        try {
            const data = { ...form };
            // Не отправляем пустой пароль при редактировании
            if (isEdit && !data.ssh_password) {
                delete data.ssh_password;
            }

            if (isEdit) {
                await servers.update(server.id, data);
                toast.success('Сервер обновлён');
            } else {
                await servers.create(data);
                toast.success('Сервер добавлен');
            }
            onSaved();
        } catch (err) {
            toast.error(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content max-w-xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-dark-600">
                    <h2 className="text-lg font-semibold text-white">
                        {isEdit ? 'Редактирование сервера' : 'Добавить сервер'}
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                    {/* Имя и описание */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Имя сервера *</label>
                        <input
                            type="text"
                            value={form.name}
                            onChange={e => set('name', e.target.value)}
                            className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500"
                            placeholder="DE-1"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Описание</label>
                        <input
                            type="text"
                            value={form.description}
                            onChange={e => set('description', e.target.value)}
                            className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500"
                            placeholder="Hetzner, Falkenstein, DE"
                        />
                    </div>

                    {/* Подключение */}
                    <div className="border-t border-dark-700 pt-4">
                        <h3 className="text-sm font-medium text-gray-300 mb-3">Подключение</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="sm:col-span-2">
                                <label className="block text-xs text-gray-400 mb-1">IP-адрес *</label>
                                <input
                                    type="text"
                                    value={form.host}
                                    onChange={e => set('host', e.target.value)}
                                    className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500"
                                    placeholder="185.123.45.67"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">SSH-порт</label>
                                <input
                                    type="number"
                                    value={form.ssh_port}
                                    onChange={e => set('ssh_port', parseInt(e.target.value) || 22)}
                                    className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500"
                                />
                            </div>
                        </div>
                        <div className="mt-3">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Домен <span className="text-gray-600">(VLESS/Xray)</span></label>
                                <input
                                    type="text"
                                    value={form.domain}
                                    onChange={e => set('domain', e.target.value)}
                                    className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500"
                                    placeholder="vpn.example.com"
                                />
                            </div>
                        </div>
                    </div>

                    {/* SSH авторизация */}
                    <div className="border-t border-dark-700 pt-4">
                        <h3 className="text-sm font-medium text-gray-300 mb-3">SSH-авторизация</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Пользователь</label>
                                <input
                                    type="text"
                                    value={form.ssh_user}
                                    onChange={e => set('ssh_user', e.target.value)}
                                    className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Тип авторизации</label>
                                <select
                                    value={form.ssh_auth_type}
                                    onChange={e => set('ssh_auth_type', e.target.value)}
                                    className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500"
                                >
                                    {AUTH_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                </select>
                            </div>
                        </div>

                        {form.ssh_auth_type === 'password' ? (
                            <div className="mt-3">
                                <label className="block text-xs text-gray-400 mb-1">
                                    Пароль SSH {isEdit && <span className="text-gray-500">(оставьте пустым, чтобы не менять)</span>}
                                </label>
                                <input
                                    type="password"
                                    value={form.ssh_password}
                                    onChange={e => set('ssh_password', e.target.value)}
                                    className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500"
                                    placeholder="••••••••"
                                />
                            </div>
                        ) : (
                            <div className="mt-3">
                                <label className="block text-xs text-gray-400 mb-1">Приватный SSH-ключ</label>
                                <textarea
                                    value={form.ssh_key}
                                    onChange={e => set('ssh_key', e.target.value)}
                                    className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500 font-mono resize-none"
                                    rows={4}
                                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                                />
                                <label className="block text-xs text-gray-400 mb-1 mt-3">Passphrase (если ключ зашифрован)</label>
                                <input
                                    type="password"
                                    value={form.ssh_key_passphrase}
                                    onChange={e => set("ssh_key_passphrase", e.target.value)}
                                    className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500"
                                    placeholder="Оставьте пустым если ключ без пароля"
                                />
                            </div>
                        )}
                    </div>

                    {/* Результат теста */}
                    {testResult && (
                        <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${testResult.connected ? 'bg-green-600/10 text-green-400' : 'bg-red-600/10 text-red-400'}`}>
                            {testResult.connected ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                            {testResult.connected
                                ? `Подключение OK${testResult.hostname ? ` (${testResult.hostname})` : ''}`
                                : `Ошибка: ${testResult.error || 'Не удалось подключиться'}`}
                        </div>
                    )}

                    {/* Кнопки */}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={handleTest}
                            disabled={testing || (!form.host && !isEdit)}
                            className="px-4 py-2.5 bg-dark-600 text-gray-300 rounded-lg text-sm font-medium hover:bg-dark-500 transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                            Тест SSH
                        </button>
                        <div className="flex-1" />
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2.5 bg-dark-700 text-gray-300 rounded-lg text-sm font-medium hover:bg-dark-600 transition-colors"
                        >
                            Отмена
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-4 py-2.5 btn-primary transition-colors disabled:opacity-50"
                        >
                            {loading ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Добавить'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
