// Модальное окно создания маршрута (Entry → Exit)
import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, ArrowRight, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { tunnels } from '../api/client';

export default function TunnelModal({ serverList, existingTunnels = [], onClose, onSaved }) {
    // Определяем роли серверов из существующих маршрутов
    const roles = useMemo(() => {
        const entryIds = new Set();
        const exitIds = new Set();
        for (const t of (existingTunnels || [])) {
            entryIds.add(t.from_server_id);
            exitIds.add(t.to_server_id);
        }
        return { entryIds, exitIds };
    }, [existingTunnels]);

    // Серверы доступные как Entry: не являются Exit в другом маршруте
    const availableEntryServers = useMemo(() => {
        return (serverList || []).filter(s => !roles.exitIds.has(s.id));
    }, [serverList, roles]);

    // Серверы доступные как Exit: не являются Entry в другом маршруте
    const availableExitServers = useMemo(() => {
        return (serverList || []).filter(s => !roles.entryIds.has(s.id));
    }, [serverList, roles]);

    const [form, setForm] = useState({
        from_server_id: '',
        to_server_id: '',
        endpoint_mode: 'ipv4',
        xray_protocol: 'vless',
        xray_port: 443,
        xray_network: 'tcp',
        xray_security: 'reality',
        xray_flow: 'xtls-rprx-vision',
        xray_sni: 'www.google.com',
        xray_fingerprint: 'chrome',
    });
    const [loading, setLoading] = useState(false);
    const initialFormRef = useRef(null);
    useEffect(() => { if (!initialFormRef.current) initialFormRef.current = JSON.stringify(form); }, []);
    const isDirty = () => initialFormRef.current && JSON.stringify(form) !== initialFormRef.current;
    const handleClose = () => { if (isDirty() && !confirm('Есть несохранённые изменения. Закрыть?')) return; onClose(); };

    const selectedEntry = serverList?.find(s => String(s.id) === String(form.from_server_id));
    const selectedExit = serverList?.find(s => String(s.id) === String(form.to_server_id));

    // Динамическая фильтрация: при выборе Entry убираем его из Exit и наоборот
    const filteredExitServers = useMemo(() => {
        return availableExitServers.filter(s => String(s.id) !== String(form.from_server_id));
    }, [availableExitServers, form.from_server_id]);

    const filteredEntryServers = useMemo(() => {
        return availableEntryServers.filter(s => String(s.id) !== String(form.to_server_id));
    }, [availableEntryServers, form.to_server_id]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.from_server_id || !form.to_server_id) {
            toast.error('Выберите Entry и Exit серверы');
            return;
        }
        if (form.from_server_id === form.to_server_id) {
            toast.error('Entry и Exit должны быть разными серверами');
            return;
        }

        setLoading(true);
        try {
            const entrySrv = serverList.find(s => s.id === parseInt(form.from_server_id));
            const exitSrv = serverList.find(s => s.id === parseInt(form.to_server_id));

            const payload = {
                name: `${entrySrv?.name || 'Entry'} → ${exitSrv?.name || 'Exit'}`,
                link_type: 'xray',
                from_server_id: parseInt(form.from_server_id),
                to_server_id: parseInt(form.to_server_id),
                endpoint_mode: form.endpoint_mode,
                xray_protocol: form.xray_protocol,
                xray_port: parseInt(form.xray_port),
            };

            const xraySettings = {};
            if (form.xray_protocol === 'vless' && form.xray_flow) {
                xraySettings.flow = form.xray_flow;
            }
            payload.xray_settings = xraySettings;

            const streamSettings = {
                network: form.xray_network,
                security: form.xray_security,
            };

            if (form.xray_security === 'reality') {
                streamSettings.realitySettings = {
                    serverNames: [form.xray_sni || 'www.google.com'],
                    fingerprint: form.xray_fingerprint || 'chrome',
                    spiderX: '/',
                };
            } else if (form.xray_security === 'tls') {
                streamSettings.tlsSettings = {
                    serverName: form.xray_sni || '',
                    fingerprint: form.xray_fingerprint || 'chrome',
                    alpn: ['h2', 'http/1.1'],
                };
            }

            payload.xray_stream_settings = streamSettings;

            await tunnels.create(payload);
            toast.success('Маршрут создан');
            onSaved();
        } catch (err) {
            toast.error(err.message);
        }
        setLoading(false);
    };

    const inputClass = 'w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500';

    // Роль сервера для отображения в dropdown
    const serverLabel = (s) => {
        const role = roles.entryIds.has(s.id) ? ' [Entry]' : roles.exitIds.has(s.id) ? ' [Exit]' : '';
        return `${s.name} (${s.domain || s.ipv4 || s.host})${role}`;
    };

    return createPortal(
        <div className="modal-overlay" onClick={handleClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-dark-600/50">
                    <h2 className="text-lg font-semibold text-white">Новый маршрут</h2>
                    <button onClick={handleClose} className="text-gray-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    {/* Схема маршрута */}
                    <div className="flex items-center gap-3 p-3 bg-dark-700/50 rounded-lg border border-dark-600">
                        <div className="flex-1">
                            <div className="text-[9px] text-accent-400 font-semibold uppercase tracking-wider mb-1">Entry (вход)</div>
                            <div className="text-xs text-gray-300">
                                {selectedEntry ? selectedEntry.name : 'Не выбран'}
                            </div>
                            {selectedEntry && (
                                <div className="text-[10px] text-gray-500 mt-0.5">
                                    {selectedEntry.domain || selectedEntry.ipv4 || selectedEntry.host}
                                </div>
                            )}
                        </div>
                        <ArrowRight className="w-5 h-5 text-purple-400 flex-shrink-0" />
                        <div className="flex-1 text-right">
                            <div className="text-[9px] text-orange-400 font-semibold uppercase tracking-wider mb-1">Exit (выход)</div>
                            <div className="text-xs text-gray-300">
                                {selectedExit ? selectedExit.name : 'Не выбран'}
                            </div>
                            {selectedExit && (
                                <div className="text-[10px] text-gray-500 mt-0.5">
                                    {selectedExit.domain || selectedExit.ipv4 || selectedExit.host}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Entry + Exit */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-accent-400 mb-1.5">Entry (вход) *</label>
                            <select
                                value={form.from_server_id}
                                onChange={e => setForm({ ...form, from_server_id: e.target.value })}
                                className={inputClass}
                            >
                                <option value="">Выберите...</option>
                                {filteredEntryServers.map(s => (
                                    <option key={s.id} value={s.id}>{serverLabel(s)}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-orange-400 mb-1.5">Exit (выход) *</label>
                            <select
                                value={form.to_server_id}
                                onChange={e => setForm({ ...form, to_server_id: e.target.value })}
                                className={inputClass}
                            >
                                <option value="">Выберите...</option>
                                {filteredExitServers.map(s => (
                                    <option key={s.id} value={s.id}>{serverLabel(s)}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Подсказка */}
                    <div className="flex items-start gap-2 text-[11px] text-gray-500 bg-dark-700/30 rounded-lg px-3 py-2">
                        <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-accent-400/60" />
                        <span>Entry принимает клиентов, Exit выпускает трафик. Один Entry может иметь несколько Exit и наоборот. Сервер не может быть Entry и Exit одновременно.</span>
                    </div>

                    {/* Endpoint */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Endpoint (связь между серверами)</label>
                        <select
                            value={form.endpoint_mode}
                            onChange={e => setForm({ ...form, endpoint_mode: e.target.value })}
                            className={inputClass}
                        >
                            <option value="ipv4">IPv4</option>
                            <option value="ipv6">IPv6</option>
                        </select>
                    </div>

                    {/* Предупреждение IPv6 */}
                    {form.endpoint_mode === 'ipv6' && (() => {
                        const hasIpv6 = (s) => s?.ipv6 || (s?.host && s.host.includes(':'));
                        const missing = [];
                        if (selectedEntry && !hasIpv6(selectedEntry)) missing.push(selectedEntry.name);
                        if (selectedExit && !hasIpv6(selectedExit)) missing.push(selectedExit.name);
                        if (missing.length === 0) return null;
                        return (
                            <div className="text-xs text-yellow-400 bg-yellow-600/10 px-3 py-2 rounded-lg">
                                Нет IPv6 у: {missing.join(', ')}
                            </div>
                        );
                    })()}

                    {/* Протокол + Порт */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1.5">Протокол</label>
                            <select
                                value={form.xray_protocol}
                                onChange={e => setForm({ ...form, xray_protocol: e.target.value })}
                                className={inputClass}
                            >
                                <option value="vless">VLESS</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1.5">Порт на Exit</label>
                            <input
                                type="number"
                                value={form.xray_port}
                                onChange={e => setForm({ ...form, xray_port: e.target.value })}
                                className={inputClass}
                            />
                        </div>
                    </div>

                    {/* Transport + Security */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1.5">Transport</label>
                            <select
                                value={form.xray_network}
                                onChange={e => setForm({ ...form, xray_network: e.target.value })}
                                className={inputClass}
                            >
                                <option value="tcp">TCP</option>
                                <option value="ws">WebSocket</option>
                                <option value="grpc">gRPC</option>
                                <option value="h2">HTTP/2</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1.5">Security</label>
                            <select
                                value={form.xray_security}
                                onChange={e => setForm({ ...form, xray_security: e.target.value })}
                                className={inputClass}
                            >
                                <option value="reality">Reality</option>
                                <option value="tls">TLS</option>
                                <option value="none">None</option>
                            </select>
                        </div>
                    </div>

                    {/* Flow */}
                    {form.xray_protocol === 'vless' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1.5">Flow</label>
                            <select
                                value={form.xray_flow}
                                onChange={e => setForm({ ...form, xray_flow: e.target.value })}
                                className={inputClass}
                            >
                                <option value="xtls-rprx-vision">xtls-rprx-vision</option>
                                <option value="">Без flow</option>
                            </select>
                        </div>
                    )}

                    {/* SNI + Fingerprint */}
                    {(form.xray_security === 'reality' || form.xray_security === 'tls') && (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1.5">SNI</label>
                                <input
                                    value={form.xray_sni}
                                    onChange={e => setForm({ ...form, xray_sni: e.target.value })}
                                    className={inputClass}
                                    placeholder="www.google.com"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1.5">Fingerprint</label>
                                <select
                                    value={form.xray_fingerprint}
                                    onChange={e => setForm({ ...form, xray_fingerprint: e.target.value })}
                                    className={inputClass}
                                >
                                    <option value="chrome">Chrome</option>
                                    <option value="firefox">Firefox</option>
                                    <option value="safari">Safari</option>
                                    <option value="random">Random</option>
                                </select>
                            </div>
                        </div>
                    )}

                    {loading && (
                        <div className="flex items-center gap-2 text-sm text-yellow-400 bg-yellow-600/10 px-3 py-2 rounded-lg">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Создание маршрута...
                        </div>
                    )}

                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose}
                            className="flex-1 px-4 py-2.5 bg-dark-700 text-gray-300 rounded-lg text-sm font-medium hover:bg-dark-600">
                            Отмена
                        </button>
                        <button type="submit" disabled={loading || !form.from_server_id || !form.to_server_id}
                            className="flex-1 px-4 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
                            {loading ? 'Создание...' : 'Создать маршрут'}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}
