// Сервис мониторинга (PostgreSQL + мульти-сервер, все операции через агент)
const cron = require('node-cron');
const { queryOne, queryAll, query, transaction } = require('../db/postgres');
const xrayService = require('./xray');
const nodeClient = require('./node-client');
const sshManager = require('./ssh-manager');

// Трекер авто-восстановления агентов (serverId → { lastAttempt, attempts })
const recoveryTracker = new Map();
// Трекер health-check сбоев (serverId → consecutiveFailures)
const healthFailures = new Map();

// Проверка истёкших подписок
async function checkExpiredClients() {
    const now = new Date().toISOString();
    const expired = await queryAll(
        `SELECT id, name, public_key, server_id, protocol FROM clients
         WHERE expires_at IS NOT NULL AND expires_at < $1 AND is_blocked = FALSE`,
        [now]
    );

    const serversToRedeploy = new Set();
    for (const client of expired) {
        await query('UPDATE clients SET is_blocked = TRUE WHERE id = $1', [client.id]);
        if (client.server_id) serversToRedeploy.add(client.server_id);
        await query(
            `INSERT INTO logs (level, category, message, details)
             VALUES ('info', 'client', $1, $2)`,
            [`Подписка клиента ${client.name} истекла — заблокирован`,
             JSON.stringify({ clientId: client.id })]
        );
    }
    // Редеплой Xray убирает заблокированных из конфига
    for (const serverId of serversToRedeploy) {
        try { await xrayService.deployConfig(serverId); } catch {}
    }
}

// Сбор статистики Xray (все активные инстансы)
async function collectXrayTrafficStats() {
    try {
        const instances = await queryAll(
            "SELECT server_id FROM xray_instances WHERE status = 'active'"
        );
        for (const inst of instances) {
            try {
                await xrayService.collectXrayStats(inst.server_id);
            } catch (err) {
                console.error(`[MONITOR] Ошибка сбора Xray статистики #${inst.server_id}:`, err.message);
            }
        }
    } catch (err) {
        console.error('[MONITOR] Ошибка сбора Xray статистики:', err.message);
    }
}

// Проверка что Xray запущен — если упал, рестартим и деплоим конфиг
async function ensureXrayRunning() {
    try {
        const instances = await queryAll(
            "SELECT xi.server_id FROM xray_instances xi JOIN servers s ON s.id = xi.server_id WHERE xi.status = 'active' AND s.status = 'online'"
        );
        for (const inst of instances) {
            try {
                const status = await nodeClient.xrayStatus(inst.server_id);
                if (!status || !status.running) {
                    console.warn(`[MONITOR] Xray не запущен на #${inst.server_id}, перезапускаем...`);
                    try {
                        await xrayService.deployConfig(inst.server_id, { force: true });
                        console.log(`[MONITOR] Xray перезапущен на #${inst.server_id}`);
                    } catch (deployErr) {
                        console.error(`[MONITOR] Не удалось перезапустить Xray #${inst.server_id}:`, deployErr.message);
                    }
                }
            } catch {}
        }
    } catch {}
}

// Проверка здоровья туннелей + авто-восстановление
async function checkTunnelHealth() {
    try {
        // Xray-цепочки — проверяем запущен ли Xray + авто-восстановление
        const xrayLinks = await queryAll(
            "SELECT * FROM server_links WHERE status IN ('active', 'error') AND link_type = 'xray'"
        );

        // Кешируем статусы серверов чтобы не дёргать агент по N раз
        const serverStatusCache = new Map();
        async function getXrayStatus(serverId) {
            if (serverStatusCache.has(serverId)) return serverStatusCache.get(serverId);
            try {
                const st = await nodeClient.xrayStatus(serverId);
                serverStatusCache.set(serverId, st);
                return st;
            } catch {
                serverStatusCache.set(serverId, { running: false });
                return { running: false };
            }
        }

        // Собираем серверы которые нужно передеплоить (дедупликация)
        const serversToRedeploy = new Set();

        for (const link of xrayLinks) {
            try {
                const [fromStatus, toStatus] = await Promise.all([
                    getXrayStatus(link.from_server_id),
                    getXrayStatus(link.to_server_id),
                ]);

                const isHealthy = fromStatus.running && toStatus.running;

                if (!isHealthy) {
                    if (link.status === 'active') {
                        console.warn(`[MONITOR] Xray-цепочка #${link.id} (${link.from_server_id}→${link.to_server_id}) — Xray не работает`);
                        await query("UPDATE server_links SET status = 'error' WHERE id = $1", [link.id]);
                    }

                    // Пробуем восстановить — передеплоим конфиг на упавших серверах
                    if (!fromStatus.running) serversToRedeploy.add(link.from_server_id);
                    if (!toStatus.running) serversToRedeploy.add(link.to_server_id);
                } else if (link.status === 'error') {
                    // Xray работает на обоих — восстанавливаем статус
                    console.log(`[MONITOR] Xray-цепочка #${link.id} восстановилась`);
                    await query("UPDATE server_links SET status = 'active' WHERE id = $1", [link.id]);
                }
            } catch {}
        }

        // Авто-восстановление: передеплоим конфиг на упавшие серверы
        for (const serverId of serversToRedeploy) {
            try {
                console.log(`[MONITOR] Авто-восстановление: деплой Xray конфига на сервер #${serverId}...`);
                await xrayService.deployConfig(serverId, { force: true });
                console.log(`[MONITOR] Xray на сервере #${serverId} передеплоен`);
            } catch (err) {
                console.error(`[MONITOR] Не удалось передеплоить Xray на #${serverId}:`, err.message);
            }
        }
    } catch (err) {
        console.error('[MONITOR] Ошибка проверки туннелей:', err.message);
    }
}

// Проверка лимитов трафика клиентов
async function checkTrafficLimits() {
    const clients = await queryAll(`
        SELECT id, name, xray_inbound_id, upload_bytes, download_bytes, traffic_limit_bytes
        FROM clients WHERE traffic_limit_bytes > 0 AND is_blocked = FALSE
    `);

    for (const client of clients) {
        const total = (parseInt(client.upload_bytes) || 0) + (parseInt(client.download_bytes) || 0);
        if (total >= parseInt(client.traffic_limit_bytes)) {
            await query('UPDATE clients SET is_blocked = TRUE WHERE id = $1', [client.id]);

            // Редеплой конфига (заблокированный клиент не будет в конфиге)
            if (client.xray_inbound_id) {
                const ib = await queryOne('SELECT server_id FROM xray_inbounds WHERE id = $1', [client.xray_inbound_id]);
                if (ib) {
                    try { await xrayService.deployConfig(ib.server_id); } catch {}
                }
            }

            await query(
                `INSERT INTO logs (level, category, message, details)
                 VALUES ('warning', 'client', $1, $2)`,
                [`Клиент ${client.name} заблокирован: превышен лимит трафика`,
                 JSON.stringify({ clientId: client.id, total, limit: parseInt(client.traffic_limit_bytes) })]
            );
        }
    }
}

// Парсинг строки access.log Xray
// Формат Xray-core: 2024/01/15 12:34:56 1.2.3.4:12345 accepted tcp:example.com:443 [tag] email: user@vpn
// Формат v2ray:     2024/01/15 12:34:56 from 1.2.3.4:12345 accepted tcp:example.com:443 email: user@vpn
// Без email: 2024/01/15 12:34:56 1.2.3.4:12345 accepted tcp:example.com:443 [tag]
function parseAccessLogLine(line) {
    try {
        if (!line || !line.includes('accepted')) return null;

        // Извлекаем email/username
        const emailMatch = line.match(/email:\s*(\S+)/);

        // Извлекаем inbound tag: формат [tag -> outbound] или [tag]
        const tagMatch = line.match(/\[(\S+?)(?:\s*->|\])/);
        const tag = tagMatch ? tagMatch[1] : null;

        // Извлекаем timestamp
        const tsMatch = line.match(/^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})/);
        const timestamp = tsMatch ? new Date(tsMatch[1].replace(/\//g, '-')).getTime() : 0;

        // Извлекаем source IP — поддержка обоих форматов (с "from" и без)
        // IPv4: 1.2.3.4:12345 или from 1.2.3.4:12345
        // IPv6: [2001:db8::1]:12345 или from [2001:db8::1]:12345
        let ip;
        const ipv4Match = line.match(/(?:from\s+)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+\s+accepted/);
        if (ipv4Match) {
            ip = ipv4Match[1];
        } else {
            const ipv6Match = line.match(/(?:from\s+)?\[([^\]]+)\]:\d+\s+accepted/);
            if (ipv6Match) ip = ipv6Match[1];
        }

        if (!ip) return null;

        return { email: emailMatch ? emailMatch[1] : null, ip, timestamp, tag };
    } catch {
        return null;
    }
}

// Сбор внешних IP Xray-клиентов из access.log
async function collectXrayEndpoints() {
    try {
        const instances = await queryAll(
            "SELECT server_id FROM xray_instances WHERE status = 'active'"
        );

        for (const inst of instances) {
            try {
                const result = await nodeClient.xrayAccessLog(inst.server_id, 1000);
                if (!result || !result.lines || result.lines.length === 0) continue;

                // Парсим логи — берём самый свежий IP для каждого email
                const userIps = new Map();

                for (const line of result.lines) {
                    const parsed = parseAccessLogLine(line);
                    if (!parsed) continue;

                    // Пропускаем записи от служебных inbound'ов
                    if (parsed.tag && (parsed.tag.startsWith('chain-') || parsed.tag === 'api')) continue;
                    if (!parsed.email) continue;

                    const existing = userIps.get(parsed.email);
                    if (!existing || parsed.timestamp > existing.timestamp) {
                        userIps.set(parsed.email, { ip: parsed.ip, timestamp: parsed.timestamp });
                    }
                }

                // Обновляем endpoint по xray_email
                for (const [email, { ip }] of userIps) {
                    await query(
                        `UPDATE clients SET endpoint = $1
                         WHERE xray_email = $2 AND is_chain = FALSE`,
                        [ip, email]
                    );
                }
            } catch (err) {
                console.error(`[MONITOR] Ошибка сбора endpoint Xray #${inst.server_id}:`, err.message);
            }
        }
    } catch (err) {
        console.error('[MONITOR] Ошибка сбора Xray endpoints:', err.message);
    }
}

// Очистка access.log на всех серверах (вызывается раз в сутки)
async function truncateXrayAccessLogs() {
    try {
        const instances = await queryAll(
            "SELECT server_id FROM xray_instances WHERE status = 'active'"
        );
        for (const inst of instances) {
            try {
                await nodeClient.xrayTruncateAccessLog(inst.server_id);
            } catch {}
        }
    } catch {}
}

/**
 * Быстрый health ping агентов — каждые 15 сек
 * Лёгкий запрос /api/health (без метрик)
 * После 5 подряд сбоев → авто-восстановление
 */
async function quickAgentHealthCheck() {
    const servers = await queryAll(
        "SELECT id, name, agent_status FROM servers WHERE agent_status NOT IN ('none', 'deploying')"
    );

    for (const server of servers) {
        try {
            await nodeClient.healthCheck(server.id);

            // Успех — сбрасываем счётчик сбоев
            healthFailures.delete(server.id);

            // Если был unreachable — возвращаем online
            if (server.agent_status === 'unreachable' || server.agent_status === 'error') {
                await query(
                    `UPDATE servers SET status = 'online', agent_status = 'active', last_seen = NOW(), updated_at = NOW() WHERE id = $1`,
                    [server.id]
                );
                console.log(`[MONITOR] Агент #${server.id} (${server.name}): восстановлен, status=active`);
            } else {
                await query(
                    `UPDATE servers SET last_seen = NOW() WHERE id = $1`,
                    [server.id]
                );
            }
        } catch {
            // Сбой — увеличиваем счётчик
            const fails = (healthFailures.get(server.id) || 0) + 1;
            healthFailures.set(server.id, fails);

            if (fails === 3) {
                // 3 сбоя (~45 сек) — помечаем unreachable
                await query(
                    `UPDATE servers SET agent_status = 'unreachable', updated_at = NOW() WHERE id = $1`,
                    [server.id]
                );
            } else if (fails === 5) {
                // 5 сбоев (~75 сек) — пробуем авто-восстановление
                console.warn(`[MONITOR] Агент #${server.id} (${server.name}): 5 сбоев подряд, запуск восстановления`);
                await query(
                    `UPDATE servers SET status = 'offline', agent_status = 'unreachable', updated_at = NOW() WHERE id = $1`,
                    [server.id]
                );
                recoverAgent(server.id, server.name).catch(e =>
                    console.error(`[MONITOR] recoverAgent #${server.id} error:`, e.message)
                );
            } else if (fails > 5 && fails % 20 === 0) {
                // Каждые 20 сбоев (~5 мин) — повторная попытка восстановления
                recoverAgent(server.id, server.name).catch(e =>
                    console.error(`[MONITOR] recoverAgent #${server.id} error:`, e.message)
                );
            }
        }
    }
}

/**
 * Авто-восстановление агента через SSH → docker restart
 * Вызывается когда агент недоступен > 3 мин
 * Ограничение: не чаще 1 раза в 5 мин на сервер, макс 3 попытки подряд
 */
async function recoverAgent(serverId, serverName) {
    const now = Date.now();
    const tracker = recoveryTracker.get(serverId) || { lastAttempt: 0, attempts: 0 };

    // Не чаще 1 раза в 5 мин
    if (now - tracker.lastAttempt < 5 * 60 * 1000) return false;
    // Макс 3 попытки подряд, потом ждём ручного вмешательства
    if (tracker.attempts >= 3) {
        if (!tracker.gaveUp) {
            console.error(`[MONITOR] Агент #${serverId} (${serverName}): 3 попытки восстановления не помогли, ожидаем ручное вмешательство`);
            await query(
                `INSERT INTO logs (level, category, server_id, message) VALUES ('error', 'agent', $1, $2)`,
                [serverId, `Авто-восстановление исчерпано (3 попытки). Проверьте сервер вручную.`]
            );
            tracker.gaveUp = true;
            recoveryTracker.set(serverId, tracker);
        }
        return false;
    }

    tracker.lastAttempt = now;
    tracker.attempts++;
    recoveryTracker.set(serverId, tracker);

    console.log(`[MONITOR] Авто-восстановление агента #${serverId} (${serverName}), попытка ${tracker.attempts}/3...`);

    try {
        const ssh = await sshManager.connect(serverId);
        const exec = async (cmd) => {
            const r = await ssh.execCommand(cmd, { cwd: '/' });
            return r.stdout.trim();
        };

        // Проверяем состояние контейнера
        const containerStatus = await exec('docker inspect -f "{{.State.Status}}" vpn-node-agent 2>/dev/null');
        console.log(`[MONITOR] Агент #${serverId}: контейнер status="${containerStatus}"`);

        if (!containerStatus || containerStatus === '') {
            // Контейнер не существует — нужен полный редеплой
            console.error(`[MONITOR] Агент #${serverId}: контейнер не найден, нужен редеплой`);
            await query(
                `INSERT INTO logs (level, category, server_id, message) VALUES ('error', 'agent', $1, $2)`,
                [serverId, `Контейнер агента не найден. Нажмите "Установить агент" в панели.`]
            );
            tracker.attempts = 3; // Не пробуем больше
            recoveryTracker.set(serverId, tracker);
            return false;
        }

        if (containerStatus === 'exited' || containerStatus === 'dead') {
            // Контейнер остановлен — запускаем
            console.log(`[MONITOR] Агент #${serverId}: контейнер ${containerStatus}, запускаем...`);
            await exec('docker start vpn-node-agent');
        } else if (containerStatus === 'running') {
            // Контейнер запущен, но не отвечает — перезапускаем
            console.log(`[MONITOR] Агент #${serverId}: контейнер running но не отвечает, рестарт...`);
            await exec('docker restart vpn-node-agent');
        } else {
            // Другой статус (restarting, paused, created) — restart
            await exec('docker restart vpn-node-agent');
        }

        // Ждём старта (5 сек)
        await new Promise(r => setTimeout(r, 5000));

        // Проверяем health
        try {
            const health = await nodeClient.healthCheck(serverId);
            if (health && health.status === 'ok') {
                console.log(`[MONITOR] Агент #${serverId}: восстановлен успешно!`);
                await query(
                    `UPDATE servers SET status = 'online', agent_status = 'active', last_seen = NOW(), updated_at = NOW() WHERE id = $1`,
                    [serverId]
                );
                await query(
                    `INSERT INTO logs (level, category, server_id, message) VALUES ('info', 'agent', $1, $2)`,
                    [serverId, `Агент автоматически восстановлен (попытка ${tracker.attempts})`]
                );
                // Сбрасываем счётчик
                recoveryTracker.set(serverId, { lastAttempt: now, attempts: 0 });
                return true;
            }
        } catch {}

        console.warn(`[MONITOR] Агент #${serverId}: рестарт выполнен, но health check не прошёл`);
        await query(
            `INSERT INTO logs (level, category, server_id, message) VALUES ('warning', 'agent', $1, $2)`,
            [serverId, `Рестарт контейнера выполнен (попытка ${tracker.attempts}), но агент не отвечает`]
        );
        return false;

    } catch (err) {
        console.error(`[MONITOR] Авто-восстановление #${serverId} SSH ошибка:`, err.message);
        await query(
            `INSERT INTO logs (level, category, server_id, message) VALUES ('error', 'agent', $1, $2)`,
            [serverId, `Авто-восстановление: SSH ошибка — ${err.message}`]
        );
        return false;
    }
}

// Обновление метрик (CPU/RAM/Disk) всех серверов через агент
// Health check и recovery теперь в quickAgentHealthCheck (каждые 15 сек)
async function updateServerMetrics() {
    // Только online серверы — метрики нужны когда агент отвечает
    const servers = await queryAll(
        "SELECT id, name FROM servers WHERE agent_status = 'active'"
    );

    for (const server of servers) {
        try {
            const metrics = await nodeClient.getMetrics(server.id);

            const ramTotalMb = Math.round((metrics.ram?.total || 0) / 1024 / 1024);
            const ramUsedMb = Math.round((metrics.ram?.used || 0) / 1024 / 1024);
            const diskTotalGb = Math.round((metrics.disk?.total || 0) / 1024 / 1024 / 1024);
            const diskUsedGb = Math.round((metrics.disk?.used || 0) / 1024 / 1024 / 1024);

            await query(
                `UPDATE servers SET
                    cpu_percent = $1, ram_total_mb = $2, ram_used_mb = $3,
                    disk_total_gb = $4, disk_used_gb = $5, uptime_seconds = $6,
                    updated_at = NOW()
                 WHERE id = $7`,
                [metrics.cpu, ramTotalMb, ramUsedMb,
                 diskTotalGb, diskUsedGb, metrics.uptime || 0,
                 server.id]
            );
        } catch {
            // Метрики не критичны — ошибка не меняет статус (это делает quickAgentHealthCheck)
        }
    }
}

// Данные графика трафика (async — PostgreSQL)
async function getTrafficChartData(period = '24h', clientId = null, clientIds = null) {
    let interval, groupBy;
    switch (period) {
        case '7d':
            interval = "NOW() - INTERVAL '7 days'";
            groupBy = "TO_CHAR(recorded_at, 'YYYY-MM-DD HH24:00')";
            break;
        case '30d':
            interval = "NOW() - INTERVAL '30 days'";
            groupBy = "TO_CHAR(recorded_at, 'YYYY-MM-DD')";
            break;
        default:
            interval = "NOW() - INTERVAL '24 hours'";
            groupBy = "TO_CHAR(recorded_at, 'YYYY-MM-DD HH24:MI')";
            break;
    }

    const params = [];
    const $ = (val) => { params.push(val); return `$${params.length}`; };

    let sql = `
        SELECT ${groupBy} as time,
            SUM(rx_bytes) as rx, SUM(tx_bytes) as tx
        FROM traffic_history
        WHERE recorded_at >= ${interval}
    `;

    if (clientId) {
        sql += ` AND client_id = ${$(clientId)}`;
    } else if (clientIds && clientIds.length > 0) {
        const placeholders = clientIds.map(id => $(id)).join(',');
        sql += ` AND client_id IN (${placeholders})`;
    }

    sql += ` GROUP BY ${groupBy} ORDER BY time`;

    return queryAll(sql, params);
}

// Запуск планировщика
function startScheduler() {
    // Немедленная проверка метрик и трафика при старте (через 5 сек после запуска)
    setTimeout(async () => {
        try {
            console.log('[MONITOR] Начальная проверка серверов...');
            await updateServerMetrics();
            await collectXrayTrafficStats();
            await collectXrayEndpoints();
            console.log('[MONITOR] Начальная проверка завершена');
        } catch (err) {
            console.error('[MONITOR] Ошибка начальной проверки:', err.message);
        }
    }, 5000);

    // Каждые 5 сек — Xray статистика
    cron.schedule('*/5 * * * * *', async () => {
        try {
            await collectXrayTrafficStats();
        } catch (err) {
            console.error('[MONITOR] Ошибка быстрого цикла:', err.message);
        }
    });

    // Каждые 15 сек — health check агентов + внешние IP (более тяжёлые операции)
    cron.schedule('*/15 * * * * *', async () => {
        try {
            await quickAgentHealthCheck();
            await collectXrayEndpoints();
        } catch (err) {
            console.error('[MONITOR] Ошибка цикла:', err.message);
        }
    });

    // Каждые 5 мин — лимиты, подписки, метрики серверов, туннели
    cron.schedule('*/5 * * * *', async () => {
        try {
            await checkTrafficLimits();
            await checkExpiredClients();
            await updateServerMetrics();
            await checkTunnelHealth();
            await ensureXrayRunning();
        } catch (err) {
            console.error('[MONITOR] Ошибка проверок:', err.message);
        }
    });

    // Каждые 6 часов — ротация access.log (с loglevel 'info' растёт быстро)
    cron.schedule('0 */6 * * *', async () => {
        try {
            await truncateXrayAccessLogs();
            console.log('[MONITOR] Ротация access.log');
        } catch (err) {
            console.error('[MONITOR] Ошибка ротации access.log:', err.message);
        }
    });

    // Каждый день в 3:00 — очистка истории > 90 дней
    cron.schedule('0 3 * * *', async () => {
        try {
            await query("DELETE FROM traffic_history WHERE recorded_at < NOW() - INTERVAL '90 days'");
            console.log('[MONITOR] Очистка старых записей трафика');
        } catch (err) {
            console.error('[MONITOR] Ошибка очистки:', err.message);
        }
    });

    console.log('[MONITOR] Планировщик задач запущен');
}

module.exports = {
    checkTrafficLimits,
    getTrafficChartData, startScheduler,
};
