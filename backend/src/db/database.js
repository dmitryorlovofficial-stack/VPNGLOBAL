// Инициализация базы данных PostgreSQL
const bcrypt = require('bcryptjs');
const { getPool, query, queryOne } = require('./postgres');
const { runMigrations } = require('./migrations/migrate');

// Инициализация: миграции + сидирование админа + настройки по умолчанию
async function initDatabase() {
    const pool = getPool();

    // Ждём готовности PostgreSQL (retry при старте)
    for (let i = 0; i < 30; i++) {
        try {
            await pool.query('SELECT 1');
            break;
        } catch (err) {
            console.log(`[БД] Ожидание PostgreSQL... (${i + 1}/30)`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    // Применяем миграции
    await runMigrations(pool);

    // Создаём или обновляем администратора
    const adminUser = process.env.PANEL_ADMIN_USER || 'admin';
    const adminPass = process.env.PANEL_ADMIN_PASS || 'changeme123';
    const adminHash = bcrypt.hashSync(adminPass, 12);

    const existing = await queryOne(
        'SELECT id FROM admins WHERE username = $1', [adminUser]
    );

    if (!existing) {
        await query(
            'INSERT INTO admins (username, password_hash, role) VALUES ($1, $2, $3)',
            [adminUser, adminHash, 'admin']
        );
        console.log(`[БД] Создан администратор: ${adminUser}`);
    } else {
        await query(
            'UPDATE admins SET password_hash = $1, role = $2 WHERE username = $3',
            [adminHash, 'admin', adminUser]
        );
        console.log(`[БД] Пароль администратора ${adminUser} синхронизирован с .env`);
    }

    // Настройки по умолчанию
    const defaultSettings = {
        'client_dns': process.env.CLIENT_DNS || '1.1.1.1, 8.8.8.8',
        'wg0_port': process.env.WG0_PORT || '41920',
        'wg1_port': process.env.WG1_PORT || '43821',
        'wg0_subnet': process.env.WG0_SUBNET || '10.20.20',
        'wg1_subnet': process.env.WG1_SUBNET || '10.10.10',
        'server2_public_ip': process.env.SERVER2_PUBLIC_IP || '203.0.113.1',
        'server1_ipv6': process.env.SERVER1_IPV6 || '2001:db8::1',
        'mtu': '1420',
        'keepalive': '25',
        'ip_whitelist': '',
        'max_login_attempts': '5',
        'lockout_minutes': '15',
        'telegram_bot_token': '',
        'telegram_bot_username': '',
    };

    for (const [key, value] of Object.entries(defaultSettings)) {
        await query(
            'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
            [key, value]
        );
    }

    console.log('[БД] PostgreSQL инициализирован');
}

module.exports = { initDatabase };
