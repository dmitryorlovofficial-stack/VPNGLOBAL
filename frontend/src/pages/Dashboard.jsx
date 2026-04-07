// Страница Dashboard — общая статистика (динамические серверы)
import { useState, useEffect } from 'react';
import { Users, Wifi, ArrowUpDown, Server, Cpu, MemoryStick } from 'lucide-react';
import StatsCard from '../components/StatsCard';
import StatusBadge from '../components/StatusBadge';
import TrafficChart from '../components/TrafficChart';
import { dashboard } from '../api/client';
import { useUser } from '../App';

// Форматирование байтов
function fmtBytes(b) {
    if (!b) return '0 B';
    const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
}

// Форматирование аптайма (секунды)
function fmtUptime(sec) {
    if (!sec) return 'н/д';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}д ${h}ч`;
    if (h > 0) return `${h}ч ${m}м`;
    return `${m}м`;
}

// Прогресс-бар
function ProgressBar({ value, max, color = 'blue' }) {
    const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    const colors = { blue: 'bg-accent-500', green: 'bg-emerald-500', yellow: 'bg-yellow-500', red: 'bg-red-500' };
    const barColor = pct > 90 ? colors.red : pct > 70 ? colors.yellow : colors[color];

    return (
        <div className="w-full bg-dark-700 rounded-full h-2">
            <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
    );
}

// Мини-карточка сервера для дашборда
function ServerMiniCard({ server }) {
    const isOnline = server.status === 'online';
    return (
        <div className="glass-card-hover p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Server className={`w-5 h-5 ${isOnline ? 'text-accent-400' : 'text-gray-500'}`} />
                    <h3 className="text-sm font-semibold text-white">{server.name}</h3>
                </div>
                <StatusBadge status={isOnline ? 'online' : 'offline'} />
            </div>

            {isOnline && server.cpu_percent != null ? (
                <div className="space-y-3">
                    <div>
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                            <span className="flex items-center gap-1"><Cpu className="w-3 h-3" /> CPU</span>
                            <span>{server.cpu_percent}%</span>
                        </div>
                        <ProgressBar value={server.cpu_percent} max={100} />
                    </div>
                    {server.ram_total_mb > 0 && (
                        <div>
                            <div className="flex justify-between text-xs text-gray-400 mb-1">
                                <span className="flex items-center gap-1"><MemoryStick className="w-3 h-3" /> RAM</span>
                                <span>{server.ram_used_mb} / {server.ram_total_mb} MB</span>
                            </div>
                            <ProgressBar value={server.ram_used_mb} max={server.ram_total_mb} />
                        </div>
                    )}
                </div>
            ) : (
                <p className="text-xs text-gray-500">
                    {isOnline ? 'Нет данных метрик' : 'Сервер недоступен'}
                </p>
            )}
        </div>
    );
}

export default function Dashboard() {
    const user = useUser();
    const isAdmin = user?.role === 'admin';

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchData = () => {
        dashboard.get()
            .then(setData)
            .catch(console.error)
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64 text-gray-500">
                Загрузка дашборда...
            </div>
        );
    }

    if (!data) return null;

    const { clients: cl, traffic, servers: srv, serversCount } = data;

    return (
        <div className="space-y-6 animate-fade-in">
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>

            {/* Карточки статистики */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <StatsCard
                    title="VPN-клиентов"
                    value={cl.total}
                    subtitle={`${cl.online} онлайн`}
                    icon={Users}
                    color="blue"
                />
                <StatsCard
                    title="Онлайн сейчас"
                    value={cl.online}
                    subtitle={`${cl.blocked} заблокировано`}
                    icon={Wifi}
                    color="green"
                />
                <StatsCard
                    title="Трафик сегодня"
                    value={fmtBytes(traffic.todayRx + traffic.todayTx)}
                    subtitle={`↑${fmtBytes(traffic.todayTx)} ↓${fmtBytes(traffic.todayRx)}`}
                    icon={ArrowUpDown}
                    color="purple"
                />
            </div>

            {/* График трафика */}
            <TrafficChart />

            {/* Серверы — динамический список */}
            {isAdmin && srv && (
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                            <Server className="w-5 h-5 text-gray-400" />
                            Серверы ({serversCount ?? srv.list?.length ?? 0})
                        </h2>
                        <a href="/servers" className="text-sm text-accent-400 hover:text-accent-300">Управление</a>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                        {srv.list?.map(server => (
                            <ServerMiniCard key={server.id} server={server} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
