// Секция связей между серверами — WG-туннели и Xray-цепочки
import { useState, useEffect, useCallback } from 'react';
import { Link2, Plus, Trash2, RefreshCw, CheckCircle, XCircle, Loader2, ArrowLeftRight, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { tunnels } from '../api/client';
import TunnelModal from './TunnelModal';

export default function TunnelSection({ serverList }) {
    const [tunnelList, setTunnelList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [actionLoading, setActionLoading] = useState(null);

    const fetchTunnels = useCallback(async () => {
        try {
            const data = await tunnels.list();
            setTunnelList(data);
        } catch (err) {
            console.error('Tunnels fetch error:', err);
        }
        setLoading(false);
    }, []);

    useEffect(() => { fetchTunnels(); }, [fetchTunnels]);

    const handleDelete = async (t) => {
        const typeLabel = t.link_type === 'xray' ? 'Xray-цепочку' : 'WG-туннель';
        if (!confirm(`Удалить ${typeLabel}? Конфиги будут обновлены на обоих серверах.`)) return;
        try {
            await tunnels.remove(t.id);
            toast.success(`${t.link_type === 'xray' ? 'Xray-цепочка' : 'Туннель'} удалён`);
            fetchTunnels();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleRestart = async (id) => {
        setActionLoading(id);
        try {
            await tunnels.restart(id);
            toast.success('Связь перезапущена');
            fetchTunnels();
        } catch (err) {
            toast.error(err.message);
        }
        setActionLoading(null);
    };

    const handleCheckStatus = async (id) => {
        setActionLoading(id);
        try {
            const status = await tunnels.status(id);
            if (status.ping_ok) {
                toast.success(`Связь OK${status.handshake ? ` (handshake: ${status.handshake})` : ''}`);
            } else {
                toast.error('Связь не работает');
            }
            fetchTunnels();
        } catch (err) {
            toast.error(err.message);
        }
        setActionLoading(null);
    };

    if (loading) return null;

    const statusColor = (s) => {
        if (s === 'active') return 'text-green-400';
        if (s === 'creating') return 'text-yellow-400';
        return 'text-red-400';
    };

    return (
        <div className="bg-dark-800 border border-dark-700 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Link2 className="w-5 h-5 text-blue-400" />
                    <h2 className="text-sm font-semibold text-white">Связи между серверами</h2>
                    <span className="text-xs text-gray-500">{tunnelList.length}</span>
                </div>
                <button
                    onClick={() => setShowModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700"
                >
                    <Plus className="w-3 h-3" /> Создать связь
                </button>
            </div>

            {tunnelList.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">Нет связей между серверами</p>
            ) : (
                <div className="space-y-2">
                    {tunnelList.map(t => {
                        const isXray = t.link_type === 'xray';

                        return (
                            <div key={t.id} className="flex items-center justify-between bg-dark-700/50 rounded-lg px-4 py-3">
                                <div className="flex items-center gap-3">
                                    {isXray
                                        ? <ArrowRight className={`w-4 h-4 ${statusColor(t.status)}`} />
                                        : <ArrowLeftRight className={`w-4 h-4 ${statusColor(t.status)}`} />
                                    }
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm text-white font-medium">
                                                {t.from_server_name || `#${t.from_server_id}`}
                                            </span>
                                            <span className="text-gray-500">{isXray ? '→' : '↔'}</span>
                                            <span className="text-sm text-white font-medium">
                                                {t.to_server_name || `#${t.to_server_id}`}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                                            {/* Бейдж типа связи */}
                                            <span className={isXray ? 'text-purple-400 font-medium' : 'text-blue-400 font-medium'}>
                                                {isXray ? 'Xray' : 'WG'}
                                            </span>

                                            {/* Детали в зависимости от типа */}
                                            {isXray ? (
                                                <>
                                                    <span>{t.xray_protocol}</span>
                                                    <span>:{t.xray_port}</span>
                                                    {t.xray_stream_settings?.security && (
                                                        <span className="text-gray-500">{t.xray_stream_settings.security}</span>
                                                    )}
                                                </>
                                            ) : null}

                                            {/* Endpoint mode */}
                                            <span className={t.endpoint_mode === 'ipv6' ? 'text-purple-400 font-medium' : 'text-gray-500'}>
                                                {t.endpoint_mode === 'ipv6' ? 'IPv6' : 'IPv4'}
                                            </span>

                                            {/* Статус */}
                                            <span className={statusColor(t.status)}>{t.status}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => handleCheckStatus(t.id)}
                                        disabled={actionLoading === t.id}
                                        className="p-1.5 text-gray-400 hover:text-green-400 rounded-lg hover:bg-dark-600"
                                        title="Проверить"
                                    >
                                        {actionLoading === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                                    </button>
                                    <button
                                        onClick={() => handleRestart(t.id)}
                                        disabled={actionLoading === t.id}
                                        className="p-1.5 text-gray-400 hover:text-blue-400 rounded-lg hover:bg-dark-600"
                                        title="Перезапустить"
                                    >
                                        <RefreshCw className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(t)}
                                        className="p-1.5 text-gray-400 hover:text-red-400 rounded-lg hover:bg-dark-600"
                                        title="Удалить"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {showModal && (
                <TunnelModal
                    serverList={serverList}
                    onClose={() => setShowModal(false)}
                    onSaved={() => { setShowModal(false); fetchTunnels(); }}
                />
            )}
        </div>
    );
}
