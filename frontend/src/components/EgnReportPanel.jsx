import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

const BASE      = '/api/v1/egn';
const BASE_PERS = '/api/v1/personnel';
const BASE_EQ   = '/api/v1/equipment';

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

// ── Shared form helpers ─────────────────────────────────────────────────────
const inp  = { border:'1px solid #ddd', borderRadius:6, padding:'5px 8px',
  fontSize:12, fontFamily:'inherit', outline:'none', background:'#fff' };
const btnP = { background:'var(--color-accent-soil,#6b4c2a)', color:'#fff',
  border:'none', borderRadius:6, padding:'6px 14px', fontWeight:700,
  fontSize:12, cursor:'pointer', fontFamily:'inherit' };
const btnSm = { background:'none', border:'1px solid #ddd', borderRadius:6,
  padding:'4px 10px', fontSize:11, cursor:'pointer', fontFamily:'inherit', color:'#555' };

const FL = ({ label, title, style, children }) => (
  <div style={{ display:'flex', flexDirection:'column', gap:3, ...style }}>
    <div style={{ fontSize:10, fontWeight:700, color:'#aaa', textTransform:'uppercase',
      letterSpacing:'0.04em' }} title={title}>{label}</div>
    {children}
  </div>
);
const Inp = ({ style, ...p }) => <input style={{...inp,...style}} {...p}/>;

const Modal = ({ title, onClose, children, width=480 }) => (
  <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)',
    zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
    <div style={{ background:'#fff', borderRadius:14, padding:24,
      width, maxWidth:'95vw', boxShadow:'0 8px 40px rgba(0,0,0,0.18)',
      maxHeight:'90vh', overflowY:'auto' }}>
      <div style={{ display:'flex', justifyContent:'space-between',
        alignItems:'center', marginBottom:16 }}>
        <div style={{ fontWeight:800, fontSize:15 }}>{title}</div>
        <button onClick={onClose} style={{...btnSm, fontSize:15, padding:'2px 10px'}}>✕</button>
      </div>
      {children}
    </div>
  </div>
);

const EmptyMsg = ({ text }) => (
  <div style={{ textAlign:'center', padding:'28px 0', color:'#bbb', fontSize:13 }}>{text}</div>
);

const StatusDot = ({ status }) => {
  const map = {
    ACTIVE:'#2e7d32', OPERATIONAL:'#2e7d32', ON_LEAVE:'#f57f17',
    IN_USE:'#0d47a1', INACTIVE:'#9e9e9e', TERMINATED:'#9e9e9e',
    MAINTENANCE:'#f57f17', REPAIR:'#c62828', IDLE:'#9e9e9e', RETIRED:'#9e9e9e',
  };
  return <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%',
    background: map[status]||'#ccc', marginRight:5, flexShrink:0 }}/>;
};

// ── Payload sanitiser ────────────────────────────────────────────────────────
// Converts empty-string form values to null so Pydantic Optional[date/int/float]
// fields don't receive '' and return 422.
const INT_FIELDS   = new Set(['year_of_manufacture','season_year','pre_harvest_interval_days',
  'sequence','bbch_stage']);
const FLOAT_FIELDS = new Set(['power_kw','working_width_m','tank_capacity_l','weight_kg',
  'hours_initial','hours_current','hours_service_interval','hours_start','hours_end',
  'hours_worked','hours_at_service','next_service_hours',
  'area_ha','distance_km','fuel_consumed_l','fuel_cost','purchase_price',
  'pay_rate','labour_cost','n_kg_ha','p2o5_kg_ha','k2o_kg_ha','s_kg_ha','mg_kg_ha',
  'dose_kg_ha','dose_l_ha','water_volume_l_ha','total_product_used','total_dose_kg',
  'sowing_rate_kg_ha','work_cost','harvest_ton']);
function sanitise(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === '' || v === undefined) {
      // Coerce empty string to null for typed fields; omit internal flags
      if (k.startsWith('_')) continue;
      out[k] = null;
    } else if (INT_FIELDS.has(k)) {
      out[k] = Number.isFinite(Number(v)) ? Number(v) : null;
    } else if (FLOAT_FIELDS.has(k)) {
      out[k] = Number.isFinite(Number(v)) ? Number(v) : null;
    } else {
      out[k] = v;
    }
  }
  return out;
}

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

// =============================================================================
// PERSONNEL TAB
// =============================================================================

const ROLE_ICONS = {
  FARM_MANAGER:'🏡', AGRONOMIST:'🌿', FIELD_OPERATOR:'🚜',
  SPRAYER_OPERATOR:'💧', HARVESTER_OPERATOR:'🌾', IRRIGATOR:'💦',
  LIVESTOCK_WORKER:'🐄', SEASONAL_WORKER:'👤', CONTRACTOR:'🤝',
  DRIVER:'🚗', TECHNICIAN:'🔧', ADMIN:'📋', OTHER:'👤',
};

const CERT_COLORS = { expired:'#c62828', expiring:'#f57f17', ok:'#2e7d32' };

const CertBadge = ({ cert }) => {
  const days = cert.days_until_expiry;
  const color = days == null ? '#9e9e9e' : days < 0 ? CERT_COLORS.expired
    : days <= 60 ? CERT_COLORS.expiring : CERT_COLORS.ok;
  const bg = days == null ? '#f5f5f5' : days < 0 ? '#fce4ec'
    : days <= 60 ? '#fff8e1' : '#e8f5e9';
  return (
    <span title={cert.cert_number||''} style={{ fontSize:10, fontWeight:700,
      borderRadius:4, padding:'2px 6px', background:bg, color, border:`1px solid ${color}33`,
      whiteSpace:'nowrap' }}>
      {cert.cert_type.replace(/_/g,' ')}
      {cert.expiry_date && ` · ${days < 0 ? 'EXP' : days+'d'}`}
    </span>
  );
};

const PersonForm = ({ initial, onSave, onClose, busy }) => {
  const [f, setF] = useState(initial || {
    first_name:'', last_name:'', role:'FIELD_OPERATOR',
    employment_type:'FULL_TIME', status:'ACTIVE',
    phone:'', email:'', hire_date:'', pay_rate:'', pay_rate_unit:'PER_HOUR', notes:'',
  });
  const set = (k,v) => setF(p=>({...p,[k]:v}));
  const ROLES = ['FARM_MANAGER','AGRONOMIST','FIELD_OPERATOR','SPRAYER_OPERATOR',
    'HARVESTER_OPERATOR','IRRIGATOR','LIVESTOCK_WORKER','SEASONAL_WORKER',
    'CONTRACTOR','DRIVER','TECHNICIAN','ADMIN','OTHER'];
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <FL label="First name" style={{flex:1,minWidth:130}}>
          <Inp value={f.first_name} onChange={e=>set('first_name',e.target.value)}/>
        </FL>
        <FL label="Last name" style={{flex:1,minWidth:130}}>
          <Inp value={f.last_name} onChange={e=>set('last_name',e.target.value)}/>
        </FL>
      </div>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <FL label="Role" style={{flex:1,minWidth:160}}>
          <select value={f.role} onChange={e=>set('role',e.target.value)} style={inp}>
            {ROLES.map(r=><option key={r} value={r}>{ROLE_ICONS[r]||'👤'} {r.replace(/_/g,' ')}</option>)}
          </select>
        </FL>
        <FL label="Employment">
          <select value={f.employment_type} onChange={e=>set('employment_type',e.target.value)} style={inp}>
            {['FULL_TIME','PART_TIME','SEASONAL','CONTRACTOR','VOLUNTEER'].map(t=>(
              <option key={t} value={t}>{t.replace(/_/g,' ')}</option>
            ))}
          </select>
        </FL>
        <FL label="Status">
          <select value={f.status} onChange={e=>set('status',e.target.value)} style={inp}>
            {['ACTIVE','ON_LEAVE','INACTIVE','TERMINATED'].map(s=>(
              <option key={s} value={s}>{s.replace(/_/g,' ')}</option>
            ))}
          </select>
        </FL>
      </div>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <FL label="Phone" style={{flex:1,minWidth:130}}>
          <Inp value={f.phone||''} onChange={e=>set('phone',e.target.value)} placeholder="+380…"/>
        </FL>
        <FL label="Email" style={{flex:1,minWidth:160}}>
          <Inp type="email" value={f.email||''} onChange={e=>set('email',e.target.value)}/>
        </FL>
        <FL label="Hire date">
          <Inp type="date" value={f.hire_date||''} onChange={e=>set('hire_date',e.target.value)}/>
        </FL>
      </div>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <FL label="Pay rate (€)" style={{flex:1,minWidth:100}}>
          <Inp type="number" value={f.pay_rate||''} onChange={e=>set('pay_rate',e.target.value)} style={{width:100}}/>
        </FL>
        <FL label="Rate unit">
          <select value={f.pay_rate_unit||'PER_HOUR'} onChange={e=>set('pay_rate_unit',e.target.value)} style={inp}>
            {['PER_HOUR','PER_DAY','PER_MONTH','PER_SEASON','FIXED'].map(u=>(
              <option key={u} value={u}>{u.replace(/_/g,' ')}</option>
            ))}
          </select>
        </FL>
      </div>
      <FL label="Notes">
        <textarea value={f.notes||''} onChange={e=>set('notes',e.target.value)}
          style={{...inp, width:'100%', minHeight:56, resize:'vertical', boxSizing:'border-box'}}/>
      </FL>
      <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 }}>
        <button onClick={onClose} style={btnSm}>Cancel</button>
        <button onClick={()=>onSave(f)} disabled={busy||!f.first_name||!f.last_name} style={btnP}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
};

const CertForm = ({ onSave, onClose, busy }) => {
  const [f, setF] = useState({ cert_type:'PESTICIDE_APPLICATOR', cert_number:'',
    issued_by:'', issue_date:'', expiry_date:'', notes:'' });
  const set = (k,v) => setF(p=>({...p,[k]:v}));
  const CERTS = ['PESTICIDE_APPLICATOR','PESTICIDE_ADVISOR','TRACTOR_LICENCE',
    'FORKLIFT_LICENCE','CHAINSAW_LICENCE','DRONE_OPERATOR','FIRST_AID',
    'FIRE_SAFETY','HAZMAT','AGRONOMIST_LICENCE','IRRIGATION_TECHNICIAN',
    'ORGANIC_FARMING_CERT','OTHER'];
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <FL label="Certificate type" style={{flex:1,minWidth:180}}>
          <select value={f.cert_type} onChange={e=>set('cert_type',e.target.value)} style={inp}>
            {CERTS.map(c=><option key={c} value={c}>{c.replace(/_/g,' ')}</option>)}
          </select>
        </FL>
        <FL label="Certificate number" style={{flex:1,minWidth:130}}>
          <Inp value={f.cert_number} onChange={e=>set('cert_number',e.target.value)}/>
        </FL>
      </div>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <FL label="Issued by" style={{flex:1,minWidth:160}}>
          <Inp value={f.issued_by} onChange={e=>set('issued_by',e.target.value)}/>
        </FL>
        <FL label="Issue date">
          <Inp type="date" value={f.issue_date} onChange={e=>set('issue_date',e.target.value)}/>
        </FL>
        <FL label="Expiry date" title="Leave blank if no expiry">
          <Inp type="date" value={f.expiry_date} onChange={e=>set('expiry_date',e.target.value)}/>
        </FL>
      </div>
      <FL label="Notes">
        <Inp value={f.notes} onChange={e=>set('notes',e.target.value)}/>
      </FL>
      <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 }}>
        <button onClick={onClose} style={btnSm}>Cancel</button>
        <button onClick={()=>onSave(f)} disabled={busy} style={btnP}>
          {busy ? 'Saving…' : 'Add Certificate'}
        </button>
      </div>
    </div>
  );
};

const WorkLogForm = ({ onSave, onClose, busy }) => {
  const [f, setF] = useState({ work_date:'', hours_worked:'',
    start_time:'', end_time:'', labour_cost:'', task_description:'', notes:'' });
  const set = (k,v) => setF(p=>({...p,[k]:v}));
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <FL label="Date"><Inp type="date" value={f.work_date} onChange={e=>set('work_date',e.target.value)}/></FL>
        <FL label="Start" title="Optional – auto-computes hours">
          <Inp value={f.start_time} onChange={e=>set('start_time',e.target.value)} placeholder="08:00" style={{width:72}}/>
        </FL>
        <FL label="End">
          <Inp value={f.end_time} onChange={e=>set('end_time',e.target.value)} placeholder="17:00" style={{width:72}}/>
        </FL>
        <FL label="Hours worked" title="Override auto-calc">
          <Inp type="number" value={f.hours_worked} onChange={e=>set('hours_worked',e.target.value)} style={{width:80}}/>
        </FL>
        <FL label="Labour cost (€)">
          <Inp type="number" value={f.labour_cost} onChange={e=>set('labour_cost',e.target.value)} style={{width:100}}/>
        </FL>
      </div>
      <FL label="Task description">
        <Inp value={f.task_description} onChange={e=>set('task_description',e.target.value)} style={{width:'100%'}}/>
      </FL>
      <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
        <button onClick={onClose} style={btnSm}>Cancel</button>
        <button onClick={()=>onSave(f)} disabled={busy||!f.work_date} style={btnP}>
          {busy ? 'Saving…' : 'Log Work'}
        </button>
      </div>
    </div>
  );
};

const PersonCard = ({ person, onEdit, onDelete, onRefresh }) => {
  const [expanded, setExpanded] = useState(false);
  const [showCertForm, setShowCertForm] = useState(false);
  const [showLogForm,  setShowLogForm]  = useState(false);
  const [busy, setBusy] = useState(false);
  const hasIssues = person.expired_certs_count > 0 || person.expiring_certs_count > 0;

  const saveCert = async (data) => {
    setBusy(true);
    try {
      await api.post(`${BASE_PERS}/${person.id}/certifications?user_id=${person.user_id}`, sanitise(data));
      setShowCertForm(false); onRefresh();
    } catch { alert('Failed to save certificate'); }
    finally { setBusy(false); }
  };

  const saveLog = async (data) => {
    setBusy(true);
    try {
      await api.post(`${BASE_PERS}/${person.id}/work-log?user_id=${person.user_id}`, sanitise(data));
      setShowLogForm(false); onRefresh();
    } catch { alert('Failed to log work'); }
    finally { setBusy(false); }
  };

  const deleteCert = async (certId) => {
    if (!window.confirm('Delete this certificate?')) return;
    await api.delete(`${BASE_PERS}/${person.id}/certifications/${certId}?user_id=${person.user_id}`);
    onRefresh();
  };

  return (
    <div style={{ background:'#fff', border:'1px solid #e0d8cf', borderRadius:10,
      overflow:'hidden', borderLeft: hasIssues ? '4px solid #f57f17' : '4px solid #e0d8cf' }}>
      {/* Row */}
      <div onClick={()=>setExpanded(v=>!v)} style={{ display:'flex', alignItems:'center',
        gap:10, padding:'10px 14px', cursor:'pointer', userSelect:'none' }}>
        <span style={{ fontSize:20, flexShrink:0 }}>{ROLE_ICONS[person.role]||'👤'}</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <span style={{ fontWeight:700, fontSize:13, color:'#333' }}>{person.full_name}</span>
            <StatusDot status={person.status}/>
            <span style={{ fontSize:11, color:'#888' }}>{person.role.replace(/_/g,' ')}</span>
            <span style={{ fontSize:10, color:'#aaa', background:'#f5f0ea',
              borderRadius:4, padding:'1px 6px' }}>{person.employment_type.replace(/_/g,' ')}</span>
          </div>
          <div style={{ display:'flex', gap:8, marginTop:4, flexWrap:'wrap' }}>
            {person.certifications.slice(0,4).map(c=><CertBadge key={c.id} cert={c}/>)}
            {person.certifications.length > 4 &&
              <span style={{ fontSize:10, color:'#aaa' }}>+{person.certifications.length-4} more</span>}
          </div>
        </div>
        <div style={{ display:'flex', gap:16, alignItems:'center', flexShrink:0 }}>
          {person.total_hours_this_year != null && (
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#333' }}>
                {Number(person.total_hours_this_year).toFixed(0)}h
              </div>
              <div style={{ fontSize:10, color:'#aaa' }}>this year</div>
            </div>
          )}
          {hasIssues && (
            <span style={{ fontSize:10, background:'#fff8e1', color:'#e65100',
              border:'1px solid #ffe082', borderRadius:10, padding:'2px 8px', fontWeight:700 }}>
              {person.expired_certs_count > 0
                ? `${person.expired_certs_count} cert${person.expired_certs_count>1?'s':''} expired`
                : `${person.expiring_certs_count} expiring`}
            </span>
          )}
          <span style={{ color:'#ccc', fontSize:11 }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ borderTop:'1px solid #ede7df', padding:'12px 14px',
          background:'#fafaf8' }}>
          {/* Action buttons */}
          <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
            <button onClick={()=>onEdit(person)} style={btnSm}>✏️ Edit</button>
            <button onClick={()=>setShowCertForm(true)} style={btnSm}>🏅 Add certificate</button>
            <button onClick={()=>setShowLogForm(true)} style={btnSm}>⏱ Log work</button>
            <button onClick={()=>onDelete(person.id)} style={{...btnSm, color:'#c62828', borderColor:'#ef9a9a'}}>
              🗑 Delete
            </button>
          </div>

          {/* Cert form */}
          {showCertForm && (
            <div style={{ marginBottom:12, background:'#fff', borderRadius:8,
              border:'1px solid #e0d8cf', padding:'12px 14px' }}>
              <div style={{ fontWeight:700, fontSize:12, marginBottom:10 }}>🏅 Add Certificate</div>
              <CertForm onSave={saveCert} onClose={()=>setShowCertForm(false)} busy={busy}/>
            </div>
          )}

          {/* Work log form */}
          {showLogForm && (
            <div style={{ marginBottom:12, background:'#fff', borderRadius:8,
              border:'1px solid #e0d8cf', padding:'12px 14px' }}>
              <div style={{ fontWeight:700, fontSize:12, marginBottom:10 }}>⏱ Log Work Session</div>
              <WorkLogForm onSave={saveLog} onClose={()=>setShowLogForm(false)} busy={busy}/>
            </div>
          )}

          {/* Certificates table */}
          {person.certifications.length > 0 && (
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:10, fontWeight:700, color:'#aaa', textTransform:'uppercase',
                marginBottom:6 }}>Certifications</div>
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {person.certifications.map(c => {
                  const days = c.days_until_expiry;
                  const color = days == null ? '#555' : days < 0 ? '#c62828'
                    : days <= 60 ? '#e65100' : '#2e7d32';
                  return (
                    <div key={c.id} style={{ display:'flex', alignItems:'center', gap:10,
                      background:'#fff', borderRadius:6, padding:'6px 10px',
                      border:'1px solid #ede7df', fontSize:11 }}>
                      <span style={{ flex:1, fontWeight:600, color:'#444' }}>
                        {c.cert_type.replace(/_/g,' ')}
                      </span>
                      {c.cert_number && <span style={{ color:'#888' }}>#{c.cert_number}</span>}
                      {c.issued_by   && <span style={{ color:'#aaa' }}>{c.issued_by}</span>}
                      {c.expiry_date && (
                        <span style={{ fontWeight:700, color }}>
                          {days < 0 ? `⚠ Expired ${c.expiry_date}` : `Valid until ${c.expiry_date} (${days}d)`}
                        </span>
                      )}
                      <button onClick={()=>deleteCert(c.id)}
                        style={{...btnSm, color:'#c62828', borderColor:'#ef9a9a', padding:'2px 8px'}}>
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Contact info */}
          <div style={{ display:'flex', gap:16, flexWrap:'wrap', fontSize:11, color:'#888', marginTop:4 }}>
            {person.phone && <span>📞 {person.phone}</span>}
            {person.email && <span>📧 {person.email}</span>}
            {person.hire_date && <span>📅 Hired {person.hire_date}</span>}
            {person.pay_rate && (
              <span>💶 {Number(person.pay_rate).toFixed(2)} €/{(person.pay_rate_unit||'hr').replace('PER_','').toLowerCase()}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const PersonnelTab = ({ userId }) => {
  const [staff, setStaff]       = useState([]);
  const [summary, setSummary]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [busy, setBusy]         = useState(false);
  const [expiring, setExpiring] = useState([]);

  const load = useCallback(() => {
    if (!userId) return;
    setLoading(true);
    Promise.all([
      api.get(`${BASE_PERS}/user`),
      api.get(`${BASE_PERS}/summary/user`),
      api.get(`${BASE_PERS}/expiring-certs/user`, { params:{ days:60 } }),
    ])
      .then(([s, su, ex]) => {
        setStaff(Array.isArray(s.data) ? s.data : []);
        setSummary(su.data);
        setExpiring(Array.isArray(ex.data) ? ex.data : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const saveNew = async (data) => {
    setBusy(true);
    try {
      await api.post(`${BASE_PERS}/create?user_id=${userId}`, sanitise(data));
      setShowForm(false); load();
    } catch { alert('Failed to save'); }
    finally { setBusy(false); }
  };

  const saveEdit = async (data) => {
    setBusy(true);
    try {
      await api.patch(`${BASE_PERS}/${editing.id}?user_id=${userId}`, sanitise(data));
      setEditing(null); load();
    } catch { alert('Failed to update'); }
    finally { setBusy(false); }
  };

  const deletePerson = async (id) => {
    if (!window.confirm('Delete this staff member?')) return;
    await api.delete(`${BASE_PERS}/${id}?user_id=${userId}`);
    load();
  };

  return (
    <div>
      {/* New / Edit modal */}
      {(showForm || editing) && (
        <Modal title={editing ? '✏️ Edit Staff Member' : '👤 Add Staff Member'}
          onClose={() => { setShowForm(false); setEditing(null); }} width={520}>
          <PersonForm
            initial={editing}
            onSave={editing ? saveEdit : saveNew}
            onClose={() => { setShowForm(false); setEditing(null); }}
            busy={busy}
          />
        </Modal>
      )}

      {/* Summary cards */}
      {summary && (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
          <Card icon="👥" label="Total staff"    value={summary.total_staff}           color="#6b4c2a"/>
          <Card icon="✅" label="Active"          value={summary.by_status?.ACTIVE||0}  color="#2e7d32"/>
          <Card icon="⏱"  label="Hours (YTD)"
            value={summary.year_hours_total ? `${Number(summary.year_hours_total).toFixed(0)}h` : '—'}
            color="#0d47a1"/>
          <Card icon="💶" label="Labour cost (YTD)"
            value={summary.year_labour_cost_total
              ? `${Number(summary.year_labour_cost_total).toFixed(0)} €` : '—'}
            color="#5d4037"/>
          {summary.expired_certs > 0 && (
            <Card icon="⚠️" label="Expired certs" value={summary.expired_certs}         color="#c62828"/>
          )}
          {summary.expiring_certs_60d > 0 && (
            <Card icon="🔔" label="Expiring soon" value={summary.expiring_certs_60d}   color="#f57f17"/>
          )}
        </div>
      )}

      {/* Expiring cert alert */}
      {expiring.filter(c=>c.expired).length > 0 && (
        <div style={{ background:'#fce4ec', border:'1px solid #ef9a9a', borderRadius:8,
          padding:'10px 14px', marginBottom:12, fontSize:12, color:'#c62828' }}>
          <strong>⚠️ Expired certifications:</strong>{' '}
          {expiring.filter(c=>c.expired).map(c=>(
            <span key={c.cert_id} style={{ marginRight:8 }}>
              {c.full_name} — {c.cert_type.replace(/_/g,' ')}
            </span>
          ))}
        </div>
      )}

      {/* Add button */}
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:12 }}>
        <button onClick={()=>setShowForm(true)} style={{...btnP, display:'flex', gap:6, alignItems:'center'}}>
          + Add Staff Member
        </button>
      </div>

      {loading
        ? <EmptyMsg text="Loading staff…"/>
        : staff.length === 0
          ? <EmptyMsg text="No staff added yet. Click + Add Staff Member to get started."/>
          : (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {staff.map(p => (
                <PersonCard
                  key={p.id}
                  person={p}
                  onEdit={setEditing}
                  onDelete={deletePerson}
                  onRefresh={load}
                />
              ))}
            </div>
          )
      }
    </div>
  );
};


// =============================================================================
// EQUIPMENT TAB
// =============================================================================

const EQ_ICONS = {
  TRACTOR:'🚜', PLOW:'🔧', DISC_HARROW:'⚙️', CULTIVATOR:'⚙️', SUBSOILER:'🔩',
  ROLLER:'🔄', SEEDER:'🌱', TRANSPLANTER:'🌿', POTATO_PLANTER:'🥔',
  SPRAYER:'💧', FERTILIZER_SPREADER:'🧪', IRRIGATION_SYSTEM:'💦',
  MOWER:'✂️', BALER:'📦', RAKE:'🌾', COMBINE_HARVESTER:'🌾',
  FORAGE_HARVESTER:'🌿', GRAIN_CART:'🛒', TRAILER:'🚛',
  LOADER:'🏗', TELEHANDLER:'🏗', ATV:'🏎', TRUCK:'🚛',
  DRONE:'🛸', OTHER:'🔧',
};


const EquipmentForm = ({ initial, onSave, onClose, busy }) => {
  const EQ_TYPES = ['TRACTOR','PLOW','DISC_HARROW','CULTIVATOR','SUBSOILER','ROLLER',
    'SEEDER','TRANSPLANTER','SPRAYER','FERTILIZER_SPREADER','IRRIGATION_SYSTEM',
    'MOWER','BALER','COMBINE_HARVESTER','FORAGE_HARVESTER','GRAIN_CART',
    'TRAILER','LOADER','TELEHANDLER','TRUCK','DRONE','OTHER'];
  const [f, setF] = useState(initial || {
    name:'', equipment_type:'TRACTOR', manufacturer:'', model:'',
    year_of_manufacture:'', serial_number:'', registration_plate:'',
    power_kw:'', working_width_m:'', fuel_type:'DIESEL',
    hours_initial:'', hours_service_interval:'',
    status:'OPERATIONAL', is_owned: true,
    purchase_date:'', purchase_price:'', insurance_expiry:'',
    next_service_date:'', notes:'',
  });
  const set = (k,v) => setF(p=>({...p,[k]:v}));
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <FL label="Name / identifier" style={{flex:2,minWidth:160}}>
          <Inp value={f.name} onChange={e=>set('name',e.target.value)} placeholder="e.g. John Deere 8R"/>
        </FL>
        <FL label="Type" style={{flex:1,minWidth:140}}>
          <select value={f.equipment_type} onChange={e=>set('equipment_type',e.target.value)} style={inp}>
            {EQ_TYPES.map(t=><option key={t} value={t}>{EQ_ICONS[t]||'🔧'} {t.replace(/_/g,' ')}</option>)}
          </select>
        </FL>
      </div>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <FL label="Manufacturer" style={{flex:1,minWidth:120}}>
          <Inp value={f.manufacturer||''} onChange={e=>set('manufacturer',e.target.value)}/>
        </FL>
        <FL label="Model" style={{flex:1,minWidth:120}}>
          <Inp value={f.model||''} onChange={e=>set('model',e.target.value)}/>
        </FL>
        <FL label="Year">
          <Inp type="number" value={f.year_of_manufacture||''} onChange={e=>set('year_of_manufacture',e.target.value)} style={{width:76}}/>
        </FL>
        <FL label="Serial No.">
          <Inp value={f.serial_number||''} onChange={e=>set('serial_number',e.target.value)} style={{width:130}}/>
        </FL>
        <FL label="Reg. plate">
          <Inp value={f.registration_plate||''} onChange={e=>set('registration_plate',e.target.value)} style={{width:110}}/>
        </FL>
      </div>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <FL label="Power (kW)">
          <Inp type="number" value={f.power_kw||''} onChange={e=>set('power_kw',e.target.value)} style={{width:80}}/>
        </FL>
        <FL label="Working width (m)">
          <Inp type="number" value={f.working_width_m||''} onChange={e=>set('working_width_m',e.target.value)} style={{width:100}}/>
        </FL>
        <FL label="Fuel">
          <select value={f.fuel_type||'DIESEL'} onChange={e=>set('fuel_type',e.target.value)} style={inp}>
            {['DIESEL','PETROL','ELECTRIC','LPG','NONE'].map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        </FL>
        <FL label="Hours at reg.">
          <Inp type="number" value={f.hours_initial||''} onChange={e=>set('hours_initial',e.target.value)} style={{width:90}}/>
        </FL>
        <FL label="Service interval (h)">
          <Inp type="number" value={f.hours_service_interval||''} onChange={e=>set('hours_service_interval',e.target.value)} style={{width:100}}/>
        </FL>
      </div>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
        <FL label="Status">
          <select value={f.status} onChange={e=>set('status',e.target.value)} style={inp}>
            {['OPERATIONAL','IN_USE','MAINTENANCE','REPAIR','IDLE','RETIRED'].map(s=>(
              <option key={s} value={s}>{s.replace(/_/g,' ')}</option>
            ))}
          </select>
        </FL>
        <FL label="Ownership">
          <select value={f.is_owned?'owned':'rented'} onChange={e=>set('is_owned',e.target.value==='owned')} style={inp}>
            <option value="owned">Owned</option>
            <option value="rented">Rented / Contracted</option>
          </select>
        </FL>
        <FL label="Purchase date">
          <Inp type="date" value={f.purchase_date||''} onChange={e=>set('purchase_date',e.target.value)}/>
        </FL>
        <FL label="Purchase price (€)">
          <Inp type="number" value={f.purchase_price||''} onChange={e=>set('purchase_price',e.target.value)} style={{width:110}}/>
        </FL>
        <FL label="Insurance expiry">
          <Inp type="date" value={f.insurance_expiry||''} onChange={e=>set('insurance_expiry',e.target.value)}/>
        </FL>
        <FL label="Next service">
          <Inp type="date" value={f.next_service_date||''} onChange={e=>set('next_service_date',e.target.value)}/>
        </FL>
      </div>
      <FL label="Notes">
        <textarea value={f.notes||''} onChange={e=>set('notes',e.target.value)}
          style={{...inp, width:'100%', minHeight:48, resize:'vertical', boxSizing:'border-box'}}/>
      </FL>
      <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
        <button onClick={onClose} style={btnSm}>Cancel</button>
        <button onClick={()=>onSave(f)} disabled={busy||!f.name} style={btnP}>
          {busy ? 'Saving…' : 'Save Equipment'}
        </button>
      </div>
    </div>
  );
};

const MaintenanceForm = ({ onSave, onClose, busy }) => {
  const [f, setF] = useState({ maintenance_date:'', maintenance_type:'OIL_CHANGE',
    description:'', hours_at_service:'', cost:'', parts_cost:'', labour_cost:'',
    performed_by:'', invoice_ref:'', next_service_date:'' });
  const set = (k,v) => setF(p=>({...p,[k]:v}));
  const TYPES = ['OIL_CHANGE','FILTER_CHANGE','TYRE_SERVICE','BRAKE_SERVICE',
    'BELT_REPLACEMENT','BLADE_SHARPENING','HYDRAULIC_SERVICE','ELECTRICAL',
    'ANNUAL_SERVICE','REPAIR','INSPECTION','OTHER'];
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <FL label="Date"><Inp type="date" value={f.maintenance_date} onChange={e=>set('maintenance_date',e.target.value)}/></FL>
        <FL label="Type" style={{flex:1,minWidth:160}}>
          <select value={f.maintenance_type} onChange={e=>set('maintenance_type',e.target.value)} style={inp}>
            {TYPES.map(t=><option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}
          </select>
        </FL>
        <FL label="Hours at service">
          <Inp type="number" value={f.hours_at_service} onChange={e=>set('hours_at_service',e.target.value)} style={{width:100}}/>
        </FL>
      </div>
      <FL label="Description">
        <Inp value={f.description} onChange={e=>set('description',e.target.value)} style={{width:'100%'}}/>
      </FL>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <FL label="Total cost (€)">
          <Inp type="number" value={f.cost} onChange={e=>set('cost',e.target.value)} style={{width:100}}/>
        </FL>
        <FL label="Parts (€)">
          <Inp type="number" value={f.parts_cost} onChange={e=>set('parts_cost',e.target.value)} style={{width:90}}/>
        </FL>
        <FL label="Labour (€)">
          <Inp type="number" value={f.labour_cost} onChange={e=>set('labour_cost',e.target.value)} style={{width:90}}/>
        </FL>
        <FL label="Performed by" style={{flex:1,minWidth:130}}>
          <Inp value={f.performed_by} onChange={e=>set('performed_by',e.target.value)}/>
        </FL>
        <FL label="Invoice ref.">
          <Inp value={f.invoice_ref} onChange={e=>set('invoice_ref',e.target.value)} style={{width:110}}/>
        </FL>
        <FL label="Next service date">
          <Inp type="date" value={f.next_service_date} onChange={e=>set('next_service_date',e.target.value)}/>
        </FL>
      </div>
      <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
        <button onClick={onClose} style={btnSm}>Cancel</button>
        <button onClick={()=>onSave(f)} disabled={busy||!f.maintenance_date} style={btnP}>
          {busy ? 'Saving…' : 'Log Service'}
        </button>
      </div>
    </div>
  );
};

const UsageForm = ({ onSave, onClose, busy }) => {
  const [f, setF] = useState({ used_date:'', hours_start:'', hours_end:'',
    hours_worked:'', area_ha:'', fuel_consumed_l:'', fuel_cost:'', operator_name:'', notes:'' });
  const set = (k,v) => setF(p=>({...p,[k]:v}));
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <FL label="Date"><Inp type="date" value={f.used_date} onChange={e=>set('used_date',e.target.value)}/></FL>
        <FL label="Hours start">
          <Inp type="number" value={f.hours_start} onChange={e=>set('hours_start',e.target.value)} style={{width:90}}/>
        </FL>
        <FL label="Hours end">
          <Inp type="number" value={f.hours_end} onChange={e=>set('hours_end',e.target.value)} style={{width:90}}/>
        </FL>
        <FL label="Hours worked" title="Override auto-calc from start/end">
          <Inp type="number" value={f.hours_worked} onChange={e=>set('hours_worked',e.target.value)} style={{width:90}}/>
        </FL>
        <FL label="Area (ha)">
          <Inp type="number" value={f.area_ha} onChange={e=>set('area_ha',e.target.value)} style={{width:80}}/>
        </FL>
        <FL label="Fuel (L)">
          <Inp type="number" value={f.fuel_consumed_l} onChange={e=>set('fuel_consumed_l',e.target.value)} style={{width:80}}/>
        </FL>
        <FL label="Fuel cost (€)">
          <Inp type="number" value={f.fuel_cost} onChange={e=>set('fuel_cost',e.target.value)} style={{width:90}}/>
        </FL>
        <FL label="Operator" style={{flex:1,minWidth:130}}>
          <Inp value={f.operator_name} onChange={e=>set('operator_name',e.target.value)}/>
        </FL>
      </div>
      <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
        <button onClick={onClose} style={btnSm}>Cancel</button>
        <button onClick={()=>onSave(f)} disabled={busy||!f.used_date} style={btnP}>
          {busy ? 'Saving…' : 'Log Usage'}
        </button>
      </div>
    </div>
  );
};

const EquipmentCard = ({ eq, onEdit, onDelete, onRefresh, userId }) => {
  const [expanded, setExpanded] = useState(false);
  const [showMaint, setShowMaint] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [maintenance, setMaintenance] = useState([]);
  const [usage, setUsage]             = useState([]);
  const [loadedSub, setLoadedSub]     = useState(false);
  const [busy, setBusy] = useState(false);

  const loadSub = async () => {
    if (loadedSub) return;
    const [m, u] = await Promise.all([
      api.get(`${BASE_EQ}/${eq.id}/maintenance?user_id=${userId}`),
      api.get(`${BASE_EQ}/${eq.id}/usage?user_id=${userId}`),
    ]);
    setMaintenance(Array.isArray(m.data) ? m.data : []);
    setUsage(Array.isArray(u.data) ? u.data : []);
    setLoadedSub(true);
  };

  const toggle = () => {
    if (!expanded) loadSub();
    setExpanded(v => !v);
  };

  const saveMaint = async (data) => {
    setBusy(true);
    try {
      await api.post(`${BASE_EQ}/${eq.id}/maintenance?user_id=${userId}`, sanitise(data));
      setShowMaint(false); setLoadedSub(false); loadSub(); onRefresh();
    } catch { alert('Failed to save maintenance'); }
    finally { setBusy(false); }
  };

  const saveUsage = async (data) => {
    setBusy(true);
    try {
      await api.post(`${BASE_EQ}/${eq.id}/usage?user_id=${userId}`, sanitise(data));
      setShowUsage(false); setLoadedSub(false); loadSub(); onRefresh();
    } catch { alert('Failed to save usage'); }
    finally { setBusy(false); }
  };

  const deleteMaint = async (id) => {
    if (!window.confirm('Delete this service record?')) return;
    await api.delete(`${BASE_EQ}/${eq.id}/maintenance/${id}?user_id=${userId}`);
    setLoadedSub(false); loadSub();
  };

  const serviceOverdue = eq.next_service_date && new Date(eq.next_service_date) < new Date();

  return (
    <div style={{ background:'#fff', border:'1px solid #e0d8cf', borderRadius:10,
      overflow:'hidden', borderLeft: serviceOverdue ? '4px solid #f57f17' : '4px solid #e0d8cf' }}>
      {/* Row */}
      <div onClick={toggle} style={{ display:'flex', alignItems:'center',
        gap:10, padding:'10px 14px', cursor:'pointer', userSelect:'none' }}>
        <span style={{ fontSize:22, flexShrink:0 }}>{EQ_ICONS[eq.equipment_type]||'🔧'}</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <span style={{ fontWeight:700, fontSize:13, color:'#333' }}>{eq.name}</span>
            <StatusDot status={eq.status}/>
            <span style={{ fontSize:11, color:'#888' }}>{eq.equipment_type.replace(/_/g,' ')}</span>
            {eq.manufacturer && <span style={{ fontSize:11, color:'#aaa' }}>{eq.manufacturer} {eq.model}</span>}
          </div>
          <div style={{ display:'flex', gap:12, marginTop:3, flexWrap:'wrap', fontSize:11, color:'#aaa' }}>
            {eq.year_of_manufacture && <span>{eq.year_of_manufacture}</span>}
            {eq.power_kw            && <span>{eq.power_kw} kW</span>}
            {eq.hours_current != null && <span>⏱ {Number(eq.hours_current).toFixed(0)} h current</span>}
            {eq.registration_plate  && <span>🔖 {eq.registration_plate}</span>}
            {serviceOverdue && (
              <span style={{ color:'#f57f17', fontWeight:700 }}>⚠ Service overdue</span>
            )}
          </div>
        </div>
        <div style={{ display:'flex', gap:12, alignItems:'center', flexShrink:0 }}>
          {eq.total_hours_logged != null && (
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#333' }}>
                {Number(eq.total_hours_logged).toFixed(0)}h
              </div>
              <div style={{ fontSize:10, color:'#aaa' }}>logged</div>
            </div>
          )}
          <span style={{ color:'#ccc', fontSize:11 }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded */}
      {expanded && (
        <div style={{ borderTop:'1px solid #ede7df', padding:'12px 14px', background:'#fafaf8' }}>
          <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
            <button onClick={()=>onEdit(eq)} style={btnSm}>✏️ Edit</button>
            <button onClick={()=>setShowMaint(v=>!v)} style={btnSm}>🔧 Log service</button>
            <button onClick={()=>setShowUsage(v=>!v)} style={btnSm}>⏱ Log usage</button>
            <button onClick={()=>onDelete(eq.id)}
              style={{...btnSm, color:'#c62828', borderColor:'#ef9a9a'}}>🗑 Delete</button>
          </div>

          {showMaint && (
            <div style={{ marginBottom:12, background:'#fff', borderRadius:8,
              border:'1px solid #e0d8cf', padding:'12px 14px' }}>
              <div style={{ fontWeight:700, fontSize:12, marginBottom:10 }}>🔧 Log Service / Maintenance</div>
              <MaintenanceForm onSave={saveMaint} onClose={()=>setShowMaint(false)} busy={busy}/>
            </div>
          )}

          {showUsage && (
            <div style={{ marginBottom:12, background:'#fff', borderRadius:8,
              border:'1px solid #e0d8cf', padding:'12px 14px' }}>
              <div style={{ fontWeight:700, fontSize:12, marginBottom:10 }}>⏱ Log Usage Session</div>
              <UsageForm onSave={saveUsage} onClose={()=>setShowUsage(false)} busy={busy}/>
            </div>
          )}

          {/* Maintenance history */}
          {maintenance.length > 0 && (
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:10, fontWeight:700, color:'#aaa',
                textTransform:'uppercase', marginBottom:6 }}>Service history</div>
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {maintenance.map(m => (
                  <div key={m.id} style={{ display:'flex', alignItems:'center', gap:10,
                    background:'#fff', borderRadius:6, padding:'6px 10px',
                    border:'1px solid #ede7df', fontSize:11 }}>
                    <span style={{ color:'#6b4c2a', fontWeight:700, flexShrink:0 }}>{m.maintenance_date}</span>
                    <span style={{ flex:1, fontWeight:600 }}>{m.maintenance_type.replace(/_/g,' ')}</span>
                    {m.description && <span style={{ color:'#888' }}>{m.description}</span>}
                    {m.cost && <span style={{ color:'#555' }}>€{Number(m.cost).toFixed(0)}</span>}
                    {m.hours_at_service && <span style={{ color:'#aaa' }}>{m.hours_at_service}h</span>}
                    <button onClick={()=>deleteMaint(m.id)}
                      style={{...btnSm, color:'#c62828', borderColor:'#ef9a9a', padding:'2px 8px'}}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Usage history */}
          {usage.length > 0 && (
            <div>
              <div style={{ fontSize:10, fontWeight:700, color:'#aaa',
                textTransform:'uppercase', marginBottom:6 }}>Usage log</div>
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {usage.slice(0, 8).map(u => (
                  <div key={u.id} style={{ display:'flex', alignItems:'center', gap:10,
                    background:'#fff', borderRadius:6, padding:'6px 10px',
                    border:'1px solid #ede7df', fontSize:11 }}>
                    <span style={{ color:'#6b4c2a', fontWeight:700, flexShrink:0 }}>{u.used_date}</span>
                    {u.hours_worked && <span style={{ fontWeight:600 }}>{u.hours_worked}h</span>}
                    {u.area_ha      && <span style={{ color:'#388e3c' }}>{u.area_ha} ha</span>}
                    {u.fuel_consumed_l && <span style={{ color:'#0d47a1' }}>{u.fuel_consumed_l}L</span>}
                    {u.operator_name   && <span style={{ color:'#888' }}>{u.operator_name}</span>}
                    {u.field_label     && <span style={{ color:'#aaa' }}>📍 {u.field_label}</span>}
                  </div>
                ))}
                {usage.length > 8 && (
                  <div style={{ fontSize:11, color:'#aaa', padding:'4px 0' }}>
                    + {usage.length - 8} more entries
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quick specs */}
          <div style={{ display:'flex', gap:16, flexWrap:'wrap', fontSize:11,
            color:'#888', marginTop:8, borderTop:'1px solid #f0ebe3', paddingTop:8 }}>
            {eq.serial_number  && <span>S/N: {eq.serial_number}</span>}
            {eq.fuel_type      && <span>⛽ {eq.fuel_type}</span>}
            {eq.working_width_m && <span>↔ {eq.working_width_m}m</span>}
            {eq.next_service_date && (
              <span style={{ color: serviceOverdue ? '#c62828' : '#555', fontWeight: serviceOverdue ? 700 : 400 }}>
                🔧 Next service: {eq.next_service_date}
              </span>
            )}
            {eq.insurance_expiry && <span>📋 Insurance: {eq.insurance_expiry}</span>}
            {eq.purchase_price  && <span>💶 {Number(eq.purchase_price).toFixed(0)} €</span>}
          </div>
        </div>
      )}
    </div>
  );
};

const EquipmentTab = ({ userId }) => {
  const [fleet, setFleet]       = useState([]);
  const [summary, setSummary]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [busy, setBusy]         = useState(false);
  const [filterStatus, setFilterStatus] = useState('ALL');

  const load = useCallback(() => {
    if (!userId) return;
    setLoading(true);
    Promise.all([
      api.get(`${BASE_EQ}/user`),
      api.get(`${BASE_EQ}/summary/user`),
    ])
      .then(([f, s]) => {
        setFleet(Array.isArray(f.data) ? f.data : []);
        setSummary(s.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const saveNew = async (data) => {
    setBusy(true);
    try {
      await api.post(`${BASE_EQ}/create?user_id=${userId}`, sanitise(data));
      setShowForm(false); load();
    } catch { alert('Failed to save'); }
    finally { setBusy(false); }
  };

  const saveEdit = async (data) => {
    setBusy(true);
    try {
      await api.patch(`${BASE_EQ}/${editing.id}?user_id=${userId}`, sanitise(data));
      setEditing(null); load();
    } catch { alert('Failed to update'); }
    finally { setBusy(false); }
  };

  const deleteEq = async (id) => {
    if (!window.confirm('Delete this equipment record?')) return;
    await api.delete(`${BASE_EQ}/${id}?user_id=${userId}`);
    load();
  };

  const statuses = ['ALL', 'OPERATIONAL', 'IN_USE', 'MAINTENANCE', 'REPAIR', 'IDLE', 'RETIRED'];
  const visible  = filterStatus === 'ALL' ? fleet
    : fleet.filter(e => e.status === filterStatus);

  return (
    <div>
      {(showForm || editing) && (
        <Modal title={editing ? '✏️ Edit Equipment' : '🚜 Add Equipment'}
          onClose={()=>{ setShowForm(false); setEditing(null); }} width={620}>
          <EquipmentForm
            initial={editing}
            onSave={editing ? saveEdit : saveNew}
            onClose={()=>{ setShowForm(false); setEditing(null); }}
            busy={busy}
          />
        </Modal>
      )}

      {/* Summary cards */}
      {summary && (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
          <Card icon="🚜" label="Fleet total"     value={summary.total}                   color="#6b4c2a"/>
          <Card icon="✅" label="Operational"
            value={(summary.by_status?.OPERATIONAL||0)+(summary.by_status?.IN_USE||0)}    color="#2e7d32"/>
          <Card icon="⏱"  label="Hours (YTD)"
            value={summary.year_hours_logged ? `${Number(summary.year_hours_logged).toFixed(0)}h` : '—'}
            color="#0d47a1"/>
          {summary.overdue_service > 0 && (
            <Card icon="⚠️" label="Service overdue" value={summary.overdue_service}       color="#c62828"/>
          )}
        </div>
      )}

      {/* Status filter */}
      <div style={{ display:'flex', gap:0, border:'1px solid #e0d8cf', borderRadius:8,
        overflow:'hidden', width:'fit-content', marginBottom:12 }}>
        {statuses.map(s => (
          <button key={s} onClick={()=>setFilterStatus(s)} style={{
            padding:'5px 10px', fontSize:10, fontWeight:700, border:'none', cursor:'pointer',
            background: filterStatus===s ? 'var(--color-accent-soil,#6b4c2a)' : '#f5f0ea',
            color: filterStatus===s ? '#fff' : '#888', textTransform:'uppercase', letterSpacing:'0.03em' }}>
            {s === 'ALL' ? 'All' : s.replace(/_/g,' ')}
          </button>
        ))}
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:12 }}>
        <button onClick={()=>setShowForm(true)} style={{...btnP, display:'flex', gap:6, alignItems:'center'}}>
          + Add Equipment
        </button>
      </div>

      {loading
        ? <EmptyMsg text="Loading fleet…"/>
        : visible.length === 0
          ? <EmptyMsg text={fleet.length === 0
              ? 'No equipment added yet. Click + Add Equipment.'
              : 'No equipment matches this filter.'}/>
          : (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {visible.map(eq => (
                <EquipmentCard key={eq.id} eq={eq} userId={userId}
                  onEdit={setEditing} onDelete={deleteEq} onRefresh={load}/>
              ))}
            </div>
          )
      }
    </div>
  );
};


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
    api.get(`${BASE}/report/summary`, { params: { year } })
      .then(r => setSummary(r.data))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [userId, year]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const resp = await api.get(`${BASE}/report/pdf`, {
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
    ['status',     '📋 Status'],
    ['personnel',  '👥 Personnel'],
    ['equipment',  '🚜 Equipment'],
    ['guide',      '📖 Guide'],
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

          {/* ── PERSONNEL TAB ── */}
          {tab === 'personnel' && (
            <PersonnelTab userId={userId}/>
          )}

          {/* ── EQUIPMENT TAB ── */}
          {tab === 'equipment' && (
            <EquipmentTab userId={userId}/>
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