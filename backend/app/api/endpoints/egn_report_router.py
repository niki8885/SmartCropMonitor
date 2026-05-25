from __future__ import annotations
import io
import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import extract

from app.core.database import (
    get_db,
    UserDB,
    UserLocation,
    FieldUnit,
    FieldWork,
    SeasonRecord,
    FertilizationLog,
    PesticideLog,
)

router = APIRouter(prefix="/egn", tags=["eGN Report"])


def _fmt(v, decimals=2, unit=""):
    if v is None:
        return "—"
    return f"{round(float(v), decimals)}{' ' + unit if unit else ''}"


def _field_type_str(f: FieldUnit) -> str:
    ft = f.field_type
    return ft.value if hasattr(ft, "value") else str(ft)


def _work_type_str(w: FieldWork) -> str:
    wt = w.work_type
    return wt.value if hasattr(wt, "value") else str(wt)


def _work_status_str(w: FieldWork) -> str:
    ws = w.work_status
    return ws.value if hasattr(ws, "value") else str(ws)


def _yn(v) -> str:
    if v is None:
        return "—"
    return "Yes" if v else "No"


def _collect(user_id: int, year: int, db: Session) -> dict:

    user = db.get(UserDB, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    farm = {
        "farm_name":       user.farm_name,
        "farm_size_ha":    float(user.farm_size_ha) if user.farm_size_ha else None,
        "farm_reg_number": user.farm_reg_number,
        "farm_owner_name": user.farm_owner_name,
        "farm_operator":   user.farm_operator,
        "contact": {
            "first_name": user.first_name,
            "last_name":  user.last_name,
            "email":      user.email,
            "phone":      user.phone,
            "country":    user.country,
            "city":       user.city,
        },
    }

    locations = db.query(UserLocation).filter(UserLocation.user_id == user_id).all()
    loc_ids   = [l.id for l in locations]

    fields_db = (
        db.query(FieldUnit)
        .filter(
            FieldUnit.location_id.in_(loc_ids),
            FieldUnit.deleted_at.is_(None),
        )
        .all()
    )
    field_ids = [f.id for f in fields_db]
    field_map = {f.id: f for f in fields_db}

    fields_out = []
    for f in fields_db:
        fields_out.append({
            "id":               f.id,
            "label":            f.label,
            "field_type":       _field_type_str(f),
            "lpis_id":          f.lpis_id,
            "cadastral_ref":    f.cadastral_ref,
            "area_ha":          float(f.area_ha) if f.area_ha else None,
            "soil_type":        f.soil_type,
            "soil_texture":     f.soil_texture,
            "organic_matter":   float(f.organic_matter) if f.organic_matter else None,
            "previous_crop":    f.previous_crop,
            "previous_crop_year": f.previous_crop_year,
            "eco": {
                "has_buffer_zone":   f.has_buffer_zone,
                "buffer_zone_m":     float(f.buffer_zone_m) if f.buffer_zone_m else None,
                "is_non_productive": f.is_non_productive,
                "in_nitrate_zone":   f.in_nitrate_zone,
                "organic_farming":   f.organic_farming,
            },
        })

    seasons_db = (
        db.query(SeasonRecord)
        .filter(
            SeasonRecord.user_id == user_id,
            SeasonRecord.season_year == year,
        )
        .all()
    )

    seasons_out = []
    for s in seasons_db:
        seasons_out.append({
            "id":               s.id,
            "field_id":         s.field_id,
            "field_label":      field_map.get(s.field_id, None) and field_map[s.field_id].label,
            "crop":             s.crop,
            "variety":          s.variety,
            "sowing_date":      s.sowing_date.isoformat() if s.sowing_date else None,
            "sowing_rate_kg_ha": float(s.sowing_rate_kg_ha) if s.sowing_rate_kg_ha else None,
            "seed_treatment":   s.seed_treatment,
            "tillage_type":     s.tillage_type,
            "harvest_date":     s.harvest_date.isoformat() if s.harvest_date else None,
            "harvest_area_ha":  float(s.harvest_area_ha) if s.harvest_area_ha else None,
            "harvest_total_t":  float(s.harvest_total_t) if s.harvest_total_t else None,
            "yield_t_ha":       float(s.yield_t_ha)      if s.yield_t_ha      else None,
            "moisture_pct":     float(s.moisture_pct)    if s.moisture_pct    else None,
            "protein_pct":      float(s.protein_pct)     if s.protein_pct     else None,
        })

    fert_db = (
        db.query(FertilizationLog)
        .filter(
            FertilizationLog.user_id == user_id,
            extract("year", FertilizationLog.application_date) == year,
        )
        .order_by(FertilizationLog.application_date)
        .all()
    )

    fert_out = []
    for f in fert_db:
        fert_out.append({
            "field_id":          f.field_id,
            "field_label":       field_map.get(f.field_id, None) and field_map[f.field_id].label,
            "application_date":  f.application_date.isoformat(),
            "product_name":      f.product_name,
            "product_type":      f.product_type,
            "is_organic":        f.is_organic,
            "n_kg_ha":           float(f.n_kg_ha)    if f.n_kg_ha    else None,
            "p2o5_kg_ha":        float(f.p2o5_kg_ha) if f.p2o5_kg_ha else None,
            "k2o_kg_ha":         float(f.k2o_kg_ha)  if f.k2o_kg_ha  else None,
            "s_kg_ha":           float(f.s_kg_ha)    if f.s_kg_ha    else None,
            "dose_kg_ha":        float(f.dose_kg_ha) if f.dose_kg_ha else None,
            "total_dose_kg":     float(f.total_dose_kg) if f.total_dose_kg else None,
            "application_method": f.application_method,
            "operator_name":     f.operator_name,
            "equipment":         f.equipment,
        })

    pest_db = (
        db.query(PesticideLog)
        .filter(
            PesticideLog.user_id == user_id,
            extract("year", PesticideLog.application_date) == year,
        )
        .order_by(PesticideLog.application_date)
        .all()
    )

    pest_out = []
    for p in pest_db:
        pest_out.append({
            "field_id":            p.field_id,
            "field_label":         field_map.get(p.field_id, None) and field_map[p.field_id].label,
            "application_date":    p.application_date.isoformat(),
            "product_trade_name":  p.product_trade_name,
            "active_substance":    p.active_substance,
            "registration_number": p.registration_number,
            "dose_l_ha":           float(p.dose_l_ha)          if p.dose_l_ha          else None,
            "dose_kg_ha":          float(p.dose_kg_ha)         if p.dose_kg_ha         else None,
            "water_volume_l_ha":   float(p.water_volume_l_ha)  if p.water_volume_l_ha  else None,
            "target_type":         p.target_type,
            "target_organism":     p.target_organism,
            "bbch_stage":          p.bbch_stage,
            "pre_harvest_interval_days": p.pre_harvest_interval_days,
            "wind_speed_ms":       float(p.wind_speed_ms) if p.wind_speed_ms else None,
            "temperature_c":       float(p.temperature_c) if p.temperature_c else None,
            "operator_name":       p.operator_name,
            "operator_cert":       p.operator_cert,
        })

    ops_db = (
        db.query(FieldWork)
        .filter(
            FieldWork.user_id == user_id,
            FieldWork.field_id.in_(field_ids),
            extract("year", FieldWork.work_date) == year,
        )
        .order_by(FieldWork.work_date)
        .all()
    )

    ops_out = []
    for w in ops_db:
        ops_out.append({
            "field_id":       w.field_id,
            "field_label":    field_map.get(w.field_id, None) and field_map[w.field_id].label,
            "work_date":      w.work_date.isoformat(),
            "work_type":      _work_type_str(w),
            "work_status":    _work_status_str(w),
            "operator_name":  w.operator_name,
            "equipment":      w.equipment,
            "tillage_depth_cm": float(w.tillage_depth_cm) if w.tillage_depth_cm else None,
            "irrigation_mm":    float(w.irrigation_mm)    if w.irrigation_mm    else None,
            "work_cost":      float(w.work_cost) if w.work_cost else None,
        })

    total_area = sum(float(f.area_ha or 0) for f in fields_db)
    total_n    = sum(float(f.n_kg_ha or 0) * float(field_map[f.field_id].area_ha or 1)
                     for f in fert_db if f.n_kg_ha and f.field_id in field_map)
    total_harvest = sum(float(s.harvest_total_t or 0) for s in seasons_db if s.harvest_total_t)

    return {
        "report_year":  year,
        "generated_at": datetime.datetime.utcnow().isoformat(),
        "section_3_1_farm":         farm,
        "section_3_2_fields":       fields_out,
        "section_3_3_7_seasons":    seasons_out,
        "section_3_4_fertilization": fert_out,
        "section_3_5_pesticides":   pest_out,
        "section_3_6_operations":   ops_out,
        "totals": {
            "fields_count":      len(fields_db),
            "total_area_ha":     round(total_area, 2),
            "seasons_count":     len(seasons_db),
            "fert_events":       len(fert_db),
            "spray_events":      len(pest_db),
            "operations_count":  len(ops_db),
            "total_harvest_t":   round(total_harvest, 2),
            "total_n_kg":        round(total_n, 1),
        },
    }


def _completeness(data: dict) -> dict:
    farm   = data["section_3_1_farm"]
    fields = data["section_3_2_fields"]
    seasons = data["section_3_3_7_seasons"]
    ferts   = data["section_3_4_fertilization"]
    pests   = data["section_3_5_pesticides"]

    issues = []
    warnings = []

    # 3.1
    if not farm.get("farm_name"):        issues.append("3.1 Farm name missing")
    if not farm.get("farm_size_ha"):     issues.append("3.1 Registered farm area missing")
    if not farm.get("farm_reg_number"):  warnings.append("3.1 Registration number not set")

    # 3.2
    for f in fields:
        label = f["label"] or f"Field {f['id']}"
        if not f.get("lpis_id"):         warnings.append(f"3.2 [{label}] LPIS ID missing")
        if not f.get("area_ha"):         issues.append(f"3.2 [{label}] Area missing")
        if not f.get("soil_type"):       warnings.append(f"3.2 [{label}] Soil type not set")

    # 3.3
    for s in seasons:
        label = s.get("field_label") or f"Field {s['field_id']}"
        if not s.get("sowing_date"):     issues.append(f"3.3 [{label} / {s['crop']}] Sowing date missing")
        if not s.get("sowing_rate_kg_ha"): warnings.append(f"3.3 [{label}] Sowing rate not set")

    # 3.4
    for f in ferts:
        label = f.get("field_label") or f"Field {f['field_id']}"
        if f.get("n_kg_ha") is None and f.get("p2o5_kg_ha") is None and f.get("k2o_kg_ha") is None:
            issues.append(f"3.4 [{label} / {f['application_date']}] No NPK values — required by eGN")
        if not f.get("application_method"):
            warnings.append(f"3.4 [{label}] Application method missing")

    # 3.5
    for p in pests:
        label = p.get("field_label") or f"Field {p['field_id']}"
        if not p.get("active_substance"):
            issues.append(f"3.5 [{label} / {p['product_trade_name']}] Active substance missing")
        if not p.get("registration_number"):
            warnings.append(f"3.5 [{label}] Registration number missing")
        if p.get("pre_harvest_interval_days") is None:
            warnings.append(f"3.5 [{label} / {p['product_trade_name']}] PHI not recorded")

    score = max(0, 100 - len(issues) * 10 - len(warnings) * 3)
    status = "READY" if not issues else ("WARNINGS" if not issues else "INCOMPLETE")
    if issues:
        status = "INCOMPLETE"
    elif warnings:
        status = "WARNINGS"
    else:
        status = "READY"

    return {
        "score":    score,
        "status":   status,
        "issues":   issues,
        "warnings": warnings,
    }

def _build_pdf(data: dict, completeness: dict) -> bytes:
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.lib import colors
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
            HRFlowable, KeepTogether,
        )
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="reportlab not installed. Run: pip install reportlab",
        )

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=2*cm,  bottomMargin=2*cm,
    )

    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=16, spaceAfter=6,
                         textColor=colors.HexColor("#3e2723"))
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=12, spaceAfter=4,
                         textColor=colors.HexColor("#6b4c2a"), spaceBefore=14)
    h3 = ParagraphStyle("H3", parent=styles["Heading3"], fontSize=10, spaceAfter=3,
                         textColor=colors.HexColor("#555"), spaceBefore=8)
    body = ParagraphStyle("Body", parent=styles["Normal"], fontSize=9, spaceAfter=2)
    small = ParagraphStyle("Small", parent=styles["Normal"], fontSize=8, textColor=colors.grey)
    warn_style = ParagraphStyle("Warn", parent=styles["Normal"], fontSize=8,
                                textColor=colors.HexColor("#e65100"))
    err_style  = ParagraphStyle("Err",  parent=styles["Normal"], fontSize=8,
                                textColor=colors.HexColor("#c62828"))

    story = []
    farm = data["section_3_1_farm"]
    year = data["report_year"]

    story.append(Paragraph("eGN Farm Log Report", h1))
    story.append(Paragraph(
        f"Season {year} · Generated {data['generated_at'][:10]}",
        small,
    ))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#6b4c2a")))
    story.append(Spacer(1, 0.3*cm))

    c = completeness
    banner_color = (colors.HexColor("#e8f5e9") if c["status"] == "READY"
                    else colors.HexColor("#fff8e1") if c["status"] == "WARNINGS"
                    else colors.HexColor("#fce4ec"))
    banner_text_color = (colors.HexColor("#2e7d32") if c["status"] == "READY"
                         else colors.HexColor("#e65100") if c["status"] == "WARNINGS"
                         else colors.HexColor("#c62828"))
    banner_tbl = Table(
        [[Paragraph(
            f"Compliance score: {c['score']}%   Status: {c['status']}   "
            f"Issues: {len(c['issues'])}   Warnings: {len(c['warnings'])}",
            ParagraphStyle("Ban", parent=styles["Normal"], fontSize=9, textColor=banner_text_color),
        )]],
        colWidths=["100%"],
    )
    banner_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), banner_color),
        ("BOX", (0,0), (-1,-1), 0.5, colors.HexColor("#aaa")),
        ("TOPPADDING",    (0,0), (-1,-1), 6),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
        ("LEFTPADDING",   (0,0), (-1,-1), 8),
    ]))
    story.append(banner_tbl)
    story.append(Spacer(1, 0.4*cm))

    def _tbl(headers, rows, col_widths=None):
        """Helper: styled table."""
        all_rows = [headers] + rows
        t = Table(all_rows, colWidths=col_widths, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND",    (0,0), (-1,0),  colors.HexColor("#efebe9")),
            ("TEXTCOLOR",     (0,0), (-1,0),  colors.HexColor("#4e342e")),
            ("FONTSIZE",      (0,0), (-1,0),  8),
            ("FONTSIZE",      (0,1), (-1,-1), 8),
            ("FONTNAME",      (0,0), (-1,0),  "Helvetica-Bold"),
            ("ROWBACKGROUNDS",(0,1), (-1,-1), [colors.white, colors.HexColor("#fafaf8")]),
            ("GRID",          (0,0), (-1,-1), 0.25, colors.HexColor("#e0d8cf")),
            ("TOPPADDING",    (0,0), (-1,-1), 3),
            ("BOTTOMPADDING", (0,0), (-1,-1), 3),
            ("LEFTPADDING",   (0,0), (-1,-1), 5),
            ("RIGHTPADDING",  (0,0), (-1,-1), 5),
            ("VALIGN",        (0,0), (-1,-1), "TOP"),
        ]))
        return t

    def _kv_tbl(pairs):
        """Key-value 2-column table."""
        rows = [[Paragraph(k, small), Paragraph(str(v) if v else "—", body)] for k,v in pairs]
        t = Table(rows, colWidths=[5*cm, None])
        t.setStyle(TableStyle([
            ("GRID",         (0,0), (-1,-1), 0.25, colors.HexColor("#e0e0e0")),
            ("BACKGROUND",   (0,0), (0,-1),  colors.HexColor("#fafaf8")),
            ("TOPPADDING",   (0,0), (-1,-1), 3),
            ("BOTTOMPADDING",(0,0), (-1,-1), 3),
            ("LEFTPADDING",  (0,0), (-1,-1), 5),
        ]))
        return t

    # 3.1 Farm
    story.append(Paragraph("3.1  Farm / Holding Data", h2))
    story.append(_kv_tbl([
        ("Farm name",          farm.get("farm_name")),
        ("Registered area",    f"{farm['farm_size_ha']} ha" if farm.get("farm_size_ha") else None),
        ("Reg. number",        farm.get("farm_reg_number")),
        ("Legal owner",        farm.get("farm_owner_name")),
        ("Operator",           farm.get("farm_operator")),
        ("Country / City",     f"{farm['contact'].get('country','')} / {farm['contact'].get('city','')}"),
        ("Contact email",      farm["contact"].get("email")),
        ("Phone",              farm["contact"].get("phone")),
    ]))

    # 3.2 Fields
    story.append(Paragraph("3.2  Fields (Parcels)", h2))
    fields = data["section_3_2_fields"]
    if fields:
        headers = ["Label", "LPIS ID", "Type", "Area ha", "Soil", "Prev. crop",
                   "Buffer", "NPA", "Nitrate Z.", "Organic"]
        rows = []
        for f in fields:
            eco = f.get("eco", {})
            rows.append([
                Paragraph(f.get("label",""), body),
                Paragraph(f.get("lpis_id") or "—", body),
                Paragraph(f.get("field_type",""), body),
                Paragraph(_fmt(f.get("area_ha")), body),
                Paragraph(f.get("soil_type") or "—", body),
                Paragraph(f.get("previous_crop") or "—", body),
                Paragraph(_yn(eco.get("has_buffer_zone")), body),
                Paragraph(_yn(eco.get("is_non_productive")), body),
                Paragraph(_yn(eco.get("in_nitrate_zone")), body),
                Paragraph(_yn(eco.get("organic_farming")), body),
            ])
        story.append(_tbl(
            [Paragraph(h, ParagraphStyle("TH", parent=styles["Normal"], fontSize=8, fontName="Helvetica-Bold"))
             for h in headers],
            rows,
        ))
    else:
        story.append(Paragraph("No fields registered.", small))

    # 3.3 Sowing
    story.append(Paragraph("3.3  Sowing / Crop Data", h2))
    seasons = data["section_3_3_7_seasons"]
    if seasons:
        headers = ["Field", "Crop", "Variety", "Sowing date", "Rate kg/ha",
                   "Seed treatment", "Tillage"]
        rows = []
        for s in seasons:
            rows.append([
                Paragraph(s.get("field_label") or f"Field {s['field_id']}", body),
                Paragraph(s.get("crop","").replace("_"," "), body),
                Paragraph(s.get("variety") or "—", body),
                Paragraph(s.get("sowing_date") or "—", body),
                Paragraph(_fmt(s.get("sowing_rate_kg_ha")), body),
                Paragraph((s.get("seed_treatment") or "—").replace("_"," "), body),
                Paragraph((s.get("tillage_type") or "—").replace("_"," "), body),
            ])
        story.append(_tbl(
            [Paragraph(h, ParagraphStyle("TH", parent=styles["Normal"], fontSize=8, fontName="Helvetica-Bold"))
             for h in headers],
            rows,
        ))
    else:
        story.append(Paragraph("No sowing records for this season.", small))

    # 3.4 Fertilization
    story.append(Paragraph("3.4  Fertilization Log", h2))
    ferts = data["section_3_4_fertilization"]
    if ferts:
        headers = ["Field", "Date", "Product", "Type", "Organic",
                   "N kg/ha", "P₂O₅", "K₂O", "Dose kg/ha", "Method"]
        rows = []
        for f in ferts:
            rows.append([
                Paragraph(f.get("field_label") or f"Field {f['field_id']}", body),
                Paragraph(f.get("application_date",""), body),
                Paragraph(f.get("product_name") or "—", body),
                Paragraph(f.get("product_type") or "—", body),
                Paragraph(_yn(f.get("is_organic")), body),
                Paragraph(_fmt(f.get("n_kg_ha")), body),
                Paragraph(_fmt(f.get("p2o5_kg_ha")), body),
                Paragraph(_fmt(f.get("k2o_kg_ha")), body),
                Paragraph(_fmt(f.get("dose_kg_ha")), body),
                Paragraph((f.get("application_method") or "—").replace("_"," "), body),
            ])
        story.append(_tbl(
            [Paragraph(h, ParagraphStyle("TH", parent=styles["Normal"], fontSize=8, fontName="Helvetica-Bold"))
             for h in headers],
            rows,
        ))
    else:
        story.append(Paragraph("No fertilization events recorded.", small))

    # 3.5 Pesticides
    story.append(Paragraph("3.5  Plant Protection Products (PPP)", h2))
    pests = data["section_3_5_pesticides"]
    if pests:
        headers = ["Field", "Date", "Trade name", "Active substance",
                   "Reg. no.", "Dose L/ha", "Target", "BBCH", "PHI d", "Operator"]
        rows = []
        for p in pests:
            rows.append([
                Paragraph(p.get("field_label") or f"Field {p['field_id']}", body),
                Paragraph(p.get("application_date",""), body),
                Paragraph(p.get("product_trade_name",""), body),
                Paragraph(p.get("active_substance") or "—", body),
                Paragraph(p.get("registration_number") or "—", body),
                Paragraph(_fmt(p.get("dose_l_ha")), body),
                Paragraph((p.get("target_organism") or p.get("target_type") or "—"), body),
                Paragraph(p.get("bbch_stage") or "—", body),
                Paragraph(str(p["pre_harvest_interval_days"]) if p.get("pre_harvest_interval_days") is not None else "—", body),
                Paragraph(p.get("operator_name") or "—", body),
            ])
        story.append(_tbl(
            [Paragraph(h, ParagraphStyle("TH", parent=styles["Normal"], fontSize=8, fontName="Helvetica-Bold"))
             for h in headers],
            rows,
        ))
    else:
        story.append(Paragraph("No pesticide applications recorded.", small))

    story.append(Paragraph("3.6  Agronomic Operations", h2))
    ops = data["section_3_6_operations"]
    if ops:
        headers = ["Field", "Date", "Operation", "Status", "Operator", "Equipment"]
        rows = []
        for w in ops:
            rows.append([
                Paragraph(w.get("field_label") or f"Field {w['field_id']}", body),
                Paragraph(w.get("work_date","")[:10], body),
                Paragraph(w.get("work_type","").replace("_"," "), body),
                Paragraph(w.get("work_status",""), body),
                Paragraph(w.get("operator_name") or "—", body),
                Paragraph(w.get("equipment") or "—", body),
            ])
        story.append(_tbl(
            [Paragraph(h, ParagraphStyle("TH", parent=styles["Normal"], fontSize=8, fontName="Helvetica-Bold"))
             for h in headers],
            rows,
        ))
    else:
        story.append(Paragraph("No operations recorded.", small))

    harvest_seasons = [s for s in seasons if s.get("harvest_date")]
    story.append(Paragraph("3.7  Harvest Results", h2))
    if harvest_seasons:
        headers = ["Field", "Crop", "Harvest date", "Area ha",
                   "Total t", "Yield t/ha", "Moisture %", "Protein %"]
        rows = []
        for s in harvest_seasons:
            rows.append([
                Paragraph(s.get("field_label") or f"Field {s['field_id']}", body),
                Paragraph(s.get("crop","").replace("_"," "), body),
                Paragraph(s.get("harvest_date",""), body),
                Paragraph(_fmt(s.get("harvest_area_ha")), body),
                Paragraph(_fmt(s.get("harvest_total_t"), 3), body),
                Paragraph(_fmt(s.get("yield_t_ha"), 3), body),
                Paragraph(_fmt(s.get("moisture_pct")), body),
                Paragraph(_fmt(s.get("protein_pct")), body),
            ])
        story.append(_tbl(
            [Paragraph(h, ParagraphStyle("TH", parent=styles["Normal"], fontSize=8, fontName="Helvetica-Bold"))
             for h in headers],
            rows,
        ))
    else:
        story.append(Paragraph("No harvest results recorded yet.", small))

    story.append(Paragraph("Season Summary", h2))
    totals = data["totals"]
    story.append(_kv_tbl([
        ("Fields",           totals["fields_count"]),
        ("Total area",       f"{totals['total_area_ha']} ha"),
        ("Season records",   totals["seasons_count"]),
        ("Fertilization events", totals["fert_events"]),
        ("Spraying events",  totals["spray_events"]),
        ("Operations total", totals["operations_count"]),
        ("Total harvest",    f"{totals['total_harvest_t']} t"),
        ("Total N applied",  f"{totals['total_n_kg']} kg"),
    ]))

    # ── Compliance issues ─────────────────────────────────────────────────────
    if completeness["issues"] or completeness["warnings"]:
        story.append(Paragraph("Compliance Checklist", h2))
        if completeness["issues"]:
            story.append(Paragraph("Issues (must fix before submission):", h3))
            for issue in completeness["issues"]:
                story.append(Paragraph(f"✗  {issue}", err_style))
        if completeness["warnings"]:
            story.append(Paragraph("Warnings (recommended):", h3))
            for w in completeness["warnings"]:
                story.append(Paragraph(f"⚠  {w}", warn_style))

    story.append(Spacer(1, 0.5*cm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#ccc")))
    story.append(Paragraph(
        f"Generated by SmartCrop Monitor · {data['generated_at'][:10]} · eGN season {year}",
        small,
    ))

    doc.build(story)
    return buf.getvalue()

@router.get("/report/{user_id}")
def get_egn_report(
    user_id: int,
    year: int = None,
    db: Session = Depends(get_db),
):
    if year is None:
        year = datetime.datetime.utcnow().year
    return _collect(user_id, year, db)


@router.get("/report/{user_id}/summary")
def get_egn_summary(
    user_id: int,
    year: int = None,
    db: Session = Depends(get_db),
):
    if year is None:
        year = datetime.datetime.utcnow().year
    data = _collect(user_id, year, db)
    comp = _completeness(data)
    return {
        "year":     year,
        "totals":   data["totals"],
        **comp,
    }


@router.get("/report/{user_id}/pdf")
def get_egn_pdf(
    user_id: int,
    year: int = None,
    db: Session = Depends(get_db),
):
    if year is None:
        year = datetime.datetime.utcnow().year
    data = _collect(user_id, year, db)
    comp = _completeness(data)
    pdf  = _build_pdf(data, comp)

    farm_name = (data["section_3_1_farm"].get("farm_name") or "farm").replace(" ", "_")
    filename  = f"egn_report_{farm_name}_{year}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )