// Визуальная доска маршрутизации — read-only отображение маршрутов из групп
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    Server, Loader2, X, ArrowRight,
    ZoomIn, ZoomOut, Maximize2, Link2
} from 'lucide-react';
import toast from 'react-hot-toast';
import { servers as serversApi, tunnels, monitoring } from '../api/client';

const NODE_W = 180;
const NODE_H = 80;
const GRID_SIZE = 20;

// Snap to grid
const snap = (v) => Math.round(v / GRID_SIZE) * GRID_SIZE;

const STATUS_COLORS = {
    active: '#22c55e',
    creating: '#eab308',
    error: '#ef4444',
    inactive: '#6b7280',
};

// ============================================================
// Главная страница маршрутизации (только отображение)
// ============================================================
export default function Routing() {
    const [serverList, setServerList] = useState([]);
    const [tunnelList, setTunnelList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedLink, setSelectedLink] = useState(null);

    // Node positions (persisted in localStorage)
    const [positions, setPositions] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('routing_positions') || '{}');
        } catch { return {}; }
    });

    // Canvas state
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const canvasRef = useRef(null);
    const dragRef = useRef(null);
    const panRef = useRef(null);
    const positionsRef = useRef(positions);
    const zoomRef = useRef(zoom);

    // Синхронизируем ref с state
    useEffect(() => { positionsRef.current = positions; }, [positions]);
    useEffect(() => { zoomRef.current = zoom; }, [zoom]);

    // Fetch data
    const fetchData = useCallback(async () => {
        try {
            // Обновляем статусы серверов перед загрузкой
            try { await monitoring.refresh(); } catch (_) {}

            const [srvs, links] = await Promise.all([
                serversApi.list(),
                tunnels.list(),
            ]);
            setServerList(srvs);
            setTunnelList(links);

            // Auto-layout для новых серверов без позиции
            const newPositions = { ...positions };
            let changed = false;
            srvs.forEach((s, i) => {
                if (!newPositions[s.id]) {
                    const cols = Math.max(3, Math.ceil(Math.sqrt(srvs.length)));
                    const row = Math.floor(i / cols);
                    const col = i % cols;
                    newPositions[s.id] = {
                        x: 100 + col * 260,
                        y: 100 + row * 160,
                    };
                    changed = true;
                }
            });
            if (changed) {
                setPositions(newPositions);
                localStorage.setItem('routing_positions', JSON.stringify(newPositions));
            }
        } catch (err) {
            toast.error('Ошибка загрузки: ' + err.message);
        }
        setLoading(false);
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    // =================== Mouse handlers ===================

    // Drag node
    const handleNodeMouseDown = (e, serverId) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const startPos = positionsRef.current[serverId] || { x: 0, y: 0 };
        const startMouse = { x: e.clientX, y: e.clientY };
        dragRef.current = { serverId, startPos, startMouse };

        const onMove = (ev) => {
            if (!dragRef.current) return;
            const currentZoom = zoomRef.current;
            const dx = (ev.clientX - startMouse.x) / currentZoom;
            const dy = (ev.clientY - startMouse.y) / currentZoom;
            const newNodePos = {
                x: snap(startPos.x + dx),
                y: snap(startPos.y + dy),
            };
            setPositions(prev => {
                const updated = { ...prev, [serverId]: newNodePos };
                positionsRef.current = updated;
                return updated;
            });
        };

        const onUp = () => {
            dragRef.current = null;
            const current = positionsRef.current;
            localStorage.setItem('routing_positions', JSON.stringify(current));
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    // Pan canvas
    const handleCanvasMouseDown = (e) => {
        if (e.button !== 0 || e.target !== canvasRef.current) return;
        const startPan = { ...pan };
        const startMouse = { x: e.clientX, y: e.clientY };
        panRef.current = { startPan, startMouse };

        const onMove = (ev) => {
            if (!panRef.current) return;
            setPan({
                x: startPan.x + (ev.clientX - startMouse.x),
                y: startPan.y + (ev.clientY - startMouse.y),
            });
        };

        const onUp = () => {
            panRef.current = null;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    // Zoom
    const handleWheel = (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom(z => Math.max(0.3, Math.min(2, z + delta)));
    };

    useEffect(() => {
        const el = canvasRef.current;
        if (!el) return;
        el.addEventListener('wheel', handleWheel, { passive: false });
        return () => el.removeEventListener('wheel', handleWheel);
    }, []);

    // Reset view
    const resetView = () => {
        setPan({ x: 0, y: 0 });
        setZoom(1);
    };

    // =================== Compute edges ===================
    const edges = useMemo(() => {
        return tunnelList.map(t => {
            const from = positions[t.from_server_id];
            const to = positions[t.to_server_id];
            if (!from || !to) return null;

            const fromCenter = { x: from.x + NODE_W / 2, y: from.y + NODE_H / 2 };
            const toCenter = { x: to.x + NODE_W / 2, y: to.y + NODE_H / 2 };
            const dx = toCenter.x - fromCenter.x;
            const cp = Math.max(50, Math.abs(dx) * 0.4);

            return {
                id: t.id,
                tunnel: t,
                from: fromCenter,
                to: toCenter,
                cp,
                statusColor: STATUS_COLORS[t.status] || STATUS_COLORS.inactive,
            };
        }).filter(Boolean);
    }, [tunnelList, positions]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64 text-gray-500">
                <Loader2 className="w-6 h-6 animate-spin mr-2" /> Загрузка...
            </div>
        );
    }

    return (
        <div className="flex flex-col -m-4 lg:-m-6" style={{ height: 'calc(100vh - 2rem)' }}>
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-3 bg-dark-800 border-b border-dark-700 z-10">
                <div className="flex items-center gap-3">
                    <Link2 className="w-5 h-5 text-purple-400" />
                    <h1 className="text-lg font-semibold text-white">Маршрутизация</h1>
                    <span className="text-xs text-gray-500">
                        {serverList.length} серверов · {tunnelList.length} маршрутов
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    {/* Zoom controls */}
                    <button onClick={() => setZoom(z => Math.min(2, z + 0.2))}
                        className="p-2 text-gray-400 hover:text-white hover:bg-dark-700 rounded-lg" title="Zoom in">
                        <ZoomIn className="w-4 h-4" />
                    </button>
                    <span className="text-xs text-gray-500 w-12 text-center">{Math.round(zoom * 100)}%</span>
                    <button onClick={() => setZoom(z => Math.max(0.3, z - 0.2))}
                        className="p-2 text-gray-400 hover:text-white hover:bg-dark-700 rounded-lg" title="Zoom out">
                        <ZoomOut className="w-4 h-4" />
                    </button>
                    <button onClick={resetView}
                        className="p-2 text-gray-400 hover:text-white hover:bg-dark-700 rounded-lg" title="Reset view">
                        <Maximize2 className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Canvas */}
            <div
                ref={canvasRef}
                className="flex-1 relative overflow-hidden bg-dark-900 cursor-grab active:cursor-grabbing"
                onMouseDown={handleCanvasMouseDown}
                style={{
                    backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)`,
                    backgroundSize: `${GRID_SIZE * zoom}px ${GRID_SIZE * zoom}px`,
                    backgroundPosition: `${pan.x}px ${pan.y}px`,
                }}
            >
                {/* Transform layer */}
                <div
                    style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: '0 0',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                    }}
                >
                    {/* SVG edges */}
                    <svg
                        className="absolute top-0 left-0 pointer-events-none"
                        style={{ width: '10000px', height: '10000px', overflow: 'visible' }}
                    >
                        <defs>
                            <marker id="arrow-xray" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                                <polygon points="0 0, 8 3, 0 6" fill="#a855f7" />
                            </marker>
                        </defs>

                        {edges.map(edge => {
                            const isSelected = selectedLink === edge.id;
                            const path = `M ${edge.from.x} ${edge.from.y} C ${edge.from.x + edge.cp} ${edge.from.y}, ${edge.to.x - edge.cp} ${edge.to.y}, ${edge.to.x} ${edge.to.y}`;

                            return (
                                <g key={edge.id}>
                                    <path
                                        d={path}
                                        fill="none"
                                        stroke="transparent"
                                        strokeWidth={20}
                                        className="pointer-events-auto cursor-pointer"
                                        onClick={(e) => { e.stopPropagation(); setSelectedLink(isSelected ? null : edge.id); }}
                                    />
                                    {isSelected && (
                                        <path d={path} fill="none" stroke="#a855f7" strokeWidth={6} opacity={0.3} />
                                    )}
                                    <path
                                        d={path}
                                        fill="none"
                                        stroke="#a855f7"
                                        strokeWidth={isSelected ? 3 : 2}
                                        strokeDasharray={edge.tunnel.status === 'active' ? 'none' : '8 4'}
                                        markerEnd="url(#arrow-xray)"
                                        opacity={edge.tunnel.status === 'active' ? 1 : 0.5}
                                    />
                                    <circle
                                        cx={(edge.from.x + edge.to.x) / 2}
                                        cy={(edge.from.y + edge.to.y) / 2}
                                        r={5}
                                        fill={edge.statusColor}
                                        className="pointer-events-auto cursor-pointer"
                                        onClick={(e) => { e.stopPropagation(); setSelectedLink(isSelected ? null : edge.id); }}
                                    />
                                    <text
                                        x={(edge.from.x + edge.to.x) / 2}
                                        y={(edge.from.y + edge.to.y) / 2 - 12}
                                        textAnchor="middle"
                                        fill="#a855f7"
                                        fontSize="11"
                                        fontWeight="600"
                                        className="select-none"
                                    >
                                        Xray
                                    </text>
                                </g>
                            );
                        })}
                    </svg>

                    {/* Nodes */}
                    {serverList.map(srv => {
                        const pos = positions[srv.id] || { x: 0, y: 0 };
                        const isOnline = srv.status === 'online';
                        const hasAgent = srv.agent_status === 'active';
                        const connectedLinks = tunnelList.filter(
                            t => t.from_server_id === srv.id || t.to_server_id === srv.id
                        );
                        const isExit = tunnelList.some(t => t.to_server_id === srv.id);
                        const isEntry = tunnelList.some(t => t.from_server_id === srv.id);

                        return (
                            <div
                                key={srv.id}
                                className="absolute select-none"
                                style={{
                                    left: pos.x,
                                    top: pos.y,
                                    width: NODE_W,
                                }}
                            >
                                <div
                                    className={`
                                        bg-dark-800 border rounded-xl shadow-lg cursor-move
                                        transition-shadow hover:shadow-xl
                                        ${isExit ? 'border-orange-600/50 hover:border-orange-500/70' : isOnline ? 'border-dark-600 hover:border-dark-500' : 'border-red-900/50'}
                                    `}
                                    onMouseDown={(e) => handleNodeMouseDown(e, srv.id)}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {/* Header */}
                                    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-dark-700/50">
                                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isOnline ? 'bg-green-400' : 'bg-red-400'}`} />
                                        <span className="text-sm font-semibold text-white truncate">{srv.name}</span>
                                        <div className="ml-auto flex items-center gap-1">
                                            {isExit && (
                                                <span className="text-[9px] px-1.5 py-0.5 bg-orange-600/20 text-orange-400 rounded-full font-medium">
                                                    Exit
                                                </span>
                                            )}
                                            {isEntry && (
                                                <span className="text-[9px] px-1.5 py-0.5 bg-accent-500/15 text-accent-400 rounded-full font-medium">
                                                    Entry
                                                </span>
                                            )}
                                            {hasAgent && (
                                                <span className="text-[9px] px-1.5 py-0.5 bg-green-600/20 text-green-400 rounded-full font-medium">
                                                    Agent
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {/* Body */}
                                    <div className="px-3 py-2 space-y-1">
                                        {srv.domain && (
                                            <div className="text-[10px] text-accent-400 truncate font-medium">{srv.domain}</div>
                                        )}
                                        <div className="text-[10px] text-gray-500 truncate">
                                            {srv.ipv4 || srv.host}
                                            {srv.ipv6 && <span className="text-purple-400/60 ml-1">IPv6</span>}
                                        </div>
                                        {connectedLinks.length > 0 && (
                                            <div className="flex gap-1">
                                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-600/20 text-purple-400 font-medium">
                                                    {connectedLinks.length} {connectedLinks.length === 1 ? 'маршрут' : 'маршрутов'}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Click canvas to deselect */}
                {selectedLink && (
                    <div
                        className="absolute inset-0 z-0"
                        onClick={() => setSelectedLink(null)}
                    />
                )}
            </div>

            {/* Selected link panel (read-only — только просмотр и проверка) */}
            {selectedLink && (() => {
                const link = tunnelList.find(t => t.id === selectedLink);
                if (!link) return null;
                const fromSrv = serverList.find(s => s.id === link.from_server_id);
                const toSrv = serverList.find(s => s.id === link.to_server_id);

                return (
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 glass-card shadow-2xl p-4 min-w-[420px]">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-purple-600 text-white">
                                    Маршрут
                                </span>
                                <span className="text-sm font-semibold text-accent-400">
                                    {fromSrv?.name || `#${link.from_server_id}`}
                                </span>
                                <span className="text-[9px] px-1.5 py-0.5 bg-accent-500/15 text-accent-400 rounded-full font-medium">Entry</span>
                                <ArrowRight className="w-4 h-4 text-gray-500" />
                                <span className="text-sm font-semibold text-orange-400">
                                    {toSrv?.name || `#${link.to_server_id}`}
                                </span>
                                <span className="text-[9px] px-1.5 py-0.5 bg-orange-600/20 text-orange-400 rounded-full font-medium">Exit</span>
                            </div>
                            <button onClick={() => setSelectedLink(null)} className="text-gray-400 hover:text-white">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs mb-3">
                            <div>
                                <span className="text-gray-500">Статус: </span>
                                <span className={link.status === 'active' ? 'text-green-400' : link.status === 'error' ? 'text-red-400' : 'text-yellow-400'}>
                                    {link.status}
                                </span>
                            </div>
                            <div>
                                <span className="text-gray-500">Endpoint: </span>
                                <span className={link.endpoint_mode === 'ipv6' ? 'text-purple-400' : 'text-gray-300'}>
                                    {link.endpoint_mode || 'ipv4'}
                                </span>
                            </div>
                            <div>
                                <span className="text-gray-500">Протокол: </span>
                                <span className="text-gray-300">{link.xray_protocol}</span>
                            </div>
                            <div>
                                <span className="text-gray-500">Порт: </span>
                                <span className="text-gray-300">{link.xray_port}</span>
                            </div>
                            {fromSrv?.domain && (
                                <div>
                                    <span className="text-gray-500">Entry: </span>
                                    <span className="text-accent-400">{fromSrv.domain}</span>
                                </div>
                            )}
                            {toSrv?.domain && (
                                <div>
                                    <span className="text-gray-500">Exit: </span>
                                    <span className="text-accent-400">{toSrv.domain}</span>
                                </div>
                            )}
                        </div>

                        <span className="text-[10px] text-gray-600">
                            Управление маршрутами — во вкладке Группы
                        </span>
                    </div>
                );
            })()}

            {/* Legend */}
            <div className="absolute top-16 right-4 z-10 bg-dark-800/90 border border-dark-700 rounded-lg p-3 text-[10px] space-y-1.5 backdrop-blur-sm">
                <div>
                    <div className="text-gray-500 font-semibold mb-1 uppercase tracking-wider">Связи</div>
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-0.5 bg-purple-500" />
                        <span className="text-purple-400">Xray-маршрут</span>
                    </div>
                </div>
                <div className="border-t border-dark-700 pt-1.5 mt-1.5">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-400" />
                        <span className="text-gray-400">Active</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-400" />
                        <span className="text-gray-400">Error</span>
                    </div>
                </div>
                <div className="border-t border-dark-700 pt-1.5 mt-1.5 text-gray-600">
                    Scroll — zoom<br />
                    Drag фон — перемещение<br />
                    Drag ноду — переместить<br />
                    Click линию — детали
                </div>
            </div>
        </div>
    );
}
