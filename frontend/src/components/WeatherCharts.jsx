import { useState, useMemo } from 'react';
import { useLang } from '../context/LanguageContext';

const C = { green:'#317f43', soil:'#8b6340', mulberry:'#470736', sky:'#1a6fa3', amber:'#b87300', teal:'#1a7a6e', rose:'#b53060', slate:'#4a5568' };
const WRF_COLOR = '#7d3c98'; // distinct purple for the WRF forecast overlay

const timestampMs = (value) => {
  if (!value) return null;
  const raw = String(value);
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
};

const normalizeTimeSeries = (points = []) => {
  const byTime = new Map();
  points.forEach((p) => {
    const t = timestampMs(p.x);
    // Missing values must become a GAP, not a zero. Number(null) === 0, which
    // used to pass the finite check and plant false zeros — that was the
    // vertical "barcode". Drop null/undefined/'' so the line breaks instead.
    if (t == null || p.y == null || p.y === '') return;
    const y = Number(p.y);
    if (!Number.isFinite(y)) return;
    byTime.set(t, { x: new Date(t).toISOString(), y, t });
  });
  return Array.from(byTime.values()).sort((a, b) => a.t - b.t);
};

// Split an ascending-by-time series into contiguous runs, breaking wherever a
// time gap is much larger than the typical sampling step (i.e. data missing).
// Rendering each run as its own polyline yields a real break, not an
// interpolated line drawn across the gap.
const splitSegments = (pts, gapFactor = 1.8) => {
  if (pts.length < 2) return pts.length ? [pts] : [];
  const diffs = [];
  for (let i = 1; i < pts.length; i++) diffs.push(pts[i].t - pts[i - 1].t);
  const sorted = [...diffs].sort((a, b) => a - b);
  const medianStep = sorted[Math.floor(sorted.length / 2)] || Infinity;
  const segs = [[pts[0]]];
  for (let i = 1; i < pts.length; i++) {
    if (medianStep !== Infinity && diffs[i - 1] > medianStep * gapFactor) segs.push([pts[i]]);
    else segs[segs.length - 1].push(pts[i]);
  }
  return segs;
};

const computeSMA = (points, window) => {
  if (!window || window < 2 || points.length < 2) return [];
  return points.map((p, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = points.slice(start, i + 1);
    const avg = slice.reduce((s, pt) => s + pt.y, 0) / slice.length;
    return { ...p, y: avg };
  });
};

// ── MultiLineChart ────────────────────────────────────────────────────────────
// primary:   { points:[{x,y}], color, label, unit }
// secondary: { points:[{x,y}], color, label, unit } | null   — right (2nd) Y axis
// overlay:   { points:[{x,y}], color, label, unit } | null   — shares primary axis (e.g. WRF)
// smaWindow: 0 = off, >=2 = rolling window size
const MultiLineChart = ({ primary, secondary = null, overlay = null, smaWindow = 0, cursorIdx, onCursorChange, noDataLabel }) => {
  const validPrimary   = useMemo(() => normalizeTimeSeries(primary?.points   || []), [primary?.points]);   // eslint-disable-line
  const validSecondary = useMemo(() => normalizeTimeSeries(secondary?.points || []), [secondary?.points]); // eslint-disable-line
  const validOverlay   = useMemo(() => normalizeTimeSeries(overlay?.points   || []), [overlay?.points]);   // eslint-disable-line
  const smaPrimary     = useMemo(() => computeSMA(validPrimary,   smaWindow), [validPrimary,   smaWindow]);
  const smaSecondary   = useMemo(() => computeSMA(validSecondary, smaWindow), [validSecondary, smaWindow]);

  if (!validPrimary.length) return (
    <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 12 }}>
      {noDataLabel}
    </div>
  );

  const hasSecondary = secondary != null && validSecondary.length > 0;
  const hasOverlay   = overlay != null && validOverlay.length > 0;
  const W = 600, H = 160, padL = 44, padR = hasSecondary ? 48 : 14, padY = 14;
  const innerW = W - padL - padR, innerH = H - padY * 2 - 18;
  const now = Date.now();

  // Shared X range across all series
  const allTs = [...validPrimary.map(p => p.t), ...validSecondary.map(p => p.t), ...validOverlay.map(p => p.t)];
  const minT = Math.min(...allTs), maxT = Math.max(...allTs), rangeT = maxT - minT || 1;
  const sx = (p) => padL + ((p.t - minT) / rangeT) * innerW;

  // Primary Y scale — left axis. The overlay (e.g. WRF) shares this axis & unit,
  // so fold its values in so both fit.
  const ys1 = [...validPrimary.map(p => p.y), ...validOverlay.map(p => p.y)];
  const minY1 = Math.min(...ys1), maxY1 = Math.max(...ys1), rangeY1 = maxY1 - minY1 || 1;
  const sy1 = (v) => padY + (1 - (v - minY1) / rangeY1) * innerH;
  const yTicks1 = [minY1, minY1 + rangeY1 * 0.5, maxY1];

  // Secondary Y scale — right axis
  const ys2 = validSecondary.map(p => p.y);
  const minY2 = ys2.length ? Math.min(...ys2) : 0;
  const maxY2 = ys2.length ? Math.max(...ys2) : 1;
  const rangeY2 = maxY2 - minY2 || 1;
  const sy2 = (v) => padY + (1 - (v - minY2) / rangeY2) * innerH;
  const yTicks2 = hasSecondary ? [minY2, minY2 + rangeY2 * 0.5, maxY2] : [];

  // NOW marker
  let nowIdx = 0, bestNowDiff = Infinity;
  validPrimary.forEach((p, i) => { const d = Math.abs(p.t - now); if (d < bestNowDiff) { bestNowDiff = d; nowIdx = i; } });
  const nowX = sx(validPrimary[nowIdx]);

  // Cursor
  const curIdx  = cursorIdx != null ? Math.min(Math.max(0, cursorIdx), validPrimary.length - 1) : null;
  const curPt1  = curIdx != null ? validPrimary[curIdx] : null;
  const curX    = curPt1 ? sx(curPt1) : null;
  const curPt2  = (() => {
    if (!curPt1 || !validSecondary.length) return null;
    let best = validSecondary[0], bestD = Infinity;
    validSecondary.forEach(p => { const d = Math.abs(p.t - curPt1.t); if (d < bestD) { bestD = d; best = p; } });
    return best;
  })();
  const curPtOv = (() => {
    if (!curPt1 || !validOverlay.length) return null;
    let best = validOverlay[0], bestD = Infinity;
    validOverlay.forEach(p => { const d = Math.abs(p.t - curPt1.t); if (d < bestD) { bestD = d; best = p; } });
    return best;
  })();

  // X tick marks
  const step   = Math.max(1, Math.floor(validPrimary.length / 6));
  const xTicks = validPrimary.map((p, i) => ({ i, p })).filter(({ i }) => i % step === 0 || i === validPrimary.length - 1);

  // SVG path helpers
  const toPoly = (pts, syFn) => pts.map(p => `${sx(p)},${syFn(p.y)}`).join(' ');
  const toArea = (pts, syFn) => {
    if (!pts.length) return '';
    return `M${sx(pts[0])},${padY + innerH} ` + pts.map(p => `L${sx(p)},${syFn(p.y)}`).join(' ') + ` L${sx(pts[pts.length - 1])},${padY + innerH} Z`;
  };
  // Render a line as one <polyline> per contiguous run, so missing stretches
  // show as real breaks instead of a line interpolated across the gap.
  const renderLine = (pts, syFn, { color, width = 2, dashed = false, opacity = 1, keyPrefix }) =>
    splitSegments(pts).map((seg, i) => (
      <polyline key={`${keyPrefix}-${i}`} points={toPoly(seg, syFn)} fill="none"
        stroke={color} strokeWidth={width} strokeLinejoin="round" strokeLinecap="round"
        strokeDasharray={dashed ? '6 3' : undefined} opacity={opacity} />
    ));

  const handleClick = (e) => {
    if (!onCursorChange) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width * W;
    const frac = Math.max(0, Math.min(1, (relX - padL) / innerW));
    const clickedT = minT + frac * rangeT;
    let nearest = 0, nearestDiff = Infinity;
    validPrimary.forEach((p, i) => { const d = Math.abs(p.t - clickedT); if (d < nearestDiff) { nearest = i; nearestDiff = d; } });
    onCursorChange(nearest);
  };

  const gId1 = `grad_${(primary?.label || 'p').replace(/\W/g, '')}`;
  const gId2 = `grad2_${(secondary?.label || 's').replace(/\W/g, '')}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair' }} onClick={handleClick}>
      <defs>
        <linearGradient id={gId1} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={primary?.color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={primary?.color} stopOpacity="0" />
        </linearGradient>
        {hasSecondary && (
          <linearGradient id={gId2} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={secondary.color} stopOpacity="0.09" />
            <stop offset="100%" stopColor={secondary.color} stopOpacity="0" />
          </linearGradient>
        )}
      </defs>

      {/* Grid lines + left Y labels */}
      {yTicks1.map((v, i) => (
        <g key={i}>
          <line x1={padL} y1={sy1(v)} x2={W - padR} y2={sy1(v)} stroke="#ece6dd" strokeWidth="1" strokeDasharray="4 3" />
          <text x={padL - 5} y={sy1(v) + 3.5} textAnchor="end" fontSize="9" fill={primary?.color || '#bbb'} fontFamily="inherit">{v.toFixed(1)}</text>
        </g>
      ))}

      {/* Right Y labels for secondary */}
      {yTicks2.map((v, i) => (
        <text key={i} x={W - padR + 5} y={sy2(v) + 3.5} textAnchor="start" fontSize="9" fill={secondary?.color || '#bbb'} fontFamily="inherit">{v.toFixed(1)}</text>
      ))}

      {/* Past region */}
      <rect x={padL} y={padY} width={Math.max(0, nowX - padL)} height={innerH} fill="rgba(0,0,0,0.03)" />

      {/* Secondary area + dashed line (drawn first so primary sits on top) */}
      {hasSecondary && (
        <>
          <path d={toArea(validSecondary, sy2)} fill={`url(#${gId2})`} />
          {renderLine(validSecondary, sy2, { color: secondary.color, dashed: true, opacity: 0.9, keyPrefix: 'sec' })}
        </>
      )}

      {/* Overlay (e.g. WRF) — shares the primary/left axis; dashed line, no fill */}
      {hasOverlay && renderLine(validOverlay, sy1, { color: overlay.color, dashed: true, opacity: 0.85, keyPrefix: 'ov' })}

      {/* Primary area + solid line */}
      <path d={toArea(validPrimary, sy1)} fill={`url(#${gId1})`} />
      {renderLine(validPrimary, sy1, { color: primary?.color, keyPrefix: 'pri' })}

      {/* SMA overlays */}
      {smaPrimary.length > 0 && (
        <polyline points={toPoly(smaPrimary, sy1)} fill="none" stroke={primary?.color} strokeWidth="2" strokeDasharray="4 3" opacity="0.5" />
      )}
      {hasSecondary && smaSecondary.length > 0 && (
        <polyline points={toPoly(smaSecondary, sy2)} fill="none" stroke={secondary.color} strokeWidth="2" strokeDasharray="4 3" opacity="0.5" />
      )}

      {/* NOW line */}
      <line x1={nowX} y1={padY} x2={nowX} y2={padY + innerH} stroke="#e74c3c" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.85" />
      <rect x={nowX - 15} y={padY - 1} width={30} height={13} rx={4} fill="#e74c3c" />
      <text x={nowX} y={padY + 9} textAnchor="middle" fontSize="8" fill="#fff" fontWeight="800" fontFamily="inherit">NOW</text>

      {/* Cursor */}
      {curX != null && curPt1 && (() => {
        const dateStr = new Date(curPt1.x).toLocaleString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const entries = [
          { pt: curPt1, sy: sy1, color: primary?.color, unit: primary?.unit, label: primary?.label },
          ...(curPt2 && hasSecondary ? [{ pt: curPt2, sy: sy2, color: secondary.color, unit: secondary.unit, label: secondary.label }] : []),
          ...(curPtOv && hasOverlay ? [{ pt: curPtOv, sy: sy1, color: overlay.color, unit: overlay.unit, label: overlay.label }] : []),
        ];
        const tipW = 124, lineH = 14, tipH = 16 + entries.length * lineH;
        const tipX = Math.min(curX + 8, W - padR - tipW);
        const tipY = Math.max(padY + 2, sy1(curPt1.y) - tipH - 6);
        return (
          <g>
            <line x1={curX} y1={padY} x2={curX} y2={padY + innerH} stroke="#555" strokeWidth="1" strokeDasharray="3 2" opacity="0.35" />
            {entries.map(({ pt, sy, color }) => (
              <circle key={color} cx={sx(pt)} cy={sy(pt.y)} r={4} fill={color} stroke="#fff" strokeWidth="2" />
            ))}
            <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={6} fill="rgba(22,22,22,0.88)" />
            <text x={tipX + tipW / 2} y={tipY + 11} textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.6)" fontFamily="inherit">{dateStr}</text>
            {entries.map(({ pt, color, unit, label }, li) => (
              <text key={li} x={tipX + 8} y={tipY + 11 + (li + 1) * lineH} fontSize="9.5" fill={color} fontWeight="700" fontFamily="inherit">
                {label}: {Number(pt.y).toFixed(2)} {unit}
              </text>
            ))}
          </g>
        );
      })()}

      {/* End dots */}
      <circle cx={sx(validPrimary[validPrimary.length - 1])} cy={sy1(validPrimary[validPrimary.length - 1].y)} r={4} fill={primary?.color} stroke="#fff" strokeWidth="2" />
      {hasSecondary && (
        <circle cx={sx(validSecondary[validSecondary.length - 1])} cy={sy2(validSecondary[validSecondary.length - 1].y)} r={4} fill={secondary.color} stroke="#fff" strokeWidth="2" />
      )}
      {hasOverlay && (
        <circle cx={sx(validOverlay[validOverlay.length - 1])} cy={sy1(validOverlay[validOverlay.length - 1].y)} r={4} fill={overlay.color} stroke="#fff" strokeWidth="2" />
      )}

      {/* X tick labels */}
      {xTicks.map(({ p }) => (
        <text key={p.t} x={sx(p)} y={H - 2} textAnchor="middle" fontSize="9" fill="#bbb" fontFamily="inherit">
          {new Date(p.x).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' })}
        </text>
      ))}
    </svg>
  );
};

// ── Legend line SVG swatch ────────────────────────────────────────────────────
const LegendLine = ({ color, dashed = false }) => (
  <svg width="22" height="10" style={{ flexShrink: 0 }}>
    <line x1="0" y1="5" x2="22" y2="5" stroke={color} strokeWidth="2" strokeDasharray={dashed ? '6 3' : undefined} />
  </svg>
);

const RangeSlider = ({ value, max, color, onChange, labelLeft, labelRight }) => {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
      <span style={{ fontSize: 10, color: '#bbb', whiteSpace: 'nowrap', minWidth: 72 }}>{labelLeft}</span>
      <div style={{ flex: 1, position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 4, background: `linear-gradient(to right, ${color} ${pct}%, #e4ddd5 ${pct}%)`, pointerEvents: 'none' }} />
        <input type="range" min={0} max={max} value={value} onChange={e => onChange(Number(e.target.value))}
          style={{ width: '100%', appearance: 'none', background: 'transparent', cursor: 'pointer', position: 'relative', zIndex: 1 }} />
      </div>
      <span style={{ fontSize: 10, color: '#bbb', whiteSpace: 'nowrap', minWidth: 72, textAlign: 'right' }}>{labelRight}</span>
    </div>
  );
};

const Tab = ({ label, active, color, onClick }) => (
  <button onClick={onClick} style={{ padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer', transition: 'all 0.15s', background: active ? color : '#ede7df', color: active ? '#fff' : '#777', fontFamily: 'inherit' }}>
    {label}
  </button>
);

// ── WeatherCharts ─────────────────────────────────────────────────────────────
// data:       Open-Meteo series [{ timestamp, weather_data, metrics_data }]
// wrfWeather: WRF forecast (weather only) [{ timestamp, weather_data }] — shown
//             as a separate dashed overlay on weather variables, never on metrics.
const WeatherCharts = ({ data = [], wrfWeather = [] }) => {
  const { t } = useLang();
  const [open, setOpen]             = useState(true);
  const [active, setActive]         = useState('temp');
  const [secondary, setSecondary]   = useState(null);
  const [smaEnabled, setSmaEnabled] = useState(false);
  const [smaWindow, setSmaWindow]   = useState(7);
  const [showWrf, setShowWrf]       = useState(false);
  const [cursorIdx, setCursorIdx]   = useState(null);

  const WEATHER_TABS = [
    { key: 'temp',             label: t('wm_temp'),        unit: '°C',    color: C.rose,    src: 'weather' },
    { key: 'humidity',         label: t('wm_humidity'),    unit: '%',     color: C.sky,     src: 'weather' },
    { key: 'precipitation',    label: t('wm_precip'),      unit: 'mm',    color: C.teal,    src: 'weather' },
    { key: 'soil_moisture',    label: t('wm_soil_moist'),  unit: 'm³/m³', color: C.green,   src: 'weather' },
    { key: 'soil_temperature', label: t('wm_soil_temp'),   unit: '°C',    color: C.soil,    src: 'weather' },
    { key: 'wind_speed',       label: t('wm_wind_speed'),  unit: 'm/s',   color: C.slate,   src: 'weather' },
  ];
  const METRIC_TABS = [
    { key: 'gdd',           label: 'GDD',                unit: '°C·d',  color: C.amber,   src: 'metrics' },
    { key: 'rain_cum_30d',  label: t('wm_rain_30d'),     unit: 'mm',    color: C.sky,     src: 'metrics' },
    { key: 'et0',           label: 'ET₀',                unit: 'mm',    color: C.teal,    src: 'metrics' },
    { key: 'water_deficit', label: t('wm_water_def_7d'), unit: 'mm',    color: C.mulberry,src: 'metrics' },
    { key: 'rs_mj_m2_day',  label: t('wm_solar'),        unit: 'MJ/m²', color: C.amber,   src: 'metrics' },
  ];
  const ALL_TABS = [...WEATHER_TABS, ...METRIC_TABS];

  const cfg    = ALL_TABS.find(tb => tb.key === active)    || ALL_TABS[0];
  const secCfg = ALL_TABS.find(tb => tb.key === secondary) || null;

  const primaryPoints = useMemo(() =>
    data.map(row => ({ x: row.timestamp, y: cfg.src === 'weather' ? row.weather_data?.[cfg.key] : row.metrics_data?.[cfg.key] })),
    [data, cfg.key, cfg.src]); // eslint-disable-line

  const secondaryPoints = useMemo(() => {
    if (!secondary) return [];
    const sc = ALL_TABS.find(tb => tb.key === secondary);
    if (!sc) return [];
    return data.map(row => ({ x: row.timestamp, y: sc.src === 'weather' ? row.weather_data?.[sc.key] : row.metrics_data?.[sc.key] }));
  }, [data, secondary]); // eslint-disable-line

  // WRF forecast overlay — only for weather variables (WRF has no derived metrics).
  const wrfAvailable = cfg.src === 'weather' && wrfWeather.length > 0;
  const wrfPoints = useMemo(() =>
    wrfAvailable ? wrfWeather.map(row => ({ x: row.timestamp, y: row.weather_data?.[cfg.key] })) : [],
    [wrfWeather, cfg.key, wrfAvailable]); // eslint-disable-line
  const showWrfOverlay = showWrf && wrfAvailable;

  const validPrimary   = useMemo(() => normalizeTimeSeries(primaryPoints),   [primaryPoints]);
  const validSecondary = useMemo(() => normalizeTimeSeries(secondaryPoints),  [secondaryPoints]);

  // Stats for primary
  const vals  = validPrimary.map(p => p.y);
  const stats = vals.length ? {
    min:  Math.min(...vals).toFixed(2),
    max:  Math.max(...vals).toFixed(2),
    avg:  (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2),
    last: vals[vals.length - 1].toFixed(2),
  } : null;

  // Stats for secondary
  const secVals  = validSecondary.map(p => p.y);
  const secStats = secVals.length ? {
    min:  Math.min(...secVals).toFixed(2),
    max:  Math.max(...secVals).toFixed(2),
    avg:  (secVals.reduce((a, b) => a + b, 0) / secVals.length).toFixed(2),
    last: secVals[secVals.length - 1].toFixed(2),
  } : null;

  const sliderMax = Math.max(0, validPrimary.length - 1);
  const fmtLabel  = (p) => p ? new Date(p.x).toLocaleString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const cursorPoint = cursorIdx != null ? validPrimary[Math.min(cursorIdx, sliderMax)] : null;

  // Secondary value at cursor position
  const secCursorPoint = (() => {
    if (!cursorPoint || !validSecondary.length) return null;
    let best = validSecondary[0], bestD = Infinity;
    validSecondary.forEach(p => { const d = Math.abs(p.t - cursorPoint.t); if (d < bestD) { bestD = d; best = p; } });
    return best;
  })();

  const handleSetActive = (key) => {
    setActive(key);
    setCursorIdx(null);
    if (secondary === key) setSecondary(null);
  };

  return (
    <div style={wrap}>
      <div style={header} onClick={() => setOpen(v => !v)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>📈</span>
          <span style={titleStyle}>{t('wc_title')}</span>
          {data.length > 0 && <span style={metaBadge}>{t('wc_records', data.length)}</span>}
        </div>
        <span style={{ color: '#bbb', fontSize: 13 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={body}>
          {/* Primary variable selector */}
          <div style={tabSection}>
            <span style={groupLabel}>{t('wc_group_weather')}</span>
            <div style={tabRow}>
              {WEATHER_TABS.map(tb => (
                <Tab key={tb.key} label={tb.label} active={active === tb.key} color={tb.color} onClick={() => handleSetActive(tb.key)} />
              ))}
            </div>
          </div>
          <div style={{ ...tabSection, marginTop: 8 }}>
            <span style={groupLabel}>{t('wc_group_agro')}</span>
            <div style={tabRow}>
              {METRIC_TABS.map(tb => (
                <Tab key={tb.key} label={tb.label} active={active === tb.key} color={tb.color} onClick={() => handleSetActive(tb.key)} />
              ))}
            </div>
          </div>

          {/* Secondary variable selector */}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #e8e0d4' }}>
            <span style={groupLabel}>{t('wc_compare')}</span>
            <div style={tabRow}>
              {ALL_TABS.filter(tb => tb.key !== active).map(tb => (
                <button
                  key={tb.key}
                  onClick={() => setSecondary(s => s === tb.key ? null : tb.key)}
                  style={{
                    padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    border: `1px solid ${secondary === tb.key ? tb.color : '#ddd'}`,
                    background: secondary === tb.key ? tb.color : 'transparent',
                    color: secondary === tb.key ? '#fff' : '#999',
                    cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit',
                  }}
                >
                  {tb.label}
                </button>
              ))}
            </div>
          </div>

          {/* SMA controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#888', cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={smaEnabled} onChange={e => setSmaEnabled(e.target.checked)} />
              {t('wc_sma_trend')}
            </label>
            {smaEnabled && (
              <>
                <span style={{ fontSize: 11, color: '#bbb' }}>{t('wc_sma_window')}</span>
                <input type="range" min={3} max={30} value={smaWindow} onChange={e => setSmaWindow(Number(e.target.value))}
                  style={{ width: 90, cursor: 'pointer' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#666', minWidth: 26 }}>{smaWindow}d</span>
              </>
            )}
            {wrfAvailable && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: WRF_COLOR, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={showWrf} onChange={e => setShowWrf(e.target.checked)} />
                {t('wc_show_wrf')}
              </label>
            )}
          </div>

          <div style={chartBox}>
            {/* Legend row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: cfg.color }}>
                <LegendLine color={cfg.color} />
                {cfg.label} <span style={{ opacity: 0.6, fontSize: 10 }}>({cfg.unit})</span>
              </span>
              {secCfg && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: secCfg.color }}>
                  <LegendLine color={secCfg.color} dashed />
                  {secCfg.label} <span style={{ opacity: 0.6, fontSize: 10 }}>({secCfg.unit})</span>
                </span>
              )}
              {smaEnabled && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#888' }}>
                  <svg width="22" height="10" style={{ flexShrink: 0 }}>
                    <line x1="0" y1="5" x2="22" y2="5" stroke="#888" strokeWidth="2" strokeDasharray="4 3" opacity="0.6" />
                  </svg>
                  SMA {smaWindow}d
                </span>
              )}
              {showWrfOverlay && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: WRF_COLOR }}>
                  <LegendLine color={WRF_COLOR} dashed />
                  {cfg.label} <span style={{ opacity: 0.6, fontSize: 10 }}>(WRF)</span>
                </span>
              )}
              <span style={{ fontSize: 10, color: '#aaa', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                <svg width="18" height="8" style={{ flexShrink: 0 }}><line x1="0" y1="4" x2="18" y2="4" stroke="#e74c3c" strokeWidth="1.5" strokeDasharray="5 3"/></svg>
                {t('wc_now')}
              </span>
              <span style={{ fontSize: 10, color: '#aaa', display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="14" height="8" style={{ flexShrink: 0 }}><rect x="0" y="0" width="14" height="8" fill="rgba(0,0,0,0.07)" rx="2"/></svg>
                {t('wc_past')}
              </span>
            </div>

            {/* Stats rows */}
            {stats && (
              <div style={{ display: 'flex', gap: 16, marginBottom: secStats ? 4 : 8, flexWrap: 'wrap' }}>
                {[[t('wc_stat_min'), stats.min],[t('wc_stat_max'), stats.max],[t('wc_stat_avg'), stats.avg],[t('wc_stat_latest'), stats.last]].map(([k, v]) => (
                  <div key={k} style={statCol}>
                    <span style={statLbl}>{k}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>{v} <span style={{ fontSize: 10, fontWeight: 400, color: '#aaa' }}>{cfg.unit}</span></span>
                  </div>
                ))}
              </div>
            )}
            {secStats && secCfg && (
              <div style={{ display: 'flex', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
                {[[t('wc_stat_min'), secStats.min],[t('wc_stat_max'), secStats.max],[t('wc_stat_avg'), secStats.avg],[t('wc_stat_latest'), secStats.last]].map(([k, v]) => (
                  <div key={k} style={statCol}>
                    <span style={statLbl}>{k}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: secCfg.color }}>{v} <span style={{ fontSize: 10, fontWeight: 400, color: '#aaa' }}>{secCfg.unit}</span></span>
                  </div>
                ))}
              </div>
            )}

            <MultiLineChart
              primary={{ points: primaryPoints, color: cfg.color, label: cfg.label, unit: cfg.unit }}
              secondary={secCfg ? { points: secondaryPoints, color: secCfg.color, label: secCfg.label, unit: secCfg.unit } : null}
              overlay={showWrfOverlay ? { points: wrfPoints, color: WRF_COLOR, label: `${cfg.label} (WRF)`, unit: cfg.unit } : null}
              smaWindow={smaEnabled ? smaWindow : 0}
              cursorIdx={cursorIdx}
              onCursorChange={setCursorIdx}
              noDataLabel={t('wc_no_data')}
            />

            {validPrimary.length > 1 && (
              <>
                <RangeSlider
                  value={cursorIdx ?? sliderMax}
                  max={sliderMax}
                  color={cfg.color}
                  onChange={setCursorIdx}
                  labelLeft={fmtLabel(validPrimary[0])}
                  labelRight={fmtLabel(validPrimary[sliderMax])}
                />
                <div style={{ marginTop: 6, minHeight: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {cursorPoint ? (
                    <>
                      <span style={{ fontSize: 11, color: '#aaa' }}>{fmtLabel(cursorPoint)}</span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: cfg.color, background: `${cfg.color}18`, borderRadius: 6, padding: '1px 10px' }}>
                        {Number(cursorPoint.y).toFixed(2)}
                        <span style={{ fontSize: 10, fontWeight: 400, color: '#aaa', marginLeft: 3 }}>{cfg.unit}</span>
                      </span>
                      {secCursorPoint && secCfg && (
                        <span style={{ fontSize: 14, fontWeight: 800, color: secCfg.color, background: `${secCfg.color}18`, borderRadius: 6, padding: '1px 10px' }}>
                          {Number(secCursorPoint.y).toFixed(2)}
                          <span style={{ fontSize: 10, fontWeight: 400, color: '#aaa', marginLeft: 3 }}>{secCfg.unit}</span>
                        </span>
                      )}
                    </>
                  ) : (
                    <span style={{ fontSize: 11, color: '#ccc' }}>{t('wc_inspect_hint')}</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default WeatherCharts;

const wrap       = { background: '#fff', borderRadius: 14, border: '1px solid var(--color-accent-soil)', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', overflow: 'hidden', marginBottom: 20 };
const header     = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 20px', cursor: 'pointer', background: 'var(--color-bg-champagne)', borderBottom: '1px solid var(--color-accent-soil)', userSelect: 'none' };
const titleStyle = { fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 15, color: 'var(--color-accent-chernozem)' };
const metaBadge  = { fontSize: 11, color: '#aaa', background: '#f0ebe3', borderRadius: 10, padding: '2px 8px' };
const body       = { padding: '16px 20px 20px' };
const tabSection = {};
const groupLabel = { display: 'block', fontSize: 10, fontWeight: 700, color: '#ccc', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 };
const tabRow     = { display: 'flex', gap: 6, flexWrap: 'wrap' };
const chartBox   = { marginTop: 14, background: 'var(--color-bg-champagne)', borderRadius: 10, padding: '13px 15px', border: '1px solid #ece6dc' };
const statCol    = { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' };
const statLbl    = { fontSize: 9, color: '#ccc', textTransform: 'uppercase', letterSpacing: '0.05em' };
