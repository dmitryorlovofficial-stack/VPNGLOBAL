// Система миграций для PostgreSQL
// Запуск: node src/db/migrations/migrate.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = __dirname;

async function runMigrations(pool) {
    const client = await pool.connect();
    try {
        // Таблица для отслеживания миграций
        await client.query(`
            CREATE TABLE IF NOT EXISTS _migrations (
                id      SERIAL PRIMARY KEY,
                name    VARCHAR(255) UNIQUE NOT NULL,
                applied TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // Получаем список применённых миграций
        const { rows: applied } = await client.query(
            'SELECT name FROM _migrations ORDER BY name'
        );
        const appliedSet = new Set(applied.map(r => r.name));

        // Получаем все .sql файлы миграций
        const files = fs.readdirSync(MIGRATIONS_DIR)
            .filter(f => f.endsWith('.sql'))
            .sort();

        let count = 0;
        for (const file of files) {
            if (appliedSet.has(file)) continue;

            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
            console.log(`[МИГРАЦИЯ] Применяю: ${file}...`);

            await client.query('BEGIN');
            try {
                await client.query(sql);
                await client.query(
                    'INSERT INTO _migrations (name) VALUES ($1)',
                    [file]
                );
                await client.query('COMMIT');
                console.log(`[МИГРАЦИЯ] ✓ ${file}`);
                count++;
            } catch (err) {
                await client.query('ROLLBACK');
                console.error(`[МИГРАЦИЯ] ✗ ${file}:`, err.message);
                throw err;
            }
        }

        if (count === 0) {
            console.log('[МИГРАЦИЯ] Все миграции уже применены');
        } else {
            console.log(`[МИГРАЦИЯ] Применено: ${count}`);
        }
    } finally {
        client.release();
    }
}

// Если запущен напрямую (npm run migrate)
if (require.main === module) {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL || 'postgresql://vpn:vpn_secret_change_me@127.0.0.1:5432/vpnpanel',
    });

    runMigrations(pool)
        .then(() => {
            console.log('[МИГРАЦИЯ] Готово');
            process.exit(0);
        })
        .catch(err => {
            console.error('[МИГРАЦИЯ] Фатальная ошибка:', err);
            process.exit(1);
        });
}

module.exports = { runMigrations };
