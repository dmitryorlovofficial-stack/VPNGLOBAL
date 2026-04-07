// Управление процессом Xray без systemd
// Xray запускается как child process и управляется через signals
const { spawn } = require('child_process');
const { run, runSafe } = require('../utils/exec');

const XRAY_BINARY = '/usr/local/bin/xray';
const XRAY_CONFIG = '/usr/local/etc/xray/config.json';

class XrayProcess {
    constructor() {
        this.process = null;
        this.running = false;
        this.restartCount = 0;
    }

    /**
     * Запустить Xray
     */
    async start() {
        if (this.running && this.process) {
            console.log('[XRAY] Already running, skipping start');
            return;
        }

        // Убиваем ВСЕ процессы Xray (на случай ручного запуска или зомби-процессов)
        // Это предотвращает дублирование — два процесса на одном порту = конфликт
        await runSafe('killall -9 xray 2>/dev/null');
        await new Promise(r => setTimeout(r, 300));

        const proc = spawn(XRAY_BINARY, ['run', '-config', XRAY_CONFIG], {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
        });

        proc.stdout.on('data', (data) => {
            // Логи Xray в stdout контейнера
        });

        proc.stderr.on('data', (data) => {
            console.error(`[XRAY] ${data.toString().trim()}`);
        });

        proc.on('error', (err) => {
            console.error('[XRAY] Process error:', err.message);
            this.running = false;
            this.process = null;
        });

        proc.on('exit', (code, signal) => {
            console.log(`[XRAY] Process exited (code: ${code}, signal: ${signal})`);
            this.running = false;
            this.process = null;

            // Авто-рестарт при любом неожиданном выходе (не по нашему stop())
            // code=0 — нормальный выход, code=null+signal — убит сигналом (OOM, SIGKILL и т.д.)
            const isExpected = code === 0 || this.restartCount >= 999;
            if (!isExpected) {
                const delay = Math.min(2000 * Math.pow(2, this.restartCount), 30000); // exponential backoff, max 30s
                this.restartCount++;
                console.log(`[XRAY] Auto-restarting in ${delay}ms (attempt ${this.restartCount})${signal ? ` after ${signal}` : ''}...`);
                setTimeout(() => this.start(), delay);
            }
        });

        this.process = proc;
        this.running = true;
        this.restartCount = 0;
        console.log(`[XRAY] Started (PID: ${proc.pid})`);
    }

    /**
     * Остановить Xray
     */
    async stop() {
        this.restartCount = 999; // Предотвращаем авто-рестарт

        if (this.process && this.running) {
            await new Promise((resolve) => {
                const proc = this.process;

                proc.on('exit', () => {
                    this.running = false;
                    this.process = null;
                    this.restartCount = 0;
                    console.log('[XRAY] Stopped');
                    resolve();
                });

                // SIGTERM — graceful shutdown
                proc.kill('SIGTERM');

                // Если не завершился за 5 сек — SIGKILL
                setTimeout(() => {
                    if (this.process && this.process.pid) {
                        try {
                            proc.kill('SIGKILL');
                        } catch {}
                    }
                    resolve();
                }, 5000);
            });
        }

        // Дополнительно убиваем все процессы Xray (защита от зомби и ручных запусков)
        await runSafe('killall -9 xray 2>/dev/null');
        this.running = false;
        this.process = null;
        this.restartCount = 0;
    }

    /**
     * Перезапустить Xray
     */
    async restart() {
        await this.stop();
        await new Promise(r => setTimeout(r, 500));
        await this.start();
    }

    /**
     * Проверить что Xray запущен
     */
    isRunning() {
        if (!this.process || !this.running) return false;
        try {
            // Проверяем что процесс жив
            process.kill(this.process.pid, 0);
            return true;
        } catch {
            this.running = false;
            this.process = null;
            return false;
        }
    }

    /**
     * Получить версию Xray
     */
    async getVersion() {
        const version = await runSafe(`${XRAY_BINARY} version 2>/dev/null | head -1 | awk '{print $2}'`);
        return version || null;
    }

    /**
     * Проверить установлен ли Xray
     */
    async isInstalled() {
        const result = await runSafe(`test -f ${XRAY_BINARY} && echo "yes" || echo "no"`);
        return result === 'yes';
    }
}

// Singleton
const xrayProcess = new XrayProcess();

// Запускаем Xray при старте агента если конфиг существует
(async () => {
    try {
        const { existsSync } = require('fs');
        if (existsSync(XRAY_BINARY) && existsSync(XRAY_CONFIG)) {
            console.log('[XRAY] Found existing config, starting Xray...');
            await xrayProcess.start();
        }
    } catch {}
})();

module.exports = xrayProcess;
