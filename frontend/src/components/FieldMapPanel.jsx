import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import api from '../api/client';
import { useLang } from '../context/LanguageContext';

const METRIC_META = {
  ndvi:  { label: 'NDVI',  descKey: 'fmp_ndvi_desc',  min: -1, max: 1, ramp: ['#d73027','#fee08b','#1a9850'] },
  gndvi: { label: 'GNDVI', descKey: 'fmp_gndvi_desc', min: -1, max: 1, ramp: ['#d73027','#fee08b','#1a9850'] },
  ndre:  { label: 'NDRE',  descKey: 'fmp_ndre_desc',  min: -1, max: 1, ramp: ['#762a83','#f7f7f7','#1b7837'] },
  ndwi:  { label: 'NDWI',  descKey: 'fmp_ndwi_desc',  min: -1, max: 1, ramp: ['#8c510a','#f5f5f5','#01665e'] },
  nmdi:  { label: 'NMDI',  descKey: 'fmp_nmdi_desc',  min:  0, max: 1, ramp: ['#b2182b','#fddbc7','#2166ac'] },
};
const METRICS = Object.keys(METRIC_META);

const CONTOUR_SRC   = 'dem-contour-src';
const CONTOUR_LAYER = 'dem-contour-lines';
const CONTOUR_LABEL = 'dem-contour-labels';

function bboxFromGeoJSON(geojson) {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  geojson.features.forEach(f => {
    const coords = f.geometry.coordinates.flat(Infinity);
    for (let i = 0; i < coords.length; i += 2) {
      if (coords[i]   < minLng) minLng = coords[i];
      if (coords[i]   > maxLng) maxLng = coords[i];
      if (coords[i+1] < minLat) minLat = coords[i+1];
      if (coords[i+1] > maxLat) maxLat = coords[i+1];
    }
  });
  return [[minLng, minLat], [maxLng, maxLat]];
}

function utmToWgs84(easting, northing, zone = 34) {
  const a = 6378137.0, e1sq = 0.00669437999014, k0 = 0.9996;
  const e0 = easting - 500000.0, M = northing / k0;
  const mu = M / (a * (1 - e1sq/4 - 3*e1sq*e1sq/64));
  const e1 = (1 - Math.sqrt(1-e1sq)) / (1 + Math.sqrt(1-e1sq));
  const fp = mu + (3*e1/2)*Math.sin(2*mu) + (21*e1*e1/16)*Math.sin(4*mu) + (151*e1*e1*e1/96)*Math.sin(6*mu);
  const e2 = e1sq/(1-e1sq), C1 = e2*Math.cos(fp)**2, T1 = Math.tan(fp)**2;
  const R1 = a*(1-e1sq)/Math.pow(1-e1sq*Math.sin(fp)**2, 1.5);
  const N  = a/Math.sqrt(1-e1sq*Math.sin(fp)**2), D = e0/(N*k0);
  const lat = fp - (N*Math.tan(fp)/R1) * (D*D/2 - (5+3*T1+10*C1-4*C1*C1-9*e2)*D*D*D*D/24 + (61+90*T1+298*C1+45*T1*T1-3*C1*C1-252*e2)*D*D*D*D*D*D/720);
  const lon0 = ((zone-1)*6 - 180 + 3) * Math.PI/180;
  const lon = lon0 + (D - (1+2*T1+C1)*D*D*D/6 + (5-2*C1+28*T1-3*C1*C1+8*e2+24*T1*T1)*D*D*D*D*D/120) / Math.cos(fp);
  return [lon*180/Math.PI, lat*180/Math.PI];
}

function isUtm(coords) { return Math.abs(coords[0]) > 180 || Math.abs(coords[1]) > 90; }

// Build a GeoJSON FeatureCollection from anomaly_pixels across all anomaly records
function _anomalyToGeoJSON(anomalyRecords) {
  const features = [];
  for (const rec of anomalyRecords) {
    if (!rec.is_anomaly && rec.confidence_score < 0.5) continue;
    for (const px of (rec.anomaly_pixels || [])) {
      if (px.lat == null || px.lon == null) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [px.lon, px.lat] },
        properties: {
          delta:       px.delta,
          metric:      rec.metric_type  || 'ndvi',
          direction:   rec.direction    || 'drop',
          confidence:  rec.confidence_score,
          date:        rec.analysis_date ? rec.analysis_date.slice(0, 10) : '—',
          last_mean:   rec.last_mean,
          prev_mean:   rec.prev_mean,
          rel_change:  rec.rel_change,
        },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

function _renderAnomalyLayer(map, anomalyRecords, srcId, layerId) {
  if (map.getLayer(layerId)) map.removeLayer(layerId);
  if (map.getSource(srcId))  map.removeSource(srcId);

  const gj = _anomalyToGeoJSON(anomalyRecords);
  if (!gj.features.length) return;

  map.addSource(srcId, { type: 'geojson', data: gj });
  map.addLayer({
    id: layerId, type: 'circle', source: srcId,
    paint: {
      // Red for drop, orange for rise — intensity by abs delta
      'circle-color': ['case',
        ['==', ['get','direction'], 'drop'], '#e74c3c',
        '#e67e22',
      ],
      'circle-radius': ['interpolate',['linear'],['zoom'],
        10, 3,  12, 5,  14, 8,  16, 12,
      ],
      'circle-opacity': 0.85,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#fff',
    },
  });

  // Popup on click
  map.on('click', layerId, e => {
    const p = e.features[0].properties;
    const pct = p.rel_change != null ? `${(p.rel_change * 100).toFixed(1)}%` : '—';
    const conf = p.confidence != null ? `${(p.confidence * 100).toFixed(0)}%` : '—';
    new mapboxgl.Popup({ closeButton: true, maxWidth: '240px' })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family:sans-serif;font-size:12px;line-height:1.7">
          <strong style="font-size:13px">⚠ ${(p.metric || 'NDVI').toUpperCase()} ${p.direction === 'drop' ? '↓ Drop' : '↑ Rise'}</strong><br/>
          <span style="color:#888">Date:</span> <b>${p.date}</b><br/>
          <span style="color:#888">Δ mean:</span> ${pct}<br/>
          <span style="color:#888">Pixel Δ:</span> ${Number(p.delta).toFixed(3)}<br/>
          <span style="color:#888">Prev / Last:</span> ${Number(p.prev_mean).toFixed(3)} → ${Number(p.last_mean).toFixed(3)}<br/>
          <span style="color:#888">Confidence:</span> ${conf}
        </div>
      `)
      .addTo(map);
  });
  map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
}

function gridToPolygonGeoJSON(z, x, y) {
  const needsConversion = isUtm([x[0], y[0]]);
  const features = [];

  if (needsConversion) {
    const dx = x.length > 1 ? Math.abs(x[1] - x[0]) / 2 : 15;
    const dy = y.length > 1 ? Math.abs(y[1] - y[0]) / 2 : 15;
    for (let row = 0; row < y.length; row++) {
      for (let col = 0; col < x.length; col++) {
        const val = z[row]?.[col];
        if (val === null || val === undefined || isNaN(val)) continue;
        const cx = x[col], cy = y[row];
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[
            utmToWgs84(cx - dx, cy - dy),
            utmToWgs84(cx + dx, cy - dy),
            utmToWgs84(cx + dx, cy + dy),
            utmToWgs84(cx - dx, cy + dy),
            utmToWgs84(cx - dx, cy - dy),
          ]] },
          properties: { value: val },
        });
      }
    }
  } else {
    const dx = x.length > 1 ? Math.abs(x[1] - x[0]) / 2 : 0.0001;
    const dy = y.length > 1 ? Math.abs(y[1] - y[0]) / 2 : 0.0001;
    for (let row = 0; row < y.length; row++) {
      for (let col = 0; col < x.length; col++) {
        const val = z[row]?.[col];
        if (val === null || val === undefined || isNaN(val)) continue;
        const cx = x[col], cy = y[row];
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[
            [cx - dx, cy - dy], [cx + dx, cy - dy],
            [cx + dx, cy + dy], [cx - dx, cy + dy],
            [cx - dx, cy - dy],
          ]] },
          properties: { value: val },
        });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

function addContourLayers(map, geojson) {
  if (map.getLayer(CONTOUR_LABEL)) map.removeLayer(CONTOUR_LABEL);
  if (map.getLayer(CONTOUR_LAYER)) map.removeLayer(CONTOUR_LAYER);
  if (map.getSource(CONTOUR_SRC))  map.removeSource(CONTOUR_SRC);
  map.addSource(CONTOUR_SRC, { type: 'geojson', data: geojson });
  map.addLayer({ id: CONTOUR_LAYER, type: 'line', source: CONTOUR_SRC, paint: { 'line-color': ['case', ['==',['get','index_line'],true], '#5a3e1b', 'rgba(90,62,27,0.45)'], 'line-width': ['case', ['==',['get','index_line'],true], 1.6, 0.8], 'line-opacity': 0.85 } });
  map.addLayer({ id: CONTOUR_LABEL, type: 'symbol', source: CONTOUR_SRC, filter: ['==',['get','index_line'],true], layout: { 'symbol-placement': 'line', 'text-field': ['concat',['to-string',['get','elevation']],' m'], 'text-size': 10, 'text-font': ['DIN Pro Medium','Arial Unicode MS Regular'], 'text-offset': [0,-0.4], 'symbol-spacing': 200 }, paint: { 'text-color': '#3b2a10', 'text-halo-color': 'rgba(255,255,255,0.75)', 'text-halo-width': 1.2 } });
}

function removeContourLayers(map) {
  if (map.getLayer(CONTOUR_LABEL)) map.removeLayer(CONTOUR_LABEL);
  if (map.getLayer(CONTOUR_LAYER)) map.removeLayer(CONTOUR_LAYER);
  if (map.getSource(CONTOUR_SRC))  map.removeSource(CONTOUR_SRC);
}

const FieldMapPanel = forwardRef(({ userId, locationId, locationCenter, onAddLocation, onDrawField, onSegment, segmentationStatus }, ref) => {
  const { t } = useLang();
  const mapRef       = useRef(null);
  const loadedRef    = useRef(false);
  const popupRef     = useRef(null);
  const watchIdRef    = useRef(null);
  const gpsMarkerRef  = useRef(null);
  const gpsPositionRef = useRef(null);

  const [open, setOpen]                   = useState(true);
  const [fields, setFields]               = useState(null);
  const [metric, setMetric]               = useState('ndvi');
  const [metricEnabled, setMetricEnabled] = useState(true);
  const [metricData, setMetricData]       = useState(null);
  const [metricLoading, setMetricLoading] = useState(false);
  const [metricError, setMetricError]     = useState(null);
  const [selectedField, setSelectedField] = useState(null);
  const [mapError, setMapError]           = useState(null);
  const [contoursOn, setContoursOn]       = useState(false);
  const [contourData, setContourData]     = useState(null);
  const [contourLoading, setContourLoading] = useState(false);
  const [contourError, setContourError]   = useState(null);
  const [contourMeta, setContourMeta]     = useState(null);
  const [gpsActive, setGpsActive]         = useState(false);
  const [gpsError,  setGpsError]          = useState(null);

  // ── Anomaly overlay ──────────────────────────────────────────────────────
  const [anomalyOn,      setAnomalyOn]      = useState(false);
  const [anomalyData,    setAnomalyData]    = useState(null);   // array of anomaly records
  const [anomalyLoading, setAnomalyLoading] = useState(false);
  const [anomalyError,   setAnomalyError]   = useState(null);
  const [anomalyField,   setAnomalyField]   = useState(null);   // field_id currently shown

  useImperativeHandle(ref, () => ({
    refreshFields: () => {
      if (!userId) return;
      api.get('/api/v1/user/fields', { params: { user_id: userId } }).then(r => setFields(r.data)).catch(() => {});
    },
  }));

  const applyToMap = useCallback((fn) => {
    const map = mapRef.current; if (!map) return;
    if (loadedRef.current) { fn(map); } else { map.once('load', () => fn(map)); }
  }, []);

  const toggleGps = useCallback(() => {
    if (gpsActive) {
      if (watchIdRef.current != null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
      if (gpsMarkerRef.current) { gpsMarkerRef.current.remove(); gpsMarkerRef.current = null; }
      setGpsActive(false);
      setGpsError(null);
      return;
    }
    if (!navigator.geolocation) { setGpsError(t('fmp_gps_unavail')); return; }
    setGpsError(null);
    setGpsActive(true);
    let firstFix = true;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        gpsPositionRef.current = [longitude, latitude];
        applyToMap((map) => {
          if (!gpsMarkerRef.current) {
            const el = document.createElement('div');
            el.className = 'gps-dot';
            gpsMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
              .setLngLat([longitude, latitude])
              .addTo(map);
          } else {
            gpsMarkerRef.current.setLngLat([longitude, latitude]);
          }
          if (firstFix) {
            firstFix = false;
            map.flyTo({ center: [longitude, latitude], zoom: 16, duration: 1200, essential: true });
          }
        });
      },
      (err) => {
        const msg = err.code === 1 ? t('fmp_gps_denied') : err.code === 2 ? t('fmp_gps_unavail') : t('fmp_gps_timeout');
        setGpsError(msg);
        setGpsActive(false);
        if (watchIdRef.current != null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  }, [gpsActive, applyToMap, t]); // eslint-disable-line

  const mapCallbackRef = useCallback((node) => {
    if (!node) {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; loadedRef.current = false; }
      gpsMarkerRef.current = null; // marker was part of the removed map
      return;
    }
    if (mapRef.current) return;

    const token = import.meta.env.VITE_MAPBOX_TOKEN || '';
    if (!token) { setMapError(t('fmp_map_err_token')); return; }
    mapboxgl.accessToken = token;

    let map;
    try {
      const savedView = (() => { try { return JSON.parse(sessionStorage.getItem('fmp_view')); } catch { return null; } })();
      map = new mapboxgl.Map({ container: node, style: 'mapbox://styles/mapbox/satellite-streets-v12', center: savedView ? [savedView.lng, savedView.lat] : [19.648, 47.728], zoom: savedView ? savedView.zoom : 13, attributionControl: false, renderWorldCopies: false });
      map.on('moveend', () => { const c = map.getCenter(); try { sessionStorage.setItem('fmp_view', JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() })); } catch { /* sessionStorage unavailable */ } });
    } catch (err) { setMapError(t('fmp_map_err_init', err.message)); return; }

    map.on('error', e => console.error('[FieldMapPanel]', e.error?.message || String(e)));
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100 }), 'bottom-left');
    map.on('load', () => { loadedRef.current = true; });
    mapRef.current = map;
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!userId) return;
    api.get('/api/v1/user/fields', { params: { user_id: userId } }).then(r => setFields(r.data)).catch(() => setFields({ type: 'FeatureCollection', features: [] }));
  }, [userId]);

  const loadMetric = useCallback(() => {
    if (!locationId || !userId) return;
    setMetricLoading(true); setMetricError(null);
    api.get(`/api/v1/location/${locationId}/latest-metrics/${metric}`, { params: { user_id: userId, step: 3 } })
      .then(r => { setMetricData(r.data); setMetricLoading(false); })
      .catch(() => { setMetricData(null); setMetricError(t('fmp_no_metric')); setMetricLoading(false); });
  }, [locationId, userId, metric]); // eslint-disable-line

  useEffect(() => { loadMetric(); }, [loadMetric]);

  useEffect(() => {
    if (!contoursOn || !locationId || !userId || contourData) return;
    setContourLoading(true); setContourError(null);
    api.get(`/api/v1/location/${locationId}/dem-contours`, { params: { user_id: userId, interval: 10 } })
      .then(r => { setContourData(r.data); setContourMeta(r.data.meta); setContourLoading(false); })
      .catch(() => { setContourError(t('fmp_contours_err')); setContourLoading(false); setContoursOn(false); });
  }, [contoursOn, locationId, userId, contourData]); // eslint-disable-line

  useEffect(() => { setContourData(null); setContourMeta(null); setContourError(null); setContoursOn(false); }, [locationId]);

  useEffect(() => {
    if (!open) return;
    applyToMap(map => { if (contoursOn && contourData) addContourLayers(map, contourData); else removeContourLayers(map); });
  }, [contoursOn, contourData, open, applyToMap]);

  // Fetch + render anomaly pixels when a field is selected and anomaly mode is on
  useEffect(() => {
    const ASRC = 'anomaly-src', ALAYER = 'anomaly-layer';
    const clearLayer = () => applyToMap(map => {
      if (map.getLayer(ALAYER)) map.removeLayer(ALAYER);
      if (map.getSource(ASRC))  map.removeSource(ASRC);
    });

    if (!anomalyOn || !selectedField?.id || !userId) { clearLayer(); return; }

    // Already loaded for this field
    if (anomalyField === selectedField.id && anomalyData) {
      applyToMap(map => _renderAnomalyLayer(map, anomalyData, ASRC, ALAYER));
      return;
    }

    setAnomalyLoading(true); setAnomalyError(null);
    api.get(`/api/v1/fields/${selectedField.id}/anomalies`, { params: { user_id: userId, limit: 5 } })
      .then(r => {
        setAnomalyData(r.data);
        setAnomalyField(selectedField.id);
        setAnomalyLoading(false);
        applyToMap(map => _renderAnomalyLayer(map, r.data, ASRC, ALAYER));
      })
      .catch(() => { setAnomalyError(t('fmp_anomaly_err')); setAnomalyLoading(false); clearLayer(); });
  }, [anomalyOn, selectedField, userId, anomalyData, anomalyField, applyToMap, t]); // eslint-disable-line

  // Clear anomaly layer when field deselected or anomaly mode turned off
  useEffect(() => {
    if (!anomalyOn || !selectedField) {
      applyToMap(map => {
        if (map.getLayer('anomaly-layer')) map.removeLayer('anomaly-layer');
        if (map.getSource('anomaly-src'))  map.removeSource('anomaly-src');
      });
    }
  }, [anomalyOn, selectedField, applyToMap]);

  useEffect(() => {
    if (!locationCenter?.lat || !locationCenter?.lon) return;
    const fly = (map) => {
      map.flyTo({ center: [locationCenter.lon, locationCenter.lat], zoom: 14, duration: 1200, essential: true });
      try { sessionStorage.setItem('fmp_view', JSON.stringify({ lat: locationCenter.lat, lng: locationCenter.lon, zoom: 14 })); } catch { /* sessionStorage unavailable */ }
    };
    const map = mapRef.current; if (!map) return;
    if (loadedRef.current) { fly(map); } else { map.once('load', () => fly(map)); }
  }, [locationCenter]);

  useEffect(() => {
    if (!fields || !open) return;
    applyToMap(map => {
      const SRC = 'fields-src';
      if (map.getSource(SRC)) {
        map.getSource(SRC).setData(fields);
      } else {
        map.addSource(SRC, { type: 'geojson', data: fields });
        map.addLayer({ id: 'fields-fill', type: 'fill', source: SRC, paint: { 'fill-color': ['case',['==',['get','field_type'],'crop'],'rgba(134,197,75,0.25)','rgba(100,160,255,0.25)'], 'fill-opacity': ['case',['boolean',['feature-state','hover'],false],0.55,0.3] } });
        map.addLayer({ id: 'fields-outline-case', type: 'line', source: SRC, paint: { 'line-color': '#000', 'line-width': 5, 'line-opacity': 0.35 } });
        map.addLayer({ id: 'fields-outline', type: 'line', source: SRC, paint: { 'line-color': '#fff', 'line-width': 2.5 } });
        map.addLayer({ id: 'fields-label', type: 'symbol', source: SRC, layout: { 'text-field': ['get','label'], 'text-size': 13, 'text-font': ['DIN Pro Medium','Arial Unicode MS Regular'] }, paint: { 'text-color': '#fff', 'text-halo-color': '#1a2a12', 'text-halo-width': 1.5 } });

        let hoverId = null;
        map.on('mousemove', 'fields-fill', e => {
          map.getCanvas().style.cursor = 'pointer';
          if (hoverId !== null) map.setFeatureState({ source: SRC, id: hoverId }, { hover: false });
          hoverId = e.features[0].id;
          map.setFeatureState({ source: SRC, id: hoverId }, { hover: true });
        });
        map.on('mouseleave', 'fields-fill', () => { map.getCanvas().style.cursor = ''; if (hoverId !== null) map.setFeatureState({ source: SRC, id: hoverId }, { hover: false }); hoverId = null; });
        map.on('click', 'fields-fill', e => {
          const p = e.features[0].properties;
          if (popupRef.current) popupRef.current.remove();
          popupRef.current = new mapboxgl.Popup({ closeButton: true, maxWidth: '220px' })
            .setLngLat(e.lngLat)
            .setHTML(`<div style="font-family:sans-serif;font-size:13px;line-height:1.6"><strong style="font-size:14px">${p.label}</strong><br/>${t('fmp_popup_type')} <em>${p.field_type}</em><br/>${t('fmp_popup_crop')} <em>${p.crop_type || '—'}</em></div>`)
            .addTo(map);
          setSelectedField(p);
        });
      }
      if (fields.features.length > 0) {
        const hasSavedView = (() => { try { return !!sessionStorage.getItem('fmp_view'); } catch { return false; } })();
        if (!hasSavedView) map.fitBounds(bboxFromGeoJSON(fields), { padding: 60, maxZoom: 16, duration: 800 });
      }
    });
  }, [fields, open, applyToMap]); // eslint-disable-line

  useEffect(() => {
    if (!open) return;
    applyToMap(map => {
      const HM_SRC = 'metric-src', HM_LAYER = 'metric-layer';
      if (!metricData || !metricEnabled) {
        if (map.getLayer(HM_LAYER)) map.removeLayer(HM_LAYER);
        if (map.getSource(HM_SRC))  map.removeSource(HM_SRC);
        return;
      }
      const { z, x, y } = metricData;
      const gj   = gridToPolygonGeoJSON(z, x, y);
      const meta = METRIC_META[metric];
      let dMin = Infinity, dMax = -Infinity;
      gj.features.forEach(f => { const v = f.properties.value; if (v < dMin) dMin = v; if (v > dMax) dMax = v; });
      const dMid = dMin + (dMax - dMin) * 0.5;
      const colorExpr = ['interpolate',['linear'],['get','value'], dMin, meta.ramp[0], dMid, meta.ramp[1], dMax, meta.ramp[2]];

      if (map.getSource(HM_SRC)) {
        // Reuse existing source and layer to avoid flicker on metric switch
        map.getSource(HM_SRC).setData(gj);
        if (map.getLayer(HM_LAYER)) map.setPaintProperty(HM_LAYER, 'fill-color', colorExpr);
      } else {
        map.addSource(HM_SRC, { type: 'geojson', data: gj });
        map.addLayer({ id: HM_LAYER, type: 'fill', source: HM_SRC, paint: {
          'fill-color': colorExpr,
          'fill-opacity': 0.75,
          'fill-antialias': false,
        } }, map.getLayer('fields-fill') ? 'fields-fill' : undefined);
      }
    });
  }, [metricData, metric, metricEnabled, open, applyToMap]);

  useEffect(() => () => {
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    if (gpsMarkerRef.current) gpsMarkerRef.current.remove();
  }, []);

  const meta = METRIC_META[metric];

  const contourTitle = !locationId
    ? t('fmp_contours_no_loc')
    : contourLoading ? t('fmp_contours_loading')
    : contourError   ? contourError
    : contoursOn     ? t('fmp_contours_hide')
    : t('fmp_contours_show');

  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader} onClick={() => setOpen(v => !v)}>
        <div style={styles.panelTitle}>
          <span style={styles.panelIcon}>🗺</span>
          <span>{t('fmp_title')}</span>
          {fields && (
            <span style={styles.badge}>{t('fmp_fields_count', fields.features.length)}</span>
          )}
        </div>
        <div style={styles.panelRight}>
          {(metricLoading || contourLoading) && <span style={styles.loadingDot} title={t('loading')} />}
          <span style={styles.chevron}>{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div style={styles.panelBody}>
          <div style={styles.toolbar}>
            {/* ── Map action buttons ── */}
            {onAddLocation && (
              <button onClick={onAddLocation} style={styles.actionBtn} title={t('add_location')}>
                + {t('add_location')}
              </button>
            )}
            {locationId && onDrawField && (
              <button onClick={onDrawField} style={{ ...styles.actionBtn, ...styles.actionBtnBlue }}>
                ✏ {t('draw_field')}
              </button>
            )}
            {locationId && onSegment && (
              <button
                onClick={onSegment}
                style={{ ...styles.actionBtn, ...styles.actionBtnGreen, ...(segmentationStatus === 'done' ? styles.actionBtnDone : {}) }}
              >
                {segmentationStatus === 'done'
                  ? `✔ ${t('fields_updated')}`
                  : `🛰 ${t('segment_fields')}`}
              </button>
            )}

            <span style={styles.divider} />

            {/* ── Metric overlay toggle ── */}
            <span style={styles.toolbarLabel}>{t('fmp_overlay')}</span>

            {/* "None" / off button */}
            <button
              onClick={() => setMetricEnabled(false)}
              style={{ ...styles.metricBtn, ...(!metricEnabled ? styles.metricBtnActive : {}) }}
            >
              {t('fmp_overlay_none') || '—'}
            </button>

            {METRICS.map(m => (
              <button
                key={m}
                onClick={() => { setMetric(m); setMetricEnabled(true); }}
                style={{ ...styles.metricBtn, ...(metricEnabled && metric === m ? styles.metricBtnActive : {}) }}
              >
                {METRIC_META[m].label}
              </button>
            ))}

            <span style={styles.divider} />

            <button onClick={() => { if (contoursOn) setContoursOn(false); else if (locationId) setContoursOn(true); }}
              disabled={!locationId || contourLoading}
              title={contourTitle}
              style={{ ...styles.metricBtn, ...(contoursOn ? styles.contourBtnActive : {}), opacity: (!locationId || contourLoading) ? 0.45 : 1 }}>
              {contourLoading ? `⟳ ${t('fmp_contours_loading')}` : t('fmp_contours')}
            </button>

            {contoursOn && contourMeta && (
              <span style={styles.elevBadge}>
                {t('fmp_elev_range', contourMeta.elev_min, contourMeta.elev_max, contourMeta.interval_m)}
              </span>
            )}

            <span style={styles.divider} />

            <button
              onClick={toggleGps}
              title={gpsActive ? t('fmp_gps_stop') : t('fmp_gps_track')}
              style={{ ...styles.metricBtn, ...(gpsActive ? styles.gpsBtnActive : {}), opacity: !navigator.geolocation ? 0.45 : 1 }}
            >
              {gpsActive ? `● ${t('fmp_gps_stop')}` : `📍 ${t('fmp_gps_track')}`}
            </button>

            {metricError  && <span style={styles.errorNote}>{metricError}</span>}
            {contourError && <span style={styles.errorNote}>{contourError}</span>}
            {gpsError     && <span style={styles.errorNote}>{gpsError}</span>}
            {anomalyError && <span style={styles.errorNote}>{anomalyError}</span>}

            <span style={styles.divider} />
            <button
              onClick={() => setAnomalyOn(v => !v)}
              disabled={!selectedField || anomalyLoading}
              title={anomalyOn ? t('fmp_anomaly_hide') : t('fmp_anomaly_show')}
              style={{ ...styles.metricBtn, ...(anomalyOn ? styles.anomalyBtnActive : {}), opacity: (!selectedField || anomalyLoading) ? 0.45 : 1 }}
            >
              {anomalyLoading ? `⟳ ${t('fmp_anomaly')}` : t('fmp_anomaly')}
            </button>
            {anomalyOn && anomalyData && (
              <span style={styles.anomalyBadge}>
                {t('fmp_anomaly_badge', anomalyData.reduce((s, r) => s + (r.anomaly_pixels?.length || 0), 0), anomalyData.length)}
              </span>
            )}
          </div>

          <div style={styles.mapWrap}>
            {mapError ? (
              <div style={styles.mapErrorMsg}>{mapError}</div>
            ) : (
              <div ref={mapCallbackRef} style={{ position: 'absolute', inset: 0 }} />
            )}

            {gpsActive && (
              <button
                onClick={() => applyToMap(map => gpsPositionRef.current && map.flyTo({ center: gpsPositionRef.current, zoom: 16, duration: 800, essential: true }))}
                title={t('fmp_gps_track')}
                style={styles.locateBtn}
              >
                ⊕
              </button>
            )}

            {metricEnabled && (
            <div style={styles.legend}>
              <div style={styles.legendTitle}>
                {meta.label} <span style={styles.legendDesc}>{t(meta.descKey)}</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, marginBottom: 3, background: `linear-gradient(to right, ${meta.ramp.join(',')})` }} />
              <div style={styles.legendLabels}><span>{meta.min}</span><span>{meta.max}</span></div>
            </div>
            )}

            {selectedField && (
              <div style={styles.fieldChip}>
                <strong>{selectedField.label}</strong>
                <span style={{ opacity: 0.4 }}>·</span>
                {selectedField.crop_type}
                <button style={styles.chipClose} onClick={() => setSelectedField(null)}>×</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

const styles = {
  panel:       { marginBottom: 20, borderRadius: 12, border: '1px solid var(--color-accent-soil)', background: 'var(--color-bg-magnolia)' },
  panelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', cursor: 'pointer', background: 'var(--color-bg-magnolia)', borderRadius: '12px 12px 0 0', userSelect: 'none' },
  panelTitle:  { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 },
  panelIcon:   { fontSize: 16 },
  badge:       { background: 'var(--color-accent-soil)', color: '#fff', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20 },
  panelRight:  { display: 'flex', alignItems: 'center', gap: 10 },
  loadingDot:  { width: 8, height: 8, borderRadius: '50%', background: '#86c54b', display: 'inline-block', animation: 'pulse 1s infinite' },
  chevron:     { fontSize: 11, opacity: 0.5 },
  panelBody:   {},
  toolbar:     { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderTop: '1px solid var(--color-accent-soil)', flexWrap: 'wrap' },
  toolbarLabel:{ fontSize: 12, fontWeight: 600, color: 'var(--color-accent-chernozem)', marginRight: 4 },
  metricBtn:   { padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, border: '1px solid var(--color-accent-soil)', background: 'transparent', cursor: 'pointer', color: 'inherit', transition: 'all 0.15s' },
  metricBtnActive:  { background: 'var(--color-accent-soil)', color: '#fff', borderColor: 'var(--color-accent-soil)' },
  contourBtnActive: { background: '#5a3e1b', color: '#fff', borderColor: '#5a3e1b' },
  gpsBtnActive:     { background: '#1a5276', color: '#fff', borderColor: '#1a5276' },
  actionBtn: {
    padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
    border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
    background: 'var(--color-accent-soil)', color: '#fff',
    transition: 'opacity 0.15s',
  },
  actionBtnBlue: { background: 'linear-gradient(135deg, #2471a3, #1a5276)' },
  actionBtnGreen: { background: 'linear-gradient(135deg, #2c7a4b, #1a5c38)' },
  actionBtnDone: { background: 'linear-gradient(135deg, #27ae60, #1e8449)' },
  locateBtn:        { position: 'absolute', top: 100, right: 10, zIndex: 10, width: 30, height: 30, borderRadius: 4, border: '1px solid rgba(0,0,0,0.25)', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.3)', cursor: 'pointer', fontSize: 18, lineHeight: '28px', textAlign: 'center', padding: 0, color: '#2980b9', fontWeight: 700 },
  divider:     { display: 'inline-block', width: 1, height: 18, background: 'var(--color-accent-soil)', opacity: 0.35, margin: '0 4px' },
  elevBadge:   { fontSize: 11, fontWeight: 600, color: '#5a3e1b', background: 'rgba(90,62,27,0.1)', border: '1px solid rgba(90,62,27,0.25)', borderRadius: 20, padding: '2px 10px' },
  errorNote:   { fontSize: 12, color: '#c0392b', marginLeft: 8 },
  mapWrap:     { position: 'relative', height: 'clamp(320px, 45vh, 480px)', width: '100%' },
  mapErrorMsg: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#c0392b', background: '#fff3f3' },
  legend:      { position: 'absolute', bottom: 60, right: 12, zIndex: 10, background: 'rgba(255,255,255,0.92)', borderRadius: 8, padding: '8px 12px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', minWidth: 140 },
  legendTitle: { fontSize: 12, fontWeight: 700, marginBottom: 4 },
  legendDesc:  { fontWeight: 400, opacity: 0.65, fontSize: 11 },
  legendLabels:{ display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.7 },
  fieldChip:   { position: 'absolute', top: 12, left: 12, zIndex: 10, background: 'rgba(255,255,255,0.93)', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 500, boxShadow: '0 2px 6px rgba(0,0,0,0.12)', display: 'flex', alignItems: 'center', gap: 6 },
  chipClose:   { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px', opacity: 0.5 },
  anomalyBtnActive: { background: '#c0392b', color: '#fff', borderColor: '#c0392b' },
  anomalyBadge: { fontSize: 11, fontWeight: 600, color: '#c0392b', background: 'rgba(192,57,43,0.1)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 20, padding: '2px 10px' },
};

FieldMapPanel.displayName = 'FieldMapPanel';
export default FieldMapPanel;