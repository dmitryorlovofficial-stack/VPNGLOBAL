const API_BASE = '/api/user-portal';
const TOKEN_KEY = 'user_portal_token';

function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

async function request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`${API_BASE}${path}`, options);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка');
    return data;
}

export const userApi = {
    sendCode: (email) => request('POST', '/send-code', { email }),
    verifyCode: (email, code) => request('POST', '/verify-code', { email, code }),
    deleteDevice: (deviceId) => request('DELETE', `/devices/${deviceId}`),
    getMe: () => request('GET', '/me'),
    setToken: (token) => localStorage.setItem(TOKEN_KEY, token),
    removeToken: () => localStorage.removeItem(TOKEN_KEY),
    isAuthenticated: () => !!getToken(),
};
