import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api/client';
import { useLang } from '../context/LanguageContext';

const BASE_EVENTS = '/api/v1/events';
const POLL_INTERVAL_MS = 30_000;

const SEV_COLOR = {
  CRITICAL: { bg: '#fce4ec', text: '#b71c1c', border: '#ef9a9a' },
  ERROR:    { bg: '#fce4ec', text: '#c62828', border: '#ef9a9a' },
  WARNING:  { bg: '#fff8e1', text: '#e65100', border: '#ffcc02' },
  INFO:     { bg: '#e3f2fd', text: '#0d47a1', border: '#90caf9' },
};
const STATUS_COLOR = {
  ACTIVE:       { bg: '#e8f5e9', text: '#1b5e20', border: '#a5d6a7' },
  ACKNOWLEDGED: { bg: '#fff3e0', text: '#e65100', border: '#ffcc02' },
  RESOLVED:     { bg: '#f3e5f5', text: '#4a148c', border: '#ce93d8' },
  ARCHIVED:     { bg: '#f5f5f5', text: '#616161', border: '#bdbdbd' },
  IGNORED:      { bg: '#f5f5f5', text: '#9e9e9e', border: '#e0e0e0' },
};
const EVT_ICONS = {
  SENSOR_OFFLINE:'📡', DISEASE_DETECTION:'🦠', PEST_OUTBREAK:'🐛',
  FROST_HAZARD:'❄️', HEAT_STRESS:'🔥', DROUGHT_WARNING:'🏜️',
  HEAVY_RAIN:'🌧️', HAIL_STORM:'⛈️', HIGH_WIND:'💨',
  NDVI_DROP:'🌿', METRIC_ANOMALY:'📊', LOW_BATTERY:'🔋',
  MANUAL_ALERT:'✏️', OTHER:'⚠️',
};
const STATUSES = ['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'ARCHIVED', 'IGNORED'];

const Pill = ({ label, colors }) => (
  <span style={{
    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
    background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`,
    textTransform: 'uppercase', letterSpacing: '0.05em',
  }}>{label}</span>
);

// ── Single alert row ──────────────────────────────────────────────────────────
const AlertRow = ({ event, userId, onStatusChange }) => {
  const { t } = useLang();
  const [updating, setUpdating] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [open, setOpen] = useState(false);
  const sev  = SEV_COLOR[event.severity]  || SEV_COLOR.INFO;
  const sta  = STATUS_COLOR[event.status] || STATUS_COLOR.ACTIVE;
  const icon = EVT_ICONS[event.event_type] || EVT_ICONS.OTHER;
  const ts   = event.created_at
    ? new Date(event.created_at).toLocaleString('hu-HU', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';

  const autoResolved =
    event.status === 'RESOLVED' &&
    event.event_type === 'SENSOR_OFFLINE' &&
    event.extra_metadata?.resolved_at;

  const changeStatus = async (newStatus) => {
    if (newStatus === event.status) return;
    setUpdating(true);
    try {
      await api.patch(`${BASE_EVENTS}/${event.id}/status`, { status: newStatus });
      onStatusChange();
    } catch { alert(t('alert_err_status')); }
    finally { setUpdating(false); }
  };

  const markFalsePositive = async (e) => {
    e.stopPropagation();
    if (event.status === 'IGNORED') return;
    setIgnoring(true);
    try {
      await api.post('/api/v1/false-positives', {
        user_id:          userId,
        event_id:         event.id,
        event_type:       event.event_type,
        context_snapshot: event.extra_metadata ?? null,
      });
      onStatusChange();
    } catch { alert(t('alert_err_status')); }
    finally { setIgnoring(false); }
  };

  const isAlreadyIgnored = event.status === 'IGNORED';

  return (
    <div style={{ border: `1px solid ${sev.border}`, borderRadius: 10, overflow: 'hidden', background: '#fafaf8', marginBottom: 6 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', cursor: 'pointer', userSelect: 'none',
        borderLeft: `4px solid ${event.status === 'RESOLVED' ? '#ce93d8' : sev.text}`,
      }} onClick={() => setOpen(v => !v)}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#333' }}>
              {event.event_type?.replace(/_/g, ' ')}
            </span>
            <Pill label={t(`alert_sev_${event.severity?.toLowerCase()}`)} colors={sev} />
            <Pill label={t(`alert_status_${event.status?.toLowerCase()}`)}   colors={sta} />
            {autoResolved && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#e8f5e9', color: '#2e7d32', border: '1px solid #a5d6a7', letterSpacing: '0.05em' }}>
                {t('alerts_sensor_online')}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{ts}</div>
        </div>
        {!isAlreadyIgnored && (
          <button
            disabled={ignoring || updating}
            onClick={markFalsePositive}
            title={t('alert_mark_fp') || 'False positives'}
            style={{
              flexShrink: 0,
              padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              cursor: 'pointer', border: '1px solid #e0d8cf',
              background: '#f5f0ea', color: '#9e7a4a',
              opacity: ignoring ? 0.5 : 1, transition: 'all 0.15s',
              userSelect: 'none',
            }}
          >
            {ignoring ? '…' : '🚫 FP'}
          </button>
        )}
        <span style={{ color: '#bbb', fontSize: 12, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '12px 14px 14px', borderTop: `1px solid ${sev.border}`, background: '#fff' }}>
          {autoResolved && (
            <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#2e7d32' }}>
              {t('alerts_auto_resolved', new Date(event.extra_metadata.resolved_at).toLocaleString('hu-HU', { dateStyle: 'medium', timeStyle: 'short' }))}
            </div>
          )}

          {event.extra_metadata && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                {t('alerts_details')}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {Object.entries(event.extra_metadata).map(([k, v]) => {
                  const display = v === null || v === undefined
                    ? '—'
                    : typeof v === 'object'
                      ? JSON.stringify(v)
                      : String(v);
                  return (
                    <div key={k} style={{ background: '#f5f0ea', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>
                      <span style={{ color: '#999', marginRight: 4 }}>{k.replace(/_/g, ' ')}:</span>
                      <span style={{ fontWeight: 600, color: '#444' }}>{display}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              {t('alerts_change_status')}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {STATUSES.map(s => {
                const c = STATUS_COLOR[s];
                const active = s === event.status;
                return (
                  <button key={s} disabled={updating || active} onClick={() => changeStatus(s)} style={{
                    padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                    cursor: active ? 'default' : 'pointer',
                    background: active ? c.bg : '#f5f5f5',
                    color: active ? c.text : '#999',
                    border: active ? `1px solid ${c.border}` : '1px solid #e0e0e0',
                    opacity: updating ? 0.5 : 1, transition: 'all 0.15s',
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                  }}>{t(`alert_status_${s.toLowerCase()}`)}</button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Template library ──────────────────────────────────────────────────────────
// name/description/group
const TEMPLATES = [
  { groupKey: 'tpl_group_weather', items: [
    { nameKey: 'tpl_frost_hazard_name',    descKey: 'tpl_frost_hazard_desc',    event_type: 'FROST_HAZARD',    icon: '❄️', condition: { metric: 'temp_min_night_7d',         operator: '<', value: 0    }, action: { notify: true, severity: 'WARNING' } },
    { nameKey: 'tpl_heat_stress_name',     descKey: 'tpl_heat_stress_desc',     event_type: 'HEAT_STRESS',     icon: '🔥', condition: { metric: 'temp_max_day_7d',          operator: '>', value: 35   }, action: { notify: true, severity: 'WARNING' } },
    { nameKey: 'tpl_drought_warning_name', descKey: 'tpl_drought_warning_desc', event_type: 'DROUGHT_WARNING', icon: '🏜️', condition: { metric: 'water_deficit_30d',         operator: '>', value: 50   }, action: { notify: true, severity: 'WARNING' } },
    { nameKey: 'tpl_heavy_rain_name',      descKey: 'tpl_heavy_rain_desc',      event_type: 'HEAVY_RAIN',      icon: '🌧️', condition: { metric: 'rain_cum_7d',              operator: '>', value: 80   }, action: { notify: true, severity: 'WARNING' } },
    { nameKey: 'tpl_high_wind_name',       descKey: 'tpl_high_wind_desc',       event_type: 'HIGH_WIND',       icon: '💨', condition: { metric: 'wind_speed',               operator: '>', value: 15   }, action: { notify: true, severity: 'INFO'    } },
    { nameKey: 'tpl_low_spi_name',         descKey: 'tpl_low_spi_desc',         event_type: 'DROUGHT_WARNING', icon: '📉', condition: { metric: 'spi_1m',                   operator: '<', value: -1   }, action: { notify: true, severity: 'WARNING' } },
  ]},
  { groupKey: 'tpl_group_sensor', items: [
    { nameKey: 'tpl_sensor_offline_name',  descKey: 'tpl_sensor_offline_desc',  event_type: 'SENSOR_OFFLINE',  icon: '📡', condition: { metric: 'sensor_silence_multiplier', operator: '>', value: 3    }, action: { notify: true, severity: 'WARNING' } },
    { nameKey: 'tpl_low_battery_name',     descKey: 'tpl_low_battery_desc',     event_type: 'LOW_BATTERY',     icon: '🔋', condition: { metric: 'battery_pct',              operator: '<', value: 20   }, action: { notify: true, severity: 'INFO'    } },
    { nameKey: 'tpl_temp_spike_name',      descKey: 'tpl_temp_spike_desc',      event_type: 'HEAT_STRESS',     icon: '🌡️', condition: { metric: 'sensor_temp',              operator: '>', value: 40   }, action: { notify: true, severity: 'WARNING' } },
  ]},
  { groupKey: 'tpl_group_vegetation', items: [
    { nameKey: 'tpl_ndvi_drop_name',       descKey: 'tpl_ndvi_drop_desc',       event_type: 'NDVI_DROP',       icon: '🌿', condition: { metric: 'ndvi_delta',               operator: '<', value: -0.15}, action: { notify: true, severity: 'WARNING' } },
    { nameKey: 'tpl_metric_anomaly_name',  descKey: 'tpl_metric_anomaly_desc',   event_type: 'METRIC_ANOMALY',  icon: '📊', condition: { metric: 'anomaly_score',            operator: '>', value: 0.8  }, action: { notify: true, severity: 'INFO'    } },
  ]},
];

const EVENT_TYPES = [
  'FROST_HAZARD','HEAT_STRESS','HEAVY_RAIN','HAIL_STORM','HIGH_WIND','DROUGHT_WARNING',
  'LIGHTNING_STRIKE','LOW_SOIL_MOISTURE','HIGH_SOIL_MOISTURE','SOIL_TEMP_LOW','SOIL_TEMP_HIGH',
  'NDVI_DROP','EVI_ANOMALY','PEST_OUTBREAK','DISEASE_DETECTION','METRIC_ANOMALY',
  'SENSOR_OFFLINE','LOW_BATTERY','GATEWAY_DISCONNECTED','DATA_CORRUPTION',
  'MANUAL_ALERT','OTHER',
];
const OPERATORS = ['>', '<', '>=', '<=', '==', '!='];
const METRIC_OPTIONS = [
  ['temp','Temperature'],['wind_speed','Wind speed'],['humidity','Humidity'],
  ['rain','Rain'],['precipitation','Precipitation'],['pressure','Pressure'],
  ['cloud_coverage','Cloud cover'],['soil_temperature_0cm','Soil temp 0 cm'],
  ['soil_moisture_0_to_1cm','Soil moisture 0-1 cm'],['temp_min_night_7d','Min night temp 7d'],
  ['temp_max_day_7d','Max day temp 7d'],['rain_cum_7d','Rain total 7d'],
  ['rain_cum_30d','Rain total 30d'],['water_deficit_7d','Water deficit 7d'],
  ['water_deficit_30d','Water deficit 30d'],['humidity_mean_7d','Humidity mean 7d'],
  ['spi_1m','SPI 1m'],['gdd_base_10','GDD base 10'],['battery_pct','Battery percent'],
  ['sensor_temp','Sensor temperature'],['sensor_humidity','Sensor humidity'],
  ['sensor_pressure','Sensor pressure'],
];

const blankCondition = () => ({ metric: 'temp', operator: '>', value: '' });

const conditionToRows = (condition = {}) => {
  const rows = Array.isArray(condition.conditions) ? condition.conditions : [condition];
  return rows.filter(row => row?.metric).map(row => ({ metric: row.metric, operator: row.operator || '>', value: row.value ?? '' }));
};
const buildConditionPayload = (logic, rows) => {
  const conditions = rows.map(row => ({ metric: row.metric, operator: row.operator, value: Number(row.value) }));
  return conditions.length === 1 ? conditions[0] : { logic, conditions };
};
const describeCondition = (condition = {}) => {
  if (Array.isArray(condition.conditions)) {
    return condition.conditions.map(item => `${item.metric} ${item.operator} ${item.value}`).join(` ${condition.logic || 'AND'} `);
  }
  return `${condition.metric ?? 'metric'} ${condition.operator ?? ''} ${condition.value ?? ''}`;
};

// ── Condition rows builder ────────────────────────────────────────────────────
const ConditionRows = ({ logic, setLogic, rows, setRows, inp }) => {
  const { t } = useLang();
  const updateRow = (idx, patch) => setRows(current => current.map((row, i) => i === idx ? { ...row, ...patch } : row));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <label style={lbl}>
        {t('rule_match')}
        <select value={logic} onChange={e => setLogic(e.target.value)} style={inp({ width: 150 })}>
          <option value="AND">{t('rule_match_all')}</option>
          <option value="OR">{t('rule_match_any')}</option>
        </select>
      </label>

      {rows.map((row, idx) => (
        <div key={idx} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
          <label style={lbl}>
            {t('rule_metric')}
            <select value={row.metric} onChange={e => updateRow(idx, { metric: e.target.value })} style={inp({ minWidth: 190 })}>
              {METRIC_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label style={lbl}>
            {t('rule_operator')}
            <select value={row.operator} onChange={e => updateRow(idx, { operator: e.target.value })} style={inp({ width: 80 })}>
              {OPERATORS.map(o => <option key={o}>{o}</option>)}
            </select>
          </label>
          <label style={lbl}>
            {t('rule_value')}
            <input type="number" value={row.value} onChange={e => updateRow(idx, { value: e.target.value })}
              placeholder="0" style={inp({ width: 100 })} />
          </label>
          {rows.length > 1 && (
            <button type="button" onClick={() => setRows(current => current.filter((_, i) => i !== idx))}
              style={{ ...btnSecondary, padding: '6px 10px' }}>
              {t('rule_remove_cond')}
            </button>
          )}
        </div>
      ))}

      <button type="button" onClick={() => setRows(current => [...current, blankCondition()])}
        style={{ ...btnSecondary, width: 'fit-content' }}>
        {t('rule_add_cond')}
      </button>
    </div>
  );
};

// ── Rule creation panel ───────────────────────────────────────────────────────
const RuleCreator = ({ userId, locationId, onCreated }) => {
  const { t } = useLang();
  const [tab, setTab] = useState('template');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [selectedTpl, setSelectedTpl] = useState(null);
  const [tplValues, setTplValues] = useState({});
  const [custom, setCustom] = useState({ name: '', event_type: 'MANUAL_ALERT', severity: 'INFO', logic: 'AND', conditions: [blankCondition()], description: '' });

  const selectTemplate = (tpl) => { setSelectedTpl(tpl); setTplValues({ value: tpl.condition.value }); };

  const submitTemplate = async () => {
    if (!selectedTpl) return;
    setBusy(true);
    try {
      // Для бэкенда используем английское имя (из en.js), чтобы правило читалось независимо от языка
      await api.post(`${BASE_EVENTS}/rules/create`, { user_id: userId, location_id: locationId, name: t(selectedTpl.nameKey), event_type: selectedTpl.event_type, condition: { ...selectedTpl.condition, value: Number(tplValues.value) }, action: selectedTpl.action, is_active: true });
      setSuccess(true); setSelectedTpl(null);
      setTimeout(() => setSuccess(false), 3000);
      onCreated();
    } catch { alert(t('rule_err_create')); }
    finally { setBusy(false); }
  };

  const submitCustom = async () => {
    const invalid = custom.conditions.some(row => !row.metric || row.value === '');
    if (!custom.name || invalid) { alert(t('rule_err_required')); return; }
    setBusy(true);
    try {
      await api.post(`${BASE_EVENTS}/rules/create`, { user_id: userId, location_id: locationId, name: custom.name, event_type: custom.event_type, condition: buildConditionPayload(custom.logic, custom.conditions), action: { notify: true, severity: custom.severity }, is_active: true });
      setSuccess(true);
      setCustom({ name: '', event_type: 'MANUAL_ALERT', severity: 'INFO', logic: 'AND', conditions: [blankCondition()], description: '' });
      setTimeout(() => setSuccess(false), 3000);
      onCreated();
    } catch { alert(t('rule_err_create')); }
    finally { setBusy(false); }
  };

  const inp = (extra) => ({ padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13, fontFamily: 'inherit', outline: 'none', background: '#fff', ...extra });

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 0, marginBottom: 14, border: '1px solid #e0d8cf', borderRadius: 8, overflow: 'hidden', width: 'fit-content' }}>
        {[['template', t('rule_tab_template')], ['custom', t('rule_tab_custom')]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ padding: '7px 18px', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', background: tab === k ? 'var(--color-accent-soil, #6b4c2a)' : '#f5f0ea', color: tab === k ? '#fff' : '#888', transition: 'all 0.15s' }}>{l}</button>
        ))}
      </div>

      {success && (
        <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 8, padding: '8px 14px', fontSize: 13, color: '#1b5e20', marginBottom: 12 }}>
          {t('rule_created_ok')}
        </div>
      )}

      {tab === 'template' && (
        <div>
          {TEMPLATES.map(group => (
            <div key={group.groupKey} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{t(group.groupKey)}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {group.items.map(tpl => {
                  const active = selectedTpl?.nameKey === tpl.nameKey && selectedTpl?.event_type === tpl.event_type;
                  return (
                    <button key={tpl.nameKey + tpl.event_type} onClick={() => active ? setSelectedTpl(null) : selectTemplate(tpl)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, padding: '8px 12px', borderRadius: 8, cursor: 'pointer', border: active ? '2px solid var(--color-accent-soil, #6b4c2a)' : '1px solid #e0d8cf', background: active ? '#fdf6ed' : '#fafaf8', transition: 'all 0.15s', minWidth: 140, textAlign: 'left' }}>
                      <span style={{ fontSize: 16 }}>{tpl.icon}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#444' }}>{t(tpl.nameKey)}</span>
                      <span style={{ fontSize: 10, color: '#aaa', lineHeight: 1.3 }}>{t(tpl.descKey)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {selectedTpl && (
            <div style={{ background: '#fdf6ed', border: '1px solid #e0c89a', borderRadius: 10, padding: '14px 16px', marginTop: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#444', marginBottom: 10 }}>
                {selectedTpl.icon} {t('rule_configure', t(selectedTpl.nameKey))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13, color: '#666' }}>
                  {t('rule_when')} <strong style={{ color: '#444' }}>{selectedTpl.condition.metric?.replace(/_/g, ' ')}</strong>
                  {' '}<strong style={{ color: '#444' }}>{selectedTpl.condition.operator}</strong>
                </div>
                <input type="number" value={tplValues.value ?? selectedTpl.condition.value} onChange={e => setTplValues(v => ({ ...v, value: e.target.value }))} style={inp({ width: 90 })} />
                <button onClick={submitTemplate} disabled={busy} style={btnPrimary}>
                  {busy ? t('rule_creating') : t('rule_create_btn')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'custom' && (
        <div style={{ background: '#fafaf8', border: '1px solid #e0d8cf', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <label style={lbl}>
              {t('rule_custom_name')}
              <input value={custom.name} onChange={e => setCustom(c => ({ ...c, name: e.target.value }))} placeholder={t('rule_custom_ph')} style={inp({})} />
            </label>
            <label style={lbl}>
              {t('rule_event_type')}
              <select value={custom.event_type} onChange={e => setCustom(c => ({ ...c, event_type: e.target.value }))} style={inp({})}>
                {EVENT_TYPES.map(tp => <option key={tp} value={tp}>{tp.replace(/_/g, ' ')}</option>)}
              </select>
            </label>
            <label style={lbl}>
              {t('rule_severity')}
              <select value={custom.severity} onChange={e => setCustom(c => ({ ...c, severity: e.target.value }))} style={inp({})}>
                {['INFO','WARNING','ERROR','CRITICAL'].map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
            <div style={{ flexBasis: '100%' }}>
              <ConditionRows logic={custom.logic} setLogic={logic => setCustom(c => ({ ...c, logic }))} rows={custom.conditions} setRows={conditions => setCustom(c => ({ ...c, conditions: typeof conditions === 'function' ? conditions(c.conditions) : conditions }))} inp={inp} />
            </div>
          </div>
          <button onClick={submitCustom} disabled={busy} style={{ ...btnPrimary, marginTop: 14 }}>
            {busy ? t('rule_creating') : t('rule_create_custom')}
          </button>
        </div>
      )}
    </div>
  );
};

// ── Rules list ────────────────────────────────────────────────────────────────
const RulesList = ({ userId, refresh }) => {
  const { t } = useLang();
  const [rules, setRules]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [open, setOpen]         = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft]       = useState(null);

  const load = useCallback(() => {
    if (!userId) return;
    setLoading(true);
    api.get(`${BASE_EVENTS}/rules/user`).then(r => setRules(r.data)).catch(() => setRules([])).finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => { load(); }, [load, refresh]);

  const startEdit = (rule) => {
    const rows = conditionToRows(rule.condition);
    setEditingId(rule.id);
    setDraft({ name: rule.name, event_type: rule.event_type || 'MANUAL_ALERT', severity: rule.action?.severity || 'WARNING', is_active: rule.is_active, logic: rule.condition?.logic || 'AND', conditions: rows.length ? rows : [blankCondition()] });
  };

  const saveEdit = async (ruleId) => {
    const invalid = draft.conditions.some(row => !row.metric || row.value === '');
    if (!draft.name || invalid) { alert(t('rule_err_required')); return; }
    try {
      await api.patch(`${BASE_EVENTS}/rules/${ruleId}`, { name: draft.name, event_type: draft.event_type, condition: buildConditionPayload(draft.logic, draft.conditions), action: { notify: true, severity: draft.severity }, is_active: draft.is_active });
      setEditingId(null); setDraft(null); load();
    } catch { alert(t('rule_err_update')); }
  };

  const deleteRule = async (ruleId) => {
    if (!window.confirm(t('rule_delete_confirm'))) return;
    try {
      await api.delete(`${BASE_EVENTS}/rules/${ruleId}`, { params: { user_id: userId } });
      load();
    } catch { alert(t('rule_err_delete')); }
  };

  const inp = (extra) => ({ padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13, fontFamily: 'inherit', outline: 'none', background: '#fff', ...extra });

  return (
    <div style={{ marginBottom: 16 }}>
      <button onClick={() => { setOpen(v => !v); if (!open) load(); }} style={{ ...btnSecondary, marginBottom: open ? 10 : 0 }}>
        {open ? t('rules_hide') : t('rules_show')}
        {rules.length > 0 && <span style={{ marginLeft: 6, background: '#f0ebe3', color: '#888', borderRadius: 10, padding: '1px 7px', fontSize: 11 }}>{rules.length}</span>}
      </button>

      {open && (
        <div>
          {loading ? (
            <div style={{ color: '#bbb', fontSize: 13, padding: 10 }}>{t('rules_loading')}</div>
          ) : rules.length === 0 ? (
            <div style={{ color: '#bbb', fontSize: 13, padding: 10 }}>{t('rules_empty')}</div>
          ) : (
            rules.map(rule => {
              const isEditing = editingId === rule.id && draft;
              return (
                <div key={rule.id} style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', background: '#fafaf8', border: '1px solid #e0d8cf', borderRadius: 8, padding: '8px 12px', marginBottom: 6 }}>
                  {isEditing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
                        <label style={lbl}>
                          {t('rule_name_lbl')}
                          <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} style={inp({ minWidth: 180 })} />
                        </label>
                        <label style={lbl}>
                          {t('rule_event_type')}
                          <select value={draft.event_type} onChange={e => setDraft(d => ({ ...d, event_type: e.target.value }))} style={inp({})}>
                            {EVENT_TYPES.map(tp => <option key={tp} value={tp}>{tp.replace(/_/g, ' ')}</option>)}
                          </select>
                        </label>
                        <label style={lbl}>
                          {t('rule_severity')}
                          <select value={draft.severity} onChange={e => setDraft(d => ({ ...d, severity: e.target.value }))} style={inp({})}>
                            {['INFO','WARNING','ERROR','CRITICAL'].map(s => <option key={s}>{s}</option>)}
                          </select>
                        </label>
                        <label style={{ ...lbl, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                          <input type="checkbox" checked={draft.is_active} onChange={e => setDraft(d => ({ ...d, is_active: e.target.checked }))} />
                          {t('rule_active_lbl')}
                        </label>
                      </div>
                      <ConditionRows logic={draft.logic} setLogic={logic => setDraft(d => ({ ...d, logic }))} rows={draft.conditions} setRows={conditions => setDraft(d => ({ ...d, conditions: typeof conditions === 'function' ? conditions(d.conditions) : conditions }))} inp={inp} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => saveEdit(rule.id)} style={btnPrimary}>{t('rule_save')}</button>
                        <button onClick={() => { setEditingId(null); setDraft(null); }} style={btnSecondary}>{t('rule_cancel')}</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#444' }}>{rule.name}</span>
                          <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 700, background: rule.is_active ? '#e8f5e9' : '#f5f5f5', color: rule.is_active ? '#2e7d32' : '#9e9e9e', border: `1px solid ${rule.is_active ? '#a5d6a7' : '#e0e0e0'}` }}>
                            {rule.is_active ? t('rule_is_active') : t('rule_is_inactive')}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
                          {rule.event_type?.replace(/_/g, ' ')} - {describeCondition(rule.condition)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => startEdit(rule)} style={{ background: 'none', border: '1px solid #d7ccc8', color: '#6b4c2a', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>{t('rule_edit')}</button>
                        <button onClick={() => deleteRule(rule.id)} style={{ background: 'none', border: '1px solid #ffcdd2', color: '#e53935', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>{t('rule_delete')}</button>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

// ── Filter bar ────────────────────────────────────────────────────────────────
const FilterBar = ({ filter, setFilter }) => {
  const { t } = useLang();
  const statusOpts = ['ALL', ...STATUSES];
  const sevOpts = ['ALL', 'CRITICAL', 'ERROR', 'WARNING', 'INFO'];

  const statusLabel = (s) => {
    const key = `alert_status_${s.toLowerCase()}`;
    return t(key);
  };
  const sevLabel = (s) => {
    const key = `alert_sev_${s.toLowerCase()}`;
    return t(key);
  };

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 0, border: '1px solid #e0d8cf', borderRadius: 8, overflow: 'hidden' }}>
        {statusOpts.map(s => (
          <button key={s} onClick={() => setFilter(f => ({ ...f, status: s }))} style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer', background: filter.status === s ? 'var(--color-accent-soil,#6b4c2a)' : '#f5f0ea', color: filter.status === s ? '#fff' : '#888', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{statusLabel(s)}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 0, border: '1px solid #e0d8cf', borderRadius: 8, overflow: 'hidden' }}>
        {sevOpts.map(s => (
          <button key={s} onClick={() => setFilter(f => ({ ...f, severity: s }))} style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer', background: filter.severity === s ? 'var(--color-accent-soil,#6b4c2a)' : '#f5f0ea', color: filter.severity === s ? '#fff' : '#888', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{sevLabel(s)}</button>
        ))}
      </div>
    </div>
  );
};

// ── Main export ───────────────────────────────────────────────────────────────
const AlertsPanel = ({ userId, locationId }) => {
  const { t } = useLang();
  const [open, setOpen]       = useState(true);
  const [tab, setTab]         = useState('events');
  const [events, setEvents]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [rulesVer, setRulesVer] = useState(0);
  const [filter, setFilter]   = useState({ status: 'ACTIVE', severity: 'ALL' });
  const [lastPoll, setLastPoll] = useState(null);

  const loadEvents = useCallback(() => {
    if (!userId) return;
    setLoading(true);
    api.get(`${BASE_EVENTS}/user`).then(r => { setEvents(r.data); setLastPoll(new Date()); }).catch(() => setEvents([])).finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const pollRef = useRef(null);
  useEffect(() => {
    if (!userId) return;
    pollRef.current = setInterval(() => {
      api.get(`${BASE_EVENTS}/user`).then(r => { setEvents(r.data); setLastPoll(new Date()); }).catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => clearInterval(pollRef.current);
  }, [userId]);

  const filtered = events.filter(e => {
    if (filter.status !== 'ALL' && e.status !== filter.status) return false;
    if (filter.severity !== 'ALL' && e.severity !== filter.severity) return false;
    return true;
  });

  const activeCount   = events.filter(e => e.status === 'ACTIVE').length;
  const criticalCount = events.filter(e => e.severity === 'CRITICAL' && e.status === 'ACTIVE').length;

  return (
    <div style={panelWrap}>
      <div style={panelHead} onClick={() => setOpen(v => !v)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>🔔</span>
          <span style={titleStyle}>{t('alerts_title')}</span>
          {activeCount > 0 && (
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 700, background: criticalCount > 0 ? '#fce4ec' : '#fff8e1', color: criticalCount > 0 ? '#c62828' : '#e65100', border: `1px solid ${criticalCount > 0 ? '#ef9a9a' : '#ffcc02'}` }}>
              {t('alerts_active', activeCount)}{criticalCount > 0 ? ` ${t('alerts_critical', criticalCount)}` : ''}
            </span>
          )}
          {lastPoll && (
            <span style={{ fontSize: 10, color: '#ccc', marginLeft: 4 }}>
              {t('alerts_updated')} {lastPoll.toLocaleTimeString('hu-HU', { timeStyle: 'short' })}
            </span>
          )}
        </div>
        <span style={{ color: '#bbb', fontSize: 13 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={panelBody}>
          <div style={{ display: 'flex', gap: 0, marginBottom: 16, border: '1px solid #e0d8cf', borderRadius: 8, overflow: 'hidden', width: 'fit-content' }}>
            {[['events', t('alerts_tab_events')], ['rules', t('alerts_tab_rules')]].map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} style={{ padding: '7px 18px', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', background: tab === k ? 'var(--color-accent-soil, #6b4c2a)' : '#f5f0ea', color: tab === k ? '#fff' : '#888' }}>{l}</button>
            ))}
          </div>

          {tab === 'events' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 4 }}>
                <FilterBar filter={filter} setFilter={setFilter} />
                <button onClick={loadEvents} style={btnSecondary}>{t('alerts_refresh')}</button>
              </div>
              {loading ? (
                <div style={{ color: '#bbb', padding: 16, textAlign: 'center', fontSize: 13 }}>{t('alerts_loading')}</div>
              ) : filtered.length === 0 ? (
                <div style={{ color: '#bbb', padding: 16, textAlign: 'center', fontSize: 13 }}>
                  {events.length === 0 ? t('alerts_empty_all') : t('alerts_empty_filter')}
                </div>
              ) : (
                <div>{filtered.map(e => <AlertRow key={e.id} event={e} userId={userId} onStatusChange={loadEvents} />)}</div>
              )}
            </>
          )}

          {tab === 'rules' && (
            <>
              <div style={{ fontSize: 12, color: '#aaa', marginBottom: 12 }}>{t('rules_hint')}</div>
              <RuleCreator userId={userId} locationId={locationId} onCreated={() => setRulesVer(v => v + 1)} />
              <RulesList userId={userId} refresh={rulesVer} />
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default AlertsPanel;

const panelWrap  = { background: '#fff', borderRadius: 14, border: '1px solid var(--color-accent-soil)', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', overflow: 'hidden', marginBottom: 20 };
const panelHead  = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 20px', cursor: 'pointer', background: 'var(--color-bg-champagne)', borderBottom: '1px solid var(--color-accent-soil)', userSelect: 'none' };
const panelBody  = { padding: '16px 20px 20px' };
const titleStyle = { fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 15, color: 'var(--color-accent-chernozem)' };
const btnPrimary   = { background: 'var(--color-green-primary, #054e05)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
const btnSecondary = { background: '#eee', color: '#555', border: 'none', borderRadius: 6, padding: '7px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
const lbl = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.04em' };