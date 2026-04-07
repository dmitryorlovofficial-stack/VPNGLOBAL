// Карточка статистики для дашборда
import clsx from 'clsx';

export default function StatsCard({ title, value, subtitle, icon: Icon, color = 'blue', className }) {
    const iconColors = {
        blue: 'from-accent-400 to-accent-600',
        green: 'from-emerald-400 to-emerald-600',
        yellow: 'from-amber-400 to-amber-600',
        red: 'from-red-400 to-red-600',
        purple: 'from-violet-400 to-violet-600',
    };

    return (
        <div className={clsx(
            'glass-card-hover p-5 animate-fade-in',
            className
        )}>
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm text-gray-400 mb-1">{title}</p>
                    <p className="text-2xl font-bold text-white">{value}</p>
                    {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
                </div>
                {Icon && (
                    <div className={clsx(
                        'p-2.5 rounded-lg bg-gradient-to-br shadow-glow-sm',
                        iconColors[color] || iconColors.blue
                    )}>
                        <Icon className="w-5 h-5 text-white" />
                    </div>
                )}
            </div>
        </div>
    );
}
