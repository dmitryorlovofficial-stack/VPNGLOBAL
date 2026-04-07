// Компонент Telegram Login Widget
import { useEffect, useRef, useCallback } from 'react';

export default function TelegramLoginButton({ botUsername, onAuth, size = 'large' }) {
    const containerRef = useRef(null);
    const callbackRef = useRef(null);

    const handleAuth = useCallback((user) => {
        if (onAuth) onAuth(user);
    }, [onAuth]);

    useEffect(() => {
        if (!botUsername || !containerRef.current) return;

        // Очищаем контейнер
        containerRef.current.innerHTML = '';

        // Уникальный глобальный callback
        const callbackName = `__tgAuth_${Date.now()}`;
        window[callbackName] = handleAuth;
        callbackRef.current = callbackName;

        // Создаём скрипт Telegram Login Widget
        const script = document.createElement('script');
        script.src = 'https://telegram.org/js/telegram-widget.js?23';
        script.setAttribute('data-telegram-login', botUsername);
        script.setAttribute('data-size', size);
        script.setAttribute('data-onauth', `${callbackName}(user)`);
        script.setAttribute('data-request-access', 'write');
        script.async = true;

        containerRef.current.appendChild(script);

        return () => {
            if (callbackRef.current) {
                delete window[callbackRef.current];
            }
        };
    }, [botUsername, handleAuth, size]);

    if (!botUsername) return null;

    return <div ref={containerRef} className="flex justify-center" />;
}
