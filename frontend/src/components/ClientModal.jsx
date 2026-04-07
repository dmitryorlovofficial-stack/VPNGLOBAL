// Модальное окно создания/редактирования клиента (мульти-протокол)
// При создании автоматически создаются VLESS-клиенты
import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { clients, servers, xray, groups } from '../api/client';

const XRAY_PROTOCOLS = ['vless'];

export default function ClientModal({ client, onClose, onSaved }) {
    const isEdit = !!client;
    const [form, setForm] = useState({
        name: client?.name || '',
        note: client?.note || '',
        dns: client?.dns || '',
        protocol: client?.protocol || 'vless',
        server_id: client?.server_id || '',
        xray_inbound_id: client?.xray_inbound_id || '',
        client_group_id: client?.client_group_id || '',
    });
    const [loading, setLoading] = useState(false);
    const [serverList, setServerList] = useState([]);
    const [allInbounds, setAllInbounds] = useState([]);
    const [loadingInbounds, setLoadingInbounds] = useState(false);
    const [clientGroupList, setClientGroupList] = useState([]);
    // Режим создания: 'auto' (все протоколы) или 'manual' (один протокол)
    const [createMode, setCreateMode] = useState('auto');

    // Загружаем серверы и группы клиентов при открытии
    useEffect(() => {
        servers.list().then(data => setServerList(data)).catch(() => {});
        groups.clientGroups().then(data => setClientGroupList(data)).catch(() => {});
    }, []);

    // Загружаем inbound'ы при ручном режиме
    useEffect(() => {
        if (createMode !== 'manual' || !XRAY_PROTOCOLS.includes(form.protocol)) {
            setAllInbounds([]);
            return;
        }
        setLoadingInbounds(true);

        const selectedGroup = clientGroupList.find(cg => cg.id === parseInt(form.client_group_id));
        const opts = selectedGroup?.server_group_id
            ? { serverGroupId: selectedGroup.server_group_id }
            : {};

        xray.allInbounds(opts)
            .then(data => setAllInbounds(data))
            .catch(() => setAllInbounds([]))
            .finally(() => setLoadingInbounds(false));
    }, [form.protocol, form.client_group_id, clientGroupList, createMode]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) {
            toast.error('Введите имя клиента');
            return;
        }

        setLoading(true);
        try {
            if (isEdit) {
                await clients.update(client.id, {
                    name: form.name,
                    note: form.note,
                    dns: form.dns,
                });
                toast.success('Клиент обновлён');
            } else if (createMode === 'auto') {
                // Автоматическое создание всех протоколов
                const payload = {
                    name: form.name,
                    note: form.note,
                    auto_all: true,
                };
                if (form.client_group_id) {
                    payload.client_group_id = parseInt(form.client_group_id);
                }
                if (form.dns) payload.dns = form.dns;

                const result = await clients.create(payload);
                const created = Array.isArray(result) ? result : [result];
                const protocols = created.map(c => {
                    if (c.protocol === 'vless') return 'VLESS';
                    return c.protocol;
                });
                toast.success(`Создано: ${protocols.join(', ')}`);
            } else {
                // Ручное создание одного протокола
                const isXray = XRAY_PROTOCOLS.includes(form.protocol);
                if (isXray && !form.xray_inbound_id) {
                    toast.error('Выберите Inbound для Xray-клиента');
                    setLoading(false);
                    return;
                }

                const payload = {
                    name: form.name,
                    note: form.note,
                    protocol: form.protocol,
                };

                if (isXray) {
                    payload.xray_inbound_id = parseInt(form.xray_inbound_id);
                    const selectedInbound = allInbounds.find(ib => ib.id === parseInt(form.xray_inbound_id));
                    payload.server_id = selectedInbound?.server_id;
                    if (form.client_group_id) {
                        payload.client_group_id = parseInt(form.client_group_id);
                    }
                } else {
                    if (form.dns) payload.dns = form.dns;
                    if (form.server_id) payload.server_id = parseInt(form.server_id);
                }

                await clients.create(payload);
                toast.success('Клиент создан');
            }
            onSaved();
        } catch (err) {
            toast.error(err.message);
        } finally {
            setLoading(false);
        }
    };

    const isXray = XRAY_PROTOCOLS.includes(form.protocol);
    const inputClass = 'w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500';

    // Фильтруем inbounds по выбранному протоколу и группируем по серверу
    const filteredInbounds = isXray
        ? allInbounds.filter(ib => ib.protocol === form.protocol)
        : [];

    const groupedInbounds = {};
    for (const ib of filteredInbounds) {
        const serverKey = ib.server_id;
        if (!groupedInbounds[serverKey]) {
            groupedInbounds[serverKey] = {
                serverName: ib.server_name,
                serverIp: ib.server_ip,
                serverDomain: ib.server_domain,
                inbounds: [],
            };
        }
        groupedInbounds[serverKey].inbounds.push(ib);
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-dark-600">
                    <h2 className="text-lg font-semibold text-white">
                        {isEdit ? 'Редактирование клиента' : 'Новый клиент'}
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    {/* Режим создания (только при создании) */}
                    {!isEdit && (
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">Режим</label>
                            <div className="grid grid-cols-2 gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => setCreateMode('auto')}
                                    className={`px-2 py-2 rounded-lg text-xs font-medium transition-colors border ${
                                        createMode === 'auto'
                                            ? 'bg-green-600/20 border-green-500 text-green-400'
                                            : 'bg-dark-700 border-dark-600 text-gray-400 hover:border-dark-500'
                                    }`}
                                >
                                    Все протоколы
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setCreateMode('manual')}
                                    className={`px-2 py-2 rounded-lg text-xs font-medium transition-colors border ${
                                        createMode === 'manual'
                                            ? 'bg-accent-500/15 border-accent-500 text-accent-400'
                                            : 'bg-dark-700 border-dark-600 text-gray-400 hover:border-dark-500'
                                    }`}
                                >
                                    Один протокол
                                </button>
                            </div>
                            {createMode === 'auto' && (
                                <p className="text-[10px] text-gray-500 mt-1.5">Автоматически создаст VLESS на всех серверах</p>
                            )}
                        </div>
                    )}

                    {/* Протокол (только при ручном создании) */}
                    {!isEdit && createMode === 'manual' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">Протокол</label>
                            <div className="grid grid-cols-2 gap-1.5">
                                {[
                                    { value: 'vless', label: 'VLESS', active: 'bg-purple-600/20 border-purple-500 text-purple-400' },
                                ].map(p => (
                                    <button
                                        key={p.value}
                                        type="button"
                                        onClick={() => setForm(f => ({ ...f, protocol: p.value, xray_inbound_id: '', server_id: '' }))}
                                        className={`px-2 py-2 rounded-lg text-xs font-medium transition-colors border ${
                                            form.protocol === p.value
                                                ? p.active
                                                : 'bg-dark-700 border-dark-600 text-gray-400 hover:border-dark-500'
                                        }`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Имя */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Имя *</label>
                        <input
                            type="text"
                            value={form.name}
                            onChange={e => setForm({ ...form, name: e.target.value })}
                            className={inputClass}
                            placeholder="Например: iPhone Иванов"
                        />
                    </div>

                    {/* Заметка */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Заметка</label>
                        <textarea
                            value={form.note}
                            onChange={e => setForm({ ...form, note: e.target.value })}
                            className={`${inputClass} resize-none`}
                            rows={2}
                            placeholder="Дополнительная информация..."
                        />
                    </div>

                    {/* Группа клиентов (авто-режим или Xray ручной) */}
                    {!isEdit && (createMode === 'auto' || isXray) && clientGroupList.length > 0 && (
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1.5">Группа клиентов</label>
                            <select
                                value={form.client_group_id}
                                onChange={e => setForm({ ...form, client_group_id: e.target.value, xray_inbound_id: '' })}
                                className={inputClass}
                            >
                                <option value="">Без группы</option>
                                {clientGroupList.map(cg => (
                                    <option key={cg.id} value={cg.id}>
                                        {cg.name} {cg.server_group_name ? `(${cg.server_group_name})` : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Xray Inbound (только ручной режим) */}
                    {!isEdit && createMode === 'manual' && isXray && (
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1.5">
                                Inbound *
                                {loadingInbounds && <Loader2 className="w-3 h-3 animate-spin inline ml-1" />}
                            </label>
                            {filteredInbounds.length === 0 && !loadingInbounds ? (
                                <p className="text-xs text-yellow-400 bg-yellow-600/10 px-3 py-2 rounded-lg">
                                    Нет inbounds с протоколом {form.protocol}
                                    {form.client_group_id ? ' в выбранной группе серверов' : ''}.
                                    Создайте inbound в настройках сервера.
                                </p>
                            ) : (
                                <select
                                    value={form.xray_inbound_id}
                                    onChange={e => setForm({ ...form, xray_inbound_id: e.target.value })}
                                    className={inputClass}
                                >
                                    <option value="">Выберите inbound...</option>
                                    {Object.entries(groupedInbounds).map(([serverId, group]) => (
                                        <optgroup key={serverId} label={`${group.serverName} (${group.serverDomain || group.serverIp})`}>
                                            {group.inbounds.map(ib => (
                                                <option key={ib.id} value={ib.id}>
                                                    {ib.tag} (:{ib.port}) — {ib.clients_count || 0} кл.
                                                </option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </select>
                            )}
                        </div>
                    )}

                    {/* Info при редактировании */}
                    {isEdit && (
                        <div className="text-xs text-gray-500 bg-dark-900/50 px-3 py-2 rounded-lg">
                            Протокол: <span className="text-gray-300 font-medium">{client.protocol}</span>
                            {client.xray_uuid && <> | UUID: <span className="text-gray-300 font-mono">{client.xray_uuid}</span></>}
                            {client.ip_address && <> | IP: <span className="text-gray-300">{client.ip_address}</span></>}
                        </div>
                    )}

                    {/* Кнопки */}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2.5 bg-dark-700 text-gray-300 rounded-lg text-sm font-medium hover:bg-dark-600 transition-colors"
                        >
                            Отмена
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 px-4 py-2.5 btn-primary transition-colors disabled:opacity-50"
                        >
                            {loading ? 'Создание...' : isEdit ? 'Сохранить' : 'Создать'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
