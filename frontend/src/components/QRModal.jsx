// Модальное окно с QR-кодом и конфигом/share link клиента (мульти-протокол)
import { useState, useEffect } from 'react';
import { X, Download, Copy, Check, QrCode, Link as LinkIcon, Rss } from 'lucide-react';
import toast from 'react-hot-toast';
import { clients } from '../api/client';

const XRAY_PROTOCOLS = ['vless'];

const protocolLabel = {
    vless: 'VLESS',
};

const protocolColor = {
    vless: 'text-purple-400 border-purple-400',
};

const protocolBg = {
    vless: 'bg-purple-600/20 text-purple-400',
};

export default function QRModal({ clients: clientsList, onClose }) {
    // Поддержка массива клиентов (группа) — выбор активного протокола
    const [activeProto, setActiveProto] = useState(clientsList[0]?.protocol);
    const activeClient = clientsList.find(c => c.protocol === activeProto) || clientsList[0];
    const hasMultiple = clientsList.length > 1;

    const [config, setConfig] = useState('');
    const [qrUrl, setQrUrl] = useState('');
    const [copied, setCopied] = useState(false);
    const [copiedSub, setCopiedSub] = useState(false);
    const [tab, setTab] = useState('qr');

    const isXray = XRAY_PROTOCOLS.includes(activeClient.protocol);
    // Единая подписка для всех протоколов (общий sub_token)
    const subToken = clientsList.find(c => c.sub_token)?.sub_token;
    const subUrl = subToken ? `${window.location.origin}/api/sub/${subToken}` : null;

    // Загрузка конфига/QR при смене активного клиента
    useEffect(() => {
        setConfig('');
        setQrUrl('');
        setCopied(false);

        clients.config(activeClient.id)
            .then(text => setConfig(text))
            .catch(() => setConfig('Ошибка загрузки'));

        clients.qrDataUrl(activeClient.id)
            .then(data => setQrUrl(data.qr))
            .catch(console.error);
    }, [activeClient.id]);

    const handleCopy = () => {
        navigator.clipboard.writeText(config);
        setCopied(true);
        toast.success(isXray ? 'Share link скопирован' : 'Конфиг скопирован');
        setTimeout(() => setCopied(false), 2000);
    };

    const handleCopySub = () => {
        if (!subUrl) return;
        navigator.clipboard.writeText(subUrl);
        setCopiedSub(true);
        toast.success('Subscription URL скопирован');
        setTimeout(() => setCopiedSub(false), 2000);
    };

    const handleDownload = () => {
        const blob = new Blob([config], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = isXray ? `${activeClient.name}-${activeClient.protocol}.txt` : `${activeClient.name}.conf`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(isXray ? 'Share link скачан' : 'Конфиг скачан');
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                {/* Заголовок */}
                <div className="flex items-center justify-between p-5 border-b border-dark-600">
                    <div>
                        <h2 className="text-lg font-semibold text-white">{activeClient.name}</h2>
                        <p className="text-sm text-gray-400">
                            {hasMultiple
                                ? `${clientsList.length} подключения`
                                : (
                                    <>
                                        {activeClient.ip_address && <span>{activeClient.ip_address} | </span>}
                                        <span className={protocolColor[activeClient.protocol]?.split(' ')[0] || 'text-gray-400'}>
                                            {protocolLabel[activeClient.protocol] || activeClient.protocol}
                                        </span>
                                    </>
                                )
                            }
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Переключатель протоколов (если > 1) */}
                {hasMultiple && (
                    <div className="flex gap-2 px-5 pt-4">
                        {clientsList.map(c => (
                            <button
                                key={c.id}
                                onClick={() => { setActiveProto(c.protocol); setTab('qr'); }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                    activeProto === c.protocol
                                        ? protocolBg[c.protocol] || 'bg-dark-600 text-white'
                                        : 'bg-dark-700/50 text-gray-500 hover:text-gray-300'
                                }`}
                            >
                                {protocolLabel[c.protocol] || c.protocol}
                            </button>
                        ))}
                    </div>
                )}

                {/* Переключатель вкладок QR / Config / Sub */}
                <div className="flex border-b border-dark-600 mt-2">
                    <button
                        onClick={() => setTab('qr')}
                        className={`flex-1 px-4 py-3 text-sm font-medium text-center transition-colors ${
                            tab === 'qr'
                                ? 'text-accent-400 border-b-2 border-blue-400'
                                : 'text-gray-400 hover:text-white'
                        }`}
                    >
                        <QrCode className="w-4 h-4 inline mr-2" />
                        QR-код
                    </button>
                    <button
                        onClick={() => setTab('config')}
                        className={`flex-1 px-4 py-3 text-sm font-medium text-center transition-colors ${
                            tab === 'config'
                                ? 'text-accent-400 border-b-2 border-blue-400'
                                : 'text-gray-400 hover:text-white'
                        }`}
                    >
                        {isXray ? <LinkIcon className="w-4 h-4 inline mr-2" /> : null}
                        {isXray ? 'Share Link' : 'Конфиг'}
                    </button>
                    {subUrl && (
                        <button
                            onClick={() => setTab('sub')}
                            className={`flex-1 px-4 py-3 text-sm font-medium text-center transition-colors ${
                                tab === 'sub'
                                    ? 'text-accent-400 border-b-2 border-blue-400'
                                    : 'text-gray-400 hover:text-white'
                            }`}
                        >
                            <Rss className="w-4 h-4 inline mr-2" />
                            Подписка
                        </button>
                    )}
                </div>

                <div className="p-5">
                    {tab === 'qr' ? (
                        <div className="flex flex-col items-center">
                            {qrUrl ? (
                                <img src={qrUrl} alt="QR Code" className="w-72 h-72 rounded-lg bg-white p-3" />
                            ) : (
                                <div className="w-72 h-72 bg-dark-700 rounded-lg flex items-center justify-center text-gray-500">
                                    Загрузка QR...
                                </div>
                            )}
                            <p className="text-xs text-gray-500 mt-3">
                                {isXray
                                    ? 'Отсканируйте в v2rayNG, Hiddify, Streisand или другом клиенте'
                                    : 'Отсканируйте QR-код в VPN-приложении'}
                            </p>
                        </div>
                    ) : tab === 'sub' ? (
                        <div className="space-y-4">
                            <div>
                                <p className="text-sm text-gray-300 mb-2">Subscription URL</p>
                                <div className="flex gap-2">
                                    <input
                                        readOnly
                                        value={subUrl || ''}
                                        className="flex-1 bg-dark-900 border border-dark-600 rounded-lg px-3 py-2.5 text-xs font-mono text-accent-400 focus:outline-none"
                                    />
                                    <button
                                        onClick={handleCopySub}
                                        className="px-4 py-2.5 btn-primary transition-colors flex items-center gap-2"
                                    >
                                        {copiedSub ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                        {copiedSub ? 'Готово' : 'Копировать'}
                                    </button>
                                </div>
                            </div>
                            {hasMultiple && (
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                    {clientsList.map(c => (
                                        <span key={c.id} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${protocolBg[c.protocol] || 'bg-dark-600 text-gray-400'}`}>
                                            {protocolLabel[c.protocol] || c.protocol}
                                        </span>
                                    ))}
                                </div>
                            )}
                            <div className="bg-dark-900 border border-dark-600 rounded-lg p-4 text-xs text-gray-400 space-y-2 mt-3">
                                <p className="text-gray-300 font-medium">Как использовать:</p>
                                <p>1. Скопируйте URL выше</p>
                                <p>2. В VPN-клиенте выберите «Добавить подписку» или «Subscription»</p>
                                <p>3. Вставьте URL и сохраните</p>
                                <p className="text-green-400 mt-2">
                                    {hasMultiple
                                        ? `Содержит все протоколы (${clientsList.map(c => protocolLabel[c.protocol] || c.protocol).join(', ')}). Обновляется каждый час.`
                                        : 'Конфигурация будет обновляться автоматически каждый час'
                                    }
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <pre className={`bg-dark-900 border border-dark-600 rounded-lg p-4 text-xs overflow-x-auto font-mono ${
                                isXray ? 'text-purple-400 break-all whitespace-pre-wrap' : 'text-green-400 whitespace-pre-wrap'
                            }`}>
                                {config || 'Загрузка...'}
                            </pre>
                        </div>
                    )}

                    {/* Кнопки */}
                    {tab !== 'sub' && (
                        <div className="flex gap-3 mt-4">
                            <button
                                onClick={handleCopy}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-dark-700 text-gray-300 rounded-lg text-sm font-medium hover:bg-dark-600 transition-colors"
                            >
                                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                                {copied ? 'Скопировано' : 'Копировать'}
                            </button>
                            <button
                                onClick={handleDownload}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 btn-primary transition-colors"
                            >
                                <Download className="w-4 h-4" />
                                Скачать {isXray ? '.txt' : '.conf'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
