// Карточка статистики для дашборда
import clsx from 'clsx';

export default function StatsCard({ title, value, subtitle, icon: Icon, color = 'blue', className }) {
    const colors = {
        blue: 'bg-blue-600/20 text-blue-400',
        green: 'bg-green-600/20 text-green-400',
        yellow: 'bg-yellow-600/20 text-yellow-400',
        red: 'bg-red-600/20 text-red-400',
        purple: 'bg-purple-600/20 text-purple-400',
    };

    return (
        <div className={clsx(
            'bg-dark-800 border border-dark-700 rounded-xl p-5 animate-fade-in',
            className
        )}>
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm text-gray-400 mb-1">{title}</p>
                    <p className="text-2xl font-bold text-white">{value}</p>
                    {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
                </div>
                {Icon && (
                    <div className={clsx('p-2.5 rounded-lg', colors[color])}>
                        <Icon className="w-5 h-5" />
                    </div>
                )}
            </div>
        </div>
    );
}
