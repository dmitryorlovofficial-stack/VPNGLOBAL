// Управление nginx для сайтов-заглушек (stub sites)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { run, runFull } = require('../utils/exec');

const NGINX_BINARY = '/usr/sbin/nginx';
const STUB_SITE_DIR = '/var/www/stub-site';
const ACME_DIR = '/var/www/acme-challenge';
const SSL_DIR = '/etc/nginx/ssl';
const LETSENCRYPT_LIVE = '/etc/letsencrypt/live';
const NGINX_CONF = '/etc/nginx/nginx.conf';

class NginxProcess {
    async isInstalled() {
        return fs.existsSync(NGINX_BINARY);
    }

    async isRunning() {
        try {
            const result = await runFull('pgrep -x nginx');
            return result.exitCode === 0 && result.stdout.trim().length > 0;
        } catch {
            return false;
        }
    }

    async start() {
        if (await this.isRunning()) {
            console.log('[NGINX] Already running');
            return;
        }
        // Убираем stale PID файл
        try { fs.unlinkSync('/run/nginx.pid'); } catch {}
        await run(`${NGINX_BINARY}`);
        console.log('[NGINX] Started');
    }

    async stop() {
        if (!(await this.isRunning())) return;
        try {
            await run(`${NGINX_BINARY} -s stop`);
        } catch {
            await runFull('pkill -x nginx');
        }
        // Убираем PID файл
        try { fs.unlinkSync('/run/nginx.pid'); } catch {}
        console.log('[NGINX] Stopped');
    }

    async reload() {
        if (!(await this.isRunning())) {
            await this.start();
            return;
        }
        try {
            await run(`${NGINX_BINARY} -s reload`);
        } catch {
            // PID файл пустой/повреждён — перезапускаем
            console.log('[NGINX] Reload failed (stale PID), restarting...');
            await runFull('pkill -x nginx');
            try { fs.unlinkSync('/run/nginx.pid'); } catch {}
            await new Promise(r => setTimeout(r, 300));
            await run(`${NGINX_BINARY}`);
        }
        console.log('[NGINX] Reloaded');
    }

    async testConfig() {
        const result = await runFull(`${NGINX_BINARY} -t 2>&1`);
        return {
            ok: result.exitCode === 0,
            output: (result.stdout + '\n' + result.stderr).trim(),
        };
    }

    async getVersion() {
        try {
            const result = await runFull(`${NGINX_BINARY} -v 2>&1`);
            const match = (result.stdout + result.stderr).match(/nginx\/(\S+)/);
            return match ? match[1] : '';
        } catch {
            return '';
        }
    }

    // Генерация самоподписного сертификата с SAN (для Reality dest)
    async generateSelfSignedCert(domain) {
        await runFull(`mkdir -p ${SSL_DIR}`);
        const cn = domain || 'localhost';
        const cmd = [
            'openssl req -x509 -nodes -days 3650',
            '-newkey rsa:2048',
            `-keyout ${SSL_DIR}/stub.key`,
            `-out ${SSL_DIR}/stub.crt`,
            `-subj "/C=US/ST=CA/O=Web/CN=${cn}"`,
            `-addext "subjectAltName=DNS:${cn}"`,
        ].join(' ');
        await run(cmd);
        // Сохраняем домен для проверки при следующем деплое
        fs.writeFileSync(`${SSL_DIR}/stub.domain`, cn, 'utf8');
        console.log(`[NGINX] Self-signed cert generated for ${cn} (with SAN)`);
    }

    // Проверить что текущий self-signed cert для нужного домена
    needsNewCert(domain) {
        const domainFile = `${SSL_DIR}/stub.domain`;
        if (!fs.existsSync(`${SSL_DIR}/stub.crt`)) return true;
        if (!domain) return false;
        try {
            const currentDomain = fs.readFileSync(domainFile, 'utf8').trim();
            return currentDomain !== domain;
        } catch {
            return true; // нет файла домена — перегенерируем
        }
    }

    // Запись файлов сайта
    async deploySiteFiles(files) {
        await runFull(`mkdir -p ${STUB_SITE_DIR}`);
        // Очищаем старые файлы
        await runFull(`rm -rf ${STUB_SITE_DIR}/*`);

        for (const [filename, content] of Object.entries(files)) {
            const safeName = path.basename(filename);
            const filePath = path.join(STUB_SITE_DIR, safeName);
            fs.writeFileSync(filePath, content, 'utf8');
        }
        console.log(`[NGINX] Deployed ${Object.keys(files).length} files to ${STUB_SITE_DIR}`);
    }

    // =================== Let's Encrypt SSL ===================

    /**
     * Проверить наличие Let's Encrypt сертификата
     */
    hasLetsEncryptCert(domain) {
        if (!domain) return false;
        const certPath = `${LETSENCRYPT_LIVE}/${domain}/fullchain.pem`;
        const keyPath = `${LETSENCRYPT_LIVE}/${domain}/privkey.pem`;
        return fs.existsSync(certPath) && fs.existsSync(keyPath);
    }

    /**
     * Получить информацию о Let's Encrypt сертификате
     */
    getCertInfo(domain) {
        if (!domain) return { exists: false };

        const certPath = `${LETSENCRYPT_LIVE}/${domain}/fullchain.pem`;
        const keyPath = `${LETSENCRYPT_LIVE}/${domain}/privkey.pem`;

        try {
            if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
                return { exists: false, domain };
            }

            const certPem = fs.readFileSync(certPath, 'utf8');
            const x509 = new crypto.X509Certificate(certPem);
            const validTo = new Date(x509.validTo);
            const daysLeft = Math.floor((validTo - new Date()) / (1000 * 60 * 60 * 24));

            return {
                exists: true,
                domain,
                validFrom: x509.validFrom,
                validTo: x509.validTo,
                daysLeft,
                issuer: x509.issuer,
            };
        } catch (err) {
            return { exists: false, domain, error: err.message };
        }
    }

    /**
     * Получить Let's Encrypt сертификат через webroot
     * nginx должен быть запущен и обслуживать ACME challenge
     */
    async obtainCert(domain, email) {
        if (!domain) throw new Error('Domain is required');

        // Создаём директорию для ACME challenge
        await runFull(`mkdir -p ${ACME_DIR}/.well-known/acme-challenge`);

        const emailArg = email
            ? `--email ${email}`
            : '--register-unsafely-without-email';

        const cmd = [
            'certbot certonly --webroot',
            `-w ${ACME_DIR}`,
            `-d ${domain}`,
            '--non-interactive --agree-tos',
            emailArg,
        ].join(' ');

        console.log(`[NGINX] Obtaining SSL cert for ${domain}...`);
        const result = await runFull(cmd);

        if (result.exitCode !== 0) {
            const output = (result.stdout + '\n' + result.stderr).trim();
            throw new Error(`Certbot failed: ${output}`);
        }

        // Проверяем что сертификат появился
        if (!this.hasLetsEncryptCert(domain)) {
            throw new Error('Certificate not found after certbot');
        }

        console.log(`[NGINX] SSL cert obtained for ${domain}`);
        return this.getCertInfo(domain);
    }

    /**
     * Обновить Let's Encrypt сертификат
     */
    async renewCert() {
        const cmd = `certbot renew --webroot -w ${ACME_DIR} --non-interactive`;
        console.log('[NGINX] Renewing SSL certs...');
        const result = await runFull(cmd);

        if (result.exitCode !== 0) {
            const output = (result.stdout + '\n' + result.stderr).trim();
            throw new Error(`Certbot renew failed: ${output}`);
        }

        console.log('[NGINX] SSL certs renewed');
        return { ok: true, output: result.stdout.trim() };
    }

    // =================== Config generation ===================

    /**
     * Генерация nginx.conf — HTTP-only (без SSL или с self-signed для Reality)
     */
    async generateConfig(domain, internalPort) {
        const serverName = domain || '_';
        const hasLE = domain && this.hasLetsEncryptCert(domain);

        // Если есть LE-сертификат — используем его
        if (hasLE) {
            return this.generateConfigWithSSL(domain, internalPort);
        }

        const config = `
worker_processes auto;
pid /run/nginx.pid;
error_log /var/log/nginx/error.log error;

events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    keepalive_timeout 65;
    gzip          on;
    gzip_types    text/plain text/css application/json application/javascript text/xml;
    access_log    off;
    server_tokens off;

    # HTTP:80 — редирект на HTTPS (порт 443 = Xray Reality)
    server {
        listen 80;
        listen [::]:80;
        server_name ${serverName};

        # ACME challenge для Let's Encrypt
        location /.well-known/acme-challenge/ {
            root ${ACME_DIR};
        }

        location / {
            return 301 https://$host$request_uri;
        }
    }

    # HTTPS на внутреннем порте для Xray Reality dest
    server {
        listen 127.0.0.1:${internalPort} ssl http2;
        server_name ${serverName};

        ssl_certificate     ${SSL_DIR}/stub.crt;
        ssl_certificate_key ${SSL_DIR}/stub.key;
        ssl_protocols       TLSv1.2 TLSv1.3;
        ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
        ssl_prefer_server_ciphers on;
        ssl_session_cache shared:SSL:10m;
        ssl_session_timeout 1d;

        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

        root ${STUB_SITE_DIR};
        index index.html;

        location / {
            try_files $uri $uri/ /index.html;
        }
    }
}
`.trim();

        // Создаём директории
        await runFull(`mkdir -p /var/log/nginx /run ${ACME_DIR}`);
        fs.writeFileSync(NGINX_CONF, config, 'utf8');
        console.log(`[NGINX] Config written: HTTP:80→HTTPS, HTTPS:127.0.0.1:${internalPort}`);
    }

    /**
     * Генерация nginx.conf с Let's Encrypt SSL
     * HTTP:80 — сайт + ACME challenge (порт 443 занят Xray)
     * HTTPS:internalPort — внутренний для Reality dest (с LE-сертификатом)
     */
    async generateConfigWithSSL(domain, internalPort) {
        const certPath = `${LETSENCRYPT_LIVE}/${domain}/fullchain.pem`;
        const keyPath = `${LETSENCRYPT_LIVE}/${domain}/privkey.pem`;

        const config = `
worker_processes auto;
pid /run/nginx.pid;
error_log /var/log/nginx/error.log error;

events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    keepalive_timeout 65;
    gzip          on;
    gzip_types    text/plain text/css application/json application/javascript text/xml;
    access_log    off;
    server_tokens off;

    # HTTP:80 — редирект на HTTPS + ACME challenge
    server {
        listen 80;
        listen [::]:80;
        server_name ${domain};

        # ACME challenge для Let's Encrypt
        location /.well-known/acme-challenge/ {
            root ${ACME_DIR};
        }

        location / {
            return 301 https://$host$request_uri;
        }
    }

    # HTTPS на внутреннем порте для Xray Reality dest (с LE-сертификатом)
    server {
        listen 127.0.0.1:${internalPort} ssl http2;
        server_name ${domain};

        ssl_certificate     ${certPath};
        ssl_certificate_key ${keyPath};
        ssl_protocols       TLSv1.2 TLSv1.3;
        ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
        ssl_prefer_server_ciphers on;
        ssl_session_cache shared:SSL:10m;
        ssl_session_timeout 1d;

        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

        root ${STUB_SITE_DIR};
        index index.html;

        location / {
            try_files $uri $uri/ /index.html;
        }
    }
}
`.trim();

        await runFull(`mkdir -p /var/log/nginx /run ${ACME_DIR}`);
        fs.writeFileSync(NGINX_CONF, config, 'utf8');
        console.log(`[NGINX] SSL Config written: HTTP:80, HTTPS:127.0.0.1:${internalPort} (LE cert)`);
    }
}

module.exports = new NginxProcess();
