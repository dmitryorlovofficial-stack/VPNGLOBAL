// vpn-node-agent — HTTP API для управления VPN-сервером
// Запускается внутри Docker-контейнера с --network host --cap-add NET_ADMIN
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const { apiKeyAuth } = require('./middleware/auth');

const app = express();
const PORT = parseInt(process.env.AGENT_PORT) || 8443;
const AGENT_VERSION = require('../package.json').version;

// Middleware
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(':method :url :status :response-time ms'));
app.use(apiKeyAuth);

// Версия агента доступна во всех req
app.use((req, res, next) => {
    req.agentVersion = AGENT_VERSION;
    next();
});

// Маршруты
app.use('/api', require('./routes/health'));
app.use('/api/metrics', require('./routes/metrics'));
app.use('/api/system', require('./routes/system'));
app.use('/api/wg', require('./routes/wg'));
app.use('/api/xray', require('./routes/xray'));
app.use('/api/stub-site', require('./routes/stub-site'));

// 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('[ERROR]', err.message);
    res.status(500).json({ error: err.message || 'Internal server error' });
});

// Слушаем на :: (dual-stack: IPv4 + IPv6)
app.listen(PORT, '::', async () => {
    console.log(`[AGENT] vpn-node-agent v${AGENT_VERSION} listening on [::]:${PORT} (IPv4+IPv6)`);
    console.log(`[AGENT] API Key: ${process.env.AGENT_API_KEY ? 'configured' : 'NOT SET!'}`);

    // Автозапуск nginx (stub-site) если конфиг существует
    try {
        const fs = require('fs');
        if (fs.existsSync('/etc/nginx/nginx.conf') && fs.existsSync('/var/www/stub-site')) {
            const nginxProcess = require('./services/nginx-process');
            if (!(await nginxProcess.isRunning())) {
                await nginxProcess.start();
                console.log('[AGENT] Nginx (stub-site) автозапущен');
            }
        }
    } catch (err) {
        console.warn('[AGENT] Не удалось запустить nginx:', err.message);
    }
});
