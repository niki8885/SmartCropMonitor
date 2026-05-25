import { useState, useEffect, useRef } from 'react';
import api from './api/client';
import { getCurrentWeather, getWeatherHistory, getWeatherMetrics } from './api/weather';
import { useFontSize } from './context/FontSizeContext';
import { useLang } from './context/LanguageContext';
import AlertsPanel from './components/AlertsPanel';
import TasksPanel from './components/TasksPanel';
import FieldWorkPanel from './components/FieldWorkPanel';
import FieldsPanel from './components/FieldsPanel';
import PasturePanel from './components/PasturePanel';
import SensorPanel from './components/SensorPanel';
import WeatherCharts from './components/WeatherCharts';
import WeatherMetricsPanel from './components/WeatherMetricsPanel';
import SprayingWindowsPanel from './components/SprayingWindowsPanel';
import FieldMapPanel from './components/FieldMapPanel';
import AddLocationModal from './components/AddLocationModal';
import SegmentationModal from './components/SegmentationModal';
import ManualFieldModal from './components/ManualFieldModal';
import MorningBriefingPanel from './components/MorningBriefingPanel';
import EgnReportPanel from './components/EgnReportPanel';
import logo from './assets/logo1.png';

// ── Tab definitions ──────────────────────────────────────────────────────────
const TABS = [
  { id: 'overview',   labelKey: 'tab_overview',   icon: '🌱' },
  { id: 'weather',    labelKey: 'tab_weather',     icon: '🌦' },
  { id: 'fields',     labelKey: 'tab_fields',      icon: '🗺️' },
  { id: 'fieldwork',  labelKey: 'tab_fieldwork',   icon: '🚜' },
  { id: 'farm',       labelKey: 'tab_farm',        icon: '🏡' },
  { id: 'egn',        labelKey: 'tab_egn',         icon: '📄' },
  { id: 'tasks',      labelKey: 'tab_tasks',       icon: '✅' },
  { id: 'sensors',    labelKey: 'tab_sensors',     icon: '📡' },
];

// ── Compact weather badge ────────────────────────────────────────────────────
const WeatherBadge = ({ currentWeather, t }) => {
  if (!currentWeather) return (
    <div style={styles.weatherBadge}>
      <span style={{ color: '#aaa', fontSize: 13 }}>{t('no_weather')}</span>
    </div>
  );
  return (
    <div style={styles.weatherBadge}>
      <span style={{ fontSize: 22, fontWeight: 700 }}>{currentWeather.temp}°C</span>
      <span style={{ fontSize: 13, opacity: 0.75, marginLeft: 8 }}>{currentWeather.weather_main}</span>
      <span style={{ fontSize: 12, opacity: 0.55, marginLeft: 8 }}>
        💧{currentWeather.humidity}% · 💨{currentWeather.wind_speed} m/s
      </span>
    </div>
  );
};

// ── Two-column layout: panels left, map right ────────────────────────────────
const TwoColumnLayout = ({ left, mapProps }) => (
  <div style={styles.twoCol}>
    <div style={styles.leftCol}>{left}</div>
    <div style={styles.rightCol}>
      <FieldMapPanel
        ref={mapProps.ref}
        userId={mapProps.userId}
        locationId={mapProps.locationId}
        locationCenter={mapProps.locationCenter}
        onAddLocation={mapProps.onAddLocation}
        onDrawField={mapProps.onDrawField}
        onSegment={mapProps.onSegment}
        segmentationStatus={mapProps.segmentationStatus}
      />
    </div>
  </div>
);

// ── Full-width layout (no map) ───────────────────────────────────────────────
const FullLayout = ({ children }) => (
  <div style={{ maxWidth: 900 }}>{children}</div>
);

// ══════════════════════════════════════════════════════════════════════════════
// FARM PROFILE PANEL  (eGN 3.1)
// ══════════════════════════════════════════════════════════════════════════════

const SOIL_TYPES = [
  'Sandy','Sandy loam','Loam','Silt loam','Silt','Clay loam','Silty clay loam',
  'Sandy clay','Silty clay','Clay','Peat','Chernozem','Rendzina','Other',
];

const SOIL_TEXTURES = [
  'Coarse','Medium','Fine','Very fine','Organic',
];

const FarmProfilePanel = ({ userId }) => {
  const [profile, setProfile]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [editing, setEditing]   = useState(false);
  const [busy, setBusy]         = useState(false);
  const [form, setForm]         = useState({});
  const set = (k, v) => setForm(f => ({...f, [k]: v}));

  useEffect(() => {
    if (!userId) return;
    api.get(`/api/v1/auth/user/${userId}`)
      .then(r => { setProfile(r.data); setForm(r.data); })
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [userId]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.patch(`/api/v1/auth/user/${userId}`, {
        email:           form.email        || null,
        first_name:      form.first_name   || null,
        last_name:       form.last_name    || null,
        phone:           form.phone        || null,
        country:         form.country      || null,
        city:            form.city         || null,
        farm_name:       form.farm_name    || null,
        farm_size_ha:    form.farm_size_ha    ? Number(form.farm_size_ha)    : null,
        farm_reg_number: form.farm_reg_number || null,
        farm_owner_name: form.farm_owner_name || null,
        farm_operator:   form.farm_operator   || null,
      });
      setProfile(res.data);
      setEditing(false);
    } catch { alert('Failed to save profile'); }
    finally { setBusy(false); }
  };

  if (loading) return <EmptyState text="Loading farm profile…"/>;

  const inp = {
    padding: '7px 10px', borderRadius: 6, border: '1px solid #ddd',
    fontSize: 13, fontFamily: 'inherit', outline: 'none', background: '#fff',
    width: '100%',
  };
  const lbl = {
    display: 'flex', flexDirection: 'column', gap: 4,
    fontSize: 10, fontWeight: 700, color: '#aaa',
    textTransform: 'uppercase', letterSpacing: '0.04em',
  };

  // ── read-only view ─────────────────────────────────────────────────────────
  if (!editing) {
    const fields = [
      { section: '🏡 Farm identity', items: [
        ['Farm name',             profile?.farm_name],
        ['Registered area',       profile?.farm_size_ha ? `${profile.farm_size_ha} ha` : null],
        ['Registration number',   profile?.farm_reg_number],
        ['Legal owner',           profile?.farm_owner_name],
        ['Operator',              profile?.farm_operator],
      ]},
      { section: '👤 Contact', items: [
        ['First name',  profile?.first_name],
        ['Last name',   profile?.last_name],
        ['Email',       profile?.email],
        ['Phone',       profile?.phone],
        ['Country',     profile?.country],
        ['City',        profile?.city],
      ]},
    ];

    return (
      <div style={{ background:'#fff', borderRadius:14, border:'1px solid var(--color-accent-soil)',
        boxShadow:'0 2px 10px rgba(0,0,0,0.05)', overflow:'hidden', marginBottom:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
          padding:'13px 20px', background:'var(--color-bg-champagne)',
          borderBottom:'1px solid var(--color-accent-soil)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:18 }}>🏡</span>
            <span style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:15,
              color:'var(--color-accent-chernozem)' }}>
              Farm Profile
            </span>
            <span style={{ fontSize:11, color:'#aaa', background:'#f0ebe3', borderRadius:10,
              padding:'2px 8px' }}>eGN 3.1</span>
          </div>
          <button onClick={() => setEditing(true)} style={{
            background:'var(--color-accent-soil,#6b4c2a)', color:'#fff', border:'none',
            borderRadius:8, padding:'6px 14px', fontWeight:700, fontSize:12, cursor:'pointer' }}>
            ✏️ Edit
          </button>
        </div>

        <div style={{ padding:'20px' }}>
          {fields.map(({ section, items }) => (
            <div key={section} style={{ marginBottom:20 }}>
              <div style={{ fontSize:10, fontWeight:700, color:'#aaa', textTransform:'uppercase',
                letterSpacing:'0.07em', marginBottom:10 }}>{section}</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:8 }}>
                {items.map(([k, v]) => (
                  <div key={k} style={{ background:'#fafaf8', borderRadius:8, padding:'10px 12px',
                    border:'1px solid #ede7df' }}>
                    <div style={{ fontSize:10, color:'#aaa', fontWeight:700, marginBottom:2 }}>{k}</div>
                    <div style={{ fontSize:13, color: v ? '#333' : '#ccc', fontWeight: v ? 600 : 400 }}>
                      {v || '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* eGN compliance checklist */}
          <EgnComplianceCard profile={profile}/>
        </div>
      </div>
    );
  }

  // ── edit form ──────────────────────────────────────────────────────────────
  return (
    <div style={{ background:'#fff', borderRadius:14, border:'1px solid var(--color-accent-soil)',
      boxShadow:'0 2px 10px rgba(0,0,0,0.05)', overflow:'hidden', marginBottom:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
        padding:'13px 20px', background:'var(--color-bg-champagne)',
        borderBottom:'1px solid var(--color-accent-soil)' }}>
        <div style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:15,
          color:'var(--color-accent-chernozem)' }}>✏️ Edit Farm Profile</div>
        <button onClick={() => setEditing(false)} style={{ background:'none',
          border:'1px solid #e0d8cf', borderRadius:6, padding:'5px 12px',
          fontSize:12, cursor:'pointer', color:'#888' }}>Cancel</button>
      </div>

      <div style={{ padding:'20px' }}>

        {/* eGN 3.1 Farm registration */}
        <SectionTitle>🏡 Farm identity &amp; registration (eGN 3.1)</SectionTitle>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))', gap:12, marginBottom:20 }}>
          <label style={lbl}>Farm name
            <input value={form.farm_name||''} onChange={e=>set('farm_name',e.target.value)} style={inp}/>
          </label>
          <label style={lbl}>Registered area (ha)
            <input type="number" value={form.farm_size_ha||''} onChange={e=>set('farm_size_ha',e.target.value)} style={inp}/>
          </label>
          <label style={lbl}>Registration / EORI number
            <input value={form.farm_reg_number||''} onChange={e=>set('farm_reg_number',e.target.value)} style={inp}
              placeholder="national / EORI reg. number"/>
          </label>
          <label style={lbl}>Legal owner name
            <input value={form.farm_owner_name||''} onChange={e=>set('farm_owner_name',e.target.value)} style={inp}
              placeholder="if different from account holder"/>
          </label>
          <label style={lbl}>Operator name
            <input value={form.farm_operator||''} onChange={e=>set('farm_operator',e.target.value)} style={inp}/>
          </label>
        </div>

        {/* Contact */}
        <SectionTitle>👤 Contact information</SectionTitle>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:12, marginBottom:24 }}>
          {[
            ['First name',  'first_name'],
            ['Last name',   'last_name'],
            ['Email',       'email'],
            ['Phone',       'phone'],
            ['Country',     'country'],
            ['City',        'city'],
          ].map(([label, key]) => (
            <label key={key} style={lbl}>{label}
              <input value={form[key]||''} onChange={e=>set(key,e.target.value)} style={inp}/>
            </label>
          ))}
        </div>

        <div style={{ display:'flex', gap:10 }}>
          <button onClick={save} disabled={busy} style={{
            background:'var(--color-green-primary,#054e05)', color:'#fff', border:'none',
            borderRadius:6, padding:'8px 20px', fontWeight:700, fontSize:13, cursor:'pointer',
            fontFamily:'inherit', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Saving…' : '💾 Save Profile'}
          </button>
          <button onClick={() => setEditing(false)} style={{
            background:'none', border:'1px solid #ddd', borderRadius:6,
            padding:'8px 16px', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

// ── eGN compliance indicator ──────────────────────────────────────────────────
const EgnComplianceCard = ({ profile }) => {
  if (!profile) return null;
  const checks = [
    { label: 'Farm name',            ok: !!profile.farm_name,        required: true  },
    { label: 'Registered area (ha)', ok: !!profile.farm_size_ha,     required: true  },
    { label: 'Registration number',  ok: !!profile.farm_reg_number,  required: false },
    { label: 'Legal owner',          ok: !!profile.farm_owner_name,  required: false },
    { label: 'Operator name',        ok: !!profile.farm_operator,    required: false },
    { label: 'Contact email',        ok: !!profile.email,            required: false },
    { label: 'Country / city',       ok: !!(profile.country && profile.city), required: false },
  ];
  const reqMissing = checks.filter(c => c.required && !c.ok);
  const score = Math.round(checks.filter(c => c.ok).length / checks.length * 100);
  const color = score >= 80 ? '#2e7d32' : score >= 50 ? '#f57f17' : '#c62828';

  return (
    <div style={{ background:'#fafaf8', borderRadius:10, border:'1px solid #ede7df',
      padding:'14px 16px', marginTop:4 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
        <span style={{ fontSize:15 }}>📋</span>
        <span style={{ fontSize:12, fontWeight:700, color:'#555' }}>eGN 3.1 completeness</span>
        <span style={{ fontWeight:800, fontSize:14, color, marginLeft:'auto' }}>{score}%</span>
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
        {checks.map(c => (
          <div key={c.label} style={{ display:'flex', alignItems:'center', gap:5, fontSize:11,
            background:'#fff', borderRadius:6, padding:'3px 9px',
            border:`1px solid ${c.ok ? '#a5d6a7' : c.required ? '#ef9a9a' : '#e0e0e0'}`,
            color: c.ok ? '#2e7d32' : c.required ? '#c62828' : '#9e9e9e' }}>
            <span>{c.ok ? '✓' : c.required ? '!' : '○'}</span>
            {c.label}
          </div>
        ))}
      </div>
      {reqMissing.length > 0 && (
        <div style={{ marginTop:10, fontSize:11, color:'#c62828', background:'#fce4ec',
          borderRadius:6, padding:'6px 10px', border:'1px solid #ef9a9a' }}>
          ⚠️ Required for eGN compliance: {reqMissing.map(c=>c.label).join(', ')}
        </div>
      )}
    </div>
  );
};

const SectionTitle = ({ children }) => (
  <div style={{ fontSize:11, fontWeight:700, color:'#6b4c2a', textTransform:'uppercase',
    letterSpacing:'0.06em', marginBottom:10, marginTop:4,
    paddingBottom:6, borderBottom:'1px solid #ede7df' }}>
    {children}
  </div>
);

const EmptyState = ({ text }) => (
  <div style={{ color:'#ccc', textAlign:'center', padding:'32px 0', fontSize:13 }}>{text}</div>
);

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════
const Dashboard = ({ userId, onLogout }) => {
  const { largeFonts, toggleFonts } = useFontSize();
  const { t, lang, setLang } = useLang();

  const [activeTab, setActiveTab]           = useState('overview');
  const [locations, setLocations]           = useState([]);
  const [locationId, setLocationId]         = useState(null);
  const [locationCenter, setLocationCenter] = useState(null);
  const [currentWeather, setCurrentWeather] = useState(null);
  const [latestWeather, setLatestWeather]   = useState(null);
  const [chartData, setChartData]           = useState([]);
  const [loading, setLoading]               = useState(true);
  const [showAddLocation, setShowAddLocation]       = useState(false);
  const [showSegmentation, setShowSegmentation]     = useState(false);
  const [showManualField, setShowManualField]       = useState(false);
  const [segmentationStatus, setSegmentationStatus] = useState(null);
  const fieldMapRef = useRef(null);

  const mapProps = {
    ref: fieldMapRef,
    userId,
    locationId,
    locationCenter,
    onAddLocation: () => setShowAddLocation(true),
    onDrawField:   () => setShowManualField(true),
    onSegment:     () => setShowSegmentation(true),
    segmentationStatus,
  };

  const fetchLocations = () => {
    if (!userId) return;
    setLoading(true);
    return api.get('/api/v1/user/locations', { params: { user_id: userId } })
      .then(res => {
        setLocations(res.data);
        if (res.data.length > 0 && !locationId) setLocationId(res.data[0].id);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchLocations(); }, [userId]); // eslint-disable-line

  useEffect(() => {
    if (!locationId || locations.length === 0) return;
    const loc = locations.find(l => l.id === locationId);
    if (loc?.lat != null && loc?.lon != null) setLocationCenter({ lat: loc.lat, lon: loc.lon });
  }, [locationId, locations]);

  useEffect(() => {
    if (!userId || !locationId) return;
    getCurrentWeather(locationId, userId).then(setCurrentWeather).catch(() => setCurrentWeather(null));
    getWeatherHistory(locationId, userId).then(setLatestWeather).catch(() => setLatestWeather(null));
    getWeatherMetrics(locationId, userId).then(setChartData).catch(() => setChartData([]));
  }, [locationId, userId]);

  const handleLocationAdded = (newLocation) => {
    setShowAddLocation(false);
    fetchLocations().then(() => { if (newLocation?.id) setLocationId(newLocation.id); });
  };

  const handleSegmentationConfirmed = () => {
    setShowSegmentation(false);
    setSegmentationStatus('done');
    fieldMapRef.current?.refreshFields?.();
    setTimeout(() => setSegmentationStatus(null), 4000);
  };

  if (loading) return <div style={styles.container}>{t('loading')}</div>;

  // ── Tab content ────────────────────────────────────────────────────────────
  const renderTabContent = () => {
    switch (activeTab) {

      case 'overview':
        return (
          <TwoColumnLayout mapProps={mapProps} left={
            <>
              <MorningBriefingPanel userId={userId} locationId={locationId} chartData={chartData}/>
              <AlertsPanel userId={userId} locationId={locationId}/>
              <TasksPanel userId={userId}/>
            </>
          }/>
        );

      case 'weather':
        return (
          <TwoColumnLayout mapProps={mapProps} left={
            <>
              <WeatherMetricsPanel latestWeather={latestWeather} userId={userId} locationId={locationId}/>
              <WeatherCharts data={chartData}/>
              <SprayingWindowsPanel userId={userId} locationId={locationId}/>
            </>
          }/>
        );

      case 'fields':
        return (
          <TwoColumnLayout mapProps={mapProps} left={
            <>
              <FieldsPanel userId={userId} locationId={locationId}/>
              <PasturePanel userId={userId} locationId={locationId}/>
            </>
          }/>
        );

      case 'fieldwork':
        return (
          <TwoColumnLayout mapProps={mapProps} left={
            <FieldWorkPanel userId={userId} locationId={locationId}/>
          }/>
        );

      // ── NEW: Farm profile ──────────────────────────────────────────────────
      case 'farm':
        return (
          <FullLayout>
            <FarmProfilePanel userId={userId}/>
          </FullLayout>
        );

      case 'egn':
        return (
          <FullLayout>
            <EgnReportPanel userId={userId}/>
          </FullLayout>
        );

      case 'tasks':
        return (
          <TwoColumnLayout mapProps={mapProps} left={
            <>
              <TasksPanel userId={userId}/>
              <AlertsPanel userId={userId} locationId={locationId}/>
            </>
          }/>
        );

      case 'sensors':
        return (
          <TwoColumnLayout mapProps={mapProps} left={
            <>
              <SensorPanel userId={userId}/>
              <WeatherMetricsPanel latestWeather={latestWeather} userId={userId} locationId={locationId}/>
            </>
          }/>
        );

      default:
        return null;
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={styles.container}>

      {/* ── Header ── */}
      <header style={styles.header}>

        <div style={styles.branding}>
          <img src={logo} style={{ width: 36 }} alt="logo"/>
          <h1 style={{ fontFamily: 'var(--font-heading)', margin: 0, fontSize: 18, whiteSpace: 'nowrap' }}>
            SmartCrop Monitor
          </h1>
        </div>

        <div style={styles.locationRow}>
          {locations.length > 0 ? (
            <div style={styles.locationSelector}>
              <label style={styles.label}>{t('location_label')}</label>
              <select
                value={locationId || ''}
                onChange={e => setLocationId(Number(e.target.value))}
                style={styles.select}
              >
                {locations.map(loc => (
                  <option key={loc.id} value={loc.id}>
                    {loc.label || t('location_fallback', loc.id)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div style={{ color: 'red', fontSize: 13 }}>{t('no_locations')}</div>
          )}
        </div>

        <WeatherBadge currentWeather={currentWeather} t={t}/>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <select value={lang} onChange={e => setLang(e.target.value)} style={styles.langSelect}>
            <option value="hu">🇭🇺 Magyar</option>
            <option value="en">🇬🇧 English</option>
            <option value="fr">🇫🇷 Français</option>
            <option value="de">🇩🇪 Deutsch</option>
          </select>

          <button
            onClick={toggleFonts}
            title={largeFonts ? t('font_switch_to_normal') : t('font_switch_to_large')}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: largeFonts ? 'var(--color-accent-chernozem)' : '#f0ebe3',
              color: largeFonts ? '#fff' : 'var(--color-accent-chernozem)',
              border: `1px solid ${largeFonts ? 'var(--color-accent-chernozem)' : 'var(--color-accent-soil)'}`,
              borderRadius: 8, padding: '6px 10px',
              cursor: 'pointer', fontWeight: 700, fontSize: 12,
              fontFamily: 'inherit', transition: 'all 0.2s',
            }}>
            <span style={{ fontSize: largeFonts ? 16 : 13 }}>A</span>
            <span style={{ fontSize: 10 }}>A</span>
          </button>

          <button onClick={onLogout} style={styles.logoutBtn}>{t('logout')}</button>
        </div>
      </header>

      {/* ── Tab navigation ── */}
      <nav style={styles.tabNav}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...styles.tabBtn,
              ...(activeTab === tab.id ? styles.tabBtnActive : {}),
            }}>
            <span style={{ fontSize: 16 }}>{tab.icon}</span>
            <span>{t(tab.labelKey) || tab.labelKey}</span>
          </button>
        ))}
      </nav>

      {/* ── Tab content ── */}
      <div style={styles.content}>
        {renderTabContent()}
      </div>

      {/* ── Modals ── */}
      {showAddLocation && (
        <AddLocationModal userId={userId} onClose={() => setShowAddLocation(false)} onSaved={handleLocationAdded}/>
      )}

      {showManualField && locationId && (
        <ManualFieldModal
          userId={userId} locationId={locationId}
          onClose={() => setShowManualField(false)}
          onSaved={() => { setShowManualField(false); fieldMapRef.current?.refreshFields?.(); }}
        />
      )}

      {showSegmentation && locationId && (
        <SegmentationModal
          userId={userId} locationId={locationId}
          onClose={() => setShowSegmentation(false)}
          onConfirmed={handleSegmentationConfirmed}
        />
      )}
    </div>
  );
};

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  container: {
    backgroundColor: 'var(--color-bg-champagne)',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
  },

  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 20px',
    borderBottom: '1px solid var(--color-accent-soil)',
    backgroundColor: 'var(--color-bg-magnolia)',
    flexWrap: 'wrap',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  branding: {
    display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
  },
  locationRow: {
    display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1, minWidth: 0,
  },
  locationSelector: {
    display: 'flex', alignItems: 'center',
    backgroundColor: 'var(--color-bg-champagne)',
    padding: '4px 10px', borderRadius: 8,
    border: '1px solid var(--color-accent-soil)',
  },
  label: {
    marginRight: 8, fontWeight: 'bold',
    color: 'var(--color-accent-chernozem)', fontSize: 12, whiteSpace: 'nowrap',
  },
  select: {
    padding: '5px 8px', borderRadius: 6,
    border: '1px solid var(--color-accent-soil)',
    cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, background: 'transparent',
  },

  weatherBadge: {
    display: 'flex', alignItems: 'center',
    background: 'var(--color-bg-champagne)',
    border: '1px solid var(--color-accent-soil)',
    borderRadius: 8, padding: '5px 14px', flexShrink: 0, gap: 4,
  },

  tabNav: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '8px 20px 0',
    borderBottom: '2px solid var(--color-accent-soil)',
    backgroundColor: 'var(--color-bg-magnolia)',
    flexWrap: 'wrap',
  },
  tabBtn: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 16px 10px',
    border: 'none', background: 'transparent', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
    color: 'var(--color-accent-chernozem)',
    opacity: 0.6,
    borderBottom: '2px solid transparent',
    marginBottom: -2,
    borderRadius: '6px 6px 0 0',
    transition: 'opacity 0.15s, background 0.15s',
  },
  tabBtnActive: {
    opacity: 1,
    background: 'var(--color-bg-champagne)',
    borderBottom: '2px solid var(--color-accent-chernozem)',
    color: 'var(--color-accent-chernozem)',
  },

  content: { flex: 1, padding: '16px 20px', overflowY: 'auto' },

  twoCol: {
    display: 'grid', gridTemplateColumns: '1fr 1fr',
    gap: 16, alignItems: 'start',
  },
  leftCol:  { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 },
  rightCol: { position: 'sticky', top: 8, minWidth: 0 },

  logoutBtn: {
    background: 'var(--color-accent-mulberry)',
    color: '#fff', border: 'none', padding: '6px 14px',
    borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap',
  },
  langSelect: {
    padding: '6px 8px', borderRadius: 8,
    border: '1px solid var(--color-accent-soil)',
    background: '#f0ebe3', color: 'var(--color-accent-chernozem)',
    cursor: 'pointer', fontSize: 12, fontWeight: 700,
    fontFamily: 'inherit', outline: 'none',
  },
};

export default Dashboard;