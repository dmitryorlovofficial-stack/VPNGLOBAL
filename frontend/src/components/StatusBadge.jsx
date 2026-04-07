// Индикатор статуса (зелёный/красный/жёлтый) с пульсацией
import clsx from 'clsx';

const VARIANTS = {
    online: { dot: 'bg-accent-400', ring: 'ring-accent-400/30', text: 'text-accent-400', label: 'Online' },
    offline: { dot: 'bg-gray-500', ring: '', text: 'text-gray-400', label: 'Offline' },
    blocked: { dot: 'bg-red-500', ring: '', text: 'text-red-400', label: 'Заблокирован' },
    active: { dot: 'bg-accent-400', ring: 'ring-accent-400/30', text: 'text-accent-400', label: 'Активен' },
    inactive: { dot: 'bg-yellow-500', ring: '', text: 'text-yellow-400', label: 'Неактивен' },
    error: { dot: 'bg-red-500', ring: 'ring-red-400/30', text: 'text-red-400', label: 'Ошибка' },
    connecting: { dot: 'bg-accent-300', ring: '', text: 'text-accent-300', label: 'Подключение...' },
    local: { dot: 'bg-violet-500', ring: '', text: 'text-violet-400', label: 'Локальный' },
};

export default function StatusBadge({ status, label, className }) {
    const variant = VARIANTS[status] || VARIANTS.offline;
    const displayLabel = label || variant.label;
    const isAlive = status === 'online' || status === 'active';

    return (
        <span className={clsx('inline-flex items-center gap-1.5 text-xs font-medium', variant.text, className)}>
            <span className={clsx(
                'w-2 h-2 rounded-full',
                variant.dot,
                isAlive && 'animate-pulse ring-2',
                isAlive && variant.ring
            )} />
            {displayLabel}
        </span>
    );
}
