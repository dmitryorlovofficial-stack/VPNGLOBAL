// API маршруты для управления сайтом-заглушкой (stub site)
const express = require('express');
const router = express.Router();
const nginxProcess = require('../services/nginx-process');

// POST /api/stub-site/deploy — развернуть заглушку
router.post('/deploy', async (req, res) => {
    try {
        const { files, domain, internalPort = 8444 } = req.body;

        if (!files || typeof files !== 'object' || Object.keys(files).length === 0) {
            return res.status(400).json({ error: 'files is required (object { filename: content })' });
        }

        if (!files['index.html']) {
            return res.status(400).json({ error: 'index.html is required' });
        }

        const installed = await nginxProcess.isInstalled();
        if (!installed) {
            return res.status(500).json({ error: 'nginx not installed in container' });
        }

        // 1. Записываем файлы сайта
        await nginxProcess.deploySiteFiles(files);

        // 2. Генерируем self-signed cert если нет или домен изменился
        if (nginxProcess.needsNewCert(domain)) {
            await nginxProcess.generateSelfSignedCert(domain);
        }

        // 3. Генерируем nginx.conf
        await nginxProcess.generateConfig(domain, internalPort);

        // 4. Проверяем конфиг
        const test = await nginxProcess.testConfig();
        if (!test.ok) {
            return res.status(400).json({ error: 'Invalid nginx config', details: test.output });
        }

        // 5. Стартуем/перезагружаем nginx
        const running = await nginxProcess.isRunning();
        if (running) {
            await nginxProcess.reload();
        } else {
            await nginxProcess.start();
        }

        res.json({
            ok: true,
            domain: domain || '_',
            internalPort,
            filesDeployed: Object.keys(files).length,
        });
    } catch (err) {
        console.error('[STUB-SITE] Deploy error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/stub-site/status — статус заглушки
router.get('/status', async (req, res) => {
    try {
        const installed = await nginxProcess.isInstalled();
        const running = installed ? await nginxProcess.isRunning() : false;
        const version = installed ? await nginxProcess.getVersion() : '';
        const fs = require('fs');
        const hasSite = fs.existsSync('/var/www/stub-site/index.html');

        res.json({ installed, running, version, hasSite });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/stub-site/stop — остановить nginx
router.post('/stop', async (req, res) => {
    try {
        await nginxProcess.stop();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/stub-site/restart — перезапустить nginx
router.post('/restart', async (req, res) => {
    try {
        await nginxProcess.stop();
        await new Promise(r => setTimeout(r, 300));
        await nginxProcess.start();
        const running = await nginxProcess.isRunning();
        res.json({ ok: running, running });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =================== SSL (Let's Encrypt) ===================

// POST /api/stub-site/ssl/obtain — получить SSL-сертификат через webroot
router.post('/ssl/obtain', async (req, res) => {
    try {
        const { domain, email, internalPort = 8444 } = req.body;

        if (!domain) {
            return res.status(400).json({ error: 'domain is required' });
        }

        // Проверяем что nginx запущен (нужен для webroot)
        const running = await nginxProcess.isRunning();
        if (!running) {
            return res.status(400).json({ error: 'nginx must be running for webroot verification' });
        }

        // Получаем сертификат
        const cert = await nginxProcess.obtainCert(domain, email);

        // Перегенерируем nginx.conf с SSL
        await nginxProcess.generateConfigWithSSL(domain, internalPort);

        // Проверяем конфиг
        const test = await nginxProcess.testConfig();
        if (!test.ok) {
            return res.status(400).json({ error: 'Invalid nginx SSL config', details: test.output });
        }

        // Reload nginx
        await nginxProcess.reload();

        res.json({ ok: true, cert });
    } catch (err) {
        console.error('[STUB-SITE] SSL obtain error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/stub-site/ssl/status — статус SSL-сертификата
router.get('/ssl/status', async (req, res) => {
    try {
        const { domain } = req.query;
        const cert = nginxProcess.getCertInfo(domain);
        res.json(cert);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/stub-site/ssl/renew — обновить SSL-сертификат
router.post('/ssl/renew', async (req, res) => {
    try {
        const { domain, internalPort = 8444 } = req.body;

        const result = await nginxProcess.renewCert();

        // Перегенерируем конфиг если есть домен
        if (domain && nginxProcess.hasLetsEncryptCert(domain)) {
            await nginxProcess.generateConfigWithSSL(domain, internalPort);
            await nginxProcess.reload();
        }

        const cert = domain ? nginxProcess.getCertInfo(domain) : null;
        res.json({ ok: true, cert, renewOutput: result.output });
    } catch (err) {
        console.error('[STUB-SITE] SSL renew error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/stub-site — удалить заглушку
router.delete('/', async (req, res) => {
    try {
        await nginxProcess.stop();
        const { runFull } = require('../utils/exec');
        await runFull('rm -rf /var/www/stub-site/*');
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
