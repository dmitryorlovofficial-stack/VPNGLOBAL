import React, { useState, useRef, useEffect } from 'react';
import { Shield, Mail, ArrowLeft, Loader2 } from 'lucide-react';
import { userApi } from '../../api/userApi';

export default function UserLogin({ onLogin }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const inputRefs = useRef([]);

  useEffect(() => {
    if (resendTimer > 0) {
      const t = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [resendTimer]);

  const handleSendCode = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setError('');
    setLoading(true);
    try {
      await userApi.sendCode(email.trim());
      setStep('code');
      setResendTimer(60);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } catch (err) {
      setError(err.message || 'Не удалось отправить код');
    } finally {
      setLoading(false);
    }
  };

  const handleCodeChange = (index, value) => {
    if (!/^\d*$/.test(value)) return;
    const newCode = [...code];
    if (value.length > 1) {
      const digits = value.split('').slice(0, 6);
      digits.forEach((d, i) => { if (index + i < 6) newCode[index + i] = d; });
      setCode(newCode);
      const nextIdx = Math.min(index + digits.length, 5);
      inputRefs.current[nextIdx]?.focus();
      if (newCode.every(d => d !== '')) submitCode(newCode.join(''));
      return;
    }
    newCode[index] = value;
    setCode(newCode);
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
    if (newCode.every(d => d !== '')) submitCode(newCode.join(''));
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const submitCode = async (codeStr) => {
    setError('');
    setLoading(true);
    try {
      const res = await userApi.verifyCode(email.trim(), codeStr);
      if (res.token) {
        userApi.setToken(res.token);
        onLogin && onLogin(res);
      }
    } catch (err) {
      setError(err.message || 'Неверный код');
      setCode(['', '', '', '', '', '']);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0) return;
    setError('');
    setLoading(true);
    try {
      await userApi.sendCode(email.trim());
      setResendTimer(60);
    } catch (err) {
      setError(err.message || 'Не удалось отправить код');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-950 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-96 h-96 bg-accent-500/5 rounded-full blur-3xl" />

      <div className="w-full max-w-md relative z-10 animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-400 to-accent-600 mb-4 shadow-glow">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">
            {step === 'email' ? 'Войти' : 'Введите код'}
          </h1>
          {step === 'code' && (
            <p className="text-gray-400 text-sm">
              Код отправлен на <span className="text-accent-400 font-medium">{email}</span>
            </p>
          )}
        </div>

        <div className="glass-card p-6">
          {step === 'email' ? (
            <form onSubmit={handleSendCode}>
              <label className="block text-sm font-medium text-gray-400 mb-2">Email</label>
              <div className="relative mb-4">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="input-glass w-full py-3 pl-11 pr-4"
                  autoFocus
                  required
                />
              </div>
              {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="btn-primary w-full py-3"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Продолжить'}
              </button>
            </form>
          ) : (
            <div>
              <div className="flex justify-center gap-2 mb-6">
                {code.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => (inputRefs.current[i] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={digit}
                    onChange={(e) => handleCodeChange(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    className="w-12 h-14 bg-dark-700/50 border border-dark-600/80 rounded-xl text-center text-xl text-white font-mono focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/20 transition-all"
                  />
                ))}
              </div>
              {error && <p className="text-red-400 text-sm text-center mb-4">{error}</p>}
              {loading && (
                <div className="flex justify-center mb-4">
                  <Loader2 className="w-6 h-6 text-accent-400 animate-spin" />
                </div>
              )}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => { setStep('email'); setCode(['','','','','','']); setError(''); }}
                  className="flex items-center gap-1 text-gray-400 hover:text-white text-sm transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" /> Назад
                </button>
                <button
                  onClick={handleResend}
                  disabled={resendTimer > 0}
                  className="text-sm text-gray-400 hover:text-accent-400 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
                >
                  {resendTimer > 0 ? `Повторно (${resendTimer}с)` : 'Отправить повторно'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
