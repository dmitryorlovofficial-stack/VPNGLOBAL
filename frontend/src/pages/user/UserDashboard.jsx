import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, User, Smartphone, Monitor, Laptop, Wifi, WifiOff,
  Copy, Check, QrCode, Trash2, LogOut, Link, ExternalLink,
  ChevronRight, X, CreditCard, Clock, Globe, Loader2, Settings
} from 'lucide-react';
import { userApi } from '../../api/userApi';
import { QRCodeSVG } from 'qrcode.react';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const diff = now - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'только что';
  if (mins < 60) return `${mins} мин. назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч. назад`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} дн. назад`;
  const months = Math.floor(days / 30);
  return `${months} мес. назад`;
}

const deviceConfigs = {
  android: {
    label: 'Android',
    icon: Smartphone,
    apps: [
      { name: 'V2RayNG', link: 'https://play.google.com/store/apps/details?id=com.v2ray.ang', scheme: 'v2rayng' },
      { name: 'Hiddify', link: 'https://play.google.com/store/apps/details?id=app.hiddify.com', scheme: 'hiddify' },
    ],
  },
  ios: {
    label: 'iPhone / MacOS',
    icon: Smartphone,
    apps: [
      { name: 'Happ', link: 'https://apps.apple.com/app/id6504287215', scheme: 'happ' },
      { name: 'Shadowrocket', link: 'https://apps.apple.com/app/shadowrocket/id932747118', scheme: 'shadowrocket' },
    ],
  },
  windows: {
    label: 'Windows',
    icon: Monitor,
    apps: [
      { name: 'v2rayN', link: 'https://github.com/2dust/v2rayN/releases', scheme: 'v2rayn' },
      { name: 'Hiddify', link: 'https://github.com/hiddify/hiddify-app/releases', scheme: 'hiddify' },
    ],
  },
  linux: {
    label: 'Linux',
    icon: Laptop,
    apps: [
      { name: 'Hiddify', link: 'https://github.com/hiddify/hiddify-app/releases', scheme: 'hiddify' },
    ],
  },
};

const navItems = [
  { id: 'profile', label: 'Профиль', icon: User },
  { id: 'connect', label: 'Подключить VPN', icon: Wifi },
  { id: 'devices', label: 'Устройства', icon: Smartphone },
];

export default function UserDashboard({ user, onLogout }) {
  const [activeTab, setActiveTab] = useState('profile');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const me = await userApi.getMe();
      setData(me);
    } catch (err) {
      console.error('Failed to fetch user data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleLogout = () => {
    userApi.removeToken();
    onLogout && onLogout();
  };

  const handleNavClick = (id) => {
    setActiveTab(id);
    setSidebarOpen(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-900 flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-dark-800 border-r border-dark-700 flex flex-col transform transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="p-4 border-b border-dark-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 flex items-center justify-center">
              <Shield className="w-5 h-5 text-blue-500" />
            </div>
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm truncate">
                {data?.name || data?.email || 'Пользователь'}
              </p>
              <p className="text-gray-500 text-xs truncate">{data?.email}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  active
                    ? 'bg-blue-600/20 text-blue-400'
                    : 'text-gray-400 hover:text-white hover:bg-dark-700'
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-dark-700">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-dark-700 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Выйти
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden bg-dark-800 border-b border-dark-700 px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-400 hover:text-white"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-white font-semibold">
            {navItems.find((n) => n.id === activeTab)?.label}
          </span>
          <div className="w-6" />
        </header>

        <div className="p-4 md:p-6 lg:p-8 max-w-4xl">
          {activeTab === 'profile' && (
            <ProfileTab
              data={data}
              onBuy={() => setShowPurchaseModal(true)}
            />
          )}
          {activeTab === 'connect' && <ConnectTab data={data} />}
          {activeTab === 'devices' && (
            <DevicesTab data={data} onRefresh={fetchData} />
          )}
        </div>
      </main>

      {showPurchaseModal && (
        <PurchaseModal
          email={data?.email}
          onClose={() => setShowPurchaseModal(false)}
        />
      )}
    </div>
  );
}

/* ===================== PROFILE TAB ===================== */
function ProfileTab({ data, onBuy }) {
  const sub = data?.subscription;
  const hasSub = sub && sub.active;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Профиль</h2>
        <p className="text-gray-400 text-sm">{data?.email}</p>
      </div>

      {/* Subscription status */}
      <div className="bg-dark-800 rounded-2xl border border-dark-700 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">Подписка</h3>
          <span
            className={`px-3 py-1 rounded-full text-xs font-medium ${
              hasSub
                ? 'bg-green-500/20 text-green-400'
                : 'bg-gray-600/20 text-gray-400'
            }`}
          >
            {hasSub ? 'Активна' : 'Неактивна'}
          </span>
        </div>

        {hasSub ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Тариф</span>
              <span className="text-white font-medium">{sub.tariff_name || sub.plan || 'Стандарт'}</span>
            </div>
            {sub.expires_at && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Действует до</span>
                <span className="text-white">
                  {new Date(sub.expires_at).toLocaleDateString('ru-RU')}
                </span>
              </div>
            )}
            {(sub.traffic_used != null || sub.traffic_limit != null) && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Трафик</span>
                <span className="text-white">
                  {formatBytes(sub.traffic_used || 0)}
                  {sub.traffic_limit ? ` / ${formatBytes(sub.traffic_limit)}` : ' (безлимит)'}
                </span>
              </div>
            )}
            <button
              onClick={onBuy}
              className="w-full mt-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-xl transition-colors text-sm"
            >
              Продлить подписку
            </button>
          </div>
        ) : (
          <div>
            <p className="text-gray-400 text-sm mb-4">
              У вас нет активной подписки. Выберите тариф для подключения.
            </p>
            <button
              onClick={onBuy}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-xl transition-colors text-sm"
            >
              Выбрать тариф
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes) return '0 Б';
  const sizes = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(1)) + ' ' + sizes[i];
}

/* ===================== CONNECT TAB ===================== */
function ConnectTab({ data }) {
  const [selectedDevice, setSelectedDevice] = useState('android');
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const subUrl = data?.subscription_url || data?.sub_url || '';
  const config = deviceConfigs[selectedDevice];

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(subUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* fallback */
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Подключить VPN</h2>
        <p className="text-gray-400 text-sm">Выберите устройство и следуйте инструкции</p>
      </div>

      {/* Device selector */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {Object.entries(deviceConfigs).map(([key, cfg]) => {
          const Icon = cfg.icon;
          const active = selectedDevice === key;
          return (
            <button
              key={key}
              onClick={() => setSelectedDevice(key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                active
                  ? 'bg-blue-600 text-white'
                  : 'bg-dark-800 text-gray-400 hover:text-white border border-dark-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Apps */}
      <div className="space-y-3">
        {config.apps.map((app) => (
          <div
            key={app.name}
            className="bg-dark-800 rounded-2xl border border-dark-700 p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">{app.name}</h3>
              <a
                href={app.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm transition-colors"
              >
                Установить
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            {subUrl && (
              <button
                onClick={() => {
                  window.location.href = `${app.scheme}://install-sub?url=${encodeURIComponent(subUrl)}`;
                }}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-2.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2 mb-4"
              >
                <Link className="w-4 h-4" />
                Подключить автоматически
              </button>
            )}

            <div className="bg-dark-900 rounded-xl p-3 text-xs text-gray-400 space-y-1">
              <p className="font-medium text-gray-300 mb-2">Подключить вручную:</p>
              <p>1. Скопируйте ссылку подписки ниже</p>
              <p>2. Откройте приложение {app.name}</p>
              <p>3. Добавьте подписку по ссылке</p>
            </div>
          </div>
        ))}
      </div>

      {/* Subscription URL */}
      {subUrl && (
        <div className="bg-dark-800 rounded-2xl border border-dark-700 p-5 space-y-4">
          <h3 className="text-white font-semibold text-sm">Ссылка подписки</h3>
          <div className="flex gap-2">
            <div className="flex-1 bg-dark-900 border border-dark-600 rounded-xl px-3 py-2.5 text-sm text-gray-300 truncate font-mono">
              {subUrl}
            </div>
            <button
              onClick={copyUrl}
              className="bg-dark-700 hover:bg-dark-600 border border-dark-600 text-white px-3 rounded-xl transition-colors flex items-center gap-1.5"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>

          <button
            onClick={() => setShowQr(!showQr)}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <QrCode className="w-4 h-4" />
            {showQr ? 'Скрыть QR-код' : 'Показать QR-код'}
          </button>

          {showQr && (
            <div className="flex justify-center bg-white rounded-xl p-4">
              <QRCodeSVG value={subUrl} size={200} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ===================== DEVICES TAB ===================== */
function DevicesTab({ data, onRefresh }) {
  const [devices, setDevices] = useState(data?.devices || []);
  const [deleting, setDeleting] = useState(null);

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      await userApi.deleteDevice(id);
      setDevices((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      console.error('Delete device error:', err);
    } finally {
      setDeleting(null);
    }
  };

  const getDeviceIcon = (deviceName) => {
    const name = (deviceName || '').toLowerCase();
    if (name.includes('iphone') || name.includes('android') || name.includes('mobile'))
      return Smartphone;
    if (name.includes('windows') || name.includes('desktop') || name.includes('pc'))
      return Monitor;
    return Laptop;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Устройства</h2>
        <p className="text-gray-400 text-sm">
          {devices.length
            ? `Подключено устройств: ${devices.length}`
            : 'Нет подключённых устройств'}
        </p>
      </div>

      {devices.length === 0 ? (
        <div className="bg-dark-800 rounded-2xl border border-dark-700 p-8 text-center">
          <WifiOff className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">Устройства не найдены</p>
          <p className="text-gray-500 text-sm mt-1">
            Подключите VPN на вашем устройстве
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {devices.map((device) => {
            const Icon = getDeviceIcon(device.device_name);
            return (
              <div
                key={device.id}
                className="bg-dark-800 rounded-2xl border border-dark-700 p-4 flex items-center gap-4"
              >
                <div className="w-10 h-10 rounded-xl bg-dark-700 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-gray-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-white text-sm font-medium truncate">
                      {device.device_name || 'Неизвестное устройство'}
                    </p>
                    {device.app_name && (
                      <span className="px-2 py-0.5 bg-dark-700 rounded-md text-xs text-gray-400 shrink-0">
                        {device.app_name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    {device.last_ip && (
                      <span className="flex items-center gap-1">
                        <Globe className="w-3 h-3" />
                        {device.last_ip}
                      </span>
                    )}
                    {(device.last_seen || device.updated_at) && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {timeAgo(device.last_seen || device.updated_at)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(device.id)}
                  disabled={deleting === device.id}
                  className="p-2 text-gray-500 hover:text-red-400 hover:bg-dark-700 rounded-lg transition-colors shrink-0 disabled:opacity-50"
                >
                  {deleting === device.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ===================== PURCHASE MODAL ===================== */
function PurchaseModal({ email, onClose }) {
  const [tariffs, setTariffs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(null);

  useEffect(() => {
    fetch('/api/tariffs')
      .then((r) => r.json())
      .then((data) => {
        setTariffs(Array.isArray(data) ? data : data.tariffs || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handlePurchase = async (tariff) => {
    setPurchasing(tariff.id);
    try {
      const res = await fetch('/api/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, tariff_id: tariff.id }),
      });
      const data = await res.json();
      if (data.payment_url) {
        window.location.href = data.payment_url;
      }
    } catch (err) {
      console.error('Payment error:', err);
    } finally {
      setPurchasing(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-dark-800 rounded-2xl border border-dark-700 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-dark-800 border-b border-dark-700 px-5 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-lg font-bold text-white">Выберите тариф</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-dark-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
            </div>
          ) : tariffs.length === 0 ? (
            <p className="text-gray-400 text-center py-8">Тарифы не найдены</p>
          ) : (
            tariffs.map((tariff) => (
              <div
                key={tariff.id}
                className="bg-dark-900 rounded-xl border border-dark-600 p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-white font-semibold">
                      {tariff.name}
                    </h3>
                    {tariff.duration_days && (
                      <p className="text-gray-500 text-xs mt-0.5">
                        {tariff.duration_days} дней
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-white font-bold text-lg">
                      {tariff.price} <span className="text-sm font-normal">₽</span>
                    </p>
                  </div>
                </div>
                {tariff.description && (
                  <p className="text-gray-400 text-sm mb-3">{tariff.description}</p>
                )}
                <button
                  onClick={() => handlePurchase(tariff)}
                  disabled={purchasing === tariff.id}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
                >
                  {purchasing === tariff.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <CreditCard className="w-4 h-4" />
                      Оплатить {tariff.price} ₽
                    </>
                  )}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
