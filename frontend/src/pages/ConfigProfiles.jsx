// Config Profiles + Snippets — управление Xray-конфигурациями
import { useState, useEffect, useCallback } from 'react';
import {
    FileCode, Plus, Edit3, Trash2, Loader2, ChevronDown, ChevronRight,
    Save, X, Server, Puzzle, ToggleLeft, ToggleRight, Star, Copy
} from 'lucide-react';
import toast from 'react-hot-toast';
import { configProfiles as api } from '../api/client';

// =================== Snippet Type Labels ===================
const SNIPPET_TYPES = [
    { value: 'dns', label: 'DNS' },
    { value: 'routing_rule', label: 'Routing Rule' },
    { value: 'policy', label: 'Policy' },
    { value: 'outbound', label: 'Outbound' },
    { value: 'transport', label: 'Transport' },
];

const snippetTypeLabel = (type) => SNIPPET_TYPES.find(t => t.value === type)?.label || type;

const snippetTypeColor = (type) => {
    switch (type) {
        case 'dns': return 'bg-accent-500/20 text-accent-400';
        case 'routing_rule': return 'bg-green-500/20 text-green-400';
        case 'policy': return 'bg-purple-500/20 text-purple-400';
        case 'outbound': return 'bg-orange-500/20 text-orange-400';
        case 'transport': return 'bg-cyan-500/20 text-cyan-400';
        default: return 'bg-gray-500/20 text-gray-400';
    }
};

// =================== Main Component ===================
export default function ConfigProfiles() {
    const [tab, setTab] = useState('profiles'); // profiles | snippets
    const [profiles, setProfiles] = useState([]);
    const [snippets, setSnippets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedProfile, setExpandedProfile] = useState(null);
    const [editingProfile, setEditingProfile] = useState(null);
    const [editingSnippet, setEditingSnippet] = useState(null);
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [showSnippetModal, setShowSnippetModal] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            const [p, s] = await Promise.all([api.list(), api.snippets()]);
            setProfiles(p);
            setSnippets(s);
        } catch (err) {
            toast.error(err.message);
        }
        setLoading(false);
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    // =================== Profile CRUD ===================
    const handleSaveProfile = async (data) => {
        try {
            if (data.id) {
                await api.update(data.id, data);
                toast.success('Профиль обновлён');
            } else {
                await api.create(data);
                toast.success('Профиль создан');
            }
            setShowProfileModal(false);
            setEditingProfile(null);
            fetchData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleDeleteProfile = async (id) => {
        if (!confirm('Удалить профиль?')) return;
        try {
            await api.remove(id);
            toast.success('Профиль удалён');
            fetchData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    // =================== Snippet CRUD ===================
    const handleSaveSnippet = async (data) => {
        try {
            if (data.id) {
                await api.updateSnippet(data.id, data);
                toast.success('Сниппет обновлён');
            } else {
                await api.createSnippet(data);
                toast.success('Сниппет создан');
            }
            setShowSnippetModal(false);
            setEditingSnippet(null);
            fetchData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleDeleteSnippet = async (id) => {
        if (!confirm('Удалить сниппет?')) return;
        try {
            await api.removeSnippet(id);
            toast.success('Сниппет удалён');
            fetchData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleToggleSnippet = async (snippet) => {
        try {
            await api.updateSnippet(snippet.id, { is_enabled: !snippet.is_enabled });
            fetchData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    // =================== Profile Snippets ===================
    const handleSetProfileSnippets = async (profileId, snippetIds) => {
        try {
            await api.setSnippets(profileId, snippetIds);
            toast.success('Сниппеты обновлены');
            // Refresh expanded profile
            const detail = await api.get(profileId);
            setExpandedProfile(detail);
            fetchData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleExpandProfile = async (profileId) => {
        if (expandedProfile?.id === profileId) {
            setExpandedProfile(null);
            return;
        }
        try {
            const detail = await api.get(profileId);
            setExpandedProfile(detail);
        } catch (err) {
            toast.error(err.message);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Config Profiles</h1>
                    <p className="text-sm text-gray-400 mt-1">Именованные Xray-конфигурации и переиспользуемые фрагменты</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-dark-800 rounded-lg p-1 w-fit">
                <button
                    onClick={() => setTab('profiles')}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                        tab === 'profiles' ? 'bg-accent-500 text-white' : 'text-gray-400 hover:text-white'
                    }`}
                >
                    <FileCode className="w-4 h-4 inline mr-2" />
                    Профили ({profiles.length})
                </button>
                <button
                    onClick={() => setTab('snippets')}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                        tab === 'snippets' ? 'bg-accent-500 text-white' : 'text-gray-400 hover:text-white'
                    }`}
                >
                    <Puzzle className="w-4 h-4 inline mr-2" />
                    Сниппеты ({snippets.length})
                </button>
            </div>

            {/* Content */}
            {tab === 'profiles' ? (
                <div className="space-y-3">
                    <div className="flex justify-end">
                        <button
                            onClick={() => { setEditingProfile(null); setShowProfileModal(true); }}
                            className="flex items-center gap-2 px-4 py-2 btn-primary"
                        >
                            <Plus className="w-4 h-4" /> Новый профиль
                        </button>
                    </div>

                    {profiles.map(profile => (
                        <div key={profile.id} className="glass-card overflow-hidden">
                            {/* Profile Header */}
                            <div
                                className="flex items-center justify-between p-4 cursor-pointer hover:bg-dark-750"
                                onClick={() => handleExpandProfile(profile.id)}
                            >
                                <div className="flex items-center gap-3">
                                    {expandedProfile?.id === profile.id
                                        ? <ChevronDown className="w-5 h-5 text-gray-400" />
                                        : <ChevronRight className="w-5 h-5 text-gray-400" />
                                    }
                                    <FileCode className="w-5 h-5 text-accent-400" />
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-white">{profile.name}</span>
                                            {profile.is_default && (
                                                <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded-full flex items-center gap-1">
                                                    <Star className="w-3 h-3" /> Default
                                                </span>
                                            )}
                                        </div>
                                        {profile.description && (
                                            <p className="text-xs text-gray-500 mt-0.5">{profile.description}</p>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-3 text-xs text-gray-500">
                                        <span><Server className="w-3.5 h-3.5 inline mr-1" />{profile.servers_count || 0} серверов</span>
                                        <span><Puzzle className="w-3.5 h-3.5 inline mr-1" />{profile.snippets_count || 0} сниппетов</span>
                                        {profile.server_group_name && (
                                            <span className="px-2 py-0.5 bg-dark-700 rounded text-gray-400">
                                                {profile.server_group_name}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                                        <button
                                            onClick={() => { setEditingProfile(profile); setShowProfileModal(true); }}
                                            className="p-1.5 text-gray-400 hover:text-accent-400 rounded"
                                        >
                                            <Edit3 className="w-4 h-4" />
                                        </button>
                                        {!profile.is_default && (
                                            <button
                                                onClick={() => handleDeleteProfile(profile.id)}
                                                className="p-1.5 text-gray-400 hover:text-red-400 rounded"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Expanded Detail */}
                            {expandedProfile?.id === profile.id && (
                                <ProfileDetail
                                    profile={expandedProfile}
                                    allSnippets={snippets}
                                    onSetSnippets={handleSetProfileSnippets}
                                />
                            )}
                        </div>
                    ))}

                    {profiles.length === 0 && (
                        <div className="text-center py-12 text-gray-500">
                            Нет профилей. Создайте первый.
                        </div>
                    )}
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="flex justify-end">
                        <button
                            onClick={() => { setEditingSnippet(null); setShowSnippetModal(true); }}
                            className="flex items-center gap-2 px-4 py-2 btn-primary"
                        >
                            <Plus className="w-4 h-4" /> Новый сниппет
                        </button>
                    </div>

                    {snippets.map(snippet => (
                        <div key={snippet.id} className="glass-card p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <Puzzle className="w-5 h-5 text-purple-400" />
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-white">{snippet.name}</span>
                                            <span className={`px-2 py-0.5 text-xs rounded-full ${snippetTypeColor(snippet.type)}`}>
                                                {snippetTypeLabel(snippet.type)}
                                            </span>
                                            {!snippet.is_enabled && (
                                                <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded-full">
                                                    Выключен
                                                </span>
                                            )}
                                        </div>
                                        {snippet.description && (
                                            <p className="text-xs text-gray-500 mt-0.5">{snippet.description}</p>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-gray-500">
                                        {snippet.profiles_count || 0} профилей
                                    </span>
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => handleToggleSnippet(snippet)}
                                            className="p-1.5 text-gray-400 hover:text-green-400 rounded"
                                            title={snippet.is_enabled ? 'Выключить' : 'Включить'}
                                        >
                                            {snippet.is_enabled
                                                ? <ToggleRight className="w-5 h-5 text-green-400" />
                                                : <ToggleLeft className="w-5 h-5" />
                                            }
                                        </button>
                                        <button
                                            onClick={() => { setEditingSnippet(snippet); setShowSnippetModal(true); }}
                                            className="p-1.5 text-gray-400 hover:text-accent-400 rounded"
                                        >
                                            <Edit3 className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteSnippet(snippet.id)}
                                            className="p-1.5 text-gray-400 hover:text-red-400 rounded"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                            {/* JSON preview */}
                            <pre className="mt-3 p-3 bg-dark-900 rounded-lg text-xs text-gray-400 overflow-x-auto max-h-32">
                                {JSON.stringify(snippet.content, null, 2)}
                            </pre>
                        </div>
                    ))}

                    {snippets.length === 0 && (
                        <div className="text-center py-12 text-gray-500">
                            Нет сниппетов. Создайте первый.
                        </div>
                    )}
                </div>
            )}

            {/* Profile Modal */}
            {showProfileModal && (
                <ProfileModal
                    profile={editingProfile}
                    onSave={handleSaveProfile}
                    onClose={() => { setShowProfileModal(false); setEditingProfile(null); }}
                />
            )}

            {/* Snippet Modal */}
            {showSnippetModal && (
                <SnippetModal
                    snippet={editingSnippet}
                    onSave={handleSaveSnippet}
                    onClose={() => { setShowSnippetModal(false); setEditingSnippet(null); }}
                />
            )}
        </div>
    );
}

// =================== Profile Detail (expanded) ===================
function ProfileDetail({ profile, allSnippets, onSetSnippets }) {
    const profileSnippetIds = (profile.snippets || []).map(s => s.id);
    const [selected, setSelected] = useState(profileSnippetIds);

    const toggleSnippet = (snippetId) => {
        setSelected(prev =>
            prev.includes(snippetId) ? prev.filter(id => id !== snippetId) : [...prev, snippetId]
        );
    };

    const hasChanges = JSON.stringify(selected.sort()) !== JSON.stringify(profileSnippetIds.sort());

    return (
        <div className="border-t border-dark-700 p-4 space-y-4">
            {/* Base Config */}
            {profile.base_config && Object.keys(profile.base_config).length > 0 && (
                <div>
                    <h4 className="text-sm font-medium text-gray-300 mb-2">Base Config</h4>
                    <pre className="p-3 bg-dark-900 rounded-lg text-xs text-gray-400 overflow-x-auto max-h-40">
                        {JSON.stringify(profile.base_config, null, 2)}
                    </pre>
                </div>
            )}

            {/* Attached Snippets */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-gray-300">Сниппеты</h4>
                    {hasChanges && (
                        <button
                            onClick={() => onSetSnippets(profile.id, selected)}
                            className="flex items-center gap-1 px-3 py-1.5 btn-primary text-xs"
                        >
                            <Save className="w-3.5 h-3.5" /> Сохранить
                        </button>
                    )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {allSnippets.map(snippet => (
                        <label
                            key={snippet.id}
                            className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer border transition-colors ${
                                selected.includes(snippet.id)
                                    ? 'bg-accent-500/10 border-accent-500/30'
                                    : 'bg-dark-900 border-dark-700 hover:border-dark-600'
                            }`}
                        >
                            <input
                                type="checkbox"
                                checked={selected.includes(snippet.id)}
                                onChange={() => toggleSnippet(snippet.id)}
                                className="rounded border-dark-600 bg-dark-700 text-blue-500"
                            />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-white truncate">{snippet.name}</span>
                                    <span className={`px-1.5 py-0.5 text-[10px] rounded ${snippetTypeColor(snippet.type)}`}>
                                        {snippetTypeLabel(snippet.type)}
                                    </span>
                                </div>
                                {snippet.description && (
                                    <p className="text-xs text-gray-500 truncate">{snippet.description}</p>
                                )}
                            </div>
                        </label>
                    ))}
                </div>
            </div>

            {/* Servers */}
            {profile.servers && profile.servers.length > 0 && (
                <div>
                    <h4 className="text-sm font-medium text-gray-300 mb-2">Серверы с этим профилем</h4>
                    <div className="flex flex-wrap gap-2">
                        {profile.servers.map(srv => (
                            <span key={srv.id} className="px-3 py-1.5 bg-dark-700 rounded-lg text-sm text-gray-300 flex items-center gap-2">
                                <Server className="w-3.5 h-3.5 text-green-400" />
                                {srv.name}
                                <span className="text-xs text-gray-500">{srv.ipv4 || srv.host}</span>
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// =================== Profile Modal ===================
function ProfileModal({ profile, onSave, onClose }) {
    const [form, setForm] = useState({
        name: profile?.name || '',
        description: profile?.description || '',
        base_config: profile?.base_config ? JSON.stringify(profile.base_config, null, 2) : '{}',
        inbound_defaults: profile?.inbound_defaults ? JSON.stringify(profile.inbound_defaults, null, 2) : '{}',
    });
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const data = {
                ...(profile?.id ? { id: profile.id } : {}),
                name: form.name,
                description: form.description,
                base_config: JSON.parse(form.base_config),
                inbound_defaults: JSON.parse(form.inbound_defaults),
            };
            await onSave(data);
        } catch (err) {
            toast.error('Невалидный JSON: ' + err.message);
        }
        setSaving(false);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
            <div className="glass-card w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-dark-700">
                    <h2 className="text-lg font-semibold text-white">
                        {profile ? 'Редактировать профиль' : 'Новый профиль'}
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Название</label>
                        <input
                            type="text"
                            value={form.name}
                            onChange={e => setForm({ ...form, name: e.target.value })}
                            className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Описание</label>
                        <input
                            type="text"
                            value={form.description}
                            onChange={e => setForm({ ...form, description: e.target.value })}
                            className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Base Config (JSON)</label>
                        <textarea
                            value={form.base_config}
                            onChange={e => setForm({ ...form, base_config: e.target.value })}
                            rows={6}
                            className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2.5 text-xs text-gray-300 font-mono focus:outline-none focus:border-accent-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Inbound Defaults (JSON)</label>
                        <textarea
                            value={form.inbound_defaults}
                            onChange={e => setForm({ ...form, inbound_defaults: e.target.value })}
                            rows={4}
                            className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2.5 text-xs text-gray-300 font-mono focus:outline-none focus:border-accent-500"
                        />
                    </div>
                    <div className="flex gap-3">
                        <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 bg-dark-700 text-gray-300 rounded-lg text-sm hover:bg-dark-600">
                            Отмена
                        </button>
                        <button type="submit" disabled={saving} className="flex-1 px-4 py-2.5 btn-primary disabled:opacity-50">
                            {saving ? 'Сохранение...' : 'Сохранить'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// =================== Snippet Modal ===================
function SnippetModal({ snippet, onSave, onClose }) {
    const [form, setForm] = useState({
        name: snippet?.name || '',
        description: snippet?.description || '',
        type: snippet?.type || 'routing_rule',
        content: snippet?.content ? JSON.stringify(snippet.content, null, 2) : '{}',
        sort_order: snippet?.sort_order || 0,
    });
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const data = {
                ...(snippet?.id ? { id: snippet.id } : {}),
                name: form.name,
                description: form.description,
                type: form.type,
                content: JSON.parse(form.content),
                sort_order: parseInt(form.sort_order) || 0,
            };
            await onSave(data);
        } catch (err) {
            toast.error('Невалидный JSON: ' + err.message);
        }
        setSaving(false);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
            <div className="glass-card w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-dark-700">
                    <h2 className="text-lg font-semibold text-white">
                        {snippet ? 'Редактировать сниппет' : 'Новый сниппет'}
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Название</label>
                        <input
                            type="text"
                            value={form.name}
                            onChange={e => setForm({ ...form, name: e.target.value })}
                            className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Описание</label>
                        <input
                            type="text"
                            value={form.description}
                            onChange={e => setForm({ ...form, description: e.target.value })}
                            className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-gray-300 mb-1">Тип</label>
                            <select
                                value={form.type}
                                onChange={e => setForm({ ...form, type: e.target.value })}
                                className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500"
                            >
                                {SNIPPET_TYPES.map(t => (
                                    <option key={t.value} value={t.value}>{t.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm text-gray-300 mb-1">Порядок</label>
                            <input
                                type="number"
                                value={form.sort_order}
                                onChange={e => setForm({ ...form, sort_order: e.target.value })}
                                className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Content (JSON)</label>
                        <textarea
                            value={form.content}
                            onChange={e => setForm({ ...form, content: e.target.value })}
                            rows={8}
                            className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2.5 text-xs text-gray-300 font-mono focus:outline-none focus:border-accent-500"
                        />
                    </div>
                    <div className="flex gap-3">
                        <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 bg-dark-700 text-gray-300 rounded-lg text-sm hover:bg-dark-600">
                            Отмена
                        </button>
                        <button type="submit" disabled={saving} className="flex-1 px-4 py-2.5 btn-primary disabled:opacity-50">
                            {saving ? 'Сохранение...' : 'Сохранить'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
