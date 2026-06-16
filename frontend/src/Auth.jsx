import { useState } from 'react';
import api from './api/client';
import { useLang } from './context/LanguageContext';
import logo from './assets/logo1.png';
import bgImage from './assets/auth-bg.jpg';

const REGISTER_FIELDS = [
  // [ key, type, required, labelKey ]
  { key: 'username',     type: 'text',     required: true,  labelKey: 'username_placeholder' },
  { key: 'password',     type: 'password', required: true,  labelKey: 'password_placeholder' },
  { key: 'email',        type: 'email',    required: false, labelKey: 'email_placeholder' },
  { key: 'first_name',   type: 'text',     required: false, labelKey: 'first_name_placeholder' },
  { key: 'last_name',    type: 'text',     required: false, labelKey: 'last_name_placeholder' },
  { key: 'phone',        type: 'tel',      required: false, labelKey: 'phone_placeholder' },
  { key: 'country',      type: 'text',     required: false, labelKey: 'country_placeholder' },
  { key: 'city',         type: 'text',     required: false, labelKey: 'city_placeholder' },
  { key: 'farm_name',    type: 'text',     required: false, labelKey: 'farm_name_placeholder' },
  { key: 'farm_size_ha', type: 'number',   required: false, labelKey: 'farm_size_placeholder' },
];

const EMPTY_FORM = Object.fromEntries(REGISTER_FIELDS.map(f => [f.key, '']));

const Auth = ({ onLogin }) => {
  const { t, lang, setLang } = useLang();
  const [isLogin, setIsLogin]   = useState(true);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [message, setMessage]   = useState('');
  const [isError, setIsError]   = useState(false);
  const [loading, setLoading]   = useState(false);

  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      if (isLogin) {
        const res = await api.post('/api/v1/auth/login', {
          username: form.username,
          password: form.password,
        });
        onLogin(res.data);
      } else {
        const payload = Object.fromEntries(
          Object.entries(form).filter(([, v]) => v !== '' && v !== null)
        );
        if (payload.farm_size_ha) payload.farm_size_ha = parseFloat(payload.farm_size_ha);
        await api.post('/api/v1/auth/register', payload);
        setIsError(false);
        setMessage(t('account_created'));
        setIsLogin(true);
        setForm(EMPTY_FORM);
      }
    } catch (err) {
      setIsError(true);
      setMessage(err.response?.data?.detail || t('server_error'));
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => { setIsLogin(v => !v); setMessage(''); setForm(EMPTY_FORM); };

  const requiredOk = form.username.trim() && form.password.trim();

  return (
    <div style={{ ...s.container, backgroundImage: `url(${bgImage})` }}>
      <div style={s.card}>

        {/* Language selector */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16, gap: 6 }}>
          {[
            { code: 'hu', flag: '🇭🇺', label: 'Magyar' },
            { code: 'en', flag: '🇬🇧', label: 'English' },
            { code: 'fr', flag: '🇫🇷', label: 'Français' },
            { code: 'de', flag: '🇩🇪', label: 'Deutsch' },
          ].map(({ code, flag, label }) => (
            <button
              key={code}
              onClick={() => setLang(code)}
              title={label}
              style={{
                padding: '5px 10px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                border: lang === code ? '2px solid var(--color-accent-soil, #6b4c2a)' : '2px solid transparent',
                background: lang === code ? '#f5ede0' : '#f0ebe3',
                fontWeight: lang === code ? 700 : 400,
                transition: 'all 0.15s',
              }}
            >
              {flag}
            </button>
          ))}
        </div>

        <img src={logo} alt="SmartCrop Logo" style={s.logo} />
        <h2 style={s.title}>{isLogin ? t('sign_in') : t('create_account')}</h2>

        <form onSubmit={handleSubmit} style={s.form}>
          {isLogin ? (
            // Login
            <>
              <input type="text"     placeholder={t('username_placeholder')} value={form.username} onChange={set('username')} style={s.input} autoComplete="username" />
              <input type="password" placeholder={t('password_placeholder')} value={form.password} onChange={set('password')} style={s.input} autoComplete="current-password" />
            </>
          ) : (
            // Register
            <>
              {/* Required */}
              <div style={s.sectionLabel}>{t('reg_section_account') || 'Account'}</div>
              <input type="text"     placeholder={`${t('username_placeholder')} *`}  value={form.username}  onChange={set('username')}  style={s.input} autoComplete="username" />
              <input type="password" placeholder={`${t('password_placeholder')} *`}  value={form.password}  onChange={set('password')}  style={s.input} autoComplete="new-password" />

              {/* Contact info */}
              <div style={s.sectionLabel}>{t('reg_section_contact') || 'Contact'}</div>
              <input type="email"  placeholder={t('email_placeholder')      || 'Email'}        value={form.email}      onChange={set('email')}      style={s.input} />
              <div style={s.row}>
                <input type="text" placeholder={t('first_name_placeholder') || 'First name'}          value={form.first_name} onChange={set('first_name')} style={{ ...s.input, flex: 1, marginRight: 8 }} />
                <input type="text" placeholder={t('last_name_placeholder')  || 'Last name'}      value={form.last_name}  onChange={set('last_name')}  style={{ ...s.input, flex: 1 }} />
              </div>
              <input type="tel"   placeholder={t('phone_placeholder')       || 'Phone'}      value={form.phone}      onChange={set('phone')}      style={s.input} />

              {/* Location */}
              <div style={s.sectionLabel}>{t('reg_section_location') || 'Location'}</div>
              <div style={s.row}>
                <input type="text" placeholder={t('country_placeholder')    || 'Country'}       value={form.country}    onChange={set('country')}    style={{ ...s.input, flex: 1, marginRight: 8 }} />
                <input type="text" placeholder={t('city_placeholder')       || 'City'}        value={form.city}       onChange={set('city')}       style={{ ...s.input, flex: 1 }} />
              </div>

              {/* Farm */}
              <div style={s.sectionLabel}>{t('reg_section_farm') || 'Farm'}</div>
              <input type="text"   placeholder={t('farm_name_placeholder')  || 'Farm name'} value={form.farm_name}    onChange={set('farm_name')}    style={s.input} />
              <input type="number" placeholder={t('farm_size_placeholder')  || 'Area (ha)'}       value={form.farm_size_ha} onChange={set('farm_size_ha')} style={s.input} min="0" step="0.1" />
            </>
          )}

          <button type="submit" style={{ ...s.button, opacity: (!requiredOk || loading) ? 0.6 : 1 }} disabled={!requiredOk || loading}>
            {loading ? '...' : isLogin ? t('login_btn') : t('register_btn')}
          </button>
        </form>

        <p style={s.switch} onClick={switchMode}>
          {isLogin ? t('no_account') : t('have_account')}
        </p>

        {message && (
          <p style={{ ...s.message, color: isError ? 'var(--color-accent-mulberry)' : 'var(--color-green-signal)' }}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
};

const s = {
  container:   { height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' },
  card:        { position: 'relative', background: 'rgba(248,244,255,0.93)', padding: '36px 40px 30px', borderRadius: 16, backdropFilter: 'blur(10px)', boxShadow: '0 15px 35px rgba(36,41,44,0.2)', width: 400, maxHeight: '92vh', overflowY: 'auto', textAlign: 'center' },
  logo:        { width: 100, marginBottom: 16 },
  title:       { fontFamily: 'var(--font-heading)', color: 'var(--color-green-primary)', marginBottom: 18, fontSize: 20 },
  form:        { display: 'flex', flexDirection: 'column', textAlign: 'left' },
  input:       { padding: '10px 12px', marginBottom: 10, borderRadius: 8, border: '1px solid var(--color-accent-soil)', backgroundColor: '#fff', color: 'var(--color-accent-chernozem)', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' },
  row:         { display: 'flex' },
  sectionLabel:{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, marginTop: 4 },
  button:      { padding: '12px', marginTop: 6, background: 'var(--color-green-signal)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold', fontSize: 14, transition: '0.2s' },
  switch:      { marginTop: 16, color: 'var(--color-green-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 500 },
  message:     { marginTop: 12, fontSize: 13, fontWeight: 600, textAlign: 'center' },
};

export default Auth;