// GET /api/metrics — CPU, RAM, Disk, Uptime
const express = require('express');
const router = express.Router();
const { runSafe } = require('../utils/exec');
const os = require('os');

router.get('/', async (req, res) => {
    try {
        // CPU load (1 min average)
        const loadAvg = os.loadavg()[0];
        const cpuCount = os.cpus().length;
        const cpuPercent = Math.min(100, Math.round((loadAvg / cpuCount) * 100));

        // RAM
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        // Disk (root partition)
        const dfOutput = await runSafe("df -B1 / | tail -1 | awk '{print $2,$3,$4}'");
        let disk = { total: 0, used: 0, available: 0 };
        if (dfOutput) {
            const [total, used, available] = dfOutput.split(' ').map(Number);
            disk = { total, used, available };
        }

        // System uptime
        const uptimeSeconds = os.uptime();

        // Network RX/TX (суммарно по всем интерфейсам кроме lo)
        const netOutput = await runSafe(
            "cat /proc/net/dev | tail -n +3 | grep -v lo | awk '{rx+=$2; tx+=$10} END {print rx, tx}'"
        );
        let network = { rx: 0, tx: 0 };
        if (netOutput) {
            const [rx, tx] = netOutput.split(' ').map(Number);
            network = { rx, tx };
        }

        res.json({
            cpu: cpuPercent,
            cpuCores: cpuCount,
            loadAvg: os.loadavg(),
            ram: {
                total: totalMem,
                used: usedMem,
                free: freeMem,
            },
            disk,
            network,
            uptime: uptimeSeconds,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
