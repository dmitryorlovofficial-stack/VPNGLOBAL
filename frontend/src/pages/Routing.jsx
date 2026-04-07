// Маршрутизация — древовидный вид серверов и связей
import { useState, useEffect, useCallback } from 'react';
import { Server, Loader2, ArrowRight, Wifi, Link2, Globe, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { servers as serversApi, tunnels, monitoring } from '../api/client';
import StatusBadge from '../components/StatusBadge';

export default function Routing() {
    const [serverList, setServerList] = useState([]);
    const [tunnelList, setTunnelList] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        try {
            try { await monitoring.refresh(); } catch (_) {}
            const [srvs, links] = await Promise.all([
                serversApi.list(),
                tunnels.list(),
            ]);
            setServerList(srvs);
            setTunnelList(links);
        } catch (err) {
            toast.error('Ошибка загрузки: ' + err.message);
        }
        setLoading(false);
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64 text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Загрузка...
            </div>
        );
    }

    // Группируем серверы: entry → exit связи
    const entryServers = new Set(tunnelList.map(t => t.from_server_id));
    const exitServers = new Set(tunnelList.map(t => t.to_server_id));
    const standalone = serverList.filter(s => !entryServers.has(s.id) && !exitServers.has(s.id));

    // Строим дерево: entry → [exits]
    const tree = [];
    for (const entryId of entryServers) {
        const entry = serverList.find(s => s.id === entryId);
        if (!entry) continue;
        const links = tunnelList.filter(t => t.from_server_id === entryId);
        const exits = links.map(link => ({
            server: serverList.find(s => s.id === link.to_server_id),
            link,
        })).filter(e => e.server);
        tree.push({ entry, exits });
    }

    // Exit-серверы без entry (только принимают)
    const orphanExits = [...exitServers].filter(id => !entryServers.has(id)).map(id => serverList.find(s => s.id === id)).filter(Boolean);

    const stats = {
        total: serverList.length,
        online: serverList.filter(s => s.status === 'online').length,
        routes: tunnelList.length,
        active: tunnelList.filter(t => t.status === 'active').length,
    };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Маршрутизация</h1>
                    <p className="text-sm text-gray-400 mt-0.5">
                        {stats.total} серверов &middot; {stats.routes} маршрутов ({stats.active} активных)
                    </p>
                </div>
                <button onClick={fetchData} className="flex items-center gap-2 px-3 py-2 bg-dark-700 text-gray-300 rounded-lg text-sm hover:bg-dark-600">
                    <RefreshCw className="w-4 h-4" />
                </button>
            </div>

            {tree.length === 0 && orphanExits.length === 0 && standalone.length === 0 ? (
                <div className="text-center py-16">
                    <Link2 className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400">Нет маршрутов</p>
                    <p className="text-xs text-gray-500 mt-1">Маршруты создаются автоматически через Группы серверов</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Деревья Entry → Exit */}
                    {tree.map(({ entry, exits }) => (
                        <div key={entry.id} className="glass-card overflow-hidden">
                            {/* Entry сервер */}
                            <ServerRow server={entry} role="entry" />

                            {/* Exit серверы */}
                            {exits.map(({ server: exitSrv, link }, idx) => (
                                <div key={link.id}>
                                    {/* Связь */}
                                    <div className="flex items-center px-5 py-1.5 bg-dark-900/30">
                                        <div className="w-10 flex justify-center">
                                            <div className={`w-0.5 h-5 ${idx === exits.length - 1 ? 'bg-gradient-to-b from-dark-500 to-transparent' : 'bg-dark-500'}`} />
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px]">
                                            <ArrowRight className="w-3 h-3 text-purple-400" />
                                            <span className="text-purple-400 font-medium">Xray</span>
                                            <span className="text-gray-600">:{link.xray_port}</span>
                                            <span className={`px-1.5 py-0.5 rounded-full font-medium ${
                                                link.status === 'active' ? 'bg-green-600/15 text-green-400'
                                                : link.status === 'error' ? 'bg-red-600/15 text-red-400'
                                                : 'bg-yellow-600/15 text-yellow-400'
                                            }`}>
                                                {link.status}
                                            </span>
                                            {link.endpoint_mode === 'ipv6' && <span className="text-purple-400/60">IPv6</span>}
                                        </div>
                                    </div>
                                    {/* Exit сервер */}
                                    <ServerRow server={exitSrv} role="exit" indent />
                                </div>
                            ))}
                        </div>
                    ))}

                    {/* Одиночные exit-серверы */}
                    {orphanExits.map(srv => (
                        <div key={srv.id} className="glass-card">
                            <ServerRow server={srv} role="exit" />
                        </div>
                    ))}

                    {/* Серверы без маршрутов */}
                    {standalone.length > 0 && (
                        <div>
                            <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider font-medium">Без маршрутов</p>
                            <div className="space-y-2">
                                {standalone.map(srv => (
                                    <div key={srv.id} className="glass-card">
                                        <ServerRow server={srv} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function ServerRow({ server, role, indent }) {
    const isOnline = server.status === 'online';
    const roleBadge = {
        entry: { text: 'Entry', cls: 'bg-accent-500/15 text-accent-400' },
        exit: { text: 'Exit', cls: 'bg-orange-600/15 text-orange-400' },
    };
    const badge = role ? roleBadge[role] : null;

    return (
        <div className={`flex items-center gap-3 px-5 py-3 ${indent ? 'pl-14' : ''}`}>
            <div className="relative flex-shrink-0">
                <Server className={`w-4 h-4 ${isOnline ? 'text-accent-400' : 'text-gray-500'}`} />
                <div className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-dark-800 ${isOnline ? 'bg-green-400' : 'bg-gray-500'}`} />
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white truncate">{server.name}</span>
                    {badge && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.text}</span>}
                </div>
                <p className="text-[11px] text-gray-500 truncate">
                    {server.domain && <span className="text-accent-400/70 mr-1.5">{server.domain}</span>}
                    {server.ipv4 || server.host || '—'}
                </p>
            </div>

            <div className="flex items-center gap-3 text-[11px] text-gray-500 flex-shrink-0">
                {server.client_count > 0 && <span><Wifi className="w-3 h-3 inline mr-0.5" />{server.client_count}</span>}
                <StatusBadge status={server.status} />
            </div>
        </div>
    );
}
