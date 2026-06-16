import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Legend, CartesianGrid,
} from 'recharts';
import api from '../api/client';

const BASE      = '/api/v1/fieldwork';
const BASE_EQ   = '/api/v1/equipment';

// WORK_TYPES used in the Generic form.
// SOWING → use the 🌾 Sowing tab  (creates a SeasonRecord, eGN 3.3)
// FERTILIZATION → use the 🧪 Fertilization tab  (captures NPK detail, eGN 3.4)
// SPRAYING → use the 💧 Spraying tab  (captures pesticide/PPP detail, eGN 3.5)
// PLANTING is kept here because it does NOT create a SeasonRecord.
const WORK_TYPES = [
  'PLOWING','SUBSOILING','DISCING','HARROWING','CULTIVATION','ROLLING',
  'PLANTING','IRRIGATION','WEEDING',
  'PRUNING','GRAFTING','MULCHING','THINNING','TRELLIS_REPAIR',
  'MOWING','RAKING','BALING','GRAZING','HARVESTING','DESICCATION',
  'SOIL_SAMPLING','MAINTENANCE',
];

// The three specialist types that must go through their own dedicated forms.
const SPECIALIST_TYPES = {
  SOWING:        { tab: 'sowing',        label: '🌾 Sowing',        reason: 'Creates a Season Record (eGN 3.3). Use the Sowing tab.' },
  FERTILIZATION: { tab: 'fertilization', label: '🧪 Fertilization', reason: 'Requires NPK detail (eGN 3.4). Use the Fertilization tab.' },
  SPRAYING:      { tab: 'spraying',      label: '💧 Spraying',      reason: 'Requires pesticide/PPP data (eGN 3.5). Use the Spraying tab.' },
};

const CROPS = [
  'WHEAT_WINTER','WHEAT_SPRING','BARLEY','CORN','OATS','RYE','RICE',
  'PEAS','SOYBEANS','CHICKPEAS','LENTILS',
  'SUNFLOWER','RAPESEED_WINTER','RAPESEED_SPRING','FLAX',
  'SUGAR_BEET','POTATOES','COTTON',
  'ALFALFA','SILAGE_CORN','CLOVER','GRASS_MIX',
  'APPLE','PEAR','CHERRY','GRAPES_WINE','GRAPES_TABLE','STRAWBERRY','BLUEBERRY',
  'TOMATO','ONION','CARROT','CABBAGE',
  'FALLOW','COVER_CROP','OTHER',
];

const FERT_METHODS = ['BROADCAST','INJECTION','INCORPORATION','FOLIAR','FERTIGATION','BAND_PLACEMENT','TOP_DRESSING','SIDE_DRESSING','OTHER'];
const PEST_TARGETS = ['PEST','DISEASE','WEED','GROWTH','OTHER'];
const SEED_TREATMENTS = ['NONE','FUNGICIDE','INSECTICIDE','COMBINED','BIOLOGICAL','PELLETING','OTHER'];
const TILLAGE_TYPES = ['CONVENTIONAL','MINIMUM','NO_TILL','STRIP_TILL','DEEP_LOOSENING'];

const STATUS_CFG = {
  DRAFT:       { bg: '#f5f5f5', text: '#757575', border: '#e0e0e0' },
  PLANNED:     { bg: '#e3f2fd', text: '#0d47a1', border: '#90caf9' },
  SCHEDULED:   { bg: '#e8eaf6', text: '#283593', border: '#9fa8da' },
  ON_HOLD:     { bg: '#fff9c4', text: '#f57f17', border: '#fff176' },
  IN_PROGRESS: { bg: '#e1f5fe', text: '#01579b', border: '#81d4fa' },
  COMPLETED:   { bg: '#e8f5e9', text: '#1b5e20', border: '#a5d6a7' },
  VERIFIED:    { bg: '#f3e5f5', text: '#4a148c', border: '#ce93d8' },
  CANCELLED:   { bg: '#f5f5f5', text: '#9e9e9e', border: '#e0e0e0' },
  FAILED:      { bg: '#fce4ec', text: '#b71c1c', border: '#ef9a9a' },
};
const STATUS_COLORS = {
  DRAFT:'#bdbdbd', PLANNED:'#1565c0', SCHEDULED:'#283593', ON_HOLD:'#f9a825',
  IN_PROGRESS:'#0277bd', COMPLETED:'#2e7d32', VERIFIED:'#6a1b9a',
  CANCELLED:'#9e9e9e', FAILED:'#c62828',
};
const WORK_ICONS = {
  PLOWING:'🚜', SUBSOILING:'⛏️', DISCING:'⚙️', HARROWING:'🔧', CULTIVATION:'🌱',
  ROLLING:'🛞', SOWING:'🌾', PLANTING:'🪴', FERTILIZATION:'🧪', SPRAYING:'💧',
  IRRIGATION:'🚿', WEEDING:'🌿', PRUNING:'✂️', GRAFTING:'🔗', MULCHING:'🍂',
  THINNING:'🔪', TRELLIS_REPAIR:'🪝', MOWING:'🌿', RAKING:'🪣', BALING:'📦',
  GRAZING:'🐄', HARVESTING:'🌾', DESICCATION:'☀️', SOIL_SAMPLING:'🧫',
  MAINTENANCE:'🔨',
};
const PALETTE = [
  '#6b4c2a','#054e05','#8d6e63','#388e3c','#5d4037',
  '#2e7d32','#a1887f','#1b5e20','#795548','#4caf50',
  '#bf360c','#e65100','#827717','#f9a825',
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtEur = v => `${Number(v || 0).toFixed(0)} €`;
const fmtTon = v => `${Number(v || 0).toFixed(2)} t`;
const fmtPct = v => `${Math.round((v || 0) * 100)}%`;
const fmtHa  = v => v != null ? `${Number(v).toFixed(1)} ha` : '—';
const fmtDate = v => v ? new Date(v).toLocaleDateString('hu-HU') : '—';
const todayStr = () => new Date().toISOString().slice(0, 16);
const todayDate = () => new Date().toISOString().slice(0, 10);

// ── Shared UI atoms ───────────────────────────────────────────────────────────
const YearPicker = ({ year, setYear }) => {
  const cur = new Date().getFullYear();
  return (
    <div style={{ display:'flex', gap:0, border:'1px solid #e0d8cf', borderRadius:8,
      overflow:'hidden', width:'fit-content', marginBottom:18 }}>
      {Array.from({length:5},(_,i)=>cur-i).map(y => (
        <button key={y} onClick={()=>setYear(y)} style={{
          padding:'5px 14px', fontSize:12, fontWeight:700, border:'none', cursor:'pointer',
          background: year===y ? 'var(--color-accent-soil,#6b4c2a)' : '#f5f0ea',
          color: year===y ? '#fff' : '#888',
        }}>{y}</button>
      ))}
    </div>
  );
};

const Sec = ({ children }) => (
  <div style={{ fontSize:10, fontWeight:700, color:'#aaa', textTransform:'uppercase',
    letterSpacing:'0.07em', marginBottom:8, marginTop:2 }}>{children}</div>
);

const Card = ({ icon, label, value, sub, color='#6b4c2a' }) => (
  <div style={{ flex:'1 1 130px', background:'#fff', borderRadius:10, padding:'12px 14px',
    border:'1px solid #e8e0d8', borderLeft:`4px solid ${color}` }}>
    <div style={{ fontSize:18, marginBottom:3 }}>{icon}</div>
    <div style={{ fontSize:10, color:'#aaa', fontWeight:600, marginBottom:1 }}>{label}</div>
    <div style={{ fontSize:19, fontWeight:800, color:'#333' }}>{value}</div>
    {sub && <div style={{ fontSize:11, color:'#bbb', marginTop:1 }}>{sub}</div>}
  </div>
);

const ChartBox = ({ children, style }) => (
  <div style={{ background:'#fafaf8', borderRadius:10, border:'1px solid #ede7df',
    padding:'12px 14px', ...style }}>{children}</div>
);

const EmptyState = ({ text }) => (
  <div style={{ color:'#ccc', textAlign:'center', padding:'24px 0', fontSize:13 }}>{text}</div>
);

const StatusPill = ({ status }) => {
  const c = STATUS_CFG[status] || STATUS_CFG.PLANNED;
  return (
    <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20,
      background:c.bg, color:c.text, border:`1px solid ${c.border}`,
      textTransform:'uppercase', letterSpacing:'0.05em', whiteSpace:'nowrap' }}>
      {status.replace(/_/g,' ')}
    </span>
  );
};

const FieldPill = ({ text }) => (
  <span style={{ fontSize:11, color:'#888', background:'#f5f0ea', borderRadius:6, padding:'1px 7px' }}>
    {text}
  </span>
);

// ── Form field atoms ──────────────────────────────────────────────────────────
const FL = ({ label, children }) => (
  <label style={lbl}>{label}{children}</label>
);
const Inp = (props) => <input {...props} style={{...inp, ...props.style}}/>;
// ── Tab selector for create forms ─────────────────────────────────────────────
const CreateTabs = ({ active, setActive }) => {
  const tabs = [
    { id:'generic',      label:'⚙️ Generic' },
    { id:'sowing',       label:'🌾 Sowing' },
    { id:'fertilization',label:'🧪 Fertilization' },
    { id:'spraying',     label:'💧 Spraying' },
  ];
  return (
    <div style={{ display:'flex', gap:0, border:'1px solid #e0d8cf', borderRadius:8,
      overflow:'hidden', marginBottom:14, width:'fit-content' }}>
      {tabs.map(t=>(
        <button key={t.id} onClick={()=>setActive(t.id)} style={{
          padding:'5px 14px', fontSize:12, fontWeight:700, border:'none', cursor:'pointer',
          background: active===t.id ? 'var(--color-accent-soil,#6b4c2a)' : '#f5f0ea',
          color: active===t.id ? '#fff' : '#888',
        }}>{t.label}</button>
      ))}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// CREATE FORMS
// ══════════════════════════════════════════════════════════════════════════════

// Generic ──────────────────────────────────────────────────────────────────────
const GenericForm = ({ userId, fields, onCreated, onSwitchTab }) => {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    field_id:'', work_type:'PLOWING', work_status:'PLANNED',
    work_date: todayStr(), work_cost:'', harvest_ton:'',
    operator_name:'', equipment:'', note:'',
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  useEffect(()=>{ if(fields.length && !form.field_id) set('field_id', fields[0].id); },[fields]); // eslint-disable-line

  const specialist = SPECIALIST_TYPES[form.work_type];

  const submit = async () => {
    if (!form.field_id || specialist) return;
    setBusy(true);
    try {
      await api.post(`${BASE}/create`, {
        user_id: userId, field_id: Number(form.field_id),
        work_type: form.work_type, work_status: form.work_status,
        work_date: new Date(form.work_date).toISOString(),
        work_cost: form.work_cost ? Number(form.work_cost) : null,
        harvest_ton: form.harvest_ton ? Number(form.harvest_ton) : null,
        operator_name: form.operator_name || null,
        equipment: form.equipment || null,
        extra_metadata: form.note ? { note: form.note } : null,
      });
      onCreated();
    } catch { alert('Failed to save'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      {specialist && (
        <div style={{ marginBottom:12, background:'#fff8e1', border:'1px solid #ffe082',
          borderLeft:'4px solid #f9a825', borderRadius:8, padding:'10px 14px',
          display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
          <div>
            <div style={{ fontWeight:700, fontSize:13, color:'#333', marginBottom:2 }}>
              {specialist.label} requires a dedicated form
            </div>
            <div style={{ fontSize:11, color:'#888' }}>{specialist.reason}</div>
          </div>
          <button onClick={()=>onSwitchTab(specialist.tab)} style={{
            background:'#f9a825', color:'#fff', border:'none', borderRadius:6,
            padding:'6px 14px', fontWeight:700, fontSize:12, cursor:'pointer', whiteSpace:'nowrap',
          }}>
            Switch to {specialist.label} →
          </button>
        </div>
      )}
      <div style={{ display:'flex', flexWrap:'wrap', gap:12, alignItems:'flex-end' }}>
        <FieldSelector fields={fields} value={form.field_id} onChange={v=>set('field_id',v)}/>
        <FL label="Work type">
          <select value={form.work_type} onChange={e=>set('work_type',e.target.value)} style={inp}>
            <optgroup label="General operations">
              {WORK_TYPES.map(tp=><option key={tp} value={tp}>{WORK_ICONS[tp]||'🌾'} {tp.replace(/_/g,' ')}</option>)}
            </optgroup>
            <optgroup label="⚠️ Use dedicated tab instead">
              {Object.entries(SPECIALIST_TYPES).map(([tp,s])=><option key={tp} value={tp}>{s.label}</option>)}
            </optgroup>
          </select>
        </FL>
        <FL label="Status">
          <select value={form.work_status} onChange={e=>set('work_status',e.target.value)} style={inp}>
            {Object.keys(STATUS_CFG).map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
          </select>
        </FL>
        <FL label="Date"><Inp type="datetime-local" value={form.work_date} onChange={e=>set('work_date',e.target.value)}/></FL>
        <FL label="Cost (€)"><Inp type="number" value={form.work_cost} onChange={e=>set('work_cost',e.target.value)} style={{width:100}}/></FL>
        <FL label="Harvest (t)"><Inp type="number" value={form.harvest_ton} onChange={e=>set('harvest_ton',e.target.value)} style={{width:110}}/></FL>
        <FL label="Operator"><Inp value={form.operator_name} onChange={e=>set('operator_name',e.target.value)} style={{width:140}}/></FL>
        <FL label="Equipment"><Inp value={form.equipment} onChange={e=>set('equipment',e.target.value)} style={{width:140}}/></FL>
        <FL label="Note" style={{flex:1,minWidth:200}}><Inp value={form.note} onChange={e=>set('note',e.target.value)} style={{width:'100%'}}/></FL>
      </div>
      <div style={{ marginTop:12 }}>
        <button onClick={submit} disabled={busy||!!specialist}
          title={specialist ? `Use the ${specialist.label} tab for this operation type` : undefined}
          style={{...btnPrimary, opacity: specialist ? 0.4 : 1, cursor: specialist ? 'not-allowed' : 'pointer'}}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {specialist && (
          <span style={{ marginLeft:10, fontSize:11, color:'#aaa', fontStyle:'italic' }}>
            Select a general operation type to enable Save
          </span>
        )}
      </div>
    </div>
  );
};

// Sowing / planting ────────────────────────────────────────────────────────────
const SowingForm = ({ userId, fields, onCreated }) => {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    field_id:'', work_date: todayStr(), work_status:'COMPLETED',
    season_year: new Date().getFullYear(), crop:'CORN', variety:'',
    sowing_date: todayDate(), sowing_rate_kg_ha:'',
    seed_treatment:'NONE', seed_treatment_note:'',
    tillage_type:'MINIMUM', operator_name:'', equipment:'', work_cost:'', notes:'',
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  useEffect(()=>{ if(fields.length && !form.field_id) set('field_id', fields[0].id); },[fields]); // eslint-disable-line

  const submit = async () => {
    if (!form.field_id || !form.crop) return;
    setBusy(true);
    try {
      await api.post(`${BASE}/sowing`, {
        user_id: userId, field_id: Number(form.field_id),
        work_date: new Date(form.work_date).toISOString(),
        work_status: form.work_status,
        season_year: Number(form.season_year), crop: form.crop,
        variety: form.variety || null, sowing_date: form.sowing_date || null,
        sowing_rate_kg_ha: form.sowing_rate_kg_ha ? Number(form.sowing_rate_kg_ha) : null,
        seed_treatment: form.seed_treatment, seed_treatment_note: form.seed_treatment_note || null,
        tillage_type: form.tillage_type || null,
        operator_name: form.operator_name || null, equipment: form.equipment || null,
        work_cost: form.work_cost ? Number(form.work_cost) : null,
        notes: form.notes || null,
      });
      onCreated();
    } catch { alert('Failed to save sowing record'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ fontSize:11, color:'#888', marginBottom:10, background:'#f0f7f0', borderRadius:6,
        padding:'6px 10px', borderLeft:'3px solid #388e3c' }}>
        Creates a sowing operation and a <strong>Season Record</strong> for crop rotation tracking (eGN 3.3)
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:12, alignItems:'flex-end' }}>
        <FieldSelector fields={fields} value={form.field_id} onChange={v=>set('field_id',v)}/>
        <FL label="Season year"><Inp type="number" value={form.season_year} onChange={e=>set('season_year',e.target.value)} style={{width:90}}/></FL>
        <FL label="Crop">
          <select value={form.crop} onChange={e=>set('crop',e.target.value)} style={inp}>
            {CROPS.map(c=><option key={c} value={c}>{c.replace(/_/g,' ')}</option>)}
          </select>
        </FL>
        <FL label="Variety / hybrid"><Inp value={form.variety} onChange={e=>set('variety',e.target.value)} style={{width:160}} placeholder="e.g. DKC 3939"/></FL>
        <FL label="Sowing date"><Inp type="date" value={form.sowing_date} onChange={e=>set('sowing_date',e.target.value)}/></FL>
        <FL label="Sowing rate (kg/ha)"><Inp type="number" value={form.sowing_rate_kg_ha} onChange={e=>set('sowing_rate_kg_ha',e.target.value)} style={{width:120}}/></FL>
        <FL label="Seed treatment">
          <select value={form.seed_treatment} onChange={e=>set('seed_treatment',e.target.value)} style={inp}>
            {SEED_TREATMENTS.map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
          </select>
        </FL>
        {form.seed_treatment !== 'NONE' && (
          <FL label="Treatment note"><Inp value={form.seed_treatment_note} onChange={e=>set('seed_treatment_note',e.target.value)} style={{width:200}}/></FL>
        )}
        <FL label="Tillage system">
          <select value={form.tillage_type} onChange={e=>set('tillage_type',e.target.value)} style={inp}>
            {TILLAGE_TYPES.map(t=><option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}
          </select>
        </FL>
        <FL label="Operator"><Inp value={form.operator_name} onChange={e=>set('operator_name',e.target.value)} style={{width:140}}/></FL>
        <FL label="Equipment"><Inp value={form.equipment} onChange={e=>set('equipment',e.target.value)} style={{width:140}}/></FL>
        <FL label="Cost (€)"><Inp type="number" value={form.work_cost} onChange={e=>set('work_cost',e.target.value)} style={{width:100}}/></FL>
        <FL label="Notes"><Inp value={form.notes} onChange={e=>set('notes',e.target.value)} style={{width:220}}/></FL>
      </div>
      <div style={{ marginTop:12 }}>
        <button onClick={submit} disabled={busy} style={{...btnPrimary, background:'#2e7d32'}}>{busy ? 'Saving…' : '🌾 Save Sowing'}</button>
      </div>
    </div>
  );
};

// Fertilization ────────────────────────────────────────────────────────────────
const FertilizationForm = ({ userId, fields, onCreated }) => {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    field_id:'', work_date: todayStr(), work_status:'COMPLETED',
    application_date: todayDate(),
    product_name:'', product_type:'NPK', is_organic: false,
    n_kg_ha:'', p2o5_kg_ha:'', k2o_kg_ha:'', s_kg_ha:'', mg_kg_ha:'',
    dose_kg_ha:'', total_dose_kg:'', application_method:'BROADCAST',
    operator_name:'', equipment:'', work_cost:'', notes:'',
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  useEffect(()=>{ if(fields.length && !form.field_id) set('field_id', fields[0].id); },[fields]); // eslint-disable-line

  const submit = async () => {
    if (!form.field_id) return;
    setBusy(true);
    try {
      await api.post(`${BASE}/fertilization`, {
        user_id: userId, field_id: Number(form.field_id),
        work_date: new Date(form.work_date).toISOString(),
        work_status: form.work_status,
        application_date: form.application_date || null,
        product_name: form.product_name || null,
        product_type: form.product_type || null,
        is_organic: form.is_organic,
        n_kg_ha:    form.n_kg_ha    ? Number(form.n_kg_ha)    : null,
        p2o5_kg_ha: form.p2o5_kg_ha ? Number(form.p2o5_kg_ha) : null,
        k2o_kg_ha:  form.k2o_kg_ha  ? Number(form.k2o_kg_ha)  : null,
        s_kg_ha:    form.s_kg_ha    ? Number(form.s_kg_ha)    : null,
        mg_kg_ha:   form.mg_kg_ha   ? Number(form.mg_kg_ha)   : null,
        dose_kg_ha:    form.dose_kg_ha    ? Number(form.dose_kg_ha)    : null,
        total_dose_kg: form.total_dose_kg ? Number(form.total_dose_kg) : null,
        application_method: form.application_method || null,
        operator_name: form.operator_name || null, equipment: form.equipment || null,
        work_cost: form.work_cost ? Number(form.work_cost) : null,
        notes: form.notes || null,
      });
      onCreated();
    } catch { alert('Failed to save fertilization record'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ fontSize:11, color:'#888', marginBottom:10, background:'#fff8e1', borderRadius:6,
        padding:'6px 10px', borderLeft:'3px solid #f9a825' }}>
        Full fertilization record with NPK active substances (eGN 3.4)
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:12, alignItems:'flex-end' }}>
        <FieldSelector fields={fields} value={form.field_id} onChange={v=>set('field_id',v)}/>
        <FL label="Application date"><Inp type="date" value={form.application_date} onChange={e=>set('application_date',e.target.value)}/></FL>
        <FL label="Product name"><Inp value={form.product_name} onChange={e=>set('product_name',e.target.value)} style={{width:180}} placeholder="e.g. Urea 46%"/></FL>
        <FL label="Product type"><Inp value={form.product_type} onChange={e=>set('product_type',e.target.value)} style={{width:120}} placeholder="NPK / organic / N"/></FL>
        <FL label="Organic">
          <div style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 0' }}>
            <input type="checkbox" checked={form.is_organic} onChange={e=>set('is_organic',e.target.checked)}/>
            <span style={{ fontSize:12, color:'#555' }}>Yes</span>
          </div>
        </FL>

        <div style={{ width:'100%', borderTop:'1px dashed #e0d8cf', paddingTop:10 }}>
          <Sec>Active substances (kg/ha)</Sec>
          <div style={{ display:'flex', flexWrap:'wrap', gap:12 }}>
            <FL label="N (kg/ha)"><Inp type="number" value={form.n_kg_ha} onChange={e=>set('n_kg_ha',e.target.value)} style={{width:90}}/></FL>
            <FL label="P₂O₅ (kg/ha)"><Inp type="number" value={form.p2o5_kg_ha} onChange={e=>set('p2o5_kg_ha',e.target.value)} style={{width:100}}/></FL>
            <FL label="K₂O (kg/ha)"><Inp type="number" value={form.k2o_kg_ha} onChange={e=>set('k2o_kg_ha',e.target.value)} style={{width:95}}/></FL>
            <FL label="S (kg/ha)"><Inp type="number" value={form.s_kg_ha} onChange={e=>set('s_kg_ha',e.target.value)} style={{width:85}}/></FL>
            <FL label="Mg (kg/ha)"><Inp type="number" value={form.mg_kg_ha} onChange={e=>set('mg_kg_ha',e.target.value)} style={{width:90}}/></FL>
          </div>
        </div>

        <div style={{ width:'100%', borderTop:'1px dashed #e0d8cf', paddingTop:10 }}>
          <Sec>Dosage & application</Sec>
          <div style={{ display:'flex', flexWrap:'wrap', gap:12 }}>
            <FL label="Dose (kg/ha)"><Inp type="number" value={form.dose_kg_ha} onChange={e=>set('dose_kg_ha',e.target.value)} style={{width:110}}/></FL>
            <FL label="Total applied (kg)"><Inp type="number" value={form.total_dose_kg} onChange={e=>set('total_dose_kg',e.target.value)} style={{width:130}}/></FL>
            <FL label="Method">
              <select value={form.application_method} onChange={e=>set('application_method',e.target.value)} style={inp}>
                {FERT_METHODS.map(m=><option key={m} value={m}>{m.replace(/_/g,' ')}</option>)}
              </select>
            </FL>
          </div>
        </div>

        <FL label="Operator"><Inp value={form.operator_name} onChange={e=>set('operator_name',e.target.value)} style={{width:140}}/></FL>
        <FL label="Equipment"><Inp value={form.equipment} onChange={e=>set('equipment',e.target.value)} style={{width:140}}/></FL>
        <FL label="Cost (€)"><Inp type="number" value={form.work_cost} onChange={e=>set('work_cost',e.target.value)} style={{width:100}}/></FL>
        <FL label="Notes"><Inp value={form.notes} onChange={e=>set('notes',e.target.value)} style={{width:220}}/></FL>
      </div>
      <div style={{ marginTop:12 }}>
        <button onClick={submit} disabled={busy} style={{...btnPrimary, background:'#e65100'}}>{busy ? 'Saving…' : '🧪 Save Fertilization'}</button>
      </div>
    </div>
  );
};

// Spraying ─────────────────────────────────────────────────────────────────────
const SprayingForm = ({ userId, fields, onCreated }) => {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    field_id:'', work_date: todayStr(), work_status:'COMPLETED',
    application_date: todayDate(),
    product_trade_name:'', active_substance:'', registration_number:'',
    dose_l_ha:'', dose_kg_ha:'', water_volume_l_ha:'', total_product_used:'',
    target_crop:'', target_type:'DISEASE', target_organism:'',
    wind_speed_ms:'', temperature_c:'', bbch_stage:'',
    pre_harvest_interval_days:'',
    operator_name:'', operator_cert:'', equipment:'', work_cost:'', notes:'',
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  useEffect(()=>{ if(fields.length && !form.field_id) set('field_id', fields[0].id); },[fields]); // eslint-disable-line

  const submit = async () => {
    if (!form.field_id || !form.product_trade_name) return;
    setBusy(true);
    try {
      await api.post(`${BASE}/spraying`, {
        user_id: userId, field_id: Number(form.field_id),
        work_date: new Date(form.work_date).toISOString(),
        work_status: form.work_status,
        application_date: form.application_date || null,
        product_trade_name: form.product_trade_name,
        active_substance: form.active_substance || null,
        registration_number: form.registration_number || null,
        dose_l_ha:          form.dose_l_ha          ? Number(form.dose_l_ha)          : null,
        dose_kg_ha:         form.dose_kg_ha         ? Number(form.dose_kg_ha)         : null,
        water_volume_l_ha:  form.water_volume_l_ha  ? Number(form.water_volume_l_ha)  : null,
        total_product_used: form.total_product_used ? Number(form.total_product_used) : null,
        target_crop: form.target_crop || null,
        target_type: form.target_type || null,
        target_organism: form.target_organism || null,
        wind_speed_ms: form.wind_speed_ms ? Number(form.wind_speed_ms) : null,
        temperature_c: form.temperature_c ? Number(form.temperature_c) : null,
        bbch_stage: form.bbch_stage || null,
        pre_harvest_interval_days: form.pre_harvest_interval_days ? Number(form.pre_harvest_interval_days) : null,
        operator_name: form.operator_name || null,
        operator_cert: form.operator_cert || null,
        equipment: form.equipment || null,
        work_cost: form.work_cost ? Number(form.work_cost) : null,
        notes: form.notes || null,
      });
      onCreated();
    } catch { alert('Failed to save spraying record'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ fontSize:11, color:'#888', marginBottom:10, background:'#e3f2fd', borderRadius:6,
        padding:'6px 10px', borderLeft:'3px solid #1565c0' }}>
        Full pesticide / PPP record: product, dose, target organism, application conditions (eGN 3.5)
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:12, alignItems:'flex-end' }}>
        <FieldSelector fields={fields} value={form.field_id} onChange={v=>set('field_id',v)}/>
        <FL label="Application date"><Inp type="date" value={form.application_date} onChange={e=>set('application_date',e.target.value)}/></FL>
        <FL label="Product trade name *"><Inp value={form.product_trade_name} onChange={e=>set('product_trade_name',e.target.value)} style={{width:200}} placeholder="e.g. Roundup 360"/></FL>
        <FL label="Active substance"><Inp value={form.active_substance} onChange={e=>set('active_substance',e.target.value)} style={{width:180}} placeholder="e.g. Glyphosate"/></FL>
        <FL label="Reg. number"><Inp value={form.registration_number} onChange={e=>set('registration_number',e.target.value)} style={{width:130}}/></FL>

        <div style={{ width:'100%', borderTop:'1px dashed #e0d8cf', paddingTop:10 }}>
          <Sec>Dosage</Sec>
          <div style={{ display:'flex', flexWrap:'wrap', gap:12 }}>
            <FL label="Dose (L/ha)"><Inp type="number" value={form.dose_l_ha} onChange={e=>set('dose_l_ha',e.target.value)} style={{width:100}}/></FL>
            <FL label="Dose (kg/ha)"><Inp type="number" value={form.dose_kg_ha} onChange={e=>set('dose_kg_ha',e.target.value)} style={{width:100}}/></FL>
            <FL label="Water vol. (L/ha)"><Inp type="number" value={form.water_volume_l_ha} onChange={e=>set('water_volume_l_ha',e.target.value)} style={{width:120}} placeholder="200"/></FL>
            <FL label="Total used"><Inp type="number" value={form.total_product_used} onChange={e=>set('total_product_used',e.target.value)} style={{width:110}}/></FL>
          </div>
        </div>

        <div style={{ width:'100%', borderTop:'1px dashed #e0d8cf', paddingTop:10 }}>
          <Sec>Target organism</Sec>
          <div style={{ display:'flex', flexWrap:'wrap', gap:12 }}>
            <FL label="Target type">
              <select value={form.target_type} onChange={e=>set('target_type',e.target.value)} style={inp}>
                {PEST_TARGETS.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </FL>
            <FL label="Organism / species"><Inp value={form.target_organism} onChange={e=>set('target_organism',e.target.value)} style={{width:200}} placeholder="e.g. Botrytis cinerea"/></FL>
            <FL label="Target crop"><Inp value={form.target_crop} onChange={e=>set('target_crop',e.target.value)} style={{width:140}}/></FL>
            <FL label="BBCH stage"><Inp value={form.bbch_stage} onChange={e=>set('bbch_stage',e.target.value)} style={{width:80}} placeholder="e.g. 55"/></FL>
            <FL label="PHI (days)"><Inp type="number" value={form.pre_harvest_interval_days} onChange={e=>set('pre_harvest_interval_days',e.target.value)} style={{width:80}}/></FL>
          </div>
        </div>

        <div style={{ width:'100%', borderTop:'1px dashed #e0d8cf', paddingTop:10 }}>
          <Sec>Application conditions</Sec>
          <div style={{ display:'flex', flexWrap:'wrap', gap:12 }}>
            <FL label="Wind (m/s)"><Inp type="number" value={form.wind_speed_ms} onChange={e=>set('wind_speed_ms',e.target.value)} style={{width:90}}/></FL>
            <FL label="Temp (°C)"><Inp type="number" value={form.temperature_c} onChange={e=>set('temperature_c',e.target.value)} style={{width:90}}/></FL>
          </div>
        </div>

        <FL label="Operator"><Inp value={form.operator_name} onChange={e=>set('operator_name',e.target.value)} style={{width:140}}/></FL>
        <FL label="Cert. number"><Inp value={form.operator_cert} onChange={e=>set('operator_cert',e.target.value)} style={{width:140}}/></FL>
        <FL label="Equipment"><Inp value={form.equipment} onChange={e=>set('equipment',e.target.value)} style={{width:140}}/></FL>
        <FL label="Cost (€)"><Inp type="number" value={form.work_cost} onChange={e=>set('work_cost',e.target.value)} style={{width:100}}/></FL>
        <FL label="Notes"><Inp value={form.notes} onChange={e=>set('notes',e.target.value)} style={{width:220}}/></FL>
      </div>
      <div style={{ marginTop:12 }}>
        <button onClick={submit} disabled={busy} style={{...btnPrimary, background:'#0d47a1'}}>{busy ? 'Saving…' : '💧 Save Spraying'}</button>
      </div>
    </div>
  );
};

// ── Field selector helper ────────────────────────────────────────────────────
const FIELD_TYPE_ICON = { cropland:'🌾', pasture:'🐄', orchard:'🍎', vineyard:'🍇', garden:'🥕', fallow:'🟫', other:'🗺️' };

const FieldSelector = ({ fields, value, onChange }) => {
  const [open,    setOpen]   = useState(false);
  const [query,   setQuery]  = useState('');
  const ref = React.useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = fields.find(f => String(f.id) === String(value));

  const filtered = query.trim()
    ? fields.filter(f => {
        const q = query.toLowerCase();
        return (f.label||'').toLowerCase().includes(q)
            || (f.crop_type||'').toLowerCase().includes(q)
            || (f.field_type||'').toLowerCase().includes(q)
            || String(f.id).includes(q);
      })
    : fields;

  const pick = f => { onChange(String(f.id)); setOpen(false); setQuery(''); };

  // Fallback: no fields loaded yet — simple numeric input
  if (fields.length === 0) {
    return (
      <FL label="Field ID">
        <Inp type="number" value={value} onChange={e=>onChange(e.target.value)} style={{width:110}} placeholder="ID"/>
      </FL>
    );
  }

  return (
    <div ref={ref} style={{ position:'relative', minWidth:220 }}>
      <div style={{ fontSize:10, fontWeight:700, color:'#aaa', textTransform:'uppercase',
        letterSpacing:'0.04em', marginBottom:4 }}>Field</div>

      {/* Trigger button */}
      <button type="button" onClick={()=>setOpen(v=>!v)} style={{
        display:'flex', alignItems:'center', justifyContent:'space-between', gap:8,
        width:'100%', padding:'6px 10px', borderRadius:6,
        border: open ? '1px solid #6b4c2a' : '1px solid #ddd',
        background:'#fff', cursor:'pointer', fontSize:13, fontFamily:'inherit',
        boxShadow: open ? '0 0 0 2px rgba(107,76,42,0.15)' : 'none',
        textAlign:'left',
      }}>
        {selected ? (
          <span style={{ display:'flex', alignItems:'center', gap:7, overflow:'hidden' }}>
            <span>{FIELD_TYPE_ICON[selected.field_type] || '🗺️'}</span>
            <span style={{ fontWeight:700, color:'#333', whiteSpace:'nowrap',
              overflow:'hidden', textOverflow:'ellipsis' }}>
              {selected.label || `Field ${selected.id}`}
            </span>
            {selected.area_ha != null && (
              <span style={{ fontSize:11, color:'#aaa', whiteSpace:'nowrap' }}>
                {Number(selected.area_ha).toFixed(1)} ha
              </span>
            )}
          </span>
        ) : (
          <span style={{ color:'#bbb' }}>Select field…</span>
        )}
        <span style={{ color:'#bbb', fontSize:11, flexShrink:0 }}>{open ? '▲' : '▼'}</span>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position:'absolute', top:'100%', left:0, zIndex:999, marginTop:4,
          background:'#fff', border:'1px solid #e0d8cf', borderRadius:8,
          boxShadow:'0 6px 24px rgba(0,0,0,0.13)', width:'max-content', minWidth:'100%', maxWidth:340,
        }}>
          {/* Search */}
          <div style={{ padding:'8px 8px 4px' }}>
            <input
              autoFocus
              value={query}
              onChange={e=>setQuery(e.target.value)}
              placeholder="Search by name, crop, type…"
              style={{ ...inp, width:'100%', fontSize:12, boxSizing:'border-box' }}
            />
          </div>

          {/* List */}
          <div style={{ maxHeight:240, overflowY:'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding:'10px 12px', color:'#bbb', fontSize:12 }}>No fields match</div>
            )}
            {filtered.map(f => {
              const isActive = String(f.id) === String(value);
              const icon = FIELD_TYPE_ICON[f.field_type] || '🗺️';
              return (
                <div key={f.id} onClick={()=>pick(f)} style={{
                  display:'flex', alignItems:'center', gap:10,
                  padding:'8px 12px', cursor:'pointer',
                  background: isActive ? '#f5f0ea' : 'transparent',
                  borderLeft: isActive ? '3px solid #6b4c2a' : '3px solid transparent',
                  transition:'background 0.1s',
                }}
                  onMouseEnter={e=>{ if(!isActive) e.currentTarget.style.background='#faf7f4'; }}
                  onMouseLeave={e=>{ if(!isActive) e.currentTarget.style.background='transparent'; }}
                >
                  <span style={{ fontSize:18, flexShrink:0 }}>{icon}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:13, color:'#333',
                      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                      {f.label || `Field ${f.id}`}
                    </div>
                    <div style={{ display:'flex', gap:6, marginTop:2, flexWrap:'wrap' }}>
                      {f.area_ha != null && (
                        <span style={{ fontSize:10, color:'#888', background:'#f5f0ea',
                          borderRadius:4, padding:'1px 5px' }}>
                          {Number(f.area_ha).toFixed(1)} ha
                        </span>
                      )}
                      {f.field_type && (
                        <span style={{ fontSize:10, color:'#888', background:'#f0f4f0',
                          borderRadius:4, padding:'1px 5px' }}>
                          {f.field_type}
                        </span>
                      )}
                      {f.crop_type && (
                        <span style={{ fontSize:10, color:'#388e3c', background:'#e8f5e9',
                          borderRadius:4, padding:'1px 5px' }}>
                          {f.crop_type.replace(/_/g,' ').toLowerCase()}
                        </span>
                      )}
                    </div>
                  </div>
                  {isActive && <span style={{ color:'#6b4c2a', fontSize:14 }}>✓</span>}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{ padding:'6px 12px', borderTop:'1px solid #f0ebe3',
            fontSize:10, color:'#bbb', fontStyle:'italic' }}>
            {fields.length} field{fields.length!==1?'s':''} total
          </div>
        </div>
      )}
    </div>
  );
};

// ── Combined create panel ─────────────────────────────────────────────────────
const CreateWorkForm = ({ userId, fields: fieldsProp, onCreated }) => {
  const fields = Array.isArray(fieldsProp) ? fieldsProp : [];
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('generic');

  const handleCreated = () => { setOpen(false); onCreated(); };

  return (
    <div style={{ marginBottom:14 }}>
      <button onClick={()=>setOpen(v=>!v)} style={btnAdd}>
        {open ? '✕ Cancel' : '+ Log operation'}
      </button>
      {open && (
        <div style={formBox}>
          <CreateTabs active={mode} setActive={setMode}/>
          {mode === 'generic'       && <GenericForm       userId={userId} fields={fields} onCreated={handleCreated} onSwitchTab={setMode}/>}
          {mode === 'sowing'        && <SowingForm        userId={userId} fields={fields} onCreated={handleCreated}/>}
          {mode === 'fertilization' && <FertilizationForm userId={userId} fields={fields} onCreated={handleCreated}/>}
          {mode === 'spraying'      && <SprayingForm      userId={userId} fields={fields} onCreated={handleCreated}/>}
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// HARVEST MODAL (on season)
// ══════════════════════════════════════════════════════════════════════════════
const HarvestModal = ({ season, onClose, onSaved }) => {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    harvest_date: todayDate(), harvest_area_ha: season.harvest_area_ha || '',
    harvest_total_t:'', yield_t_ha:'', moisture_pct:'', protein_pct:'',
    operator_name:'', notes:'',
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`${BASE}/harvest/${season.id}`, {
        harvest_date: form.harvest_date || null,
        harvest_area_ha: form.harvest_area_ha ? Number(form.harvest_area_ha) : null,
        harvest_total_t: form.harvest_total_t ? Number(form.harvest_total_t) : null,
        yield_t_ha:      form.yield_t_ha      ? Number(form.yield_t_ha)      : null,
        moisture_pct:    form.moisture_pct    ? Number(form.moisture_pct)    : null,
        protein_pct:     form.protein_pct     ? Number(form.protein_pct)     : null,
        operator_name: form.operator_name || null, notes: form.notes || null,
      });
      onSaved();
    } catch { alert('Failed to save harvest'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', borderRadius:14, padding:24, width:460, maxWidth:'95vw',
        boxShadow:'0 8px 40px rgba(0,0,0,0.18)' }}>
        <div style={{ fontWeight:800, fontSize:15, marginBottom:4 }}>🌾 Record Harvest</div>
        <div style={{ fontSize:11, color:'#888', marginBottom:16 }}>
          Season {season.season_year} — {season.crop.replace(/_/g,' ')}
          {season.variety ? ` (${season.variety})` : ''}
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:12 }}>
          <FL label="Harvest date"><Inp type="date" value={form.harvest_date} onChange={e=>set('harvest_date',e.target.value)}/></FL>
          <FL label="Area (ha)"><Inp type="number" value={form.harvest_area_ha} onChange={e=>set('harvest_area_ha',e.target.value)} style={{width:100}}/></FL>
          <FL label="Total yield (t)"><Inp type="number" value={form.harvest_total_t} onChange={e=>set('harvest_total_t',e.target.value)} style={{width:110}}/></FL>
          <FL label="Yield t/ha"><Inp type="number" value={form.yield_t_ha} onChange={e=>set('yield_t_ha',e.target.value)} style={{width:100}} placeholder="auto"/></FL>
          <FL label="Moisture %"><Inp type="number" value={form.moisture_pct} onChange={e=>set('moisture_pct',e.target.value)} style={{width:100}}/></FL>
          <FL label="Protein %"><Inp type="number" value={form.protein_pct} onChange={e=>set('protein_pct',e.target.value)} style={{width:100}}/></FL>
          <FL label="Operator"><Inp value={form.operator_name} onChange={e=>set('operator_name',e.target.value)} style={{width:160}}/></FL>
          <FL label="Notes" style={{flex:1,minWidth:200}}><Inp value={form.notes} onChange={e=>set('notes',e.target.value)} style={{width:'100%'}}/></FL>
        </div>
        <div style={{ display:'flex', gap:10, marginTop:16, justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ background:'none', border:'1px solid #ddd', borderRadius:6,
            padding:'7px 16px', cursor:'pointer', fontSize:13 }}>Cancel</button>
          <button onClick={submit} disabled={busy} style={{...btnPrimary, background:'#2e7d32'}}>
            {busy ? 'Saving…' : '🌾 Save Harvest'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// SEASONS TAB
// ══════════════════════════════════════════════════════════════════════════════
const SeasonsTab = ({ fields }) => {
  const [selectedField, setSelectedField] = useState(fields[0]?.id || null);
  const [seasons, setSeasons] = useState([]);
  const [loading, setLoading] = useState(false);
  const [harvestSeason, setHarvestSeason] = useState(null);

  useEffect(()=>{ if(fields.length && !selectedField) setSelectedField(fields[0].id); },[fields]); // eslint-disable-line

  const load = useCallback(()=>{
    if(!selectedField) return;
    setLoading(true);
    api.get(`${BASE}/seasons/field/${selectedField}`)
      .then(r=>setSeasons(Array.isArray(r.data)?r.data:[]))
      .catch(()=>setSeasons([]))
      .finally(()=>setLoading(false));
  },[selectedField]);

  useEffect(()=>{ load(); },[load]);

  if (!fields.length) return <EmptyState text="No fields found. Add a field first."/>;

  return (
    <div>
      {harvestSeason && (
        <HarvestModal season={harvestSeason} onClose={()=>setHarvestSeason(null)} onSaved={()=>{ setHarvestSeason(null); load(); }}/>
      )}

      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
        <Sec style={{marginBottom:0}}>Field</Sec>
        <select value={selectedField||''} onChange={e=>setSelectedField(Number(e.target.value))} style={inp}>
          {fields.map(f=><option key={f.id} value={f.id}>{f.label||`Field ${f.id}`} ({fmtHa(f.area_ha)})</option>)}
        </select>
      </div>

      {loading
        ? <EmptyState text="Loading seasons…"/>
        : seasons.length === 0
          ? <EmptyState text="No season records for this field. Log a sowing operation to create one."/>
          : (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {seasons.map(s=>(
                <SeasonCard key={s.id} season={s} onHarvest={()=>setHarvestSeason(s)}/>
              ))}
            </div>
          )
      }
    </div>
  );
};

const SeasonCard = ({ season, onHarvest }) => {
  const [open, setOpen] = useState(false);
  const hasHarvest = season.harvest_date || season.harvest_total_t;

  return (
    <div style={{ background:'#fff', borderRadius:10, border:'1px solid #e0d8cf',
      overflow:'hidden', borderLeft:`4px solid ${hasHarvest ? '#2e7d32' : '#f9a825'}` }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
        cursor:'pointer', userSelect:'none' }} onClick={()=>setOpen(v=>!v)}>
        <span style={{ fontSize:18 }}>🌱</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <span style={{ fontSize:13, fontWeight:700, color:'#333' }}>
              {season.season_year} — {season.crop.replace(/_/g,' ')}
            </span>
            {season.variety && <FieldPill text={season.variety}/>}
            <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20,
              background: hasHarvest ? '#e8f5e9' : '#fff8e1',
              color: hasHarvest ? '#2e7d32' : '#f57f17',
              border: `1px solid ${hasHarvest ? '#a5d6a7' : '#ffe082'}`,
              textTransform:'uppercase' }}>
              {hasHarvest ? '✓ Harvested' : 'Active'}
            </span>
          </div>
          <div style={{ fontSize:11, color:'#aaa', marginTop:2, display:'flex', gap:12, flexWrap:'wrap' }}>
            {season.sowing_date && <span>🌾 Sown {fmtDate(season.sowing_date)}</span>}
            {season.harvest_date && <span>🌾 Harvested {fmtDate(season.harvest_date)}</span>}
            {season.yield_t_ha && <span>📦 {Number(season.yield_t_ha).toFixed(2)} t/ha</span>}
            {season.tillage_type && <FieldPill text={season.tillage_type.replace(/_/g,' ')}/>}
          </div>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          {!hasHarvest && (
            <button onClick={e=>{ e.stopPropagation(); onHarvest(); }} style={{
              background:'#2e7d32', color:'#fff', border:'none', borderRadius:6,
              padding:'4px 10px', fontSize:11, fontWeight:700, cursor:'pointer' }}>
              + Harvest
            </button>
          )}
        </div>
        <span style={{ color:'#ccc', fontSize:12 }}>{open?'▲':'▼'}</span>
      </div>

      {open && (
        <div style={{ padding:'10px 14px 14px', borderTop:'1px solid #ede7df', background:'#fafaf8' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:8 }}>
            {[
              ['🌾 Crop', season.crop.replace(/_/g,' ')],
              ['🔬 Variety', season.variety || '—'],
              ['📅 Sowing', fmtDate(season.sowing_date)],
              ['⚖️ Sowing rate', season.sowing_rate_kg_ha ? `${season.sowing_rate_kg_ha} kg/ha` : '—'],
              ['💉 Seed treatment', season.seed_treatment || '—'],
              ['🚜 Tillage', season.tillage_type?.replace(/_/g,' ') || '—'],
              ['📅 Harvest', fmtDate(season.harvest_date)],
              ['🗺️ Area', fmtHa(season.harvest_area_ha)],
              ['📦 Total', season.harvest_total_t ? `${Number(season.harvest_total_t).toFixed(2)} t` : '—'],
              ['📊 Yield', season.yield_t_ha ? `${Number(season.yield_t_ha).toFixed(2)} t/ha` : '—'],
              ['💧 Moisture', season.moisture_pct ? `${season.moisture_pct}%` : '—'],
              ['🧪 Protein', season.protein_pct ? `${season.protein_pct}%` : '—'],
            ].map(([k,v])=>(
              <div key={k} style={{ background:'#fff', borderRadius:7, padding:'7px 10px',
                border:'1px solid #ede7df' }}>
                <div style={{ fontSize:10, color:'#aaa', fontWeight:700 }}>{k}</div>
                <div style={{ fontSize:12, color:'#333', fontWeight:600, marginTop:1 }}>{v}</div>
              </div>
            ))}
          </div>
          {season.notes && (
            <div style={{ marginTop:10, fontSize:12, color:'#888', background:'#fff',
              borderRadius:7, padding:'7px 10px', border:'1px solid #ede7df' }}>
              📝 {season.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// WORK ROW (log list item)
// ══════════════════════════════════════════════════════════════════════════════
const WorkRow = ({ record, onUpdate }) => {
  const [_open, _setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const icon = WORK_ICONS[record.work_type] || '🌾';
  const ts = record.work_date
    ? new Date(record.work_date).toLocaleString('hu-HU',{dateStyle:'medium',timeStyle:'short'}) : '—';
  const sc = STATUS_CFG[record.work_status] || STATUS_CFG.PLANNED;

  const changeStatus = async s => {
    if (s === record.work_status) return;
    setUpdating(true);
    try { await api.patch(`${BASE}/${record.id}`, {work_status:s}); onUpdate(); }
    catch { alert('Failed to update status'); } finally { setUpdating(false); }
  };
  const del = async () => {
    if (!window.confirm('Delete this record?')) return;
    try { await api.delete(`${BASE}/${record.id}`, {params:{user_id:record.user_id}}); onUpdate(); }
    catch { alert('Failed to delete'); }
  };

  const fert = record.fertilization;
  const pest = record.pesticide;

  return (
    <div style={{ border:`1px solid ${sc.border}`, borderRadius:10, overflow:'hidden',
      background:'#fafaf8', marginBottom:6 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
        cursor:'pointer', userSelect:'none', borderLeft:`4px solid ${sc.text}` }}
        onClick={()=>_setOpen(v=>!v)}>
        <span style={{ fontSize:18 }}>{icon}</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <span style={{ fontSize:13, fontWeight:700, color:'#333' }}>
              {record.work_type?.replace(/_/g,' ')}
            </span>
            <StatusPill status={record.work_status}/>
            {record.field_label && <FieldPill text={record.field_label}/>}
            {fert && <span style={{ fontSize:10, fontWeight:700, color:'#e65100',
              background:'#fff3e0', borderRadius:10, padding:'1px 7px', border:'1px solid #ffe0b2' }}>
              🧪 {fert.product_name||'Fertilization'}
            </span>}
            {pest && <span style={{ fontSize:10, fontWeight:700, color:'#0d47a1',
              background:'#e3f2fd', borderRadius:10, padding:'1px 7px', border:'1px solid #90caf9' }}>
              💧 {pest.product_trade_name}
            </span>}
          </div>
          <div style={{ fontSize:11, color:'#aaa', marginTop:2, display:'flex', gap:12, flexWrap:'wrap' }}>
            <span>📅 {ts}</span>
            {record.operator_name && <span>👤 {record.operator_name}</span>}
            {record.work_cost != null && <span>💶 {Number(record.work_cost).toFixed(2)} €</span>}
            {record.harvest_ton != null && <span>🌾 {Number(record.harvest_ton).toFixed(3)} t</span>}
            {fert && fert.n_kg_ha != null && (
              <span>N {fert.n_kg_ha} · P {fert.p2o5_kg_ha||'—'} · K {fert.k2o_kg_ha||'—'} kg/ha</span>
            )}
            {pest && pest.target_organism && <span>🎯 {pest.target_organism}</span>}
            {record.extra_metadata?.note && <span>📝 {record.extra_metadata.note}</span>}
          </div>
        </div>
        <span style={{ color:'#ccc', fontSize:12 }}>{_open?'▲':'▼'}</span>
      </div>

      {_open && (
        <div style={{ padding:'10px 14px 14px', borderTop:'1px solid #ede7df', background:'#fff' }}>

          {/* Typed sub-record detail */}
          {fert && (
            <div style={{ marginBottom:12, background:'#fff8f0', borderRadius:8, padding:'10px 12px',
              border:'1px solid #ffe0b2' }}>
              <Sec>🧪 Fertilization detail (eGN 3.4)</Sec>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, fontSize:11 }}>
                {[
                  ['Product', fert.product_name], ['Type', fert.product_type],
                  ['Organic', fert.is_organic ? 'Yes' : 'No'],
                  ['N kg/ha', fert.n_kg_ha], ['P₂O₅ kg/ha', fert.p2o5_kg_ha],
                  ['K₂O kg/ha', fert.k2o_kg_ha], ['S kg/ha', fert.s_kg_ha],
                  ['Dose kg/ha', fert.dose_kg_ha], ['Total kg', fert.total_dose_kg],
                  ['Method', fert.application_method?.replace(/_/g,' ')],
                  ['Equipment', fert.equipment],
                ].filter(([,v])=>v!=null&&v!=='').map(([k,v])=>(
                  <div key={k} style={{ background:'#fff', borderRadius:6, padding:'3px 8px',
                    border:'1px solid #ffe0b2' }}>
                    <span style={{ color:'#aaa' }}>{k}: </span><strong>{v}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pest && (
            <div style={{ marginBottom:12, background:'#e8f4fd', borderRadius:8, padding:'10px 12px',
              border:'1px solid #90caf9' }}>
              <Sec>💧 Pesticide detail (eGN 3.5)</Sec>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, fontSize:11 }}>
                {[
                  ['Trade name', pest.product_trade_name],
                  ['Active substance', pest.active_substance],
                  ['Reg. no.', pest.registration_number],
                  ['Dose L/ha', pest.dose_l_ha], ['Water L/ha', pest.water_volume_l_ha],
                  ['Target', pest.target_type], ['Organism', pest.target_organism],
                  ['BBCH', pest.bbch_stage],
                  ['PHI days', pest.pre_harvest_interval_days],
                  ['Wind m/s', pest.wind_speed_ms], ['Temp °C', pest.temperature_c],
                  ['Operator cert.', pest.operator_cert],
                ].filter(([,v])=>v!=null&&v!=='').map(([k,v])=>(
                  <div key={k} style={{ background:'#fff', borderRadius:6, padding:'3px 8px',
                    border:'1px solid #90caf9' }}>
                    <span style={{ color:'#aaa' }}>{k}: </span><strong>{v}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Status change */}
          <div style={{ fontSize:10, fontWeight:700, color:'#bbb', textTransform:'uppercase',
            letterSpacing:'0.05em', marginBottom:6 }}>Change status</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:12 }}>
            {Object.entries(STATUS_CFG).map(([s,c])=>(
              <button key={s} disabled={updating||s===record.work_status} onClick={()=>changeStatus(s)}
                style={{ padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:700,
                  cursor:s===record.work_status?'default':'pointer',
                  background:s===record.work_status?c.bg:'#f5f5f5',
                  color:s===record.work_status?c.text:'#999',
                  border:s===record.work_status?`1px solid ${c.border}`:'1px solid #e0e0e0',
                  opacity:updating?0.5:1, transition:'all 0.15s',
                  textTransform:'uppercase', letterSpacing:'0.04em' }}>
                {s.replace(/_/g,' ')}
              </button>
            ))}
          </div>
          <button onClick={del} style={{ background:'none', border:'1px solid #ffcdd2',
            color:'#e53935', borderRadius:6, padding:'4px 12px', fontSize:12, cursor:'pointer' }}>
            🗑 Delete
          </button>
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// LOG TAB
// ══════════════════════════════════════════════════════════════════════════════
const LogTab = ({ userId, records, fields, loading, onUpdate, onCreated,
  filterType, setFilterType, filterStatus, setFilterStatus }) => {
  const typeOptions = ['ALL', ...new Set(records.map(r=>r.work_type))];
  const filtered = records.filter(r => {
    if (filterType   !== 'ALL' && r.work_type   !== filterType)   return false;
    if (filterStatus !== 'ALL' && r.work_status !== filterStatus) return false;
    return true;
  });
  return (
    <>
      <CreateWorkForm userId={userId} fields={fields} onCreated={onCreated}/>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:14 }}>
        <div style={{ display:'flex', gap:0, border:'1px solid #e0d8cf', borderRadius:8, overflow:'hidden' }}>
          {['ALL',...Object.keys(STATUS_CFG)].map(s=>(
            <button key={s} onClick={()=>setFilterStatus(s)} style={{
              padding:'5px 10px', fontSize:10, fontWeight:700, border:'none', cursor:'pointer',
              background: filterStatus===s ? 'var(--color-accent-soil,#6b4c2a)' : '#f5f0ea',
              color: filterStatus===s ? '#fff' : '#888',
              textTransform:'uppercase', letterSpacing:'0.03em' }}>
              {s.replace(/_/g,' ')}
            </button>
          ))}
        </div>
      </div>
      {typeOptions.length > 2 && (
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:14 }}>
          {typeOptions.map(tp=>(
            <button key={tp} onClick={()=>setFilterType(tp)} style={{
              padding:'4px 10px', borderRadius:20, fontSize:11, fontWeight:700,
              border:'none', cursor:'pointer',
              background: filterType===tp ? 'var(--color-green-primary,#054e05)' : '#ede7df',
              color: filterType===tp ? '#fff' : '#777' }}>
              {tp==='ALL' ? 'All types' : `${WORK_ICONS[tp]||''} ${tp.replace(/_/g,' ')}`}
            </button>
          ))}
        </div>
      )}
      {loading
        ? <EmptyState text="Loading…"/>
        : filtered.length === 0
          ? <EmptyState text={records.length===0 ? 'No records yet.' : 'No records match the filter.'}/>
          : filtered.map(r=><WorkRow key={r.id} record={r} onUpdate={onUpdate}/>)
      }
    </>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// ANALYTICS TAB 1 – Work Types (unchanged)
// ══════════════════════════════════════════════════════════════════════════════
const WorkTypeAnalytics = ({ userId }) => {
  const [data,setData]       = useState(null);
  const [loading,setLoading] = useState(true);
  const [year,setYear]       = useState(new Date().getFullYear());
  const [selected,setSelected] = useState(null);

  const load = useCallback(()=>{
    if(!userId)return;
    setLoading(true);
    api.get(`${BASE}/analytics/work-types/user`,{params:{year}})
      .then(r=>{ setData(r.data); setSelected(null); })
      .catch(()=>setData(null))
      .finally(()=>setLoading(false));
  },[userId,year]);
  useEffect(()=>{ load(); },[load]);

  if(loading) return <EmptyState text="Loading…"/>;
  if(!data||!data.types.length) return <EmptyState text="No data for this period."/>;
  const { types, summary } = data;
  const sel = selected ? types.find(t=>t.work_type===selected) : null;
  // Top-3 comparison radar: one polygon per operation type across 5 real dimensions.
  // Each axis is normalised 0–100 relative to the max in that dimension.
  const top3 = types.slice(0,3);
  const maxCount   = Math.max(...types.map(t=>t.count),1);
  const maxCost    = Math.max(...types.map(t=>t.avg_cost||0),1);
  const maxHarvest = Math.max(...types.map(t=>t.total_harvest_ton||0),1);
  const maxFields  = Math.max(...types.map(t=>t.fields_involved||0),1);
  // Radar format: rows are axes, each series key is a type name
  const RADAR_AXES = ['Frequency','Completion %','Cost efficiency','Fields covered','Harvest vol.'];
  const radarData = RADAR_AXES.map(axis => {
    const row = { axis };
    top3.forEach(t => {
      const name = (WORK_ICONS[t.work_type]||'') + ' ' + t.work_type.replace(/_/g,' ').toLowerCase();
      row[name] = axis === 'Frequency'
        ? Math.round(t.count / maxCount * 100)
        : axis === 'Completion %'
        ? Math.round((t.completion_rate||0) * 100)
        : axis === 'Cost efficiency'
        ? Math.round((1 - (t.avg_cost||0) / maxCost) * 100)
        : axis === 'Fields covered'
        ? Math.round((t.fields_involved||0) / maxFields * 100)
        : Math.round((t.total_harvest_ton||0) / maxHarvest * 100);
    });
    return row;
  });
  const RADAR_COLORS = ['#6b4c2a','#054e05','#0d47a1'];

  return (
    <div>
      <YearPicker year={year} setYear={setYear}/>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
        {[
          {label:'Most frequent',   val: summary.most_frequent?.replace(/_/g,' '),        icon:'🔁'},
          {label:'Best completion', val: summary.best_completion_rate?.replace(/_/g,' '),  icon:'✅'},
          {label:'Most expensive',  val: summary.most_expensive_avg?.replace(/_/g,' '),    icon:'💶'},
          {label:'Needs attention', val: summary.worst_completion_rate?.replace(/_/g,' '), icon:'⚠️'},
        ].filter(b=>b.val).map(b=>(
          <div key={b.label} style={{ background:'#fff', borderRadius:8, border:'1px solid #e0d8cf',
            padding:'6px 12px', fontSize:11 }}>
            <span style={{ fontSize:16, marginRight:6 }}>{b.icon}</span>
            <span style={{ color:'#aaa', marginRight:4 }}>{b.label}:</span>
            <span style={{ fontWeight:700, color:'#444', textTransform:'capitalize' }}>{b.val}</span>
          </div>
        ))}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
        <ChartBox>
          <Sec>Completion rate &amp; total cost by operation type</Sec>
          {/* Custom SVG chart: completion-rate bar (colour-coded) + cost label.
              More meaningful than the old count/completed/failed triple-bar which
              plotted three subsets of the same metric on one axis. */}
          <div style={{ overflowY:'auto', maxHeight: Math.max(200, types.length*34) }}>
            {[...types].sort((a,b)=>b.completion_rate-a.completion_rate).map(t=>{
              const pct   = Math.round(t.completion_rate * 100);
              const color = pct >= 80 ? '#2e7d32' : pct >= 50 ? '#f57f17' : '#c62828';
              const bg    = pct >= 80 ? '#e8f5e9' : pct >= 50 ? '#fff8e1' : '#fce4ec';
              const label = (WORK_ICONS[t.work_type]||'') + ' ' + t.work_type.replace(/_/g,' ').toLowerCase();
              return (
                <div key={t.work_type}
                  onClick={()=>setSelected(t.work_type===selected?null:t.work_type)}
                  title={`${t.completed} of ${t.count} completed${t.total_cost ? ` · ${fmtEur(t.total_cost)} total` : ''}`}
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 0',
                    cursor:'pointer', borderRadius:4,
                    background: t.work_type===selected ? '#fdf6ef' : 'transparent' }}>
                  {/* Label */}
                  <div style={{ width:130, fontSize:10, color:'#666', fontWeight:600,
                    whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', flexShrink:0 }}>
                    {label}
                  </div>
                  {/* Bar track */}
                  <div style={{ flex:1, height:14, background:'#f0ebe3', borderRadius:3, position:'relative', minWidth:60 }}>
                    <div style={{ width:`${pct}%`, height:'100%', background:color,
                      borderRadius:3, transition:'width 0.3s' }}/>
                  </div>
                  {/* Pct label */}
                  <div style={{ width:36, fontSize:10, fontWeight:800, color:color,
                    textAlign:'right', flexShrink:0 }}>
                    {pct}%
                  </div>
                  {/* Cost badge */}
                  <div style={{ width:68, fontSize:10, color:'#888',
                    background: t.total_cost ? bg : 'transparent',
                    borderRadius:4, padding:'1px 5px', textAlign:'right', flexShrink:0 }}>
                    {t.total_cost ? fmtEur(t.total_cost) : '—'}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display:'flex', gap:16, marginTop:8, fontSize:10, color:'#aaa' }}>
            <span>■ <span style={{color:'#2e7d32'}}>≥80%</span> good</span>
            <span>■ <span style={{color:'#f57f17'}}>50–79%</span> watch</span>
            <span>■ <span style={{color:'#c62828'}}>&lt;50%</span> attention</span>
            <span style={{marginLeft:'auto'}}>Click row to drill down</span>
          </div>
        </ChartBox>
        <ChartBox>
          <Sec>Average cost per operation type (€)</Sec>
          <ResponsiveContainer width="100%" height={Math.max(160,types.filter(t=>t.avg_cost>0).length*26)}>
            <BarChart layout="vertical"
              data={types.filter(t=>t.avg_cost>0).sort((a,b)=>b.avg_cost-a.avg_cost)
                .map(d=>({...d,label:(WORK_ICONS[d.work_type]||'')+' '+d.work_type.replace(/_/g,' ').toLowerCase()}))}
              margin={{top:0,right:16,left:4,bottom:0}}>
              <XAxis type="number" tick={{fontSize:10}}/>
              <YAxis type="category" dataKey="label" tick={{fontSize:10}} width={120}/>
              <Tooltip contentStyle={{fontSize:11}} formatter={v=>[`${v} €`,'Avg cost']}/>
              <Bar dataKey="avg_cost" radius={[0,3,3,0]}>
                {types.filter(t=>t.avg_cost>0).sort((a,b)=>b.avg_cost-a.avg_cost)
                  .map((_,i)=><Cell key={i} fill={PALETTE[i%PALETTE.length]}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>
      </div>
      {top3.length >= 2 && (
        <ChartBox style={{ marginBottom:14 }}>
          <Sec>Top-3 operation types — 5-axis comparison radar</Sec>
          <div style={{ display:'flex', gap:8, marginBottom:10, flexWrap:'wrap' }}>
            {top3.map((t,i) => (
              <div key={t.work_type} style={{ display:'flex', alignItems:'center', gap:6,
                background:'#fafaf8', borderRadius:6, padding:'5px 10px',
                border:`2px solid ${RADAR_COLORS[i]}22` }}>
                <span style={{ width:10, height:10, borderRadius:'50%',
                  background:RADAR_COLORS[i], display:'inline-block', flexShrink:0 }}/>
                <span style={{ fontSize:12, fontWeight:700, color:'#444' }}>
                  {WORK_ICONS[t.work_type]||''} {t.work_type.replace(/_/g,' ')}
                </span>
                <span style={{ fontSize:10, color:'#aaa' }}>
                  {t.count} ops · {Math.round(t.completion_rate*100)}% done
                  {t.avg_cost ? ` · ${fmtEur(t.avg_cost)} avg` : ''}
                </span>
              </div>
            ))}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, alignItems:'start' }}>
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart data={radarData} margin={{top:10,right:30,bottom:10,left:30}}>
                <PolarGrid stroke="#e0d8cf"/>
                <PolarAngleAxis dataKey="axis" tick={{fontSize:10}}/>
                <PolarRadiusAxis angle={72} domain={[0,100]} tick={{fontSize:8}} tickCount={4}/>
                {top3.map((t,i) => {
                  const name = (WORK_ICONS[t.work_type]||'') + ' ' + t.work_type.replace(/_/g,' ').toLowerCase();
                  return (
                    <Radar key={t.work_type} name={name} dataKey={name}
                      stroke={RADAR_COLORS[i]} fill={RADAR_COLORS[i]} fillOpacity={0.15}/>
                  );
                })}
                <Legend iconSize={9} wrapperStyle={{fontSize:10}}/>
                <Tooltip contentStyle={{fontSize:11}} formatter={(v,n)=>[`${v} / 100`,n]}/>
              </RadarChart>
            </ResponsiveContainer>
            {/* Axis explanation */}
            <div style={{ display:'flex', flexDirection:'column', gap:8, paddingTop:8 }}>
              <div style={{ fontSize:10, fontWeight:700, color:'#aaa', textTransform:'uppercase',
                letterSpacing:'0.06em', marginBottom:4 }}>How to read this chart</div>
              {[
                ['Frequency',       '#6b4c2a', 'How often this operation is performed relative to the most frequent type.'],
                ['Completion %',    '#054e05', 'Share of operations reaching COMPLETED or VERIFIED status.'],
                ['Cost efficiency', '#e65100', 'Inverse of average cost — higher means cheaper per operation.'],
                ['Fields covered',  '#0d47a1', 'Number of distinct fields this operation type has been applied to.'],
                ['Harvest vol.',    '#388e3c', 'Total harvest tonnage associated with this operation type.'],
              ].map(([axis,color,desc]) => (
                <div key={axis} style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
                  <span style={{ width:8, height:8, borderRadius:2, background:color,
                    flexShrink:0, marginTop:3 }}/>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:'#444' }}>{axis}</div>
                    <div style={{ fontSize:10, color:'#888' }}>{desc}</div>
                  </div>
                </div>
              ))}
              <div style={{ marginTop:4, fontSize:10, color:'#bbb', fontStyle:'italic' }}>
                All axes normalised 0–100 relative to your data.
                A larger polygon means stronger performance across dimensions.
              </div>
            </div>
          </div>
        </ChartBox>
      )}
      {sel && (
        <ChartBox style={{ border:'2px solid #6b4c2a', marginBottom:14 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
            <Sec>{WORK_ICONS[sel.work_type]||''} {sel.work_type.replace(/_/g,' ')} — detail</Sec>
            <button onClick={()=>setSelected(null)} style={{ background:'none', border:'1px solid #e0d8cf',
              borderRadius:6, padding:'3px 10px', fontSize:11, cursor:'pointer', color:'#888' }}>✕ Close</button>
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14 }}>
            <Card icon="📋" label="Total ops"     value={sel.count}                     color="#6b4c2a"/>
            <Card icon="✅" label="Completion"    value={fmtPct(sel.completion_rate)}   color="#2e7d32"/>
            <Card icon="💶" label="Avg cost"      value={fmtEur(sel.avg_cost)}
              sub={`${fmtEur(sel.min_cost)} – ${fmtEur(sel.max_cost)}`}                color="#8d6e63"/>
            <Card icon="🌾" label="Total harvest" value={fmtTon(sel.total_harvest_ton)} color="#388e3c"/>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <Sec>Monthly operations</Sec>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={sel.by_month} margin={{top:2,right:8,left:-16,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe3"/>
                  <XAxis dataKey="month" tick={{fontSize:9}} tickFormatter={v=>v.slice(5)}/>
                  <YAxis tick={{fontSize:9}} allowDecimals={false}/>
                  <Bar dataKey="count" fill="#6b4c2a" radius={[2,2,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <Sec>Status breakdown</Sec>
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={sel.by_status} dataKey="count" nameKey="status"
                    cx="50%" cy="50%" outerRadius={55} innerRadius={26}
                    label={({percent})=>percent>0.05?`${(percent*100).toFixed(0)}%`:''} labelLine={false}>
                    {sel.by_status.map(d=><Cell key={d.status} fill={STATUS_COLORS[d.status]||'#888'}/>)}
                  </Pie>
                  <Tooltip contentStyle={{fontSize:11}} formatter={(v,n)=>[v,n]}/>
                  <Legend iconSize={8} wrapperStyle={{fontSize:10}}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </ChartBox>
      )}
      <ChartBox>
        <Sec>Full breakdown table</Sec>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
            <thead>
              <tr style={{ background:'#f5f0ea', textAlign:'left' }}>
                {['Type','Ops','Done','Rate','Cancelled','Avg €','Total €','Harvest t','Fields'].map(h=>(
                  <th key={h} style={{ padding:'6px 10px', fontWeight:700, color:'#888',
                    borderBottom:'1px solid #e0d8cf', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {types.map((t,i)=>(
                <tr key={t.work_type}
                  onClick={()=>setSelected(t.work_type===selected?null:t.work_type)}
                  style={{ background: t.work_type===selected?'#fdf6ef':i%2===0?'#fff':'#fafaf8',
                    cursor:'pointer', transition:'background 0.1s' }}>
                  <td style={{ padding:'6px 10px', fontWeight:600, color:'#444' }}>
                    {WORK_ICONS[t.work_type]||''} {t.work_type.replace(/_/g,' ')}
                  </td>
                  <td style={{ padding:'6px 10px', textAlign:'right' }}>{t.count}</td>
                  <td style={{ padding:'6px 10px', textAlign:'right', color:'#2e7d32' }}>{t.completed}</td>
                  <td style={{ padding:'6px 10px', textAlign:'right', fontWeight:700,
                    color:t.completion_rate>=0.8?'#2e7d32':t.completion_rate>=0.5?'#f57f17':'#c62828' }}>
                    {fmtPct(t.completion_rate)}
                  </td>
                  <td style={{ padding:'6px 10px', textAlign:'right', color:'#9e9e9e' }}>{t.cancelled||0}</td>
                  <td style={{ padding:'6px 10px', textAlign:'right' }}>{t.avg_cost?fmtEur(t.avg_cost):'—'}</td>
                  <td style={{ padding:'6px 10px', textAlign:'right', fontWeight:600 }}>{t.total_cost?fmtEur(t.total_cost):'—'}</td>
                  <td style={{ padding:'6px 10px', textAlign:'right', color:'#388e3c' }}>{t.total_harvest_ton?fmtTon(t.total_harvest_ton):'—'}</td>
                  <td style={{ padding:'6px 10px', textAlign:'right' }}>{t.fields_involved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartBox>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// ANALYTICS TAB 2 – Location / Farm (unchanged)
// ══════════════════════════════════════════════════════════════════════════════
const LocationAnalytics = ({ userId }) => {
  const [data,setData]       = useState(null);
  const [loading,setLoading] = useState(true);
  const [year,setYear]       = useState(new Date().getFullYear());
  const [selLoc,setSelLoc]   = useState(null);

  const load = useCallback(()=>{
    if(!userId)return;
    setLoading(true);
    api.get(`${BASE}/analytics/locations/user`,{params:{year}})
      .then(r=>{ setData(r.data); setSelLoc(null); })
      .catch(()=>setData(null))
      .finally(()=>setLoading(false));
  },[userId,year]);
  useEffect(()=>{ load(); },[load]);

  if(loading) return <EmptyState text="Loading…"/>;
  if(!data||!data.locations?.length) return <EmptyState text="No data for this period."/>;

  const { farm, locations } = data;
  const selected = selLoc != null ? locations.find(l=>l.location_id===selLoc) : null;
  const compData = locations.map(l=>({
    name: l.location_label,
    'Ops':          l.total_ops,
    'Cost (€)':     l.total_cost,
    'Harvest (t)':  l.total_harvest_ton,
    '€/ha':         l.cost_per_ha||0,
    'Completion %': Math.round(l.completion_rate*100),
  }));

  return (
    <div>
      <YearPicker year={year} setYear={setYear}/>
      <ChartBox style={{ marginBottom:16, borderLeft:'4px solid #6b4c2a' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
          <span style={{ fontSize:22 }}>🏡</span>
          <div>
            <div style={{ fontWeight:800, fontSize:15, color:'#333' }}>
              {farm.farm_name || 'Your Farm'}
            </div>
            <div style={{ fontSize:11, color:'#aaa' }}>
              {farm.locations_count} location{farm.locations_count!==1?'s':''} · {fmtHa(farm.total_area_ha)} total area
              {farm.farm_size_ha ? ` · registered ${fmtHa(farm.farm_size_ha)}` : ''}
            </div>
          </div>
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <Card icon="📋" label="Total ops"     value={farm.total_ops}                color="#6b4c2a"/>
          <Card icon="💶" label="Total cost"    value={fmtEur(farm.total_cost)}
            sub={farm.cost_per_ha?`${fmtEur(farm.cost_per_ha)} / ha`:undefined}      color="#8d6e63"/>
          <Card icon="🌾" label="Total harvest" value={fmtTon(farm.total_harvest_ton)}
            sub={farm.harvest_per_ha?`${farm.harvest_per_ha.toFixed(3)} t/ha`:undefined} color="#054e05"/>
          <Card icon="✅" label="Completion"    value={fmtPct(farm.completion_rate)}
            color={farm.completion_rate>=0.8?'#2e7d32':'#f57f17'}/>
        </div>
      </ChartBox>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
        <ChartBox>
          <Sec>Operations &amp; completion by location</Sec>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={compData} margin={{top:4,right:8,left:-8,bottom:40}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe3"/>
              <XAxis dataKey="name" tick={{fontSize:10}} angle={-25} textAnchor="end" interval={0}/>
              <YAxis tick={{fontSize:10}} allowDecimals={false}/>
              <Tooltip contentStyle={{fontSize:11}}/>
              <Legend iconSize={10} wrapperStyle={{fontSize:11}}/>
              <Bar dataKey="Ops" fill="#6b4c2a" radius={[3,3,0,0]}
                onClick={e=>{ const l=locations.find(x=>x.location_label===e.name); if(l) setSelLoc(l.location_id===selLoc?null:l.location_id); }}/>
              <Bar dataKey="Completion %" fill="#2e7d32" radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>
        <ChartBox>
          <Sec>Cost &amp; harvest by location</Sec>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={compData} margin={{top:4,right:8,left:-8,bottom:40}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe3"/>
              <XAxis dataKey="name" tick={{fontSize:10}} angle={-25} textAnchor="end" interval={0}/>
              <YAxis yAxisId="cost" tick={{fontSize:10}}/>
              <YAxis yAxisId="harv" orientation="right" tick={{fontSize:10}}/>
              <Tooltip contentStyle={{fontSize:11}}/>
              <Legend iconSize={10} wrapperStyle={{fontSize:11}}/>
              <Bar yAxisId="cost" dataKey="Cost (€)"    fill="#8d6e63" radius={[3,3,0,0]}/>
              <Bar yAxisId="harv" dataKey="Harvest (t)" fill="#388e3c" radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>
      </div>
      <Sec>Locations overview — click to expand</Sec>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))', gap:10, marginBottom:14 }}>
        {locations.map(loc=>{
          const active = loc.location_id===selLoc;
          return (
            <div key={loc.location_id}
              onClick={()=>setSelLoc(loc.location_id===selLoc?null:loc.location_id)}
              style={{ background:'#fff', borderRadius:10, padding:'12px 14px', cursor:'pointer',
                border:`2px solid ${active?'#6b4c2a':'#e0d8cf'}`, transition:'all 0.15s' }}>
              <div style={{ fontWeight:700, fontSize:13, color:'#333', marginBottom:4 }}>
                📍 {loc.location_label}
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, fontSize:11 }}>
                <span style={{ background:'#f5f0ea', borderRadius:6, padding:'2px 8px' }}>{loc.total_ops} ops</span>
                <span style={{ background:'#e8f5e9', borderRadius:6, padding:'2px 8px', color:'#2e7d32' }}>{fmtPct(loc.completion_rate)}</span>
                {loc.total_cost>0 && <span style={{ background:'#fafafa', borderRadius:6, padding:'2px 8px' }}>{fmtEur(loc.total_cost)}</span>}
                <span style={{ background:'#f0f4f0', borderRadius:6, padding:'2px 8px', color:'#555' }}>{loc.fields_count} fields · {fmtHa(loc.total_area_ha)}</span>
              </div>
            </div>
          );
        })}
      </div>
      {selected && (
        <ChartBox style={{ border:'2px solid #6b4c2a', marginBottom:14 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <div style={{ fontWeight:800, fontSize:14, color:'#333' }}>📍 {selected.location_label}</div>
            <button onClick={()=>setSelLoc(null)} style={{ background:'none', border:'1px solid #e0d8cf',
              borderRadius:6, padding:'3px 10px', fontSize:11, cursor:'pointer', color:'#888' }}>✕ Close</button>
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14 }}>
            <Card icon="📋" label="Total ops"   value={selected.total_ops}                        color="#6b4c2a"/>
            <Card icon="✅" label="Completion"  value={fmtPct(selected.completion_rate)}          color="#2e7d32"/>
            <Card icon="💶" label="Total cost"  value={fmtEur(selected.total_cost)}
              sub={selected.cost_per_ha?`${fmtEur(selected.cost_per_ha)}/ha`:undefined}           color="#8d6e63"/>
            <Card icon="🌾" label="Harvest"     value={fmtTon(selected.total_harvest_ton)}
              sub={selected.harvest_per_ha?`${selected.harvest_per_ha.toFixed(3)} t/ha`:undefined} color="#388e3c"/>
            <Card icon="🗺️" label="Fields"      value={`${selected.fields_count} fields`}
              sub={fmtHa(selected.total_area_ha)}                                                  color="#5d4037"/>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <Sec>Operations by type</Sec>
              <ResponsiveContainer width="100%" height={Math.max(120,selected.by_type.length*22)}>
                <BarChart layout="vertical"
                  data={selected.by_type.map(d=>({...d,label:(WORK_ICONS[d.work_type]||'')+' '+d.work_type.replace(/_/g,' ').toLowerCase()}))}
                  margin={{top:0,right:12,left:4,bottom:0}}>
                  <XAxis type="number" tick={{fontSize:9}} allowDecimals={false}/>
                  <YAxis type="category" dataKey="label" tick={{fontSize:9}} width={110}/>
                  <Tooltip contentStyle={{fontSize:11}}/>
                  <Bar dataKey="count" fill="#6b4c2a" radius={[0,3,3,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <Sec>Monthly activity</Sec>
              <ResponsiveContainer width="100%" height={Math.max(120,selected.by_month.length*22)}>
                <BarChart data={selected.by_month} margin={{top:0,right:8,left:-16,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe3"/>
                  <XAxis dataKey="month" tick={{fontSize:9}} tickFormatter={v=>v.slice(5)}/>
                  <YAxis tick={{fontSize:9}} allowDecimals={false}/>
                  <Tooltip contentStyle={{fontSize:11}}/>
                  <Bar dataKey="count" fill="#8d6e63" radius={[2,2,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </ChartBox>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// ANALYTICS TAB 3 – Equipment usage
// ══════════════════════════════════════════════════════════════════════════════
const EQ_ICONS_FW = {
  TRACTOR:'🚜', PLOW:'🔧', DISC_HARROW:'⚙️', CULTIVATOR:'⚙️', SUBSOILER:'🔩',
  ROLLER:'🔄', SEEDER:'🌱', TRANSPLANTER:'🌿', POTATO_PLANTER:'🥔',
  SPRAYER:'💧', FERTILIZER_SPREADER:'🧪', IRRIGATION_SYSTEM:'💦',
  MOWER:'✂️', BALER:'📦', RAKE:'🌾', COMBINE_HARVESTER:'🌾',
  FORAGE_HARVESTER:'🌿', GRAIN_CART:'🛒', TRAILER:'🚛',
  LOADER:'🏗', TELEHANDLER:'🏗', ATV:'🏎', TRUCK:'🚛',
  DRONE:'🛸', OTHER:'🔧',
};

const EQ_STATUS_COLORS_FW = {
  OPERATIONAL:'#2e7d32', IN_USE:'#0d47a1', MAINTENANCE:'#f57f17',
  REPAIR:'#c62828', IDLE:'#9e9e9e', RETIRED:'#bdbdbd',
};

const EquipmentAnalytics = ({ userId }) => {
  const [fleet,   setFleet]   = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selEq,   setSelEq]   = useState(null);
  const [usage,   setUsage]   = useState([]);
  const [loadingUsage, setLoadingUsage] = useState(false);

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

  const selectEq = (eq) => {
    if (selEq?.id === eq.id) { setSelEq(null); setUsage([]); return; }
    setSelEq(eq);
    setLoadingUsage(true);
    api.get(`${BASE_EQ}/${eq.id}/usage?user_id=${userId}`)
      .then(r => setUsage(Array.isArray(r.data) ? r.data : []))
      .catch(() => setUsage([]))
      .finally(() => setLoadingUsage(false));
  };

  if (loading) return <EmptyState text="Loading fleet data…"/>;
  if (!fleet.length) return (
    <div style={{ textAlign:'center', padding:'32px 0', color:'#bbb' }}>
      <div style={{ fontSize:32, marginBottom:8 }}>🚜</div>
      <div style={{ fontSize:13, marginBottom:6 }}>No equipment registered yet.</div>
      <div style={{ fontSize:11 }}>Add machines in the Farm Management → Equipment tab.</div>
    </div>
  );

  // ── derived data for charts ──────────────────────────────────────────────
  const byStatus = Object.entries(
    fleet.reduce((acc, e) => { acc[e.status] = (acc[e.status]||0)+1; return acc; }, {})
  ).map(([status, count]) => ({ status, count }));

  const hoursData = fleet
    .filter(e => (e.total_hours_logged||0) > 0)
    .sort((a, b) => (b.total_hours_logged||0) - (a.total_hours_logged||0))
    .map(e => ({
      name: e.name,
      hours: Number(e.total_hours_logged||0),
      type:  e.equipment_type,
    }));

  const fuelData = fleet
    .filter(e => (e.total_fuel_logged_l||0) > 0)
    .sort((a, b) => (b.total_fuel_logged_l||0) - (a.total_fuel_logged_l||0))
    .map(e => ({
      name: e.name,
      fuel: Number(e.total_fuel_logged_l||0).toFixed(0),
    }));

  const areaData = fleet
    .filter(e => (e.total_area_logged_ha||0) > 0)
    .sort((a, b) => (b.total_area_logged_ha||0) - (a.total_area_logged_ha||0))
    .map(e => ({
      name: e.name,
      area_ha: Number(e.total_area_logged_ha||0).toFixed(1),
    }));

  const serviceData = fleet
    .filter(e => e.next_service_date)
    .sort((a, b) => new Date(a.next_service_date) - new Date(b.next_service_date))
    .slice(0, 8);

  const today = new Date();

  // Usage aggregation for selected machine
  const usageByMonth = usage.reduce((acc, u) => {
    const m = String(u.used_date).slice(0, 7);
    if (!acc[m]) acc[m] = { month: m, hours: 0, fuel: 0, area: 0 };
    acc[m].hours += Number(u.hours_worked||0);
    acc[m].fuel  += Number(u.fuel_consumed_l||0);
    acc[m].area  += Number(u.area_ha||0);
    return acc;
  }, {});
  const usageMonthly = Object.values(usageByMonth).sort((a,b)=>a.month.localeCompare(b.month));

  return (
    <div>
      {/* Summary KPI cards */}
      {summary && (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
          <Card icon="🚜" label="Fleet total"      value={summary.total}                color="#6b4c2a"/>
          <Card icon="✅" label="Operational"
            value={(summary.by_status?.OPERATIONAL||0)+(summary.by_status?.IN_USE||0)}  color="#2e7d32"/>
          <Card icon="⏱"  label="Hours logged (YTD)"
            value={summary.year_hours_logged ? `${Number(summary.year_hours_logged).toFixed(0)} h` : '—'}
            color="#0d47a1"/>
          {summary.overdue_service > 0 && (
            <Card icon="⚠️" label="Service overdue"  value={summary.overdue_service}    color="#c62828"/>
          )}
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
        {/* Fleet status distribution */}
        <ChartBox>
          <Sec>Fleet status distribution</Sec>
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie data={byStatus} dataKey="count" nameKey="status"
                  cx="50%" cy="50%" outerRadius={60} innerRadius={28}
                  label={({percent})=>percent>0.08?`${(percent*100).toFixed(0)}%`:''} labelLine={false}>
                  {byStatus.map(d=>(
                    <Cell key={d.status} fill={EQ_STATUS_COLORS_FW[d.status]||'#9e9e9e'}/>
                  ))}
                </Pie>
                <Tooltip contentStyle={{fontSize:11}} formatter={(v,n)=>[v,n]}/>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {byStatus.map(d => (
                <div key={d.status} style={{ display:'flex', alignItems:'center', gap:7 }}>
                  <span style={{ width:10, height:10, borderRadius:3, flexShrink:0,
                    background: EQ_STATUS_COLORS_FW[d.status]||'#9e9e9e' }}/>
                  <span style={{ fontSize:11, color:'#555', fontWeight:600 }}>
                    {d.status.replace(/_/g,' ')}
                  </span>
                  <span style={{ fontSize:11, color:'#aaa', marginLeft:4 }}>{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        </ChartBox>

        {/* Next service schedule */}
        <ChartBox>
          <Sec>Service schedule (next 8 due)</Sec>
          {serviceData.length === 0
            ? <EmptyState text="No service dates set"/>
            : (
              <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                {serviceData.map(e => {
                  const due   = new Date(e.next_service_date);
                  const days  = Math.round((due - today) / 86400000);
                  const color = days < 0 ? '#c62828' : days <= 14 ? '#f57f17' : '#2e7d32';
                  const bg    = days < 0 ? '#fce4ec' : days <= 14 ? '#fff8e1' : '#e8f5e9';
                  return (
                    <div key={e.id} style={{ display:'flex', alignItems:'center', gap:10,
                      padding:'5px 8px', borderRadius:6, background:bg }}>
                      <span style={{ fontSize:16 }}>{EQ_ICONS_FW[e.equipment_type]||'🔧'}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:11, fontWeight:700, color:'#333',
                          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                          {e.name}
                        </div>
                        <div style={{ fontSize:10, color:'#aaa' }}>
                          {e.equipment_type.replace(/_/g,' ')}
                          {e.hours_current != null ? ` · ${Number(e.hours_current).toFixed(0)} h` : ''}
                        </div>
                      </div>
                      <div style={{ textAlign:'right', flexShrink:0 }}>
                        <div style={{ fontSize:11, fontWeight:800, color }}>
                          {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `${days}d`}
                        </div>
                        <div style={{ fontSize:10, color:'#aaa' }}>{e.next_service_date}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          }
        </ChartBox>
      </div>

      {/* Hours logged per machine */}
      {hoursData.length > 0 && (
        <ChartBox style={{ marginBottom:14 }}>
          <Sec>Hours logged per machine (click to drill down)</Sec>
          <ResponsiveContainer width="100%" height={Math.max(140, hoursData.length*28)}>
            <BarChart layout="vertical" data={hoursData}
              margin={{top:0,right:60,left:4,bottom:0}}
              onClick={e => {
                if (!e?.activePayload) return;
                const name = e.activePayload[0]?.payload?.name;
                const eq = fleet.find(x => x.name === name);
                if (eq) selectEq(eq);
              }}>
              <XAxis type="number" tick={{fontSize:10}} unit=" h"/>
              <YAxis type="category" dataKey="name" tick={{fontSize:10}} width={130}/>
              <Tooltip contentStyle={{fontSize:11}} formatter={v=>[`${v} h`,'Hours logged']}/>
              <Bar dataKey="hours" radius={[0,4,4,0]} cursor="pointer">
                {hoursData.map((d, i) => (
                  <Cell key={i}
                    fill={selEq?.name === d.name ? '#6b4c2a' : PALETTE[i % PALETTE.length]}
                    opacity={selEq && selEq.name !== d.name ? 0.4 : 1}/>
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>
      )}

      {/* Fuel and area side by side */}
      {(fuelData.length > 0 || areaData.length > 0) && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
          {fuelData.length > 0 && (
            <ChartBox>
              <Sec>Fuel consumed per machine (L)</Sec>
              <ResponsiveContainer width="100%" height={Math.max(120, fuelData.length*26)}>
                <BarChart layout="vertical" data={fuelData} margin={{top:0,right:50,left:4,bottom:0}}>
                  <XAxis type="number" tick={{fontSize:10}} unit=" L"/>
                  <YAxis type="category" dataKey="name" tick={{fontSize:10}} width={120}/>
                  <Tooltip contentStyle={{fontSize:11}} formatter={v=>[`${v} L`,'Fuel']}/>
                  <Bar dataKey="fuel" radius={[0,4,4,0]}>
                    {fuelData.map((_, i) => <Cell key={i} fill={PALETTE[(i+4)%PALETTE.length]}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartBox>
          )}
          {areaData.length > 0 && (
            <ChartBox>
              <Sec>Area covered per machine (ha)</Sec>
              <ResponsiveContainer width="100%" height={Math.max(120, areaData.length*26)}>
                <BarChart layout="vertical" data={areaData} margin={{top:0,right:50,left:4,bottom:0}}>
                  <XAxis type="number" tick={{fontSize:10}} unit=" ha"/>
                  <YAxis type="category" dataKey="name" tick={{fontSize:10}} width={120}/>
                  <Tooltip contentStyle={{fontSize:11}} formatter={v=>[`${v} ha`,'Area']}/>
                  <Bar dataKey="area_ha" radius={[0,4,4,0]}>
                    {areaData.map((_,i) => <Cell key={i} fill={PALETTE[(i+7)%PALETTE.length]}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartBox>
          )}
        </div>
      )}

      {/* Drill-down: selected machine monthly usage */}
      {selEq && (
        <ChartBox style={{ border:'2px solid #6b4c2a', marginBottom:14 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:22 }}>{EQ_ICONS_FW[selEq.equipment_type]||'🔧'}</span>
              <div>
                <Sec style={{ margin:0 }}>{selEq.name} — usage detail</Sec>
                <div style={{ fontSize:11, color:'#aaa' }}>
                  {selEq.equipment_type.replace(/_/g,' ')}
                  {selEq.manufacturer ? ` · ${selEq.manufacturer} ${selEq.model||''}` : ''}
                  {selEq.hours_current != null ? ` · ${Number(selEq.hours_current).toFixed(0)} h current` : ''}
                </div>
              </div>
            </div>
            <button onClick={()=>{setSelEq(null);setUsage([]);}}
              style={{ background:'none', border:'1px solid #e0d8cf', borderRadius:6,
                padding:'3px 10px', fontSize:11, cursor:'pointer', color:'#888' }}>✕ Close</button>
          </div>

          {/* KPI row */}
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14 }}>
            <Card icon="⏱"  label="Total hours logged"
              value={`${Number(selEq.total_hours_logged||0).toFixed(0)} h`}   color="#0d47a1"/>
            <Card icon="⛽"  label="Total fuel logged"
              value={selEq.total_fuel_logged_l ? `${Number(selEq.total_fuel_logged_l).toFixed(0)} L` : '—'}
              color="#e65100"/>
            <Card icon="🗺️"  label="Total area covered"
              value={selEq.total_area_logged_ha ? `${Number(selEq.total_area_logged_ha).toFixed(1)} ha` : '—'}
              color="#054e05"/>
            {selEq.last_maintenance_date && (
              <Card icon="🔧" label="Last service"
                value={selEq.last_maintenance_date}                            color="#5d4037"/>
            )}
          </div>

          {loadingUsage
            ? <EmptyState text="Loading usage log…"/>
            : usageMonthly.length === 0
              ? <EmptyState text="No usage sessions logged yet for this machine."/>
              : (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
                  <div>
                    <Sec>Hours per month</Sec>
                    <ResponsiveContainer width="100%" height={140}>
                      <BarChart data={usageMonthly} margin={{top:2,right:8,left:-18,bottom:0}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe3"/>
                        <XAxis dataKey="month" tick={{fontSize:9}} tickFormatter={v=>v.slice(5)}/>
                        <YAxis tick={{fontSize:9}}/>
                        <Tooltip contentStyle={{fontSize:11}} formatter={v=>[`${Number(v).toFixed(1)} h`,'Hours']}/>
                        <Bar dataKey="hours" fill="#0d47a1" radius={[2,2,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    <Sec>Fuel per month (L)</Sec>
                    <ResponsiveContainer width="100%" height={140}>
                      <BarChart data={usageMonthly} margin={{top:2,right:8,left:-18,bottom:0}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe3"/>
                        <XAxis dataKey="month" tick={{fontSize:9}} tickFormatter={v=>v.slice(5)}/>
                        <YAxis tick={{fontSize:9}}/>
                        <Tooltip contentStyle={{fontSize:11}} formatter={v=>[`${Number(v).toFixed(0)} L`,'Fuel']}/>
                        <Bar dataKey="fuel" fill="#e65100" radius={[2,2,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    <Sec>Area per month (ha)</Sec>
                    <ResponsiveContainer width="100%" height={140}>
                      <BarChart data={usageMonthly} margin={{top:2,right:8,left:-18,bottom:0}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe3"/>
                        <XAxis dataKey="month" tick={{fontSize:9}} tickFormatter={v=>v.slice(5)}/>
                        <YAxis tick={{fontSize:9}}/>
                        <Tooltip contentStyle={{fontSize:11}} formatter={v=>[`${Number(v).toFixed(1)} ha`,'Area']}/>
                        <Bar dataKey="area" fill="#054e05" radius={[2,2,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )
          }

          {/* Raw sessions table */}
          {usage.length > 0 && (
            <div style={{ marginTop:14 }}>
              <Sec>Usage sessions ({usage.length} total)</Sec>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                  <thead>
                    <tr style={{ background:'#f5f0ea', textAlign:'left' }}>
                      {['Date','Hours','Area (ha)','Fuel (L)','Fuel cost','Operator','Field','Work type'].map(h=>(
                        <th key={h} style={{ padding:'5px 8px', fontWeight:700, color:'#888',
                          borderBottom:'1px solid #e0d8cf', whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {usage.map((u,i)=>(
                      <tr key={u.id}
                        style={{ background:i%2===0?'#fff':'#fafaf8' }}>
                        <td style={{ padding:'5px 8px', fontWeight:600 }}>{u.used_date}</td>
                        <td style={{ padding:'5px 8px', textAlign:'right' }}>
                          {u.hours_worked ? `${Number(u.hours_worked).toFixed(1)} h` : '—'}
                        </td>
                        <td style={{ padding:'5px 8px', textAlign:'right', color:'#388e3c' }}>
                          {u.area_ha ? `${Number(u.area_ha).toFixed(1)}` : '—'}
                        </td>
                        <td style={{ padding:'5px 8px', textAlign:'right', color:'#e65100' }}>
                          {u.fuel_consumed_l ? `${Number(u.fuel_consumed_l).toFixed(0)}` : '—'}
                        </td>
                        <td style={{ padding:'5px 8px', textAlign:'right' }}>
                          {u.fuel_cost ? fmtEur(u.fuel_cost) : '—'}
                        </td>
                        <td style={{ padding:'5px 8px', color:'#888' }}>{u.operator_name||'—'}</td>
                        <td style={{ padding:'5px 8px', color:'#888' }}>{u.field_label||'—'}</td>
                        <td style={{ padding:'5px 8px', color:'#888' }}>
                          {u.work_type ? u.work_type.replace(/_/g,' ') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </ChartBox>
      )}

      {/* Fleet table */}
      <ChartBox>
        <Sec>Full fleet register</Sec>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
            <thead>
              <tr style={{ background:'#f5f0ea', textAlign:'left' }}>
                {['Machine','Type','Status','Year','Power','Hours (cur)','Hours logged','Fuel logged','Area logged','Next service'].map(h=>(
                  <th key={h} style={{ padding:'6px 8px', fontWeight:700, color:'#888',
                    borderBottom:'1px solid #e0d8cf', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fleet.map((e,i)=>{
                const due   = e.next_service_date ? new Date(e.next_service_date) : null;
                const days  = due ? Math.round((due-today)/86400000) : null;
                const dcol  = days==null?'#aaa':days<0?'#c62828':days<=14?'#f57f17':'#2e7d32';
                return (
                  <tr key={e.id} onClick={()=>selectEq(e)}
                    style={{ background:selEq?.id===e.id?'#fdf6ef':i%2===0?'#fff':'#fafaf8',
                      cursor:'pointer', transition:'background 0.1s' }}>
                    <td style={{ padding:'6px 8px', fontWeight:700 }}>
                      {EQ_ICONS_FW[e.equipment_type]||'🔧'} {e.name}
                    </td>
                    <td style={{ padding:'6px 8px', color:'#888' }}>{e.equipment_type.replace(/_/g,' ')}</td>
                    <td style={{ padding:'6px 8px' }}>
                      <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:10,
                        background:(EQ_STATUS_COLORS_FW[e.status]||'#9e9e9e')+'22',
                        color: EQ_STATUS_COLORS_FW[e.status]||'#9e9e9e', border:'1px solid currentColor' }}>
                        {e.status.replace(/_/g,' ')}
                      </span>
                    </td>
                    <td style={{ padding:'6px 8px', color:'#aaa' }}>{e.year_of_manufacture||'—'}</td>
                    <td style={{ padding:'6px 8px', color:'#aaa' }}>{e.power_kw ? `${e.power_kw} kW` : '—'}</td>
                    <td style={{ padding:'6px 8px', textAlign:'right' }}>
                      {e.hours_current != null ? `${Number(e.hours_current).toFixed(0)} h` : '—'}
                    </td>
                    <td style={{ padding:'6px 8px', textAlign:'right', fontWeight:600, color:'#0d47a1' }}>
                      {e.total_hours_logged ? `${Number(e.total_hours_logged).toFixed(0)} h` : '—'}
                    </td>
                    <td style={{ padding:'6px 8px', textAlign:'right', color:'#e65100' }}>
                      {e.total_fuel_logged_l ? `${Number(e.total_fuel_logged_l).toFixed(0)} L` : '—'}
                    </td>
                    <td style={{ padding:'6px 8px', textAlign:'right', color:'#388e3c' }}>
                      {e.total_area_logged_ha ? `${Number(e.total_area_logged_ha).toFixed(1)} ha` : '—'}
                    </td>
                    <td style={{ padding:'6px 8px', fontWeight:700, color:dcol }}>
                      {days==null ? '—' : days<0 ? `${Math.abs(days)}d overdue` : days===0 ? 'Today' : `${days}d`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ChartBox>
    </div>
  );
};


// ══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════════════════════════════════════
const FieldWorkPanel = ({ userId, locationId }) => {
  const [open,setOpen]   = useState(true);
  const [tab,setTab]     = useState('log');
  const [records,setRecords] = useState([]);
  const [fields,setFields]   = useState([]);
  const [loading,setLoading] = useState(true);
  const [filterType,setFilterType]     = useState('ALL');
  const [filterStatus,setFilterStatus] = useState('ALL');

  const loadFields = useCallback(()=>{
    if(!userId) return;
    api.get('/api/v1/user_fields',{params:{user_id:userId,...(locationId?{location_id:locationId}:{})}})
      .then(r=>{ const d=r.data; setFields(Array.isArray(d)?d:(d?.fields??d?.items??[])); })
      .catch(()=>setFields([]));
  },[userId,locationId]);

  const loadRecords = useCallback(()=>{
    if(!userId) return;
    setLoading(true);
    api.get(`${BASE}/user`)
      .then(r=>{ const d=r.data; setRecords(Array.isArray(d)?d:(d?.items??[])); })
      .catch(()=>setRecords([]))
      .finally(()=>setLoading(false));
  },[userId]);

  useEffect(()=>{ loadFields(); loadRecords(); },[loadFields,loadRecords]);

  const inProgress = records.filter(r=>r.work_status==='IN_PROGRESS').length;

  const TABS_DEF = [
    ['log',        '📋 Work Log'],
    ['seasons',    '🌱 Seasons'],
    ['by_type',    '📊 By Operation'],
    ['by_location','📍 By Location'],
    ['by_equipment','🚜 Equipment'],
  ];

  return (
    <div style={panelWrap}>
      <div style={panelHead} onClick={()=>setOpen(v=>!v)}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:18 }}>🚜</span>
          <span style={titleStyle}>Field Work</span>
          <span style={badge}>{records.length} records</span>
          {inProgress > 0 && (
            <span style={{...badge, background:'#e1f5fe', color:'#01579b'}}>
              {inProgress} in progress
            </span>
          )}
        </div>
        <span style={{ color:'#bbb', fontSize:13 }}>{open?'▲':'▼'}</span>
      </div>

      {open && (
        <div style={panelBody}>
          <div style={{ display:'flex', gap:0, marginBottom:16, border:'1px solid #e0d8cf',
            borderRadius:8, overflow:'hidden', width:'fit-content' }}>
            {TABS_DEF.map(([k,l])=>(
              <button key={k} onClick={()=>setTab(k)} style={{
                padding:'7px 18px', fontSize:13, fontWeight:700, border:'none', cursor:'pointer',
                background: tab===k ? 'var(--color-accent-soil,#6b4c2a)' : '#f5f0ea',
                color: tab===k ? '#fff' : '#888' }}>
                {l}
              </button>
            ))}
          </div>

          {tab === 'log' && (
            <LogTab userId={userId} records={records} fields={fields}
              loading={loading} onUpdate={loadRecords} onCreated={loadRecords}
              filterType={filterType} setFilterType={setFilterType}
              filterStatus={filterStatus} setFilterStatus={setFilterStatus}/>
          )}
          {tab === 'seasons' && <SeasonsTab fields={fields}/>}
          {tab === 'by_type'     && <WorkTypeAnalytics userId={userId}/>}
          {tab === 'by_location'  && <LocationAnalytics  userId={userId}/>}
          {tab === 'by_equipment' && <EquipmentAnalytics userId={userId}/>}
        </div>
      )}
    </div>
  );
};

export default FieldWorkPanel;

// ── Styles ────────────────────────────────────────────────────────────────────
const panelWrap  = {background:'#fff',borderRadius:14,border:'1px solid var(--color-accent-soil)',boxShadow:'0 2px 10px rgba(0,0,0,0.05)',overflow:'hidden',marginBottom:20};
const panelHead  = {display:'flex',justifyContent:'space-between',alignItems:'center',padding:'13px 20px',cursor:'pointer',background:'var(--color-bg-champagne)',borderBottom:'1px solid var(--color-accent-soil)',userSelect:'none'};
const panelBody  = {padding:'16px 20px 20px'};
const titleStyle = {fontFamily:'var(--font-heading)',fontWeight:700,fontSize:15,color:'var(--color-accent-chernozem)'};
const badge      = {fontSize:11,color:'#aaa',background:'#f0ebe3',borderRadius:10,padding:'2px 8px'};
const formBox    = {background:'#f8f4f0',borderRadius:10,border:'1px solid #e0d8cf',padding:14,marginTop:10};
const inp        = {padding:'6px 10px',borderRadius:6,border:'1px solid #ddd',fontSize:13,fontFamily:'inherit',outline:'none',background:'#fff'};
const lbl        = {display:'flex',flexDirection:'column',gap:4,fontSize:10,fontWeight:700,color:'#aaa',textTransform:'uppercase',letterSpacing:'0.04em'};
const btnPrimary = {background:'var(--color-green-primary,#054e05)',color:'#fff',border:'none',borderRadius:6,padding:'7px 16px',fontWeight:700,fontSize:13,cursor:'pointer',fontFamily:'inherit'};
const btnAdd     = {background:'var(--color-accent-soil,#6b4c2a)',color:'#fff',border:'none',borderRadius:8,padding:'7px 16px',fontWeight:700,fontSize:13,cursor:'pointer',fontFamily:'inherit'};