// Xray маршруты: install, deploy-config, stats, restart, keys
const express = require('express');
const router = express.Router();
const { run, runSafe, runFull } = require('../utils/exec');
const xrayProcess = require('../services/xray-process');
const fs = require('fs');
const http = require('http');

const XRAY_BINARY = '/usr/local/bin/xray';
const XRAY_CONFIG = '/usr/local/etc/xray/config.json';

// POST /api/xray/install — Установить / обновить Xray
router.post('/install', async (req, res) => {
    try {
        // Определяем архитектуру
        const archResult = await run('dpkg --print-architecture 2>/dev/null || uname -m');
        let xrayArch;
        if (archResult === 'amd64' || archResult === 'x86_64') {
            xrayArch = '64';
        } else if (archResult === 'arm64' || archResult === 'aarch64') {
            xrayArch = 'arm64-v8a';
        } else {
            xrayArch = archResult;
        }

        // Получаем последнюю версию
        const versionResult = await runFull(
            `curl -s https://api.github.com/repos/XTLS/Xray-core/releases/latest | grep '"tag_name"' | head -1 | cut -d '"' -f 4`,
            { timeout: 30000 }
        );
        const version = versionResult.stdout.trim();
        if (!version) {
            return res.status(500).json({ error: 'Не удалось определить версию Xray' });
        }

        // Скачиваем бинарник напрямую (без systemd install script)
        const downloadUrl = `https://github.com/XTLS/Xray-core/releases/download/${version}/Xray-linux-${xrayArch}.zip`;
        const installCmd = [
            `curl -L -o /tmp/xray.zip "${downloadUrl}"`,
            'mkdir -p /usr/local/bin /usr/local/etc/xray /var/log/xray',
            'unzip -o /tmp/xray.zip xray geoip.dat geosite.dat -d /usr/local/bin',
            'chmod +x /usr/local/bin/xray',
            'rm -f /tmp/xray.zip',
        ].join(' && ');

        const result = await runFull(installCmd, { timeout: 120000 });
        if (result.exitCode !== 0) {
            return res.status(500).json({
                error: 'Xray installation failed',
                stderr: result.stderr,
            });
        }

        const installedVersion = await xrayProcess.getVersion();
        res.json({ ok: true, version: installedVersion });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/xray/uninstall — Удалить Xray
router.post('/uninstall', async (req, res) => {
    try {
        await xrayProcess.stop();
        await runSafe('rm -f /usr/local/bin/xray /usr/local/bin/geoip.dat /usr/local/bin/geosite.dat');
        await runSafe('rm -rf /usr/local/etc/xray /var/log/xray');
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/xray/status — Статус Xray
router.get('/status', async (req, res) => {
    try {
        const installed = await xrayProcess.isInstalled();
        const running = xrayProcess.isRunning();
        const version = installed ? await xrayProcess.getVersion() : null;

        res.json({ installed, running, version });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/xray/restart — Перезапустить Xray
router.post('/restart', async (req, res) => {
    try {
        await xrayProcess.restart();
        // Ждём немного для стабилизации
        await new Promise(r => setTimeout(r, 1000));
        const running = xrayProcess.isRunning();
        res.json({ ok: running, running });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/xray/stop — Остановить Xray
router.post('/stop', async (req, res) => {
    try {
        await xrayProcess.stop();
        res.json({ ok: true, running: false });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/xray/deploy-config — Записать конфиг и перезапустить
router.post('/deploy-config', async (req, res) => {
    try {
        const { config } = req.body;
        if (!config) {
            return res.status(400).json({ error: 'config is required' });
        }

        const configStr = typeof config === 'string' ? config : JSON.stringify(config, null, 2);

        // Создаём директории если нет
        const configDir = '/usr/local/etc/xray';
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        const logDir = '/var/log/xray';
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        // Бэкап текущего конфига
        if (fs.existsSync(XRAY_CONFIG)) {
            fs.copyFileSync(XRAY_CONFIG, `${XRAY_CONFIG}.bak`);
        }

        // Пишем новый конфиг
        fs.writeFileSync(XRAY_CONFIG, configStr);

        // Валидируем конфиг (без 2>&1 — runFull захватывает stdout и stderr отдельно)
        const validate = await runFull(`${XRAY_BINARY} run -test -config ${XRAY_CONFIG}`);
        if (validate.exitCode !== 0) {
            // Откатываем
            if (fs.existsSync(`${XRAY_CONFIG}.bak`)) {
                fs.copyFileSync(`${XRAY_CONFIG}.bak`, XRAY_CONFIG);
            }
            // Объединяем stdout и stderr — реальная ошибка Xray обычно в stdout
            const errorDetails = [validate.stdout, validate.stderr]
                .filter(Boolean).join('\n').slice(0, 2000);
            console.error('[XRAY] Config validation failed:', errorDetails);
            return res.status(400).json({
                error: 'Invalid Xray config',
                details: errorDetails,
            });
        }

        // Перезапускаем Xray
        await xrayProcess.restart();
        await new Promise(r => setTimeout(r, 1000));
        const running = xrayProcess.isRunning();

        res.json({ ok: running, running, validated: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/xray/stats — Получить статистику трафика через Xray API
router.get('/stats', async (req, res) => {
    try {
        const apiPort = parseInt(req.query.apiPort) || 10085;

        const stats = await queryXrayStats(apiPort, false);
        if (!stats) {
            return res.json({ stats: [] });
        }

        // Парсим статистику
        const parsed = (stats.stat || []).map(s => {
            const parts = s.name.split('>>>');
            return {
                name: s.name,
                type: parts[0], // user, inbound, outbound
                tag: parts[1],
                direction: parts[3], // uplink, downlink
                value: parseInt(s.value) || 0,
            };
        });

        res.json({ stats: parsed });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/xray/stats/reset — Сбросить статистику (query + reset)
router.post('/stats/reset', async (req, res) => {
    try {
        const apiPort = parseInt(req.query.apiPort) || 10085;
        const stats = await queryXrayStats(apiPort, true);
        res.json({ ok: true, stats: stats?.stat || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/xray/access-log — Чтение access.log (последние N строк)
router.get('/access-log', async (req, res) => {
    try {
        const lines = Math.min(parseInt(req.query.lines) || 500, 2000);
        const logFile = '/var/log/xray/access.log';

        // Проверяем существование файла
        const exists = await runSafe(`test -f ${logFile} && echo "yes" || echo "no"`);
        if (exists.trim() !== 'yes') {
            return res.json({ lines: [], count: 0 });
        }

        const output = await runSafe(`tail -n ${lines} ${logFile}`);
        if (!output || !output.trim()) {
            return res.json({ lines: [], count: 0 });
        }

        const logLines = output.trim().split('\n').filter(Boolean);
        res.json({ lines: logLines, count: logLines.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/xray/access-log/truncate — Очистить access.log
router.post('/access-log/truncate', async (req, res) => {
    try {
        await runSafe('truncate -s 0 /var/log/xray/access.log 2>/dev/null || true');
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// gRPC HandlerService — управление пользователями без перезапуска
// ============================================================

// POST /api/xray/grpc/add-user — Добавить пользователя в inbound через gRPC
router.post('/grpc/add-user', async (req, res) => {
    try {
        const { inboundTag, protocol, email, id, password, level } = req.body;
        if (!inboundTag || !email) {
            return res.status(400).json({ error: 'inboundTag and email required' });
        }

        const apiPort = parseInt(req.query.apiPort) || 10085;
        let userJson;

        switch (protocol) {
            case 'vless':
                userJson = JSON.stringify({ email, id, level: level || 0 });
                break;
            default:
                userJson = JSON.stringify({ email, id, level: level || 0 });
        }

        const cmd = `echo '${userJson}' | ${XRAY_BINARY} api adu --server=127.0.0.1:${apiPort} --inbound ${inboundTag}`;
        const result = await runFull(cmd, { timeout: 5000 });

        if (result.exitCode !== 0) {
            const errMsg = (result.stderr || result.stdout || '').slice(0, 500);
            return res.status(400).json({ error: 'gRPC addUser failed', details: errMsg });
        }

        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/xray/grpc/remove-user — Удалить пользователя из inbound через gRPC
router.post('/grpc/remove-user', async (req, res) => {
    try {
        const { inboundTag, email } = req.body;
        if (!inboundTag || !email) {
            return res.status(400).json({ error: 'inboundTag and email required' });
        }

        const apiPort = parseInt(req.query.apiPort) || 10085;
        const cmd = `echo '{"email":"${email}"}' | ${XRAY_BINARY} api rmu --server=127.0.0.1:${apiPort} --inbound ${inboundTag}`;
        const result = await runFull(cmd, { timeout: 5000 });

        if (result.exitCode !== 0) {
            const errMsg = (result.stderr || result.stdout || '').slice(0, 500);
            return res.status(400).json({ error: 'gRPC removeUser failed', details: errMsg });
        }

        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/xray/write-config — Записать конфиг НЕ перезапуская Xray (для синхронизации)
router.post('/write-config', async (req, res) => {
    try {
        const { config } = req.body;
        if (!config) {
            return res.status(400).json({ error: 'config is required' });
        }

        const configStr = typeof config === 'string' ? config : JSON.stringify(config, null, 2);

        const configDir = '/usr/local/etc/xray';
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }

        // Бэкап + запись (без перезапуска)
        if (fs.existsSync(XRAY_CONFIG)) {
            fs.copyFileSync(XRAY_CONFIG, `${XRAY_CONFIG}.bak`);
        }
        fs.writeFileSync(XRAY_CONFIG, configStr);

        res.json({ ok: true, written: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/xray/config — Прочитать текущий конфиг
router.get('/config', async (req, res) => {
    try {
        if (!fs.existsSync(XRAY_CONFIG)) {
            return res.json(null);
        }
        const config = JSON.parse(fs.readFileSync(XRAY_CONFIG, 'utf-8'));
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/xray/generate-keys — Генерация Reality x25519 ключей
router.post('/generate-keys', async (req, res) => {
    try {
        const output = await run(`${XRAY_BINARY} x25519`);
        const lines = output.split('\n');

        let privateKey = '';
        let publicKey = '';
        for (const line of lines) {
            if (line.includes('Private key:')) {
                privateKey = line.split('Private key:')[1].trim();
            } else if (line.includes('Public key:')) {
                publicKey = line.split('Public key:')[1].trim();
            }
        }

        if (!privateKey || !publicKey) {
            return res.status(500).json({ error: 'Failed to parse x25519 output', raw: output });
        }

        res.json({ privateKey, publicKey });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Запрос статистики через Xray CLI (xray api statsquery)
 * @param {number} port — gRPC API порт
 * @param {boolean} reset — сбросить счётчики после запроса
 */
async function queryXrayStats(port, reset = false) {
    try {
        // Правильная команда: xray api statsquery (НЕ querystats)
        let cmd = `${XRAY_BINARY} api statsquery --server=127.0.0.1:${port}`;
        if (reset) {
            cmd += ' -reset';
        }
        const result = await runFull(cmd, { timeout: 5000 });
        if (result.exitCode !== 0) {
            if (result.stderr) {
                console.error(`[XRAY-STATS] Ошибка API (port ${port}):`, result.stderr.slice(0, 200));
            }
            return null;
        }
        const output = result.stdout.trim();
        if (!output) return null;
        return JSON.parse(output);
    } catch (err) {
        console.error(`[XRAY-STATS] Ошибка запроса:`, err.message);
        return null;
    }
}

module.exports = router;
