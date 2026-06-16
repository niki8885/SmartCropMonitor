import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api/client';
import { useLang } from '../context/LanguageContext';

const POLL_INTERVAL_MS = 30_000;
const DISMISS_KEY = 'briefing_dismissed_date'; // localStorage key (per-day dismiss)

const RISK_ORDER = { CRITICAL: 0, ERROR: 1, WARNING: 2, INFO: 3 };
const RISK_STYLE = {
  HIGH:   { bg: '#fce4ec', border: '#ef9a9a', text: '#b71c1c', dot: '#e53935' },
  MEDIUM: { bg: '#fff8e1', border: '#ffcc02', text: '#e65100', dot: '#ffa000' },
  LOW:    { bg: '#e3f2fd', border: '#90caf9', text: '#0d47a1', dot: '#1e88e5' },
};
const severityToRisk = (sev) => {
  if (sev === 'CRITICAL' || sev === 'ERROR') return 'HIGH';
  if (sev === 'WARNING') return 'MEDIUM';
  return 'LOW';
};
const EVT_ICONS = {
  DISEASE_DETECTION:'🦠', FROST_HAZARD:'❄️', HEAT_STRESS:'🔥',
  DROUGHT_WARNING:'🏜️', HEAVY_RAIN:'🌧️', HAIL_STORM:'⛈️', HIGH_WIND:'💨',
  NDVI_DROP:'🌿', METRIC_ANOMALY:'📊', SENSOR_OFFLINE:'📡',
  LOW_BATTERY:'🔋', PEST_OUTBREAK:'🐛', OTHER:'⚠️',
};

// today's date string as key (YYYY-MM-DD)
const todayKey = () => new Date().toISOString().slice(0, 10);

const RiskBadge = ({ level }) => {
  const s = RISK_STYLE[level] || RISK_STYLE.LOW;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: s.bg, color: s.text, border: `1px solid ${s.border}`, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot, display: 'inline-block' }} />
      {level}
    </span>
  );
};

const RiskRow = ({ event, rank }) => {
  const risk  = severityToRisk(event.severity);
  const icon  = EVT_ICONS[event.event_type] || EVT_ICONS.OTHER;
  const model = event.extra_metadata?.model;
  const loc   = event.extra_metadata?.location_label;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderRadius: 8, marginBottom: 5, background: RISK_STYLE[risk]?.bg || '#f9f9f9', border: `1px solid ${RISK_STYLE[risk]?.border || '#ddd'}` }}>
      <span style={{ fontSize: 11, fontWeight: 800, color: '#bbb', minWidth: 18, textAlign: 'center' }}>#{rank}</span>
      <span style={{ fontSize: 17 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#333' }}>
          {event.event_type.replace(/_/g, ' ')}
          {model ? <span style={{ fontWeight: 400, color: '#888', marginLeft: 6, fontSize: 12 }}>({model})</span> : null}
        </div>
        {loc && <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>{loc}</div>}
      </div>
      <RiskBadge level={risk} />
    </div>
  );
};

const MorningBriefingPanel = ({ userId }) => {
  const { t } = useLang();

  // Dismiss once-per-day logic
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === todayKey(); }
    catch { return false; }
  });

  // Slide-up animation on dismiss
  const [hiding, setHiding] = useState(false);

  const dismiss = () => {
    setHiding(true);
    setTimeout(() => {
      try { localStorage.setItem(DISMISS_KEY, todayKey()); } catch { /* ignore storage errors */ }
      setDismissed(true);
      setHiding(false);
    }, 420); // animation duration ms
  };

  // Data fetching
  const [open, setOpen]       = useState(true);
  const [events, setEvents]   = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!userId) return;
    setLoading(true);
    api.get(`/api/v1/events/user`)
      .then(r => setEvents(r.data || []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const pollRef = useRef(null);
  useEffect(() => {
    if (!userId) return;
    pollRef.current = setInterval(() => {
      api.get(`/api/v1/events/user`).then(r => setEvents(r.data || [])).catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => clearInterval(pollRef.current);
  }, [userId]);

  // Derived values
  const active = events
    .filter(e => e.status === 'ACTIVE')
    .sort((a, b) => (RISK_ORDER[a.severity] ?? 9) - (RISK_ORDER[b.severity] ?? 9));

  const highCount    = active.filter(e => severityToRisk(e.severity) === 'HIGH').length;
  const mediumCount  = active.filter(e => severityToRisk(e.severity) === 'MEDIUM').length;
  const overallStatus = highCount > 0 ? 'HIGH' : mediumCount > 0 ? 'MEDIUM' : 'LOW';

  const now    = new Date();
  const hour   = now.getHours();
  const greeting = hour < 12
    ? t('briefing_greeting_morning')
    : hour < 18
    ? t('briefing_greeting_afternoon')
    : t('briefing_greeting_evening');

  const dateStr = now.toLocaleDateString('hu-HU', { weekday: 'long', day: 'numeric', month: 'long' });

  const statusMsg = overallStatus === 'HIGH'
    ? t('briefing_status_high')
    : overallStatus === 'MEDIUM'
    ? t('briefing_status_medium')
    : t('briefing_status_low');

  // Already dismissed today — render nothing
  if (dismissed) return null;

  return (
    <>
      {/* Inject keyframes */}
      <style>{`
        @keyframes briefing-slide-up {
          0%   { opacity: 1; transform: translateY(0)   scale(1);    max-height: 600px; }
          60%  { opacity: 0; transform: translateY(-32px) scale(0.97); }
          100% { opacity: 0; transform: translateY(-48px) scale(0.95); max-height: 0; margin: 0; padding: 0; }
        }
        .briefing-hiding {
          animation: briefing-slide-up 0.42s cubic-bezier(0.4, 0, 0.2, 1) forwards;
          pointer-events: none;
          overflow: hidden;
        }
      `}</style>

      <div style={wrap} className={hiding ? 'briefing-hiding' : ''}>
        <div style={head} onClick={() => setOpen(v => !v)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>☀️</span>
            <span style={titleSt}>{t('briefing_title')}</span>
            <span style={{ fontSize: 11, color: '#aaa', fontWeight: 400 }}>{dateStr}</span>
            {!loading && active.length > 0 && <RiskBadge level={overallStatus} />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#bbb', fontSize: 13 }}>{open ? '▲' : '▼'}</span>
            {/* Dismiss button */}
            <button
              onClick={e => { e.stopPropagation(); dismiss(); }}
              title={t('briefing_dismiss_title') || 'Hide until tomorrow'}
              style={{
                background: 'none', border: '1px solid #ddd', borderRadius: 6,
                padding: '3px 10px', fontSize: 11, fontWeight: 700, color: '#aaa',
                cursor: 'pointer', lineHeight: 1.4, whiteSpace: 'nowrap',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#bbb'; e.currentTarget.style.color = '#888'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#ddd'; e.currentTarget.style.color = '#aaa'; }}
            >
              {t('briefing_dismiss') || 'Dismiss ✕'}
            </button>
          </div>
        </div>

        {open && (
          <div style={body}>
            {loading ? (
              <div style={{ color: '#bbb', textAlign: 'center', padding: 20, fontSize: 13 }}>
                {t('briefing_loading')}
              </div>
            ) : (
              <>
                <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 12, background: RISK_STYLE[overallStatus].bg, border: `1px solid ${RISK_STYLE[overallStatus].border}`, fontSize: 13, color: RISK_STYLE[overallStatus].text, fontWeight: 600 }}>
                  {greeting}. {statusMsg}
                  {active.length > 0 && (
                    <span style={{ fontWeight: 400, color: '#888', marginLeft: 6 }}>
                      {highCount   > 0 ? `${t('briefing_high',   highCount)} · `   : ''}
                      {mediumCount > 0 ? `${t('briefing_medium', mediumCount)} · ` : ''}
                      {t('briefing_total', active.length)}
                    </span>
                  )}
                </div>

                {active.length === 0 ? (
                  <div style={{ color: '#aaa', fontSize: 13, padding: '8px 0' }}>
                    {t('briefing_no_alerts')}
                  </div>
                ) : (
                  active.slice(0, 8).map((e, i) => <RiskRow key={e.id} event={e} rank={i + 1} />)
                )}

                {active.length > 8 && (
                  <div style={{ fontSize: 12, color: '#aaa', marginTop: 6, textAlign: 'center' }}>
                    {t('briefing_more', active.length - 8)}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
};

export default MorningBriefingPanel;

const wrap    = { background: '#fff', borderRadius: 14, border: '1px solid var(--color-accent-soil)', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', overflow: 'hidden', marginBottom: 20, transition: 'box-shadow 0.2s' };
const head    = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 20px', cursor: 'pointer', background: 'var(--color-bg-champagne)', borderBottom: '1px solid var(--color-accent-soil)', userSelect: 'none' };
const body    = { padding: '16px 20px 20px' };
const titleSt = { fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 15, color: 'var(--color-accent-chernozem)' };