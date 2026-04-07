-- Отдельный домен для WireGuard endpoint (может отличаться от domain для Xray/VLESS)
ALTER TABLE servers ADD COLUMN IF NOT EXISTS wg_domain VARCHAR(255);
