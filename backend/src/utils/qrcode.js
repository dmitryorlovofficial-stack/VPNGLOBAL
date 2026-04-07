// Генерация QR-кодов для конфигов клиентов
const QRCode = require('qrcode');

// Генерация QR-кода в формате PNG (Buffer)
async function generateQRPng(text) {
    return QRCode.toBuffer(text, {
        type: 'png',
        width: 512,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
    });
}

// Генерация QR-кода в формате Data URL
async function generateQRDataUrl(text) {
    return QRCode.toDataURL(text, {
        width: 512,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
    });
}

module.exports = { generateQRPng, generateQRDataUrl };
