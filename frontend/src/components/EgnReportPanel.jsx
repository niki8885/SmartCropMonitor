import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

const BASE = '/api/v1/egn';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtHa   = v => v != null ? `${Number(v).toFixed(1)} ha` : '—';
const fmtTon  = v => v != null ? `${Number(v).toFixed(2)} t`  : '—';
const curYear = new Date().getFullYear();

// ── UI atoms ──────────────────────────────────────────────────────────────────
const Sec = ({ children }) => (
  <div style={{ fontSize:10, fontWeight:700, color:'#aaa', textTransform:'uppercase',
    letterSpacing:'0.07em', marginBottom:8, marginTop:2 }}>{children}</div>
);

const Card = ({ icon, label, value, sub, color='#6b4c2a' }) => (
  <div style={{ flex:'1 1 110px', background:'#fff', borderRadius:10,
    padding:'11px 14px', border:'1px solid #e8e0d8', borderLeft:`4px solid ${color}` }}>
    <div style={{ fontSize:16, marginBottom:2 }}>{icon}</div>
    <div style={{ fontSize:9, color:'#aaa', fontWeight:700, marginBottom:1 }}>{label}</div>
    <div style={{ fontSize:17, fontWeight:800, color:'#333' }}>{value}</div>
    {sub && <div style={{ fontSize:10, color:'#bbb', marginTop:1 }}>{sub}</div>}
  </div>
);

const ScoreBadge = ({ score, status }) => {
  const cfg = {
    READY:      { bg:'#e8f5e9', color:'#2e7d32', border:'#a5d6a7', label:'✓ Ready to submit' },
    WARNINGS:   { bg:'#fff8e1', color:'#f57f17', border:'#ffe082', label:'⚠ Warnings present' },
    INCOMPLETE: { bg:'#fce4ec', color:'#c62828', border:'#ef9a9a', label:'✗ Incomplete data' },
  };
  const c = cfg[status] || cfg.INCOMPLETE;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 18px',
      background:c.bg, borderRadius:12, border:`1px solid ${c.border}` }}>
      <div>
        <div style={{ fontSize:28, fontWeight:900, color:c.color, lineHeight:1 }}>{score}%</div>
        <div style={{ fontSize:11, color:c.color, fontWeight:700, marginTop:2 }}>Completeness</div>
      </div>
      <div>
        <div style={{ fontSize:13, fontWeight:700, color:c.color }}>{c.label}</div>
        <div style={{ fontSize:11, color:'#888', marginTop:3 }}>
          eGN electronic farm notebook compliance score
        </div>
      </div>
    </div>
  );
};

const IssueList = ({ issues, warnings }) => {
  if (!issues.length && !warnings.length) return (
    <div style={{ background:'#e8f5e9', borderRadius:8, padding:'10px 14px',
      border:'1px solid #a5d6a7', color:'#2e7d32', fontSize:12, fontWeight:600 }}>
      ✓ All required fields are filled. The report is ready to submit.
    </div>
  );
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      {issues.map((msg, i) => (
        <div key={i} style={{ display:'flex', gap:8, alignItems:'flex-start', fontSize:12,
          background:'#fce4ec', borderRadius:7, padding:'6px 10px',
          border:'1px solid #ef9a9a', color:'#c62828' }}>
          <span style={{ flexShrink:0, fontWeight:700 }}>✗</span>
          <span>{msg}</span>
        </div>
      ))}
      {warnings.map((msg, i) => (
        <div key={i} style={{ display:'flex', gap:8, alignItems:'flex-start', fontSize:12,
          background:'#fff8e1', borderRadius:7, padding:'6px 10px',
          border:'1px solid #ffe082', color:'#e65100' }}>
          <span style={{ flexShrink:0, fontWeight:700 }}>⚠</span>
          <span>{msg}</span>
        </div>
      ))}
    </div>
  );
};

// ── eGN documentation guide ───────────────────────────────────────────────────
const EGN_SECTIONS = [
  {
    id: '3.1', icon: '🏡', title: 'Farm Identity',
    required: true,
    desc: 'Basic holding data required for ALL subsidy applications (IACS, CAP direct payments).',
    fields: ['Farm name', 'Registered area (ha)', 'Registration/EORI number', 'Legal owner', 'Operator name'],
    where: 'Farm tab → Edit Profile',
  },
  {
    id: '3.2', icon: '🗺️', title: 'Field Parcels',
    required: true,
    desc: 'Each field must be individually identified. LPIS ID links your parcel to the national land register.',
    fields: ['LPIS parcel ID', 'Declared area (ha)', 'GIS geometry (auto)', 'Soil type', 'Previous crop'],
    where: 'Fields tab → Edit field → eGN fields',
  },
  {
    id: '3.3', icon: '🌾', title: 'Sowing & Crop',
    required: true,
    desc: 'Required for crop-specific payments and greening compliance (crop diversification check).',
    fields: ['Crop species + variety', 'Sowing date', 'Seeding rate (kg/ha)', 'Seed treatment', 'Tillage system'],
    where: 'Field Work tab → 🌾 Sowing form',
  },
  {
    id: '3.4', icon: '🧪', title: 'Fertilization Log',
    required: true,
    desc: 'Mandatory under Nitrates Directive and CAP conditionality. N input per field must be documented.',
    fields: ['Product name & type', 'N / P₂O₅ / K₂O kg/ha', 'Application date', 'Method (broadcast/injection)', 'Total quantity'],
    where: 'Field Work tab → 🧪 Fertilization form',
  },
  {
    id: '3.5', icon: '💧', title: 'Plant Protection (PPP)',
    required: true,
    desc: 'Required by Directive 2009/128/EC (sustainable use). Operator certification number must be on record.',
    fields: ['Trade name + active substance', 'Registration number', 'Dose (L or kg/ha)', 'Target organism', 'PHI (pre-harvest interval)', 'BBCH growth stage', 'Operator cert.'],
    where: 'Field Work tab → 💧 Spraying form',
  },
  {
    id: '3.6', icon: '🚜', title: 'Agronomic Operations',
    required: false,
    desc: 'Field operations log (tillage, irrigation, etc). Required for some agri-environment schemes.',
    fields: ['Operation type', 'Date', 'Operator', 'Equipment/machine'],
    where: 'Field Work tab → ⚙️ Generic form',
  },
  {
    id: '3.7', icon: '📦', title: 'Harvest Results',
    required: false,
    desc: 'Yield data required for production subsidies, organic certification, and market interventions.',
    fields: ['Harvest date', 'Area (ha)', 'Total yield (t)', 'Yield (t/ha)', 'Moisture %', 'Protein %'],
    where: 'Field Work tab → Seasons → + Harvest',
  },
  {
    id: '3.8', icon: '🌿', title: 'Eco-scheme / Greening',
    required: false,
    desc: 'CAP greening requirements: buffer zones near water, non-productive areas, crop rotation compliance.',
    fields: ['Buffer zone (m)', 'Non-productive area flag', 'Nitrate zone flag', 'Organic farming flag'],
    where: 'Fields tab → Edit field → Eco-scheme section',
  },
];

const GuideSection = ({ sec, open, toggle }) => (
  <div style={{ border:'1px solid #e0d8cf', borderRadius:10, overflow:'hidden',
    background: open ? '#fff' : '#fafaf8' }}>
    <div onClick={toggle} style={{ display:'flex', alignItems:'center', gap:10,
      padding:'10px 14px', cursor:'pointer', userSelect:'none' }}>
      <span style={{ fontSize:18 }}>{sec.icon}</span>
      <div style={{ flex:1 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:12, fontWeight:700, color:'#333' }}>
            {sec.id} — {sec.title}
          </span>
          {sec.required
            ? <span style={{ fontSize:9, fontWeight:700, padding:'1px 7px', borderRadius:10,
                background:'#fce4ec', color:'#c62828', border:'1px solid #ef9a9a' }}>REQUIRED</span>
            : <span style={{ fontSize:9, fontWeight:700, padding:'1px 7px', borderRadius:10,
                background:'#e8f5e9', color:'#2e7d32', border:'1px solid #a5d6a7' }}>OPTIONAL</span>
          }
        </div>
        <div style={{ fontSize:11, color:'#888', marginTop:2 }}>{sec.desc}</div>
      </div>
      <span style={{ color:'#ccc', fontSize:12 }}>{open ? '▲' : '▼'}</span>
    </div>
    {open && (
      <div style={{ padding:'0 14px 14px', borderTop:'1px solid #ede7df', background:'#fff' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:10 }}>
          <div>
            <Sec>Required fields</Sec>
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {sec.fields.map(f => (
                <div key={f} style={{ fontSize:11, color:'#555', display:'flex', gap:6 }}>
                  <span style={{ color:'#6b4c2a', fontWeight:700 }}>·</span>{f}
                </div>
              ))}
            </div>
          </div>
          <div>
            <Sec>Where to fill in SmartCrop</Sec>
            <div style={{ fontSize:12, background:'#f8f4f0', borderRadius:8,
              padding:'8px 12px', border:'1px solid #e0d8cf', color:'#6b4c2a', fontWeight:600 }}>
              📍 {sec.where}
            </div>
          </div>
        </div>
      </div>
    )}
  </div>
);

// ── Main panel ────────────────────────────────────────────────────────────────
const EgnReportPanel = ({ userId }) => {
  const [open, setOpen]           = useState(true);
  const [tab, setTab]             = useState('status');
  const [year, setYear]           = useState(curYear);
  const [summary, setSummary]     = useState(null);
  const [loading, setLoading]     = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [openGuide, setOpenGuide] = useState(null);

  const loadSummary = useCallback(() => {
    if (!userId) return;
    setLoading(true);
    api.get(`${BASE}/report/${userId}/summary`, { params: { year } })
      .then(r => setSummary(r.data))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [userId, year]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const resp = await api.get(`${BASE}/report/${userId}/pdf`, {
        params: { year },
        responseType: 'blob',
      });
      const url  = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href  = url;
      link.download = `egn_report_${year}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Failed to generate PDF. Make sure reportlab is installed on the server.');
    } finally {
      setDownloading(false);
    }
  };

  const YearBar = () => (
    <div style={{ display:'flex', gap:0, border:'1px solid #e0d8cf', borderRadius:8,
      overflow:'hidden', width:'fit-content', marginBottom:16 }}>
      {Array.from({length:4},(_,i) => curYear-i).map(y => (
        <button key={y} onClick={() => setYear(y)} style={{
          padding:'5px 14px', fontSize:12, fontWeight:700, border:'none', cursor:'pointer',
          background: year===y ? 'var(--color-accent-soil,#6b4c2a)' : '#f5f0ea',
          color: year===y ? '#fff' : '#888' }}>{y}</button>
      ))}
    </div>
  );

  const TABS = [
    ['status',  '📋 Status'],
    ['guide',   '📖 What to submit'],
  ];

  return (
    <div style={panelWrap}>
      {/* Header */}
      <div style={panelHead} onClick={() => setOpen(v => !v)}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:18 }}>📄</span>
          <span style={titleStyle}>eGN Report</span>
          <span style={badge}>Electronic Farm Notebook</span>
          {summary && (
            <span style={{
              ...badge,
              background: summary.status==='READY' ? '#e8f5e9' : summary.status==='WARNINGS' ? '#fff8e1' : '#fce4ec',
              color:       summary.status==='READY' ? '#2e7d32' : summary.status==='WARNINGS' ? '#e65100' : '#c62828',
            }}>
              {summary.score}% complete
            </span>
          )}
        </div>
        <span style={{ color:'#bbb', fontSize:13 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={panelBody}>
          {/* Tab bar */}
          <div style={{ display:'flex', gap:0, marginBottom:16, border:'1px solid #e0d8cf',
            borderRadius:8, overflow:'hidden', width:'fit-content' }}>
            {TABS.map(([k,l]) => (
              <button key={k} onClick={() => setTab(k)} style={{
                padding:'7px 18px', fontSize:13, fontWeight:700, border:'none', cursor:'pointer',
                background: tab===k ? 'var(--color-accent-soil,#6b4c2a)' : '#f5f0ea',
                color: tab===k ? '#fff' : '#888' }}>{l}</button>
            ))}
          </div>

          {/* ── STATUS TAB ── */}
          {tab === 'status' && (
            <div>
              <YearBar/>

              {loading && (
                <div style={{ color:'#ccc', textAlign:'center', padding:'24px', fontSize:13 }}>
                  Loading compliance data…
                </div>
              )}

              {!loading && !summary && (
                <div style={{ color:'#ccc', textAlign:'center', padding:'24px', fontSize:13 }}>
                  Failed to load. Check your connection.
                </div>
              )}

              {!loading && summary && (
                <>
                  {/* Score */}
                  <div style={{ marginBottom:16 }}>
                    <ScoreBadge score={summary.score} status={summary.status}/>
                  </div>

                  {/* KPI cards */}
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
                    <Card icon="🗺️" label="Fields"       value={summary.totals.fields_count}
                      sub={fmtHa(summary.totals.total_area_ha)}              color="#6b4c2a"/>
                    <Card icon="🌾" label="Seasons"      value={summary.totals.seasons_count}
                      sub={`season ${year}`}                                 color="#2e7d32"/>
                    <Card icon="🧪" label="Fert. events" value={summary.totals.fert_events}   color="#e65100"/>
                    <Card icon="💧" label="Spray events" value={summary.totals.spray_events}   color="#0d47a1"/>
                    <Card icon="🚜" label="Operations"   value={summary.totals.operations_count} color="#5d4037"/>
                    <Card icon="📦" label="Harvest"      value={fmtTon(summary.totals.total_harvest_t)} color="#388e3c"/>
                  </div>

                  {/* Issues */}
                  <Sec>Compliance checklist</Sec>
                  <div style={{ marginBottom:16 }}>
                    <IssueList issues={summary.issues} warnings={summary.warnings}/>
                  </div>

                  {/* Download button */}
                  <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                    <button onClick={downloadPdf} disabled={downloading} style={{
                      background: downloading ? '#ccc' : 'var(--color-accent-soil,#6b4c2a)',
                      color:'#fff', border:'none', borderRadius:8, padding:'9px 20px',
                      fontWeight:700, fontSize:13, cursor: downloading ? 'default' : 'pointer',
                      fontFamily:'inherit', display:'flex', alignItems:'center', gap:8 }}>
                      {downloading
                        ? <><span>⏳</span> Generating PDF…</>
                        : <><span>📄</span> Download eGN Report PDF — {year}</>
                      }
                    </button>
                    <span style={{ fontSize:11, color:'#aaa' }}>
                      All sections 3.1–3.8 · A4 format · ready to print or attach to subsidy application
                    </span>
                  </div>

                  {/* What this report is used for */}
                  <div style={{ marginTop:20, background:'#f8f4f0', borderRadius:10,
                    border:'1px solid #e0d8cf', padding:'14px 16px' }}>
                    <Sec>What the eGN report is used for</Sec>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',
                      gap:8, fontSize:11 }}>
                      {[
                        ['🌿 CAP direct payments', 'Basic Income Support (BISS), eco-schemes, coupled support'],
                        ['🧪 Nitrates Directive', 'Annual N-balance per field — compulsory in NVZ areas'],
                        ['💧 PPP directive 2009/128', 'Pesticide use register — operator must hold cert.'],
                        ['🌾 Agri-environment schemes', 'AECM payments require full crop & operation history'],
                        ['📋 Cross-compliance / conditionality', 'Inspections check fertilization & PPP logs'],
                        ['🔍 Organic certification', 'Full input log required for conversion & annual audit'],
                        ['📊 Food chain traceability', 'Required by retailers & food safety authorities'],
                        ['🏦 Agricultural loans', 'Banks increasingly require eGN data for financing'],
                      ].map(([title, desc]) => (
                        <div key={title} style={{ background:'#fff', borderRadius:8,
                          padding:'8px 10px', border:'1px solid #ede7df' }}>
                          <div style={{ fontWeight:700, color:'#444', marginBottom:2 }}>{title}</div>
                          <div style={{ color:'#888' }}>{desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── GUIDE TAB ── */}
          {tab === 'guide' && (
            <div>
              <div style={{ background:'#e3f2fd', borderRadius:8, padding:'10px 14px',
                border:'1px solid #90caf9', marginBottom:16, fontSize:12, color:'#0d47a1' }}>
                <strong>eGN (elektronisches Feld-Notizbuch / electronic farm notebook)</strong> is the
                digital farm record required for CAP subsidy applications and regulatory compliance
                across the EU. The following sections must be maintained per growing season.
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {EGN_SECTIONS.map(sec => (
                  <GuideSection
                    key={sec.id}
                    sec={sec}
                    open={openGuide === sec.id}
                    toggle={() => setOpenGuide(v => v === sec.id ? null : sec.id)}
                  />
                ))}
              </div>

              {/* Submission timeline */}
              <div style={{ marginTop:20, background:'#fafaf8', borderRadius:10,
                border:'1px solid #e0d8cf', padding:'14px 16px' }}>
                <Sec>Typical submission calendar</Sec>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {[
                    ['Jan–Mar',  '📋', 'Winter / pre-season',    'Update farm registration, plan crop rotation, order inputs'],
                    ['Mar–May',  '🌱', 'Spring sowing',          'Log sowing records (3.3) as fields are planted'],
                    ['Mar–Oct',  '🧪', 'Growing season',         'Log every fertilization (3.4) and spraying (3.5) event within 24 h'],
                    ['May',      '📝', 'CAP application deadline','Submit area aid application with declared crop & area data'],
                    ['Jun–Sep',  '🚜', 'Operations',             'Log tillage, irrigation, mowing operations (3.6)'],
                    ['Aug–Oct',  '📦', 'Harvest',                'Record harvest yield & quality per field (3.7)'],
                    ['Oct–Dec',  '📄', 'Annual report',          'Generate and archive full eGN report for the season'],
                    ['Any time', '🔍', 'Inspection',             'Authority can request full eGN log — keep all records for 5 years'],
                  ].map(([period, icon, title, desc]) => (
                    <div key={period} style={{ display:'flex', gap:12, alignItems:'flex-start',
                      background:'#fff', borderRadius:8, padding:'8px 12px',
                      border:'1px solid #ede7df' }}>
                      <div style={{ minWidth:70, fontSize:11, fontWeight:700, color:'#6b4c2a' }}>{period}</div>
                      <span style={{ fontSize:16 }}>{icon}</span>
                      <div>
                        <div style={{ fontSize:12, fontWeight:700, color:'#333' }}>{title}</div>
                        <div style={{ fontSize:11, color:'#888' }}>{desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Record retention */}
              <div style={{ marginTop:12, background:'#fce4ec', borderRadius:8,
                border:'1px solid #ef9a9a', padding:'10px 14px', fontSize:12, color:'#c62828' }}>
                <strong>⚠️ Legal retention requirement:</strong> All eGN records (fertilization logs,
                PPP records, harvest data) must be retained for a minimum of <strong>5 years</strong> and
                made available to competent authorities upon request. SmartCrop Monitor stores all data
                permanently.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default EgnReportPanel;

// ── Styles ────────────────────────────────────────────────────────────────────
const panelWrap  = { background:'#fff', borderRadius:14,
  border:'1px solid var(--color-accent-soil)', boxShadow:'0 2px 10px rgba(0,0,0,0.05)',
  overflow:'hidden', marginBottom:20 };
const panelHead  = { display:'flex', justifyContent:'space-between', alignItems:'center',
  padding:'13px 20px', cursor:'pointer', background:'var(--color-bg-champagne)',
  borderBottom:'1px solid var(--color-accent-soil)', userSelect:'none' };
const panelBody  = { padding:'16px 20px 20px' };
const titleStyle = { fontFamily:'var(--font-heading)', fontWeight:700, fontSize:15,
  color:'var(--color-accent-chernozem)' };
const badge      = { fontSize:11, color:'#aaa', background:'#f0ebe3',
  borderRadius:10, padding:'2px 8px' };