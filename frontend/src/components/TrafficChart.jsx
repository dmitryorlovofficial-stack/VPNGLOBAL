// График трафика (Recharts)
import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { dashboard } from '../api/client';

// Форматирование байтов
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Кастомный тултип
function CustomTooltip({ active, payload, label }) {
    if (!active || !payload) return null;
    return (
        <div className="bg-dark-800/95 backdrop-blur-md border border-dark-600/50 rounded-lg p-3 shadow-xl">
            <p className="text-xs text-gray-400 mb-2">{label}</p>
            {payload.map((entry, i) => (
                <p key={i} className="text-sm" style={{ color: entry.color }}>
                    {entry.name}: {formatBytes(entry.value)}
                </p>
            ))}
        </div>
    );
}

export default function TrafficChart({ clientId, className }) {
    const [period, setPeriod] = useState('24h');
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        dashboard.traffic(period, clientId)
            .then(setData)
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [period, clientId]);

    const periods = [
        { value: '24h', label: '24ч' },
        { value: '7d', label: '7д' },
        { value: '30d', label: '30д' },
    ];

    return (
        <div className={`glass-card p-5 ${className || ''}`}>
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Трафик</h3>
                <div className="flex gap-1 bg-dark-700 rounded-lg p-0.5">
                    {periods.map(p => (
                        <button
                            key={p.value}
                            onClick={() => setPeriod(p.value)}
                            className={`px-3 py-1 text-xs rounded-md transition-colors ${
                                period === p.value
                                    ? 'bg-accent-500 text-white shadow-glow-sm'
                                    : 'text-gray-400 hover:text-white'
                            }`}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="h-64 flex items-center justify-center text-gray-500">
                    Загрузка...
                </div>
            ) : data.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-gray-500">
                    Нет данных
                </div>
            ) : (
                <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.5} />
                        <XAxis
                            dataKey="time"
                            tick={{ fontSize: 11, fill: '#64748b' }}
                            tickFormatter={v => v?.split(' ').pop() || v}
                        />
                        <YAxis
                            tick={{ fontSize: 11, fill: '#64748b' }}
                            tickFormatter={formatBytes}
                            width={70}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Line
                            type="monotone"
                            dataKey="rx"
                            name="Download"
                            stroke="#06b6d4"
                            strokeWidth={2}
                            dot={false}
                        />
                        <Line
                            type="monotone"
                            dataKey="tx"
                            name="Upload"
                            stroke="#2dd4bf"
                            strokeWidth={2}
                            dot={false}
                        />
                    </LineChart>
                </ResponsiveContainer>
            )}
        </div>
    );
}
