import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { useLang } from '../context/LanguageContext';

const BASE        = '/api/v1/sensors';
const BASE_EVENTS = '/api/v1/events';

const SENSOR_ALERT_TEMPLATES = [
  { name: 'Sensor Offline',  event_type: 'SENSOR_OFFLINE', icon: '📡', description: 'Fires when sensor goes silent beyond expected interval', condition_metric: 'sensor_silence_multiplier', condition_operator: '>', default_value: 3,  severity: 'WARNING' },
  { name: 'High Temperature',event_type: 'HEAT_STRESS',    icon: '🌡️', description: 'Sensor reports temperature above threshold',              condition_metric: 'sensor_temp',              condition_operator: '>', default_value: 35, severity: 'WARNING' },
  { name: 'Low Temperature', event_type: 'FROST_HAZARD',   icon: '❄️', description: 'Sensor reports temperature below threshold',              condition_metric: 'sensor_temp',              condition_operator: '<', default_value: 2,  severity: 'WARNING' },
  { name: 'High Humidity',   event_type: 'OTHER',          icon: '💧', description: 'Sensor humidity reading above threshold',                  condition_metric: 'sensor_humidity',          condition_operator: '>', default_value: 90, severity: 'INFO'    },
  { name: 'Low Humidity',    event_type: 'OTHER',          icon: '🏜️', description: 'Sensor humidity reading below threshold',                  condition_metric: 'sensor_humidity',          condition_operator: '<', default_value: 20, severity: 'INFO'    },
  { name: 'Low Battery',     event_type: 'LOW_BATTERY',    icon: '🔋', description: 'Battery level below threshold',                            condition_metric: 'battery_pct',              condition_operator: '<', default_value: 20, severity: 'INFO'    },
];

// ── Sensor Alert Modal ─────────────────────────────────────────────────────────
const SensorAlertModal = ({ sensor, userId, onClose }) => {
  const { t } = useLang();
  const [selected, setSelected] = useState(null);
  const [threshold, setThreshold] = useState('');
  const [ruleName, setRuleName]   = useState('');
  const [busy, setBusy]           = useState(false);
  const [done, setDone]           = useState(false);

  const selectTpl = (tpl) => { setSelected(tpl); setThreshold(String(tpl.default_value)); setRuleName(`${tpl.name} — ${sensor.label || `Sensor #${sensor.id}`}`); };

  const submit = async () => {
    if (!selected || !threshold) return;
    setBusy(true);
    try {
      await api.post(`${BASE_EVENTS}/rules/create`, { user_id: userId, name: ruleName, event_type: selected.event_type, condition: { metric: selected.condition_metric, operator: selected.condition_operator, value: Number(threshold), sensor_id: sensor.id }, action: { notify: true, severity: selected.severity }, is_active: true });
      setDone(true);
      setTimeout(onClose, 1500);
    } catch { alert(t('sensor_alert_err')); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 14, padding: '22px 26px', maxWidth: 480, width: '92%', boxShadow: '0 8px 40px rgba(0,0,0,0.18)', border: '1px solid #e0d8cf', maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        {done ? (
          <div style={{ textAlign: 'center', padding: '20px 0', color: '#1b5e20', fontSize: 16, fontWeight: 700 }}>{t('sensor_alert_done')}</div>
        ) : (
          <>
            <div style={{ fontWeight: 800, fontSize: 17, color: '#333', marginBottom: 2 }}>{t('sensor_alert_title')}</div>
            <div style={{ fontSize: 12, color: '#aaa', marginBottom: 16 }}>
              {t('sensor_alert_for')} <strong style={{ color: '#555' }}>{sensor.label || `Sensor #${sensor.id}`}</strong>
            </div>

            <div style={{ fontSize: 10, fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{t('sensor_alert_type_lbl')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
              {SENSOR_ALERT_TEMPLATES.map(tpl => {
                const active = selected?.name === tpl.name;
                return (
                  <button key={tpl.name} onClick={() => selectTpl(tpl)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '8px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', border: active ? '2px solid #054e05' : '1px solid #e0d8cf', background: active ? '#f0faf0' : '#fafaf8', transition: 'all 0.15s', minWidth: 120 }}>
                    <span style={{ fontSize: 16 }}>{tpl.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#444' }}>{tpl.name}</span>
                    <span style={{ fontSize: 10, color: '#aaa', lineHeight: 1.3 }}>{tpl.description}</span>
                  </button>
                );
              })}
            </div>

            {selected && (
              <div style={{ background: '#f8f4f0', borderRadius: 10, padding: '14px 16px', border: '1px solid #e0d8cf', marginBottom: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <label style={lbl}>
                    {t('sensor_alert_rule_name')}
                    <input value={ruleName} onChange={e => setRuleName(e.target.value)} style={inp} />
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, color: '#666' }}>
                      {t('sensor_alert_trigger')} <strong>{selected.condition_metric.replace(/_/g, ' ')}</strong> {selected.condition_operator}
                    </span>
                    <input type="number" value={threshold} onChange={e => setThreshold(e.target.value)} style={{ ...inp, width: 90 }} />
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={submit} disabled={busy || !selected} style={{ ...btnPrimary, opacity: !selected ? 0.5 : 1 }}>
                {busy ? t('sensor_alert_creating') : t('sensor_alert_create')}
              </button>
              <button onClick={onClose} style={btnSecondary}>{t('sensor_alert_cancel')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ── SVG Sparkline ──────────────────────────────────────────────────────────────
const Spark = ({ labels = [], values = [], color = '#317f43', title = '', unit = '', noDataLabel }) => {
  const valid = values.map((v, i) => ({ v: Number(v), t: labels[i] })).filter(p => !isNaN(p.v) && p.v != null);
  if (!valid.length) return (
    <div style={{ minWidth: 170, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, color: '#aaa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</span>
      <span style={{ fontSize: 11, color: '#ccc' }}>{noDataLabel}</span>
    </div>
  );

  const W = 190, H = 64, px = 4, py = 8;
  const ys = valid.map(p => p.v), min = Math.min(...ys), max = Math.max(...ys), range = max - min || 1;
  const sx = (i) => px + (i / (valid.length - 1 || 1)) * (W - 2 * px);
  const sy = (v) => py + (1 - (v - min) / range) * (H - 2 * py - 12);
  const pts = valid.map((p, i) => `${sx(i)},${sy(p.v)}`).join(' ');
  const area = `M${sx(0)},${H - 12} ` + valid.map((p, i) => `L${sx(i)},${sy(p.v)}`).join(' ') + ` L${sx(valid.length - 1)},${H - 12} Z`;
  const gId = `sg${title.replace(/\W/g, '')}${color.replace('#', '')}`;
  const last = valid[valid.length - 1];
  const lastTime  = last.t ? new Date(last.t).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }) : '';
  const firstDate = valid[0].t ? new Date(valid[0].t).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' }) : '';
  const lastDate  = last.t ? new Date(last.t).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' }) : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 190 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 10, color: '#aaa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color, letterSpacing: '-0.01em' }}>
          {last.v.toFixed(1)}<span style={{ fontSize: 10, fontWeight: 400, color: '#bbb', marginLeft: 2 }}>{unit}</span>
        </span>
      </div>
      <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={gId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[min, (min + max) / 2, max].map((v, i) => (
          <line key={i} x1={px} y1={sy(v)} x2={W - px} y2={sy(v)} stroke="#ece6dc" strokeWidth="1" strokeDasharray="3 3" />
        ))}
        <path d={area} fill={`url(#${gId})`} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={sx(valid.length - 1)} cy={sy(last.v)} r={4} fill={color} stroke="#fff" strokeWidth="2" />
        <text x={px} y={H} fontSize="9" fill="#ccc" fontFamily="inherit">{firstDate}</text>
        <text x={W - px} y={H} textAnchor="end" fontSize="9" fill="#ccc" fontFamily="inherit">{lastDate}</text>
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#bbb' }}>
        <span>min {min.toFixed(1)} · max {max.toFixed(1)}</span>
        <span>{lastTime}</span>
      </div>
    </div>
  );
};

// ── Online/Offline badge ───────────────────────────────────────────────────────
const Badge = ({ on }) => {
  const { t } = useLang();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: on ? '#e8f5e9' : '#fce4ec', color: on ? '#2e7d32' : '#c62828', border: `1px solid ${on ? '#a5d6a7' : '#ef9a9a'}` }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? '#43a047' : '#e53935', boxShadow: on ? '0 0 0 3px #c8e6c9' : 'none' }} />
      {on ? t('sensor_status_online') : t('sensor_status_offline')}
    </span>
  );
};

const Field = ({ label, ...props }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 120 }}>
    <span style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
    <input style={{ padding: '6px 9px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} {...props} />
  </label>
);

// ── SensorRow ──────────────────────────────────────────────────────────────────
const SensorRow = ({ sensor, latestMap, userId, onRefresh }) => {
  const { t } = useLang();
  const [open, setOpen]       = useState(false);
  const [status, setStatus]   = useState(null);
  const [history, setHistory] = useState(null);
  const [days, setDays]       = useState(7);
  const [histLoading, setHistLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [form, setForm]       = useState({ label: sensor.label || '', latitude: '', longitude: '', activation_status: sensor.activation_status });

  const loadStatus  = useCallback(() => api.get(`${BASE}/sensor_status/${sensor.id}`).then(r => setStatus(r.data)).catch(() => {}), [sensor.id]);
  const loadHistory = useCallback((d) => {
    setHistLoading(true);
    api.get(`${BASE}/sensor_history/${sensor.id}`, { params: { days: d } }).then(r => setHistory(r.data)).catch(() => setHistory(null)).finally(() => setHistLoading(false));
  }, [sensor.id]);

  useEffect(() => { if (open) { loadStatus(); loadHistory(days); } }, [open]); // eslint-disable-line

  const save = async () => {
    setSaving(true);
    const body = {};
    if (form.label !== sensor.label) body.label = form.label;
    if (form.activation_status !== sensor.activation_status) body.activation_status = form.activation_status;
    if (form.latitude && form.longitude) { body.latitude = parseFloat(form.latitude); body.longitude = parseFloat(form.longitude); }
    try { await api.patch(`${BASE}/update_sensor/${sensor.id}`, body); setEditing(false); onRefresh(); }
    catch { alert(t('sensor_err_update')); }
    finally { setSaving(false); }
  };

  const live    = latestMap?.[sensor.id];
  const lastSeen = status?.last_contact
    ? new Date(status.last_contact).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' })
    : t('sensor_last_contact') === 'Last contact' ? 'Never' : 'Soha';

  return (
    <>
      <div style={rowWrap}>
        <div style={rowHead} onClick={() => setOpen(v => !v)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 22 }}>📡</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-accent-chernozem)' }}>
                {sensor.label || `Sensor #${sensor.id}`}
              </div>
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
                ID {sensor.id}
                {sensor.meteorological && ` · ${t('sensor_meteo_badge')}`}
                {sensor.added_at && ` · ${t('sensor_added_at')} ${new Date(sensor.added_at).toLocaleDateString('hu-HU')}`}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {live && (
              <div style={{ display: 'flex', gap: 8, fontSize: 12, color: '#555' }}>
                {live.current_values?.temp != null && <span style={{ fontWeight: 700, color: '#b53060' }}>{live.current_values.temp}°C</span>}
                {live.current_values?.humidity != null && <span style={{ fontWeight: 700, color: '#1a6fa3' }}>{live.current_values.humidity}%</span>}
              </div>
            )}
            <button onClick={e => { e.stopPropagation(); setShowAlertModal(true); }} title={t('sensor_alert_btn')} style={{ background: 'none', border: '1px solid #e0d8cf', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: '#888', padding: '3px 9px', display: 'flex', alignItems: 'center', gap: 4 }}>
              {t('sensor_alert_btn')}
            </button>
            <Badge on={sensor.activation_status} />
            <span style={{ color: '#ccc', fontSize: 13, userSelect: 'none' }}>{open ? '▲' : '▼'}</span>
          </div>
        </div>

        {open && (
          <div style={rowBody}>
            <div style={strip}>
              <div style={stripItem}><span style={stripLbl}>{t('sensor_last_contact')}</span><span style={stripVal}>{lastSeen}</span></div>
              <div style={stripItem}><span style={stripLbl}>{t('sensor_status_lbl')}</span><Badge on={status?.activation_status ?? sensor.activation_status} /></div>
              {live && (
                <>
                  <div style={stripItem}><span style={stripLbl}>{t('sensor_temp_lbl')}</span><span style={{ ...stripVal, color: '#b53060' }}>{live.current_values?.temp ?? '—'} °C</span></div>
                  <div style={stripItem}><span style={stripLbl}>{t('sensor_hum_lbl')}</span><span style={{ ...stripVal, color: '#1a6fa3' }}>{live.current_values?.humidity ?? '—'} %</span></div>
                  {live.current_values?.pressure > 0 && (
                    <div style={stripItem}><span style={stripLbl}>{t('sensor_pres_lbl')}</span><span style={{ ...stripVal, color: '#7b1fa2' }}>{live.current_values.pressure} hPa</span></div>
                  )}
                </>
              )}
              <div style={stripItem}>
                <span style={stripLbl}>Type</span>
                <span style={stripVal}>{sensor.meteorological ? t('sensor_type_meteo') : t('sensor_type_field')}</span>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#555' }}>{t('sensor_history_title')}</span>
                {[7, 14, 30].map(d => (
                  <button key={d} onClick={() => { setDays(d); loadHistory(d); }} style={{ padding: '2px 9px', borderRadius: 12, fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: days === d ? 'var(--color-green-primary,#054e05)' : '#ede7df', color: days === d ? '#fff' : '#777', transition: 'all 0.12s' }}>{d}d</button>
                ))}
                {histLoading && <span style={{ fontSize: 11, color: '#aaa' }}>{t('sensor_history_loading')}</span>}
              </div>

              {history ? (
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  <Spark labels={history.labels} values={history.datasets?.temp ?? []}     color="#b53060" title={t('sensor_temp_lbl')} unit="°C"  noDataLabel={t('sensor_no_data')} />
                  <Spark labels={history.labels} values={history.datasets?.humidity ?? []} color="#1a6fa3" title={t('sensor_hum_lbl')}  unit="%"   noDataLabel={t('sensor_no_data')} />
                  <Spark labels={history.labels} values={history.datasets?.pressure ?? []} color="#7b1fa2" title={t('sensor_pres_lbl')} unit="hPa" noDataLabel={t('sensor_no_data')} />
                </div>
              ) : (
                !histLoading && <span style={{ fontSize: 12, color: '#ccc' }}>{t('sensor_no_history')}</span>
              )}
            </div>

            {editing ? (
              <div style={editBox}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <Field label={t('sensor_edit_label')} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
                  <Field label={t('sensor_edit_lat')} type="number" placeholder={t('sensor_edit_lat_ph')} value={form.latitude} onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))} />
                  <Field label={t('sensor_edit_lon')} type="number" placeholder={t('sensor_edit_lon_ph')} value={form.longitude} onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))} />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
                    <input type="checkbox" checked={form.activation_status} onChange={e => setForm(f => ({ ...f, activation_status: e.target.checked }))} />
                    {t('sensor_edit_active')}
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={save} disabled={saving} style={btnPrimary}>{saving ? t('sensor_saving') : t('sensor_save_btn')}</button>
                  <button onClick={() => setEditing(false)} style={btnSecondary}>{t('sensor_save_cancel')}</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setEditing(true)} style={btnEdit}>{t('sensor_edit_btn')}</button>
            )}
          </div>
        )}
      </div>

      {showAlertModal && <SensorAlertModal sensor={sensor} userId={userId} onClose={() => setShowAlertModal(false)} />}
    </>
  );
};

// ── AddForm ────────────────────────────────────────────────────────────────────
const AddForm = ({ userId, onAdded }) => {
  const { t } = useLang();
  const [open, setOpen]     = useState(false);
  const [busy, setBusy]     = useState(false);
  const [apiKey, setApiKey] = useState(null);
  const [form, setForm]     = useState({ label: '', latitude: '', longitude: '', meteorological: false });

  const submit = async () => {
    if (!form.label || !form.latitude || !form.longitude) { alert(t('sensor_err_required')); return; }
    setBusy(true); setApiKey(null);
    try {
      const r = await api.post(`${BASE}/add_sensor`, { label: form.label, user_id: userId, latitude: parseFloat(form.latitude), longitude: parseFloat(form.longitude), meteorological: form.meteorological });
      setApiKey(r.data.sensor_api_key);
      setForm({ label: '', latitude: '', longitude: '', meteorological: false });
      onAdded();
    } catch { alert(t('sensor_err_add')); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <button onClick={() => { setOpen(v => !v); setApiKey(null); }} style={btnAdd}>
        {open ? t('sensor_cancel_btn') : t('sensor_add_btn')}
      </button>

      {open && (
        <div style={addBody}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label={t('sensor_label')} placeholder="North field sensor" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
            <Field label={t('sensor_lat')}   type="number" placeholder="48.8566" value={form.latitude}  onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))} />
            <Field label={t('sensor_lon')}   type="number" placeholder="2.3522"  value={form.longitude} onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={form.meteorological} onChange={e => setForm(f => ({ ...f, meteorological: e.target.checked }))} />
              {t('sensor_meteo')}
            </label>
          </div>
          <button onClick={submit} disabled={busy} style={{ ...btnPrimary, marginTop: 12 }}>
            {busy ? t('sensor_adding') : t('sensor_add_submit')}
          </button>

          {apiKey && (
            <div style={keyBox}>
              {t('sensor_created_ok')}
              <code style={keyCode}>{apiKey}</code>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Main export ────────────────────────────────────────────────────────────────
const SensorPanel = ({ userId }) => {
  const { t } = useLang();
  const [open, setOpen]           = useState(true);
  const [sensors, setSensors]     = useState([]);
  const [latestMap, setLatestMap] = useState({});
  const [loading, setLoading]     = useState(true);

  const loadSensors = useCallback(() => {
    if (!userId) return;
    setLoading(true);
    api.get(`${BASE}/user_sensors`).then(r => setSensors(r.data)).catch(() => setSensors([])).finally(() => setLoading(false));
  }, [userId]);

  const loadLatest = useCallback(() => {
    if (!userId) return;
    api.get(`${BASE}/user_sensors_latest`).then(r => { const map = {}; r.data.forEach(s => { map[s.sensor_id] = s; }); setLatestMap(map); }).catch(() => {});
  }, [userId]);

  useEffect(() => { loadSensors(); loadLatest(); }, [loadSensors, loadLatest]);

  const refresh     = () => { loadSensors(); loadLatest(); };
  const onlineCount = sensors.filter(s => s.activation_status).length;

  return (
    <div style={panelWrap}>
      <div style={panelHead} onClick={() => setOpen(v => !v)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>📡</span>
          <span style={titleStyle}>{t('sensor_title')}</span>
          <span style={countBadge}>{t('sensor_registered', sensors.length)}</span>
          {onlineCount > 0 && <span style={{ ...countBadge, background: '#e8f5e9', color: '#2e7d32' }}>{t('sensor_online', onlineCount)}</span>}
        </div>
        <span style={{ color: '#bbb', fontSize: 13 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={panelBody}>
          <AddForm userId={userId} onAdded={refresh} />
          {loading ? (
            <div style={{ color: '#bbb', padding: 16, textAlign: 'center', fontSize: 13 }}>{t('sensor_loading')}</div>
          ) : sensors.length === 0 ? (
            <div style={{ color: '#bbb', padding: 16, textAlign: 'center', fontSize: 13 }}>{t('sensor_empty')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sensors.map(s => <SensorRow key={s.id} sensor={s} latestMap={latestMap} userId={userId} onRefresh={refresh} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SensorPanel;

// ── Styles ─────────────────────────────────────────────────────────────────────
const panelWrap  = { background: '#fff', borderRadius: 14, border: '1px solid var(--color-accent-soil)', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', overflow: 'hidden', marginBottom: 20 };
const panelHead  = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 20px', cursor: 'pointer', background: 'var(--color-bg-champagne)', borderBottom: '1px solid var(--color-accent-soil)', userSelect: 'none' };
const panelBody  = { padding: '16px 20px 20px' };
const titleStyle = { fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 15, color: 'var(--color-accent-chernozem)' };
const countBadge = { fontSize: 11, color: '#aaa', background: '#f0ebe3', borderRadius: 10, padding: '2px 8px' };
const rowWrap = { border: '1px solid #ede7df', borderRadius: 10, overflow: 'hidden', background: '#fafaf8' };
const rowHead = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 15px', cursor: 'pointer', userSelect: 'none' };
const rowBody = { padding: '12px 15px 15px', borderTop: '1px solid #ede7df', background: '#fff' };
const strip     = { display: 'flex', gap: 18, background: '#f8f4f0', borderRadius: 8, padding: '8px 14px', marginBottom: 14, flexWrap: 'wrap' };
const stripItem = { display: 'flex', flexDirection: 'column', gap: 2 };
const stripLbl  = { fontSize: 10, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.05em' };
const stripVal  = { fontSize: 13, fontWeight: 600, color: '#444' };
const editBox = { background: '#f8f4f0', borderRadius: 8, padding: '12px 14px', border: '1px solid #ede7df' };
const addBody = { background: '#f8f4f0', borderRadius: 10, border: '1px solid #ede7df', padding: 14, marginTop: 10 };
const btnPrimary   = { background: 'var(--color-green-primary,#054e05)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
const btnSecondary = { background: '#eee', color: '#555', border: 'none', borderRadius: 6, padding: '7px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
const btnEdit      = { background: 'none', border: '1px solid #ddd', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: '#666', fontFamily: 'inherit' };
const btnAdd       = { background: 'var(--color-accent-mulberry,#470736)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
const keyBox  = { marginTop: 12, background: '#e8f5e9', borderRadius: 8, padding: '10px 14px', border: '1px solid #a5d6a7', fontSize: 13, color: '#2e7d32' };
const keyCode = { display: 'block', marginTop: 6, fontFamily: 'monospace', background: '#fff', padding: '6px 10px', borderRadius: 6, border: '1px solid #c8e6c9', color: '#1b5e20', wordBreak: 'break-all' };
const inp = { padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13, fontFamily: 'inherit', outline: 'none', background: '#fff' };
const lbl = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.04em' };