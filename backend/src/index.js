// Точка входа backend — VPN-панель управления v2
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { initDatabase } = require('./db/database');
const { startScheduler } = require('./services/monitor');

// Маршруты
const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/clients');
const dashboardRoutes = require('./routes/dashboard');
const serverRoutes = require('./routes/servers');
const xrayRoutes = require('./routes/xray');
const tunnelRoutes = require('./routes/tunnels');
const settingsRoutes = require('./routes/settings');
const userRoutes = require('./routes/users');
const monitoringRoutes = require('./routes/monitoring');
const subscriptionRoutes = require('./routes/subscription');
const groupRoutes = require('./routes/groups');
const inviteRoutes = require('./routes/invites');
const sslRoutes = require('./routes/ssl');
const stubSiteRoutes = require('./routes/stub-sites');
const adguardRoutes = require('./routes/adguard');
const diagRoutes = require('./routes/diag');
const userPortalRoutes = require('./routes/userPortal');

const app = express();
app.set('trust proxy', 1);
const PORT = 3000;

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('short'));

// Rate limiters
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Слишком много попыток входа. Попробуйте позже.' },
});

const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 200,
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/telegram', authLimiter);
app.use('/api/auth/telegram-register', authLimiter);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API маршруты
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/xray', xrayRoutes);
app.use('/api/tunnels', tunnelRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/logs', settingsRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/ssl', sslRoutes);
app.use('/api/stub-sites', stubSiteRoutes);
app.use('/api/adguard', adguardRoutes);
app.use('/api/user-portal', userPortalRoutes);  // Пользовательский портал
app.use('/api/tariffs', require('./routes/tariffs'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/sub', subscriptionRoutes);  // Публичный (без авторизации)
app.use('/api/diag', diagRoutes);

// 404
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint не найден' });
});

// Глобальный обработчик ошибок
app.use((err, req, res, _next) => {
    console.error('[ERROR]', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// Async запуск
async function main() {
    // Инициализация БД (миграции + сидирование)
    await initDatabase();

    app.listen(PORT, '0.0.0.0', async () => {
        console.log(`[BACKEND] Панель запущена на порту ${PORT}`);

        // Запуск мониторинга
        startScheduler();

        // Автообновление SSL-сертификатов
        const { startAutoRenewal } = require('./routes/ssl');
        startAutoRenewal();

        // Проверка статуса всех серверов с агентами при старте + редеплой конфигов
        try {
            const { queryAll, queryOne, query } = require('./db/postgres');
            const nodeClient = require('./services/node-client');
            const xrayService = require('./services/xray');
            const servers = await queryAll("SELECT id, name FROM servers WHERE agent_status NOT IN ('none', 'deploying')");
            console.log(`[STARTUP] Проверяю ${servers.length} серверов с агентами...`);
            for (const srv of servers) {
                // Ставим online + active для всех серверов с агентом
                await query(
                    "UPDATE servers SET status = 'online', agent_status = 'active', last_seen = NOW() WHERE id = $1",
                    [srv.id]
                );
                console.log(`[STARTUP] ${srv.name}: online`);

                // Принудительный редеплой Xray конфига
                try {
                    const result = await xrayService.deployConfig(srv.id, { force: true });
                    if (result.changed) {
                        console.log(`[STARTUP] ${srv.name}: Xray конфиг обновлён`);
                    }
                } catch (err) {
                    console.warn(`[STARTUP] ${srv.name}: ошибка редеплоя Xray:`, err.message);
                }
            }

            // Фикс Reality dest: синхронизируем dest со stub sites
            const allRealityInbounds = await queryAll(
                `SELECT xi.id, xi.server_id, xi.stream_settings, s.domain as server_domain
                 FROM xray_inbounds xi
                 JOIN servers s ON s.id = xi.server_id
                 WHERE xi.stream_settings->>'security' = 'reality'`
            );
            for (const ib of allRealityInbounds) {
                const ss = ib.stream_settings || {};
                const rs = ss.realitySettings || {};
                const stub = await queryOne('SELECT internal_port, status, domain FROM stub_sites WHERE server_id = $1', [ib.server_id]);
                let changed = false;

                if (stub && stub.status === 'active') {
                    // Stub site активен → dest = 127.0.0.1:port, serverNames = домен
                    const correctDest = `127.0.0.1:${stub.internal_port || 8444}`;
                    const domain = stub.domain || ib.server_domain;
                    if (rs.dest !== correctDest) {
                        rs.dest = correctDest;
                        changed = true;
                    }
                    if (domain && (!rs.serverNames || rs.serverNames[0] !== domain)) {
                        rs.serverNames = [domain];
                        changed = true;
                    }
                } else {
                    // Нет stub site → dest = google, serverNames = google
                    if (rs.dest && rs.dest !== 'www.google.com:443' && !rs.dest.startsWith('127.0.0.1')) {
                        rs.dest = 'www.google.com:443';
                        rs.serverNames = ['www.google.com'];
                        changed = true;
                    }
                    // Фикс 1.1.1.1 → google
                    if (rs.dest && rs.dest.includes('1.1.1.1')) {
                        rs.dest = 'www.google.com:443';
                        rs.serverNames = ['www.google.com'];
                        changed = true;
                    }
                }

                if (changed) {
                    ss.realitySettings = rs;
                    await query('UPDATE xray_inbounds SET stream_settings = $1 WHERE id = $2', [JSON.stringify(ss), ib.id]);
                    console.log(`[STARTUP] Fixed Reality dest #${ib.id}: dest=${rs.dest}, sni=${rs.serverNames?.[0]}`);
                }
            }

            // Автовосстановление упавших туннелей
            const tunnelService = require('./services/tunnel');
            const errorTunnels = await queryAll("SELECT id, name FROM server_links WHERE status = 'error' AND link_type = 'xray'");
            if (errorTunnels.length > 0) {
                console.log(`[STARTUP] Восстанавливаю ${errorTunnels.length} туннелей в ошибке...`);
                for (const t of errorTunnels) {
                    try {
                        const result = await tunnelService.checkTunnelStatus(t.id);
                        console.log(`[STARTUP] Туннель "${t.name}": ${result.status}`);
                    } catch (err) {
                        console.warn(`[STARTUP] Туннель "${t.name}": ${err.message}`);
                    }
                }
            }
        } catch (err) {
            console.warn('[STARTUP] Ошибка проверки серверов:', err.message);
        }

        // Периодическая проверка туннелей (каждые 5 минут)
        setInterval(async () => {
            try {
                const { queryAll } = require('./db/postgres');
                const tunnelService = require('./services/tunnel');
                const errorTunnels = await queryAll("SELECT id, name FROM server_links WHERE status = 'error' AND link_type = 'xray'");
                for (const t of errorTunnels) {
                    try {
                        const result = await tunnelService.restartTunnel(t.id);
                        if (result.status === 'active') {
                            console.log(`[TUNNEL-RECOVERY] Туннель "${t.name}" восстановлен`);
                        }
                    } catch (err) {
                        // Тихо — не спамим логами
                    }
                }
            } catch {}
        }, 5 * 60 * 1000);
    });
}

main().catch(err => {
    console.error('[FATAL] Ошибка запуска:', err);
    process.exit(1);
});
