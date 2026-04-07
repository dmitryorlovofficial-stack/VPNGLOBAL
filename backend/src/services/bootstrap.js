// Bootstrap — установка Docker + агента на сервер через SSH
// SSH используется только здесь, для первоначальной установки
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const sshManager = require('./ssh-manager');
const nodeClient = require('./node-client');
const { query, queryOne, queryAll } = require('../db/postgres');

const AGENT_IMAGE = 'vpn-node-agent';
const CONTAINER_NAME = 'vpn-node-agent';

// Путь к директории агента:
// В Docker: /app/agent (маунт ./agent:/app/agent)
// Локально: ../../../agent (от backend/src/services)
function getAgentDir() {
    // Проверяем Docker-маунт
    const dockerPath = '/app/agent';
    if (fs.existsSync(dockerPath) && fs.existsSync(path.join(dockerPath, 'package.json'))) {
        return dockerPath;
    }
    // Локальный путь
    const localPath = path.join(__dirname, '..', '..', '..', 'agent');
    if (fs.existsSync(localPath)) {
        return localPath;
    }
    throw new Error('Директория агента не найдена. Проверьте наличие ./agent/ или маунт /app/agent');
}

class Bootstrap {
    /**
     * Генерация API-ключа (64 символа hex)
     */
    generateApiKey() {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Настроить Docker daemon: IPv6 + DNS
     * Нужно для корректной работы ip6tables (WG forwarding)
     */
    async _configureDockerDaemon(execSafe, execRootSafe) {
        if (!execRootSafe) execRootSafe = execSafe;
        const script = `
python3 -c "
import json, sys, os
p = '/etc/docker/daemon.json'
try:
    d = json.load(open(p)) if os.path.exists(p) else {}
except:
    d = {}
changed = False
if 'dns' not in d:
    d['dns'] = ['8.8.8.8', '1.1.1.1']
    changed = True
if not d.get('ipv6'):
    d['ipv6'] = True
    d['ip6tables'] = True
    d['experimental'] = True
    d['fixed-cidr-v6'] = 'fd00:d0c:a001::/48'
    changed = True
if changed:
    os.makedirs('/etc/docker', exist_ok=True)
    json.dump(d, open(p, 'w'), indent=2)
    print('CHANGED')
else:
    print('OK')
" 2>/dev/null || echo "SKIP"`;

        const result = await execRootSafe(script);
        if (result === 'CHANGED') {
            console.log('[BOOTSTRAP] Docker daemon.json: IPv6 + DNS настроены');
            await execRootSafe('systemctl restart docker 2>/dev/null; sleep 3');
        } else if (result === 'OK') {
            console.log('[BOOTSTRAP] Docker daemon.json: конфигурация актуальна');
            // Убедимся что Docker запущен
            await execRootSafe('systemctl start docker 2>/dev/null');
        } else {
            // python3 нет — создаём конфиг напрямую
            console.log('[BOOTSTRAP] python3 не найден, создаём daemon.json вручную');
            await execRootSafe('mkdir -p /etc/docker');
            const existing = await execRootSafe('cat /etc/docker/daemon.json 2>/dev/null');
            if (!existing || !existing.includes('ipv6')) {
                await execRootSafe(`bash -c 'cat > /etc/docker/daemon.json << 'DEOF'
{
  "dns": ["8.8.8.8", "1.1.1.1"],
  "ipv6": true,
  "ip6tables": true,
  "experimental": true,
  "fixed-cidr-v6": "fd00:d0c:a001::/48"
}
DEOF`);
                await execRootSafe('systemctl restart docker 2>/dev/null; sleep 3');
            } else {
                await execRootSafe('systemctl start docker 2>/dev/null');
            }
        }
    }

    /**
     * Развернуть агента на сервере
     * 1. SSH → проверить/установить Docker
     * 2. Собрать или загрузить образ
     * 3. Запустить контейнер
     * 4. Дождаться health check
     * 5. Сохранить в БД
     */

    async _getSudo(ssh, server) {
        const r = await ssh.execCommand('whoami', { cwd: '/' });
        const user = r.stdout.trim();
        if (user === 'root') return '';

        console.log(`[BOOTSTRAP] Пользователь: ${user}, определяем sudo...`);

        // Проверяем sudo без пароля
        const test = await ssh.execCommand('sudo -n true 2>&1; echo "EXIT:$?"', { cwd: '/' });
        const exitMatch = test.stdout.match(/EXIT:(\d+)/);
        if (exitMatch && exitMatch[1] === '0') {
            console.log('[BOOTSTRAP] sudo без пароля — OK');
            return 'sudo ';
        }

        // sudo с паролем
        const pass = server?.ssh_password || server?.ssh_key_passphrase || '';
        if (pass) {
            // Проверяем что sudo с паролем работает
            const escapedPass = pass.replace(/'/g, "'\\''");
            const prefix = `echo '${escapedPass}' | sudo -S -p '' `;
            const check = await ssh.execCommand(`${prefix}whoami 2>/dev/null`, { cwd: '/' });
            if (check.stdout.trim() === 'root') {
                console.log('[BOOTSTRAP] sudo с паролем — OK');
                return prefix;
            }
            console.warn('[BOOTSTRAP] sudo с паролем не сработал, пробуем без -p');
            return `echo '${escapedPass}' | sudo -S `;
        }

        console.warn('[BOOTSTRAP] Нет пароля для sudo, пробуем sudo напрямую');
        return 'sudo ';
    }

    async deployAgent(serverId) {
        const server = await queryOne('SELECT * FROM servers WHERE id = $1', [serverId]);
        if (!server) throw new Error(`Сервер #${serverId} не найден`);

        // Обновляем статус
        await query(
            "UPDATE servers SET agent_status = 'deploying', updated_at = NOW() WHERE id = $1",
            [serverId]
        );

        try {
            const ssh = await sshManager.connect(serverId);
            const exec = async (cmd) => {
                const r = await ssh.execCommand(cmd, { cwd: '/' });
                if (r.code !== 0 && !r.stdout) {
                    throw new Error(r.stderr || `Command failed: ${cmd}`);
                }
                return r.stdout.trim();
            };
            const execSafe = async (cmd) => {
                const r = await ssh.execCommand(cmd, { cwd: '/' });
                return r.stdout.trim();
            };

            console.log(`[BOOTSTRAP] Начинаем установку агента на #${serverId} (${server.name})`);

            // Определяем нужен ли sudo (не-root пользователь)
            const sudo = await this._getSudo(ssh, server);
            if (sudo) console.log(`[BOOTSTRAP] Не-root пользователь, используем sudo`);

            // Переопределяем exec/execSafe с sudo для системных команд
            // Важно: sudo пишет промпт в stderr — это НЕ ошибка
            const execRoot = async (cmd) => {
                const r = await ssh.execCommand(sudo + cmd, { cwd: '/' });
                // Ошибка только если код != 0 И stderr содержит реальную ошибку (не sudo prompt)
                if (r.code !== 0 && r.stderr && !r.stderr.includes('[sudo]') && !r.stderr.includes('password')) {
                    throw new Error(r.stderr.split('\n')[0]);
                }
                return r.stdout.trim();
            };
            const execRootSafe = async (cmd) => {
                const r = await ssh.execCommand(sudo + cmd, { cwd: '/' });
                return r.stdout.trim();
            };

            // 1. Проверяем Docker
            const dockerVersion = await execRootSafe('docker --version 2>/dev/null');
            if (!dockerVersion) {
                console.log('[BOOTSTRAP] Docker не найден, устанавливаем...');
                // Скачиваем скрипт отдельно, затем запускаем через sudo
                await execSafe('curl -fsSL https://get.docker.com -o /tmp/get-docker.sh');
                await execRoot('sh /tmp/get-docker.sh');
                await execSafe('rm -f /tmp/get-docker.sh');
                await execRootSafe('systemctl enable docker');
                await execRootSafe('systemctl start docker');
                // Ждём пока Docker daemon поднимется
                console.log('[BOOTSTRAP] Ожидаем запуск Docker daemon...');
                for (let i = 0; i < 15; i++) {
                    const check = await execRootSafe('docker info >/dev/null 2>&1 && echo OK || echo WAIT');
                    if (check.includes('OK')) break;
                    await new Promise(r => setTimeout(r, 2000));
                }
                // Добавляем текущего пользователя в группу docker (для не-root)
                if (sudo) {
                    const whoami = await execSafe('whoami');
                    await execRootSafe(`usermod -aG docker ${whoami}`);
                    console.log(`[BOOTSTRAP] Пользователь ${whoami} добавлен в группу docker`);
                }
                console.log('[BOOTSTRAP] Docker установлен и запущен');
            } else {
                // Убедимся что Docker запущен
                await execRootSafe('systemctl start docker 2>/dev/null');
                console.log(`[BOOTSTRAP] Docker найден: ${dockerVersion}`);
            }

            // 1.5. Настраиваем Docker IPv6 + DNS (daemon.json)
            await this._configureDockerDaemon(execSafe, execRootSafe);

            // 2. Останавливаем старый контейнер (если есть)
            await execRootSafe(`docker stop ${CONTAINER_NAME} 2>/dev/null`);
            await execRootSafe(`docker rm ${CONTAINER_NAME} 2>/dev/null`);

            // 3. Собираем образ на сервере
            // Копируем файлы агента через SSH
            console.log('[BOOTSTRAP] Загружаем файлы агента...');
            await execRootSafe('rm -rf /tmp/vpn-node-agent');
            await execRoot('mkdir -p /tmp/vpn-node-agent/src/middleware /tmp/vpn-node-agent/src/routes /tmp/vpn-node-agent/src/services /tmp/vpn-node-agent/src/utils');
            // Даём права текущему пользователю на /tmp/vpn-node-agent (для SFTP putFile)
            if (sudo) {
                const whoami = await execSafe('whoami');
                await execRootSafe(`chown -R ${whoami}:${whoami} /tmp/vpn-node-agent`);
            }

            // Загружаем файлы через putFile
            const agentDir = getAgentDir();

            await ssh.putFile(`${agentDir}/package.json`, '/tmp/vpn-node-agent/package.json');
            await ssh.putFile(`${agentDir}/Dockerfile`, '/tmp/vpn-node-agent/Dockerfile');
            await ssh.putFile(`${agentDir}/.dockerignore`, '/tmp/vpn-node-agent/.dockerignore');
            await ssh.putFile(`${agentDir}/src/index.js`, '/tmp/vpn-node-agent/src/index.js');
            await ssh.putFile(`${agentDir}/src/middleware/auth.js`, '/tmp/vpn-node-agent/src/middleware/auth.js');
            await ssh.putFile(`${agentDir}/src/utils/exec.js`, '/tmp/vpn-node-agent/src/utils/exec.js');
            await ssh.putFile(`${agentDir}/src/services/xray-process.js`, '/tmp/vpn-node-agent/src/services/xray-process.js');
            await ssh.putFile(`${agentDir}/src/services/nginx-process.js`, '/tmp/vpn-node-agent/src/services/nginx-process.js');
            await ssh.putFile(`${agentDir}/src/routes/health.js`, '/tmp/vpn-node-agent/src/routes/health.js');
            await ssh.putFile(`${agentDir}/src/routes/metrics.js`, '/tmp/vpn-node-agent/src/routes/metrics.js');
            await ssh.putFile(`${agentDir}/src/routes/system.js`, '/tmp/vpn-node-agent/src/routes/system.js');
            await ssh.putFile(`${agentDir}/src/routes/wg.js`, '/tmp/vpn-node-agent/src/routes/wg.js');
            await ssh.putFile(`${agentDir}/src/routes/xray.js`, '/tmp/vpn-node-agent/src/routes/xray.js');
            await ssh.putFile(`${agentDir}/src/routes/stub-site.js`, '/tmp/vpn-node-agent/src/routes/stub-site.js');

            console.log('[BOOTSTRAP] Собираем Docker-образ...');
            await execRoot(`docker build -t ${AGENT_IMAGE}:latest /tmp/vpn-node-agent`);

            // 4. Генерируем API-ключ
            const apiKey = this.generateApiKey();
            const agentPort = server.agent_port || 8443;

            // 4.5. Создаём директории для volume mounts (нужен root)
            await execRootSafe('mkdir -p /usr/local/etc/xray /var/log/xray /var/www/stub-site /var/www/acme-challenge');

            // 4.6. Открываем порт агента в файрволе
            await execRootSafe(`ufw allow ${agentPort}/tcp 2>/dev/null || firewall-cmd --permanent --add-port=${agentPort}/tcp 2>/dev/null && firewall-cmd --reload 2>/dev/null || true`);
            // Открываем порт 443 (VPN)
            await execRootSafe('ufw allow 443/tcp 2>/dev/null || firewall-cmd --permanent --add-port=443/tcp 2>/dev/null && firewall-cmd --reload 2>/dev/null || true');

            // 5. Запускаем контейнер
            console.log('[BOOTSTRAP] Запускаем контейнер...');
            const dockerRunCmd = [
                'docker run -d',
                `--name ${CONTAINER_NAME}`,
                '--restart unless-stopped',
                '--network host',
                '--cap-add NET_ADMIN',
                '--cap-add NET_RAW',
                '--cap-add SYS_MODULE',

                '-v /usr/local/etc/xray:/usr/local/etc/xray',
                '-v /var/log/xray:/var/log/xray',
                '-v /lib/modules:/lib/modules:ro',
                '-v /etc/letsencrypt:/etc/letsencrypt',
                '-v /var/www/stub-site:/var/www/stub-site',
                '-v /var/www/acme-challenge:/var/www/acme-challenge',
                `-e AGENT_API_KEY=${apiKey}`,
                `-e AGENT_PORT=${agentPort}`,
                `${AGENT_IMAGE}:latest`,
            ].join(' ');

            await execRoot(dockerRunCmd);

            // 6. Сохраняем в БД (agent_status + status online)
            await query(
                `UPDATE servers SET agent_port = $1, agent_api_key = $2, agent_status = 'active', status = 'online', last_seen = NOW(), updated_at = NOW() WHERE id = $3`,
                [agentPort, apiKey, serverId]
            );

            // 7. Проверяем что контейнер запущен через SSH
            await new Promise(r => setTimeout(r, 3000));
            const containerStatus = await execRootSafe(`docker ps --filter name=${CONTAINER_NAME} --format '{{.Status}}' 2>/dev/null`);
            console.log(`[BOOTSTRAP] Контейнер ${CONTAINER_NAME}: ${containerStatus || 'не найден'}`);
            if (!containerStatus) {
                // Контейнер не запустился — проверяем логи
                const logs = await execRootSafe(`docker logs ${CONTAINER_NAME} --tail 20 2>&1`);
                console.error(`[BOOTSTRAP] Контейнер не запущен! Логи:\n${logs}`);
            }

            // 8. Ждём health check (до 60 сек)
            console.log(`[BOOTSTRAP] Ожидаем health check http://${server.ipv4 || server.host}:${agentPort}...`);
            let healthy = false;
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 3000));
                try {
                    const health = await nodeClient.healthCheck(serverId);
                    if (health && health.status === 'ok') {
                        healthy = true;
                        console.log(`[BOOTSTRAP] Health check OK (попытка ${i + 1})`);
                        break;
                    }
                } catch (err) {
                    if (i % 5 === 4) console.log(`[BOOTSTRAP] Health check попытка ${i + 1}: ${err.message}`);
                }
            }

            if (!healthy) {
                console.warn('[BOOTSTRAP] Health check не прошёл за 60 сек');
                // Проверяем контейнер через SSH
                const isRunning = await execRootSafe(`docker ps -q --filter name=${CONTAINER_NAME} 2>/dev/null`);
                const dockerLogs = await execRootSafe(`docker logs ${CONTAINER_NAME} --tail 10 2>&1`);
                console.warn(`[BOOTSTRAP] Контейнер ${isRunning ? 'запущен' : 'НЕ запущен'}. Логи: ${dockerLogs}`);
                await query(
                    "UPDATE servers SET agent_status = 'error', updated_at = NOW() WHERE id = $1",
                    [serverId]
                );
            }

            // Cleanup
            await execSafe('rm -rf /tmp/vpn-node-agent');

            await query(
                `INSERT INTO logs (level, category, server_id, message) VALUES ('info', 'agent', $1, $2)`,
                [serverId, `Агент развёрнут на ${server.name} (порт ${agentPort})`]
            );

            console.log(`[BOOTSTRAP] Агент развёрнут на #${serverId} (healthy: ${healthy})`);

            // 8. Автоматическое сканирование (не блокирует ответ, не роняет статус)
            if (healthy) {
                this.autoScan(serverId).catch(err => {
                    console.warn(`[BOOTSTRAP] Автоскан #${serverId} не удался:`, err.message);
                });
            }

            return { ok: true, healthy, agentPort };

        } catch (err) {
            console.error(`[BOOTSTRAP] Ошибка установки на #${serverId}:`, err.message);
            await query(
                "UPDATE servers SET agent_status = 'error', updated_at = NOW() WHERE id = $1",
                [serverId]
            );
            throw err;
        }
    }

    /**
     * Проверить состояние агента через HTTP
     */
    async checkAgent(serverId) {
        try {
            const health = await nodeClient.healthCheck(serverId);
            const isOk = health && health.status === 'ok';

            await query(
                `UPDATE servers SET agent_status = 'active', status = 'online', last_seen = NOW(), updated_at = NOW() WHERE id = $1`,
                [serverId]
            );

            return { ...health, ok: isOk };
        } catch (err) {
            // Не меняем agent_status — серверы считаются активными
            await query(
                "UPDATE servers SET updated_at = NOW() WHERE id = $1",
                [serverId]
            );
            return { ok: false, error: err.message };
        }
    }

    /**
     * Обновить агента (SSH → pull новый образ → пересоздать контейнер)
     */
    async updateAgent(serverId) {
        const server = await queryOne('SELECT * FROM servers WHERE id = $1', [serverId]);
        if (!server) throw new Error(`Сервер #${serverId} не найден`);

        try {
            const ssh = await sshManager.connect(serverId);
            const sudo = await this._getSudo(ssh, server);
            const execRoot = async (cmd) => {
                const r = await ssh.execCommand(sudo + cmd, { cwd: '/' });
                if (r.code !== 0 && r.stderr && !r.stderr.includes('[sudo]') && !r.stderr.includes('password')) throw new Error(r.stderr.split('\n')[0]);
                return r.stdout.trim();
            };
            const exec = async (cmd) => {
                const r = await ssh.execCommand(cmd, { cwd: '/' });
                return r.stdout.trim();
            };

            // Пересобираем образ с новыми файлами
            const agentDir = getAgentDir();

            await execRoot('rm -rf /tmp/vpn-node-agent');
            await exec('mkdir -p /tmp/vpn-node-agent/src/middleware /tmp/vpn-node-agent/src/routes /tmp/vpn-node-agent/src/services /tmp/vpn-node-agent/src/utils');

            await ssh.putFile(`${agentDir}/package.json`, '/tmp/vpn-node-agent/package.json');
            await ssh.putFile(`${agentDir}/Dockerfile`, '/tmp/vpn-node-agent/Dockerfile');
            await ssh.putFile(`${agentDir}/.dockerignore`, '/tmp/vpn-node-agent/.dockerignore');
            await ssh.putFile(`${agentDir}/src/index.js`, '/tmp/vpn-node-agent/src/index.js');
            await ssh.putFile(`${agentDir}/src/middleware/auth.js`, '/tmp/vpn-node-agent/src/middleware/auth.js');
            await ssh.putFile(`${agentDir}/src/utils/exec.js`, '/tmp/vpn-node-agent/src/utils/exec.js');
            await ssh.putFile(`${agentDir}/src/services/xray-process.js`, '/tmp/vpn-node-agent/src/services/xray-process.js');
            await ssh.putFile(`${agentDir}/src/services/nginx-process.js`, '/tmp/vpn-node-agent/src/services/nginx-process.js');
            await ssh.putFile(`${agentDir}/src/routes/health.js`, '/tmp/vpn-node-agent/src/routes/health.js');
            await ssh.putFile(`${agentDir}/src/routes/metrics.js`, '/tmp/vpn-node-agent/src/routes/metrics.js');
            await ssh.putFile(`${agentDir}/src/routes/system.js`, '/tmp/vpn-node-agent/src/routes/system.js');
            await ssh.putFile(`${agentDir}/src/routes/wg.js`, '/tmp/vpn-node-agent/src/routes/wg.js');
            await ssh.putFile(`${agentDir}/src/routes/xray.js`, '/tmp/vpn-node-agent/src/routes/xray.js');
            await ssh.putFile(`${agentDir}/src/routes/stub-site.js`, '/tmp/vpn-node-agent/src/routes/stub-site.js');

            await execRoot(`docker build -t ${AGENT_IMAGE}:latest /tmp/vpn-node-agent`);

            // Пересоздаём контейнер с тем же API key
            const agentPort = server.agent_port || 8443;
            const apiKey = server.agent_api_key;

            await execRoot(`docker stop ${CONTAINER_NAME} 2>/dev/null || true`);
            await execRoot(`docker rm ${CONTAINER_NAME} 2>/dev/null || true`);

            const dockerRunCmd = [
                'docker run -d',
                `--name ${CONTAINER_NAME}`,
                '--restart unless-stopped',
                '--network host',
                '--cap-add NET_ADMIN',
                '--cap-add NET_RAW',
                '--cap-add SYS_MODULE',

                '-v /usr/local/etc/xray:/usr/local/etc/xray',
                '-v /var/log/xray:/var/log/xray',
                '-v /lib/modules:/lib/modules:ro',
                '-v /etc/letsencrypt:/etc/letsencrypt',
                '-v /var/www/stub-site:/var/www/stub-site',
                '-v /var/www/acme-challenge:/var/www/acme-challenge',
                `-e AGENT_API_KEY=${apiKey}`,
                `-e AGENT_PORT=${agentPort}`,
                `${AGENT_IMAGE}:latest`,
            ].join(' ');

            await execRoot(dockerRunCmd);
            await execRoot('rm -rf /tmp/vpn-node-agent');

            // Ждём health check
            await new Promise(r => setTimeout(r, 3000));
            const check = await this.checkAgent(serverId);

            // Автоскан после обновления
            if (check.ok) {
                this.autoScan(serverId).catch(err => {
                    console.warn(`[BOOTSTRAP] Автоскан после update #${serverId}:`, err.message);
                });
            }

            return { ok: true, healthy: check.ok };
        } catch (err) {
            throw new Error(`Ошибка обновления агента: ${err.message}`);
        }
    }

    /**
     * Удалить агента с сервера
     */
    async removeAgent(serverId) {
        const server = await queryOne('SELECT * FROM servers WHERE id = $1', [serverId]);
        if (!server) throw new Error(`Сервер #${serverId} не найден`);

        try {
            const ssh = await sshManager.connect(serverId);
            const sudo = await this._getSudo(ssh, server);
            const execRoot = async (cmd) => {
                const r = await ssh.execCommand(sudo + cmd, { cwd: '/' });
                if (r.code !== 0 && r.stderr && !r.stderr.includes('[sudo]') && !r.stderr.includes('password')) throw new Error(r.stderr.split('\n')[0]);
                return r.stdout.trim();
            };

            await execRoot(`docker stop ${CONTAINER_NAME} 2>/dev/null || true`);
            await execRoot(`docker rm ${CONTAINER_NAME} 2>/dev/null || true`);
            await execRoot(`docker rmi ${AGENT_IMAGE}:latest 2>/dev/null || true`);

            await query(
                "UPDATE servers SET agent_api_key = NULL, agent_status = 'none', updated_at = NOW() WHERE id = $1",
                [serverId]
            );

            await query(
                `INSERT INTO logs (level, category, server_id, message) VALUES ('warning', 'agent', $1, $2)`,
                [serverId, `Агент удалён с ${server.name}`]
            );

            return { ok: true };
        } catch (err) {
            throw new Error(`Ошибка удаления агента: ${err.message}`);
        }
    }

    /**
     * Полный авто-провижн: deploy agent → scan → install Xray → install WG
     * Запускается в фоне после создания сервера
     */
    async fullProvision(serverId) {
        const server = await queryOne('SELECT * FROM servers WHERE id = $1', [serverId]);
        if (!server) throw new Error(`Сервер #${serverId} не найден`);

        console.log(`[BOOTSTRAP] Полный авто-провижн #${serverId} (${server.name})...`);

        await query(
            `INSERT INTO logs (level, category, server_id, message) VALUES ('info', 'agent', $1, $2)`,
            [serverId, `Начат авто-провижн: ${server.name}`]
        );

        try {
            // 1. Деплой агента (Docker + контейнер + health check)
            const deployResult = await this.deployAgent(serverId);
            if (!deployResult.healthy) {
                console.error(`[BOOTSTRAP] Агент #${serverId} не здоров, прерываем авто-провижн`);
                await query(
                    `INSERT INTO logs (level, category, server_id, message) VALUES ('error', 'agent', $1, $2)`,
                    [serverId, `Авто-провижн прерван: агент не прошёл health check`]
                );
                return { ok: false, stage: 'deploy', error: 'Agent not healthy' };
            }

            // 2. Ждём завершения autoScan (вызванного из deployAgent)
            await new Promise(r => setTimeout(r, 3000));

            // 3. Проверяем что установлено через агента
            let scan;
            try {
                scan = await nodeClient.getSystemInfo(serverId);
            } catch (err) {
                console.error(`[BOOTSTRAP] #${serverId}: Не удалось сканировать:`, err.message);
                return { ok: true, stage: 'scan-failed', deployed: true };
            }

            // 4. Установка Xray если не найден
            if (!scan.xray || !scan.xray.installed) {
                console.log(`[BOOTSTRAP] #${serverId}: Xray не найден, устанавливаем...`);
                try {
                    // Ленивый import чтобы избежать circular dependency
                    const xrayService = require('./xray');
                    await xrayService.installXray(serverId);
                    console.log(`[BOOTSTRAP] #${serverId}: Xray установлен`);
                    await query(
                        `INSERT INTO logs (level, category, server_id, message) VALUES ('info', 'xray', $1, $2)`,
                        [serverId, `Xray автоматически установлен`]
                    );
                } catch (err) {
                    console.error(`[BOOTSTRAP] #${serverId}: Ошибка установки Xray:`, err.message);
                    await query(
                        `INSERT INTO logs (level, category, server_id, message) VALUES ('error', 'xray', $1, $2)`,
                        [serverId, `Ошибка авто-установки Xray: ${err.message}`]
                    );
                }
            } else {
                console.log(`[BOOTSTRAP] #${serverId}: Xray уже установлен (${scan.xray.version})`);
                // Убедимся что запись в БД есть
                await query(
                    `INSERT INTO xray_instances (server_id, version, status, installed_at)
                     VALUES ($1, $2, 'active', NOW())
                     ON CONFLICT (server_id) DO UPDATE SET version = $2, status = 'active'`,
                    [serverId, scan.xray.version || 'unknown']
                );
            }

            // 5. Автосоздание VLESS Reality inbound (если нет ни одного)
            try {
                const xrayService = require('./xray');
                const existingInbounds = await queryAll(
                    "SELECT id FROM xray_inbounds WHERE server_id = $1 AND tag NOT LIKE 'chain-%'",
                    [serverId]
                );
                if (existingInbounds.length === 0) {
                    console.log(`[BOOTSTRAP] #${serverId}: Создаём VLESS Reality inbound на порту 443...`);
                    const keys = await xrayService.generateRealityKeys(serverId);
                    await xrayService.createInbound(serverId, {
                        tag: 'vless-443',
                        protocol: 'vless',
                        port: 443,
                        listen: '0.0.0.0',
                        settings: { flow: 'xtls-rprx-vision' },
                        stream_settings: {
                            network: 'tcp',
                            security: 'reality',
                            realitySettings: {
                                dest: 'www.google.com:443',
                                serverNames: ['www.google.com'],
                                privateKey: keys.privateKey,
                                publicKey: keys.publicKey,
                                shortIds: [xrayService.generateShortId()],
                                fingerprint: 'chrome',
                                spiderX: '/',
                            },
                        },
                        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: true },
                        remark: 'VLESS Reality',
                    });
                    console.log(`[BOOTSTRAP] #${serverId}: Inbound vless-443 создан`);
                    await query(
                        `INSERT INTO logs (level, category, server_id, message) VALUES ('info', 'xray', $1, $2)`,
                        [serverId, 'Автоматически создан inbound VLESS Reality :443']
                    );
                }
            } catch (err) {
                console.warn(`[BOOTSTRAP] #${serverId}: Ошибка создания inbound:`, err.message);
            }

            // 6. Автодеплой stub site (GitLab шаблон)
            try {
                const stubService = require('./stub-site');
                const existingStub = await queryOne('SELECT id FROM stub_sites WHERE server_id = $1', [serverId]);
                if (!existingStub) {
                    const serverData = await queryOne('SELECT domain, host FROM servers WHERE id = $1', [serverId]);
                    const domain = serverData?.domain || serverData?.host || '';
                    console.log(`[BOOTSTRAP] #${serverId}: Деплоим stub site (gitlab)...`);
                    await stubService.deployStubSite(serverId, {
                        templateId: 'gitlab',
                        variables: { instance_name: 'GitLab', instance_url: domain },
                        internalPort: 8444,
                        autoUpdateDest: true,
                    });
                    console.log(`[BOOTSTRAP] #${serverId}: Stub site развёрнут`);
                    await query(
                        `INSERT INTO logs (level, category, server_id, message) VALUES ('info', 'stub', $1, $2)`,
                        [serverId, 'Автоматически развёрнут stub site (GitLab)']
                    );
                }
            } catch (err) {
                console.warn(`[BOOTSTRAP] #${serverId}: Ошибка деплоя stub site:`, err.message);
            }

            // 7. Финал — обновляем статус
            await query(
                "UPDATE servers SET status = 'online', agent_status = 'active', last_seen = NOW() WHERE id = $1",
                [serverId]
            );

            await query(
                `INSERT INTO logs (level, category, server_id, message) VALUES ('info', 'agent', $1, $2)`,
                [serverId, `Авто-провижн завершён: ${server.name}`]
            );

            console.log(`[BOOTSTRAP] Авто-провижн #${serverId} завершён успешно`);
            return { ok: true };

        } catch (err) {
            console.error(`[BOOTSTRAP] Авто-провижн #${serverId} ошибка:`, err.message);
            await query(
                `INSERT INTO logs (level, category, server_id, message) VALUES ('error', 'agent', $1, $2)`,
                [serverId, `Ошибка авто-провижна: ${err.message}`]
            );
            return { ok: false, error: err.message };
        }
    }

    /**
     * Автоматическое сканирование после деплоя/обновления агента
     * Не роняет статус сервера при ошибке
     */
    async autoScan(serverId) {
        try {
            console.log(`[BOOTSTRAP] Автоскан #${serverId}...`);
            const scan = await nodeClient.getSystemInfo(serverId);

            await query(
                `UPDATE servers SET os_info = $1, kernel = $2,
                 main_iface = COALESCE($3, main_iface),
                 ipv4 = COALESCE($4, ipv4),
                 ipv6 = COALESCE($5, ipv6),
                 last_seen = NOW(), updated_at = NOW()
                 WHERE id = $6`,
                [scan.os, scan.kernel, scan.mainIface || null,
                 scan.ipv4 || null, scan.ipv6 || null, serverId]
            );

            // Xray
            if (scan.xray && scan.xray.installed) {
                await query(
                    `INSERT INTO server_protocols (server_id, protocol, status, config)
                     VALUES ($1, 'xray', 'active', $2)
                     ON CONFLICT (server_id, protocol)
                     DO UPDATE SET status = 'active', config = $2`,
                    [serverId, JSON.stringify({ version: scan.xray.version })]
                );
            }

            console.log(`[BOOTSTRAP] Автоскан #${serverId} завершён: OS=${scan.os}, Xray=${scan.xray?.installed}`);
            return scan;
        } catch (err) {
            // Не роняем статус — просто логируем
            console.warn(`[BOOTSTRAP] Автоскан #${serverId} ошибка:`, err.message);
            return null;
        }
    }
}

// Singleton
const bootstrap = new Bootstrap();
module.exports = bootstrap;
