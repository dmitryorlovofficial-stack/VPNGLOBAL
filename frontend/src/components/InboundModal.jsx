// Модальное окно создания/редактирования Xray inbound
import { useState, useEffect } from 'react';
import { X, Key, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { xray } from '../api/client';

const PROTOCOLS = [
    { value: 'vless', label: 'VLESS', desc: 'Лёгкий, поддержка Reality/XTLS' },
];

const TRANSPORTS = ['xhttp', 'ws', 'grpc', 'h2'];
const SECURITIES = ['none', 'tls', 'reality'];

export default function InboundModal({ serverId, inbound, onClose, onSaved }) {
    const isEdit = !!inbound;

    const [form, setForm] = useState({
        tag: inbound?.tag || '',
        protocol: inbound?.protocol || 'vless',
        port: inbound?.port || 443,
        listen: inbound?.listen || '0.0.0.0',
        remark: inbound?.remark || '',
        // Transport
        network: inbound?.stream_settings?.network || 'xhttp',
        security: inbound?.stream_settings?.security || 'reality',
        // VLESS flow
        flow: inbound?.settings?.flow || '',
        // TLS
        tlsSni: inbound?.stream_settings?.tlsSettings?.serverName || '',
        tlsFingerprint: inbound?.stream_settings?.tlsSettings?.fingerprint || 'chrome',
        // Reality
        realityDest: inbound?.stream_settings?.realitySettings?.dest || 'www.google.com:443',
        realityServerNames: (inbound?.stream_settings?.realitySettings?.serverNames || ['www.google.com']).join(', '),
        realityPrivateKey: inbound?.stream_settings?.realitySettings?.privateKey || '',
        realityPublicKey: inbound?.stream_settings?.realitySettings?.publicKey || '',
        realityShortIds: (inbound?.stream_settings?.realitySettings?.shortIds || ['']).join(', '),
        realityFingerprint: inbound?.stream_settings?.realitySettings?.fingerprint || 'chrome',
        realitySpiderX: inbound?.stream_settings?.realitySettings?.spiderX || '/',
        // SNI list для мульти-SNI подписки (разные операторы)
        sniList: (inbound?.sni_list || []).join(', '),
        // WebSocket
        wsPath: inbound?.stream_settings?.wsSettings?.path || '/',
        wsHost: inbound?.stream_settings?.wsSettings?.headers?.Host || '',
        // gRPC
        grpcServiceName: inbound?.stream_settings?.grpcSettings?.serviceName || '',
        // XHTTP
        xhttpPath: inbound?.stream_settings?.xhttpSettings?.path || '/',
        xhttpHost: inbound?.stream_settings?.xhttpSettings?.host || '',
        xhttpMode: inbound?.stream_settings?.xhttpSettings?.mode || 'auto',
        // Sniffing
        sniffingEnabled: inbound?.sniffing?.enabled !== false,
    });
    const [loading, setLoading] = useState(false);
    const [generatingKeys, setGeneratingKeys] = useState(false);

    // Авто-генерация tag из протокола и порта
    useEffect(() => {
        if (!isEdit && !form.tag) {
            setForm(f => ({ ...f, tag: `${f.protocol}-${f.port}` }));
        }
    }, [form.protocol, form.port, isEdit]);

    const generateRealityKeys = async () => {
        setGeneratingKeys(true);
        try {
            const keys = await xray.realityKeys(serverId);
            setForm(f => ({
                ...f,
                realityPrivateKey: keys.privateKey,
                realityPublicKey: keys.publicKey,
                realityShortIds: keys.shortId,
            }));
            toast.success('Ключи Reality сгенерированы');
        } catch (err) {
            toast.error(err.message);
        }
        setGeneratingKeys(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.tag || !form.port) {
            toast.error('Tag и Port обязательны');
            return;
        }

        setLoading(true);
        try {
            // Собираем settings
            const settings = {};
            if (form.protocol === 'vless' && form.flow && form.network !== 'xhttp') settings.flow = form.flow;

            let stream_settings = {
                network: form.network,
                security: form.security,
            };
            let sniffing = { enabled: false, destOverride: [] };

            // TLS
                if (form.security === 'tls') {
                    stream_settings.tlsSettings = {
                        serverName: form.tlsSni,
                        fingerprint: form.tlsFingerprint,
                        alpn: ['h2', 'http/1.1'],
                    };
                }

                // Reality
                if (form.security === 'reality') {
                    stream_settings.realitySettings = {
                        dest: form.realityDest,
                        serverNames: form.realityServerNames.split(',').map(s => s.trim()).filter(Boolean),
                        privateKey: form.realityPrivateKey,
                        publicKey: form.realityPublicKey,
                        shortIds: form.realityShortIds.split(',').map(s => s.trim()).filter(Boolean),
                        fingerprint: form.realityFingerprint,
                        spiderX: form.realitySpiderX,
                    };
                }

                // Transport-specific
                if (form.network === 'ws') {
                    stream_settings.wsSettings = {
                        path: form.wsPath,
                        headers: form.wsHost ? { Host: form.wsHost } : {},
                    };
                } else if (form.network === 'grpc') {
                    stream_settings.grpcSettings = {
                        serviceName: form.grpcServiceName,
                    };
                } else if (form.network === 'xhttp') {
                    stream_settings.xhttpSettings = {
                        path: form.xhttpPath || '/',
                        host: form.xhttpHost || undefined,
                        mode: form.xhttpMode || 'auto',
                    };
                }

            sniffing = {
                enabled: form.sniffingEnabled,
                destOverride: ['http', 'tls'],
            };

            // SNI list для мульти-SNI подписки
            const sni_list = form.sniList
                ? form.sniList.split(',').map(s => s.trim()).filter(Boolean)
                : [];

            const data = {
                server_id: serverId,
                tag: form.tag,
                protocol: form.protocol,
                port: parseInt(form.port),
                listen: form.listen,
                settings,
                stream_settings,
                sniffing,
                remark: form.remark,
                sni_list,
            };

            if (isEdit) {
                await xray.updateInbound(inbound.id, data);
                toast.success('Inbound обновлён');
            } else {
                await xray.createInbound(data);
                toast.success('Inbound создан');
            }
            onSaved();
        } catch (err) {
            toast.error(err.message);
        }
        setLoading(false);
    };

    const inputClass = 'w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500';
    const labelClass = 'block text-xs font-medium text-gray-400 mb-1';

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-dark-600 sticky top-0 bg-dark-800 z-10">
                    <h2 className="text-lg font-semibold text-white">
                        {isEdit ? 'Редактировать Inbound' : 'Новый Inbound'}
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 space-y-5">
                    {/* Протокол */}
                    <div>
                        <label className={labelClass}>Протокол</label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {PROTOCOLS.map(p => (
                                <button
                                    key={p.value}
                                    type="button"
                                    onClick={() => {
                                        setForm(f => ({
                                            ...f,
                                            protocol: p.value,
                                            port: 443,
                                            tag: `${p.value}-443`,
                                        }));
                                    }}
                                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                                        form.protocol === p.value
                                            ? 'bg-accent-500/15 border-accent-500 text-accent-400'
                                            : 'bg-dark-700 border-dark-600 text-gray-400 hover:border-dark-500'
                                    }`}
                                >
                                    <div className="font-semibold">{p.label}</div>
                                    <div className="text-[10px] opacity-70 mt-0.5">{p.desc}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Tag + Port */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelClass}>Tag *</label>
                            <input
                                value={form.tag}
                                onChange={e => setForm({ ...form, tag: e.target.value })}
                                className={inputClass}
                                placeholder="vless-443"
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Port *</label>
                            <input
                                type="number"
                                value={form.port}
                                onChange={e => setForm({ ...form, port: e.target.value })}
                                className={inputClass}
                                placeholder="443"
                            />
                        </div>
                    </div>

                    {/* Transport + Security */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelClass}>Transport</label>
                            <select
                                value={form.network}
                                onChange={e => setForm({ ...form, network: e.target.value })}
                                className={inputClass}
                            >
                                {TRANSPORTS.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={labelClass}>Security</label>
                            <select
                                value={form.security}
                                onChange={e => setForm({ ...form, security: e.target.value })}
                                className={inputClass}
                            >
                                {SECURITIES.map(s => <option key={s} value={s}>{s === 'none' ? 'None' : s.toUpperCase()}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Protocol-specific settings */}
                    {form.protocol === 'vless' && (
                        <div>
                            <label className={labelClass}>Flow (XTLS)</label>
                            <select
                                value={form.network === 'xhttp' ? '' : form.flow}
                                onChange={e => setForm({ ...form, flow: e.target.value })}
                                className={inputClass}
                                disabled={form.network === 'xhttp'}
                            >
                                <option value="">Без Flow</option>
                                <option value="xtls-rprx-vision">xtls-rprx-vision</option>
                            </select>
                            {form.network === 'xhttp' && (
                                <p className="text-xs text-dark-400 mt-1">XHTTP несовместим с Flow</p>
                            )}
                        </div>
                    )}

                    {/* Reality settings */}
                    {form.security === 'reality' && (
                        <div className="space-y-3 bg-dark-900/50 p-4 rounded-lg border border-dark-700">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-purple-400">Reality Settings</span>
                                <button
                                    type="button"
                                    onClick={generateRealityKeys}
                                    disabled={generatingKeys}
                                    className="flex items-center gap-1 text-xs text-accent-400 hover:text-accent-300"
                                >
                                    {generatingKeys ? <Loader2 className="w-3 h-3 animate-spin" /> : <Key className="w-3 h-3" />}
                                    Генерировать ключи
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className={labelClass}>Dest (SNI target)</label>
                                    <input
                                        value={form.realityDest}
                                        onChange={e => setForm({ ...form, realityDest: e.target.value })}
                                        className={inputClass}
                                        placeholder="www.google.com:443"
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>Server Names</label>
                                    <input
                                        value={form.realityServerNames}
                                        onChange={e => setForm({ ...form, realityServerNames: e.target.value })}
                                        className={inputClass}
                                        placeholder="www.google.com"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className={labelClass}>Private Key</label>
                                <input
                                    value={form.realityPrivateKey}
                                    onChange={e => setForm({ ...form, realityPrivateKey: e.target.value })}
                                    className={inputClass}
                                    placeholder="Нажмите 'Генерировать ключи'"
                                />
                            </div>
                            <div>
                                <label className={labelClass}>Public Key</label>
                                <input
                                    value={form.realityPublicKey}
                                    onChange={e => setForm({ ...form, realityPublicKey: e.target.value })}
                                    className={inputClass}
                                    placeholder="Авто"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className={labelClass}>Short IDs</label>
                                    <input
                                        value={form.realityShortIds}
                                        onChange={e => setForm({ ...form, realityShortIds: e.target.value })}
                                        className={inputClass}
                                        placeholder="Авто"
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>Fingerprint</label>
                                    <select
                                        value={form.realityFingerprint}
                                        onChange={e => setForm({ ...form, realityFingerprint: e.target.value })}
                                        className={inputClass}
                                    >
                                        <option value="chrome">Chrome</option>
                                        <option value="firefox">Firefox</option>
                                        <option value="safari">Safari</option>
                                        <option value="random">Random</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className={labelClass}>SpiderX</label>
                                <input
                                    value={form.realitySpiderX}
                                    onChange={e => setForm({ ...form, realitySpiderX: e.target.value })}
                                    className={inputClass}
                                    placeholder="/"
                                />
                            </div>

                            {/* SNI list для подписки */}
                            <div>
                                <label className={labelClass}>SNI для подписки (операторы)</label>
                                <input
                                    value={form.sniList}
                                    onChange={e => setForm({ ...form, sniList: e.target.value })}
                                    className={inputClass}
                                    placeholder="max.ru, vk.com, ya.ru"
                                />
                                <p className="text-[10px] text-gray-500 mt-1">
                                    Через запятую. Подписка вернёт отдельный конфиг для каждого SNI. Пусто = один стандартный конфиг.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* TLS settings */}
                    {form.security === 'tls' && (
                        <div className="space-y-3 bg-dark-900/50 p-4 rounded-lg border border-dark-700">
                            <span className="text-xs font-medium text-green-400">TLS Settings</span>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className={labelClass}>SNI</label>
                                    <input
                                        value={form.tlsSni}
                                        onChange={e => setForm({ ...form, tlsSni: e.target.value })}
                                        className={inputClass}
                                        placeholder="example.com"
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>Fingerprint</label>
                                    <select
                                        value={form.tlsFingerprint}
                                        onChange={e => setForm({ ...form, tlsFingerprint: e.target.value })}
                                        className={inputClass}
                                    >
                                        <option value="chrome">Chrome</option>
                                        <option value="firefox">Firefox</option>
                                        <option value="safari">Safari</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* WebSocket settings */}
                    {form.network === 'ws' && (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className={labelClass}>WS Path</label>
                                <input
                                    value={form.wsPath}
                                    onChange={e => setForm({ ...form, wsPath: e.target.value })}
                                    className={inputClass}
                                    placeholder="/"
                                />
                            </div>
                            <div>
                                <label className={labelClass}>WS Host</label>
                                <input
                                    value={form.wsHost}
                                    onChange={e => setForm({ ...form, wsHost: e.target.value })}
                                    className={inputClass}
                                    placeholder="example.com"
                                />
                            </div>
                        </div>
                    )}

                    {/* gRPC settings */}
                    {form.network === 'grpc' && (
                        <div>
                            <label className={labelClass}>gRPC Service Name</label>
                            <input
                                value={form.grpcServiceName}
                                onChange={e => setForm({ ...form, grpcServiceName: e.target.value })}
                                className={inputClass}
                                placeholder="grpc-service"
                            />
                        </div>
                    )}

                    {/* XHTTP settings */}
                    {form.network === 'xhttp' && (
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className={labelClass}>XHTTP Path</label>
                                <input
                                    value={form.xhttpPath}
                                    onChange={e => setForm({ ...form, xhttpPath: e.target.value })}
                                    className={inputClass}
                                    placeholder="/"
                                />
                            </div>
                            <div>
                                <label className={labelClass}>XHTTP Host</label>
                                <input
                                    value={form.xhttpHost}
                                    onChange={e => setForm({ ...form, xhttpHost: e.target.value })}
                                    className={inputClass}
                                    placeholder=""
                                />
                            </div>
                            <div>
                                <label className={labelClass}>Mode</label>
                                <select
                                    value={form.xhttpMode}
                                    onChange={e => setForm({ ...form, xhttpMode: e.target.value })}
                                    className={inputClass}
                                >
                                    <option value="auto">auto</option>
                                    <option value="packet-up">packet-up</option>
                                    <option value="stream-up">stream-up</option>
                                    <option value="stream-one">stream-one</option>
                                </select>
                            </div>
                        </div>
                    )}

                    {/* Remark */}
                    <div>
                        <label className={labelClass}>Описание</label>
                        <input
                            value={form.remark}
                            onChange={e => setForm({ ...form, remark: e.target.value })}
                            className={inputClass}
                            placeholder="Описание inbound"
                        />
                    </div>

                    {/* Sniffing */}
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={form.sniffingEnabled}
                            onChange={e => setForm({ ...form, sniffingEnabled: e.target.checked })}
                            className="rounded border-dark-500"
                        />
                        <span className="text-sm text-gray-300">Sniffing (обнаружение протоколов)</span>
                    </label>

                    {/* Кнопки */}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2.5 bg-dark-700 text-gray-300 rounded-lg text-sm font-medium hover:bg-dark-600"
                        >
                            Отмена
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 px-4 py-2.5 btn-primary disabled:opacity-50"
                        >
                            {loading ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Создать'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
