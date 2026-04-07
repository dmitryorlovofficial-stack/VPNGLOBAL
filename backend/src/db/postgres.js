// Модуль подключения к PostgreSQL
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://vpn:vpn_secret_change_me@127.0.0.1:5432/vpnpanel',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    console.error('[PG] Непредвиденная ошибка пула:', err.message);
});

// Обычный запрос (возвращает { rows, rowCount, ... })
async function query(text, params = []) {
    return pool.query(text, params);
}

// Получить одну строку (или null)
async function queryOne(text, params = []) {
    const { rows } = await pool.query(text, params);
    return rows[0] || null;
}

// Получить все строки
async function queryAll(text, params = []) {
    const { rows } = await pool.query(text, params);
    return rows;
}

// Транзакция — callback получает client с методом .query()
async function transaction(callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// Получить пул для прямого использования
function getPool() {
    return pool;
}

// Закрыть пул
async function close() {
    await pool.end();
}

module.exports = { query, queryOne, queryAll, transaction, getPool, close };
