// Главный компонент приложения — роутинг и layout
import { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { isAuthenticated, removeToken, auth, getUserData, setUserData } from './api/client';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import Servers from './pages/Servers';
import Monitoring from './pages/Monitoring';
import Routing from './pages/Routing';
import Settings from './pages/Settings';
import Tariffs from './pages/Tariffs';
import Users from './pages/Users';
import Groups from './pages/Groups';
import AdGuard from './pages/AdGuard';
import UserLogin from './pages/user/UserLogin';
import UserDashboard from './pages/user/UserDashboard';
import { userApi } from './api/userApi';

// Контекст текущего пользователя (роль, лимиты)
export const UserContext = createContext(null);
export const useUser = () => useContext(UserContext);
export const RefreshUserContext = createContext(() => {});

// Защищённый маршрут
function ProtectedRoute({ children }) {
    if (!isAuthenticated()) return <Navigate to="/login" replace />;
    return children;
}

// Layout с боковой панелью
function AppLayout({ children, onLogout, user }) {
    const [sidebarOpen, setSidebarOpen] = useState(false);

    return (
        <div className="flex h-screen overflow-hidden">
            <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onLogout={onLogout} user={user} />
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Мобильная шапка */}
                <header className="lg:hidden flex items-center justify-between p-4 bg-dark-800 border-b border-dark-700">
                    <button onClick={() => setSidebarOpen(true)} className="text-gray-300 hover:text-white">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </button>
                    <span className="text-lg font-semibold">VPN Panel</span>
                    <div className="w-6" />
                </header>
                <main className="flex-1 overflow-y-auto p-4 lg:p-6">
                    {children}
                </main>
            </div>
        </div>
    );
}

function UserPortal() {
    const [authed, setAuthed] = useState(userApi.isAuthenticated());
    const [user, setUser] = useState(null);

    const handleLogin = (userData) => {
        setAuthed(true);
        setUser(userData);
    };

    const handleLogout = () => {
        userApi.removeToken();
        setAuthed(false);
        setUser(null);
    };

    if (!authed) return <UserLogin onLogin={handleLogin} />;
    return <UserDashboard user={user} onLogout={handleLogout} />;
}

export default function App() {
    const [authed, setAuthed] = useState(isAuthenticated());
    const [user, setUser] = useState(getUserData());

    // Загружаем полные данные пользователя (с vpn_count) через /auth/me
    const refreshUser = () => {
        auth.me().then(data => {
            setUser(data);
            setUserData(data);
        }).catch(() => {});
    };

    useEffect(() => {
        if (authed) refreshUser();
    }, [authed]);

    const handleLogout = () => {
        removeToken();
        setAuthed(false);
        setUser(null);
    };

    const handleLogin = (userData) => {
        setAuthed(true);
        // Сразу ставим базовые данные из login, затем useEffect обновит полные через /me
        if (userData) {
            setUser(userData);
            setUserData(userData);
        }
    };

    const isAdmin = user?.role === 'admin';

    return (
        <UserContext.Provider value={user}>
        <RefreshUserContext.Provider value={refreshUser}>
            <BrowserRouter>
                <Toaster
                    position="top-right"
                    toastOptions={{
                        className: '!bg-dark-700 !text-gray-100 !border !border-dark-600',
                        duration: 3000,
                    }}
                />
                <Routes>
                    {/* User Portal — independent auth */}
                    <Route path="/user/*" element={<UserPortal />} />

                    <Route path="/login" element={
                        authed ? <Navigate to="/" replace /> : <Login onLogin={handleLogin} />
                    } />
                    <Route path="/*" element={
                        <ProtectedRoute>
                            <AppLayout onLogout={handleLogout} user={user}>
                                <Routes>
                                    <Route path="/" element={<Dashboard />} />
                                    <Route path="/clients" element={<Clients />} />
                                    {isAdmin && <Route path="/servers" element={<Servers />} />}
                                    {isAdmin && <Route path="/monitoring" element={<Monitoring />} />}
                                    {isAdmin && <Route path="/routing" element={<Routing />} />}
                                    {isAdmin && <Route path="/adguard" element={<AdGuard />} />}
                                    {isAdmin && <Route path="/groups" element={<Groups />} />}
                                    {isAdmin && <Route path="/users" element={<Users />} />}
                                    {isAdmin && <Route path="/settings" element={<Settings />} />}
                                    {isAdmin && <Route path="/tariffs" element={<Tariffs />} />}
                                    <Route path="*" element={<Navigate to="/" replace />} />
                                </Routes>
                            </AppLayout>
                        </ProtectedRoute>
                    } />
                </Routes>
            </BrowserRouter>
        </RefreshUserContext.Provider>
        </UserContext.Provider>
    );
}
