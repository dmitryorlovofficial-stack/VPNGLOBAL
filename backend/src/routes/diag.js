// Диагностика VPN
const express = require('express');
const router = express.Router();
const { queryAll, queryOne } = require('../db/postgres');
const { authMiddleware } = require('../auth/jwt');
const nodeClient = require('../services/node-client');
const xrayService = require('../services/xray');
router.use(authMiddleware);

// GET /api/diag/xray/:serverId — Полная диагностика Xray на сервере
router.get('/xray/:serverId', async (req, res) => {
    try {
        const serverId = parseInt(req.params.serverId);
        const server = await queryOne('SELECT * FROM servers WHERE id = $1', [serverId]);
        if (!server) return res.status(404).json({ error: 'Сервер не найден' });

        const diag = {
            server: {
                id: server.id,
                name: server.name,
                host: server.host,
                ipv4: server.ipv4,
                domain: server.domain,
                status: server.status,
                agent_status: server.agent_status,
                agent_port: server.agent_port,
            },
        };

        // Проверяем агент
        try {
            const health = await nodeClient.healthCheck(serverId);
            diag.agent = { ok: true, ...health };
        } catch (err) {
            diag.agent = { ok: false, error: err.message };
        }

        // Xray статус через агента
        try {
            const status = await nodeClient.xrayStatus(serverId);
            diag.xray = status;
        } catch (err) {
            diag.xray = { error: err.message };
        }

        // Inbound'ы из БД
        const inbounds = await queryAll(
            `SELECT id, tag, protocol, port, listen, is_enabled,
                    stream_settings->>'security' as security,
                    stream_settings->>'network' as network,
                    stream_settings->'realitySettings'->>'dest' as reality_dest,
                    stream_settings->'realitySettings'->'serverNames' as reality_sni,
                    (SELECT COUNT(*) FROM clients c WHERE c.xray_inbound_id = xi.id AND c.is_blocked = FALSE) as client_count
             FROM xray_inbounds xi WHERE server_id = $1 ORDER BY id`,
            [serverId]
        );
        diag.inbounds = inbounds;

        // Генерация конфига (без деплоя)
        try {
            const config = await xrayService.buildXrayConfig(serverId);
            diag.config_summary = {
                inbounds: config.inbounds.map(i => ({
                    tag: i.tag,
                    port: i.port,
                    protocol: i.protocol,
                    clients: i.settings?.clients?.length ?? 0,
                    security: i.streamSettings?.security,
                    network: i.streamSettings?.network || 'tcp',
                    reality_dest: i.streamSettings?.realitySettings?.dest,
                    reality_sni: i.streamSettings?.realitySettings?.serverNames,
                })),
                outbounds: config.outbounds.map(o => o.tag),
                routing_rules: config.routing.rules.length,
            };
        } catch (err) {
            diag.config_error = err.message;
        }

        // Тестовый share link для первого клиента
        try {
            const firstClient = await queryOne(
                'SELECT id, name FROM clients WHERE server_id = $1 AND is_blocked = FALSE AND is_chain = FALSE LIMIT 1',
                [serverId]
            );
            if (firstClient) {
                const link = await xrayService.generateShareLink(firstClient.id);
                diag.sample_link = link;
            }
        } catch (err) {
            diag.sample_link_error = err.message;
        }

        res.json(diag);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
