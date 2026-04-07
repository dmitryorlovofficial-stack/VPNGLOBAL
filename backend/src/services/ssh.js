// Сервис SSH-подключения к Серверу 1
const { NodeSSH } = require('node-ssh');

const ssh = new NodeSSH();
let connected = false;

// Параметры подключения
function getConfig() {
    const config = {
        host: process.env.SERVER1_IPV6 || '2001:db8::1',
        port: parseInt(process.env.SERVER1_SSH_PORT) || 22,
        username: process.env.SERVER1_SSH_USER || 'root',
        readyTimeout: 10000,
    };

    // Авторизация: пароль или ключ
    const password = process.env.SERVER1_SSH_PASS;
    if (password) {
        config.password = password;
    } else {
        config.privateKeyPath = '/root/.ssh/id_rsa';
    }

    return config;
}

// Подключение к Серверу 1
async function connect() {
    if (connected && ssh.isConnected()) {
        return ssh;
    }

    try {
        await ssh.connect(getConfig());
        connected = true;
        console.log('[SSH] Подключено к Серверу 1');
        return ssh;
    } catch (err) {
        connected = false;
        console.error('[SSH] Ошибка подключения:', err.message);
        throw err;
    }
}

// Выполнение команды на Сервере 1
// options: { stdin: 'data', cwd: '/' }
async function executeCommand(command, options = {}) {
    await connect();
    const execOptions = { cwd: '/', ...options };
    const result = await ssh.execCommand(command, execOptions);

    if (result.stderr && !result.stdout) {
        throw new Error(result.stderr);
    }
    return result.stdout;
}

// Проверка доступности Сервера 1
async function checkConnection() {
    try {
        await connect();
        const uptime = await executeCommand('uptime -s');
        return { connected: true, uptime: uptime.trim() };
    } catch (err) {
        return { connected: false, error: err.message };
    }
}

// Получение системной информации Сервера 1
async function getSystemInfo() {
    try {
        await connect();
        const [hostname, kernel, os, wgVersion, uptime] = await Promise.all([
            executeCommand('hostname'),
            executeCommand('uname -r'),
            executeCommand('cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \\"'),
            executeCommand('wg --version 2>/dev/null || echo "не установлен"'),
            executeCommand('uptime -p'),
        ]);

        return {
            hostname: hostname.trim(),
            kernel: kernel.trim(),
            os: os.trim(),
            wgVersion: wgVersion.trim(),
            uptime: uptime.trim(),
        };
    } catch (err) {
        return { error: err.message };
    }
}

// Получение метрик CPU/RAM/Disk Сервера 1
async function getMetrics() {
    try {
        await connect();
        const metrics = await executeCommand(`
            echo "CPU:$(top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d. -f1)"
            echo "RAM_TOTAL:$(free -m | awk '/Mem:/ {print $2}')"
            echo "RAM_USED:$(free -m | awk '/Mem:/ {print $3}')"
            echo "DISK_TOTAL:$(df -BG / | awk 'NR==2 {print $2}' | tr -d G)"
            echo "DISK_USED:$(df -BG / | awk 'NR==2 {print $3}' | tr -d G)"
        `);

        const parsed = {};
        metrics.split('\n').forEach(line => {
            const [key, value] = line.split(':');
            if (key && value) parsed[key.trim()] = parseInt(value.trim()) || 0;
        });

        return {
            cpu: parsed.CPU || 0,
            ram: { total: parsed.RAM_TOTAL || 0, used: parsed.RAM_USED || 0 },
            disk: { total: parsed.DISK_TOTAL || 0, used: parsed.DISK_USED || 0 },
        };
    } catch (err) {
        return { error: err.message };
    }
}

// Перезагрузка Сервера 1
async function rebootServer() {
    await connect();
    // Отложенная перезагрузка (через 3 секунды)
    await executeCommand('nohup bash -c "sleep 3 && reboot" &');
    return { success: true, message: 'Сервер перезагружается...' };
}

module.exports = {
    connect,
    executeCommand,
    checkConnection,
    getSystemInfo,
    getMetrics,
    rebootServer,
};
