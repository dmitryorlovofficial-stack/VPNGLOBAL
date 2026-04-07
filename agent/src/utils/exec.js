// Локальное выполнение команд (замена SSH)
// Все команды выполняются внутри Docker-контейнера с --network host
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * Выполнить shell-команду и вернуть stdout
 */
async function run(command, options = {}) {
    const { timeout = 60000, cwd = '/' } = options;
    const result = await execAsync(command, {
        timeout,
        cwd,
        shell: '/bin/bash',
        maxBuffer: 10 * 1024 * 1024,
    });
    return result.stdout.trim();
}

/**
 * Выполнить команду, при ошибке вернуть пустую строку
 */
async function runSafe(command, options = {}) {
    try {
        return await run(command, options);
    } catch {
        return '';
    }
}

/**
 * Выполнить команду и вернуть {stdout, stderr, exitCode}
 */
async function runFull(command, options = {}) {
    const { timeout = 60000, cwd = '/' } = options;
    try {
        const result = await execAsync(command, {
            timeout,
            cwd,
            shell: '/bin/bash',
            maxBuffer: 10 * 1024 * 1024,
        });
        return { stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: 0 };
    } catch (err) {
        return {
            stdout: (err.stdout || '').trim(),
            // НЕ используем err.message — он содержит бесполезное "Command failed: <cmd>"
            // Реальный stderr доступен в err.stderr
            stderr: (err.stderr || '').trim(),
            exitCode: err.code || 1,
        };
    }
}

module.exports = { run, runSafe, runFull };
