// Индикатор статуса (зелёный/красный/жёлтый)
import clsx from 'clsx';

const VARIANTS = {
    online: { dot: 'bg-green-500', text: 'text-green-400', label: 'Online' },
    offline: { dot: 'bg-gray-500', text: 'text-gray-400', label: 'Offline' },
    blocked: { dot: 'bg-red-500', text: 'text-red-400', label: 'Заблокирован' },
    active: { dot: 'bg-green-500', text: 'text-green-400', label: 'Активен' },
    inactive: { dot: 'bg-yellow-500', text: 'text-yellow-400', label: 'Неактивен' },
    error: { dot: 'bg-red-500', text: 'text-red-400', label: 'Ошибка' },
    connecting: { dot: 'bg-blue-500', text: 'text-blue-400', label: 'Подключение...' },
    local: { dot: 'bg-purple-500', text: 'text-purple-400', label: 'Локальный' },
};

export default function StatusBadge({ status, label, className }) {
    const variant = VARIANTS[status] || VARIANTS.offline;
    const displayLabel = label || variant.label;

    return (
        <span className={clsx('inline-flex items-center gap-1.5 text-xs font-medium', variant.text, className)}>
            <span className={clsx('w-2 h-2 rounded-full', variant.dot, status === 'online' && 'animate-pulse')} />
            {displayLabel}
        </span>
    );
}
