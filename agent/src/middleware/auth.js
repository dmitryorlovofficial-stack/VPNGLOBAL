// API Key аутентификация для агента
// Ключ передаётся через env AGENT_API_KEY при запуске контейнера

const API_KEY = process.env.AGENT_API_KEY;

function apiKeyAuth(req, res, next) {
    // Health check доступен без авторизации (для load balancer / healthcheck)
    if (req.path === '/api/health' && req.method === 'GET') {
        return next();
    }

    if (!API_KEY) {
        console.error('[AUTH] AGENT_API_KEY не установлен!');
        return res.status(500).json({ error: 'Agent not configured: missing API key' });
    }

    const providedKey = req.headers['x-api-key'];
    if (!providedKey || providedKey !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized: invalid API key' });
    }

    next();
}

module.exports = { apiKeyAuth };
