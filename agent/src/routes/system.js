// Системные маршруты: info, reboot, ping, routes
const express = require('express');
const router = express.Router();
const { run, runSafe, runFull } = require('../utils/exec');
const os = require('os');

// GET /api/system/info — Информация о системе
router.get('/info', async (req, res) => {
    try {
        const [kernel, osRelease, mainIface] = await Promise.all([
            runSafe('uname -r'),
            runSafe('cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\''),
            runSafe("ip route show default | awk '{print $5}' | head -1"),
        ]);

        // Xray
        const xrayVersion = await runSafe("/usr/local/bin/xray version 2>/dev/null | head -1 | awk '{print $2}'");
        const xrayInstalled = !!xrayVersion;

        // IP addresses
        const [ipv4, ipv6] = await Promise.all([
            runSafe(`ip -4 addr show ${mainIface} 2>/dev/null | grep inet | awk '{print $2}' | cut -d/ -f1 | head -1`),
            runSafe(`ip -6 addr show ${mainIface} scope global 2>/dev/null | grep inet6 | awk '{print $2}' | cut -d/ -f1 | head -1`),
        ]);

        res.json({
            hostname: os.hostname(),
            os: osRelease || 'Unknown',
            kernel,
            arch: os.arch(),
            mainIface,
            ipv4: ipv4 || null,
            ipv6: ipv6 || null,
            xray: {
                installed: xrayInstalled,
                version: xrayVersion || null,
            },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/system/reboot — Перезагрузка (отложенная)
router.post('/reboot', async (req, res) => {
    try {
        // Отвечаем до перезагрузки
        res.status(202).json({ message: 'Rebooting in 3 seconds...' });
        setTimeout(async () => {
            try {
                await run('reboot');
            } catch {}
        }, 3000);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/system/ping — Пинг хоста
router.post('/ping', async (req, res) => {
    try {
        const { host, count = 3, timeout = 5 } = req.body;
        if (!host) {
            return res.status(400).json({ error: 'host is required' });
        }

        // Безопасная проверка хоста (только IP/домен)
        if (!/^[a-zA-Z0-9.\-:]+$/.test(host)) {
            return res.status(400).json({ error: 'Invalid host format' });
        }

        const result = await runFull(
            `ping -c ${Math.min(count, 10)} -W ${Math.min(timeout, 30)} ${host}`,
            { timeout: (timeout + 5) * 1000 }
        );

        res.json({
            ok: result.exitCode === 0,
            output: result.stdout || result.stderr,
            exitCode: result.exitCode,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/system/routes — Настроить маршруты
router.post('/routes', async (req, res) => {
    try {
        const { rules } = req.body;
        if (!Array.isArray(rules)) {
            return res.status(400).json({ error: 'rules must be an array' });
        }

        const results = [];
        for (const rule of rules) {
            const { subnet, gateway, table, iface } = rule;
            if (!subnet) continue;

            let cmd = `ip route replace ${subnet}`;
            if (gateway) cmd += ` via ${gateway}`;
            if (iface) cmd += ` dev ${iface}`;
            if (table) cmd += ` table ${table}`;

            const result = await runFull(cmd);
            results.push({
                rule,
                ok: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : null,
            });
        }

        res.json({ results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/system/logs — Системные логи (syslog/journald)
router.get('/logs', async (req, res) => {
    try {
        const { lines = 100, service } = req.query;
        const limit = Math.min(parseInt(lines) || 100, 500);

        let cmd;
        if (service) {
            // Логи конкретного сервиса
            if (!/^[a-zA-Z0-9._-]+$/.test(service)) {
                return res.status(400).json({ error: 'Invalid service name' });
            }
            cmd = `journalctl -u ${service} -n ${limit} --no-pager 2>/dev/null || tail -n ${limit} /var/log/syslog 2>/dev/null || echo "No logs available"`;
        } else {
            cmd = `journalctl -n ${limit} --no-pager 2>/dev/null || tail -n ${limit} /var/log/syslog 2>/dev/null || echo "No logs available"`;
        }

        const output = await runSafe(cmd);
        res.json({ logs: output || '', lines: limit });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/system/connections — Активные сетевые подключения
router.get('/connections', async (req, res) => {
    try {
        const output = await runSafe("ss -tunlp 2>/dev/null | tail -n +2");
        const connections = (output || '').split('\n').filter(Boolean).map(line => {
            const parts = line.trim().split(/\s+/);
            return {
                proto: parts[0],
                state: parts[1],
                recvQ: parts[2],
                sendQ: parts[3],
                local: parts[4],
                peer: parts[5],
                process: parts[6] || '',
            };
        });

        res.json({ connections });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/system/processes — Топ процессов по ресурсам
router.get('/processes', async (req, res) => {
    try {
        const output = await runSafe("ps aux --sort=-%cpu 2>/dev/null | head -16");
        const lines = (output || '').split('\n').filter(Boolean);
        const header = lines[0];
        const processes = lines.slice(1).map(line => {
            const parts = line.trim().split(/\s+/);
            return {
                user: parts[0],
                pid: parseInt(parts[1]),
                cpu: parseFloat(parts[2]),
                mem: parseFloat(parts[3]),
                vsz: parts[4],
                rss: parts[5],
                stat: parts[7],
                time: parts[9],
                command: parts.slice(10).join(' '),
            };
        });

        res.json({ processes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/system/exec — Выполнить диагностическую команду
router.post('/exec', async (req, res) => {
    try {
        const { command } = req.body;
        if (!command) return res.status(400).json({ error: 'command is required' });
        // Ограничиваем только диагностическими командами
        const blocked = ['rm ', 'mkfs', 'dd ', 'shutdown', 'reboot', '> /dev', 'chmod 777'];
        const isBlocked = blocked.some(b => command.includes(b));
        if (isBlocked) return res.status(403).json({ error: 'Command blocked' });
        const isAllowed = true; // диагностика — разрешаем всё кроме деструктивных
        if (!isAllowed) return res.status(403).json({ error: 'Command not allowed' });
        const output = await runSafe(command);
        res.json({ output: output || '' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
