import { useState, useEffect } from 'react';
import { Plus, Trash2, Save, Edit2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { tariffs as tariffsApi } from '../api/client';

export default function Tariffs() {
    const [list, setList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editId, setEditId] = useState(null);
    const [form, setForm] = useState({ name: '', duration_days: 30, price: 200, description: '', is_active: true, sort_order: 0 });

    const fetch = async () => {
        try {
            const data = await tariffsApi.all();
            setList(data);
        } catch {} finally { setLoading(false); }
    };

    useEffect(() => { fetch(); }, []);

    const handleSave = async () => {
        if (!form.name || !form.price) { toast.error('Заполните название и цену'); return; }
        try {
            if (editId) {
                await tariffsApi.update(editId, form);
                toast.success('Тариф обновлён');
            } else {
                await tariffsApi.create(form);
                toast.success('Тариф создан');
            }
            setEditId(null);
            setForm({ name: '', duration_days: 30, price: 200, description: '', is_active: true, sort_order: 0 });
            fetch();
        } catch (err) { toast.error(err.message); }
    };

    const handleDelete = async (id) => {
        if (!confirm('Удалить тариф?')) return;
        try {
            await tariffsApi.remove(id);
            toast.success('Удалён');
            fetch();
        } catch (err) { toast.error(err.message); }
    };

    const startEdit = (t) => {
        setEditId(t.id);
        setForm({ name: t.name, duration_days: t.duration_days, price: t.price, description: t.description || '', is_active: t.is_active, sort_order: t.sort_order });
    };

    if (loading) return <div className="text-gray-500 text-center py-20">Загрузка...</div>;

    return (
        <div className="space-y-6 animate-fade-in">
            <h1 className="text-2xl font-bold text-white">Тарифы</h1>

            <div className="bg-dark-800 border border-dark-700 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-semibold text-white">{editId ? 'Редактировать тариф' : 'Новый тариф'}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                        className="bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white" placeholder="Название" />
                    <input type="number" value={form.duration_days} onChange={e => setForm({...form, duration_days: parseInt(e.target.value) || 0})}
                        className="bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white" placeholder="Дней" />
                    <input type="number" value={form.price} onChange={e => setForm({...form, price: parseFloat(e.target.value) || 0})}
                        className="bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white" placeholder="Цена ₽" />
                    <input type="number" value={form.sort_order} onChange={e => setForm({...form, sort_order: parseInt(e.target.value) || 0})}
                        className="bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white" placeholder="Порядок" />
                </div>
                <input value={form.description} onChange={e => setForm({...form, description: e.target.value})}
                    className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white" placeholder="Описание" />
                <div className="flex gap-2">
                    <label className="flex items-center gap-2 text-sm text-gray-300">
                        <input type="checkbox" checked={form.is_active} onChange={e => setForm({...form, is_active: e.target.checked})} />
                        Активен
                    </label>
                    <button onClick={handleSave} className="ml-auto px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-2">
                        <Save className="w-4 h-4" /> {editId ? 'Сохранить' : 'Создать'}
                    </button>
                    {editId && <button onClick={() => { setEditId(null); setForm({ name: '', duration_days: 30, price: 200, description: '', is_active: true, sort_order: 0 }); }}
                        className="px-4 py-2 bg-dark-600 text-gray-300 rounded-lg text-sm">Отмена</button>}
                </div>
            </div>

            <div className="bg-dark-800 border border-dark-700 rounded-xl overflow-hidden">
                <table className="w-full">
                    <thead><tr className="border-b border-dark-700 text-xs text-gray-400">
                        <th className="p-3 text-left">Название</th>
                        <th className="p-3 text-center">Дней</th>
                        <th className="p-3 text-center">Цена</th>
                        <th className="p-3 text-center">Статус</th>
                        <th className="p-3 text-center">Действия</th>
                    </tr></thead>
                    <tbody>
                        {list.map(t => (
                            <tr key={t.id} className="border-b border-dark-700/50 hover:bg-dark-700/30">
                                <td className="p-3 text-sm text-white">{t.name}<br/><span className="text-[10px] text-gray-500">{t.description}</span></td>
                                <td className="p-3 text-sm text-center text-gray-300">{t.duration_days}</td>
                                <td className="p-3 text-sm text-center text-green-400 font-medium">{t.price} ₽</td>
                                <td className="p-3 text-center">{t.is_active
                                    ? <span className="text-[10px] px-2 py-0.5 bg-green-500/20 text-green-400 rounded">Активен</span>
                                    : <span className="text-[10px] px-2 py-0.5 bg-red-500/20 text-red-400 rounded">Отключён</span>}</td>
                                <td className="p-3 text-center">
                                    <button onClick={() => startEdit(t)} className="p-1 text-gray-400 hover:text-blue-400"><Edit2 className="w-4 h-4" /></button>
                                    <button onClick={() => handleDelete(t.id)} className="p-1 text-gray-400 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                                </td>
                            </tr>
                        ))}
                        {list.length === 0 && <tr><td colSpan="5" className="p-6 text-center text-gray-500">Нет тарифов. Создайте первый.</td></tr>}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
