import React, { useState, useEffect, useMemo } from 'react';
import Map, { useControl, Marker } from 'react-map-gl/maplibre'; // <-- Imported Marker
import { MapboxOverlay } from '@deck.gl/mapbox';
import { HexagonLayer } from '@deck.gl/aggregation-layers';
import { GeoJsonLayer } from '@deck.gl/layers';
import * as turf from '@turf/turf';
import 'maplibre-gl/dist/maplibre-gl.css';

const INITIAL_VIEW_STATE = {
  longitude: 121.4737,
  latitude: 31.2304,
  zoom: 10.5,
  pitch: 0,
  bearing: 0
};

const SHANGHAI_BOUNDS = [
  [120, 30], 
  [123, 32]  
];

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const SPORTS_OPTIONS = [
  { id: 'outdoor', label: 'Outdoor Spaces' },
  { id: 'swim', label: 'Swimming Pools' },
  { id: 'court', label: 'Sports Courts' },
  { id: 'yoga', label: 'Yoga & Dance' },
  { id: 'gym', label: 'Gyms' },
  { id: 'other', label: 'Other Sports' }
];

const SPORT_PREFIX_MAP = {
  outdoor: 'out',
  swim: 'swm',
  court: 'crt',
  yoga: 'yog',
  gym: 'gym',
  other: 'oth'
};

const AQI_INFO = [
  { range: '0 - 50', label: 'Good', color: '#10b981', desc: 'Little to no risk.' },
  { range: '51 - 100', label: 'Moderate', color: '#facc15', desc: 'Acceptable; slight risk for sensitive individuals.' },
  { range: '101 - 150', label: 'Unhealthy (Sensitive)', color: '#fb923c', desc: 'Sensitive groups may experience health effects.' },
  { range: '151 - 200', label: 'Unhealthy', color: '#ef4444', desc: 'Everyone may experience health effects.' },
  { range: '201 - 300', label: 'Very Unhealthy', color: '#a855f7', desc: 'Health alert: risk increased for everyone.' },
  { range: '300+', label: 'Hazardous', color: '#9f1239', desc: 'Health warning of emergency conditions.' }
];

const getAqiColor = (aqi) => {
  if (aqi <= 50) return '#10b981'; 
  if (aqi <= 100) return '#facc15'; 
  if (aqi <= 150) return '#fb923c'; 
  if (aqi <= 200) return '#ef4444'; 
  if (aqi <= 300) return '#a855f7'; 
  return '#9f1239'; 
};

function DeckGLOverlay(props) {
  const overlay = useControl(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

export default function App() {
  const [data, setData] = useState([]);
  const [maskData, setMaskData] = useState(null);
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [firstLabelLayerId, setFirstLabelLayerId] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);

  // ── Pin Point States ──
  const [selectedLocation, setSelectedLocation] = useState(null); // { lat, lon, name }
  const [closestPoint, setClosestPoint] = useState(null);

  // ── UI States ──
  const [activeTrack, setActiveTrack] = useState('baseline'); 
  const [transportMode, setTransportMode] = useState('foot'); 
  const [requireBaselineForTrackA, setRequireBaselineForTrackA] = useState(true); 
  const [selectedSports, setSelectedSports] = useState([]); 
  const [sportMatchMode, setSportMatchMode] = useState('all');
  
  const [maxAqi, setMaxAqi] = useState(300);
  const [showAqiInfo, setShowAqiInfo] = useState(false);
  const [aqiPopPos, setAqiPopPos] = useState({ x: 0, y: 0 });

  // ── Search States ──
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  useEffect(() => {
    fetch('/shanghai_15min_health_track.json.gz')
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: File not found. Ensure it is in the 'public' folder.`);
        }
        const resBackup = res.clone();
        try {
          const ds = new DecompressionStream('gzip');
          const decompressedStream = res.body.pipeThrough(ds);
          return await new Response(decompressedStream).json();
        } catch (streamError) {
          console.log("Manual decompression bypassed (file likely auto-unzipped by browser).");
          return await resBackup.json();
        }
      })
      .then((data) => setData(data))
      .catch((err) => console.error("Could not load hex data:", err));

    fetch('https://geo.datav.aliyun.com/areas_v3/bound/310000.json')
      .then(res => res.json())
      .then(geoJson => {
        const worldMask = turf.mask(geoJson);
        setMaskData(worldMask);
      })
      .catch(err => console.error("Could not load boundary data", err));
  }, []);

  // ── Calculate Closest Point from Data Array ──
  useEffect(() => {
    if (!selectedLocation || data.length === 0) {
      setClosestPoint(null);
      return;
    }

    const searchTarget = turf.point([selectedLocation.lon, selectedLocation.lat]);
    let minDistance = Infinity;
    let nearest = null;

    // Linear scanning for the closest point coordinate mapping
    for (let i = 0; i < data.length; i++) {
      const p = data[i];
      if (!p.lon || !p.lat) continue;
      
      const gridPoint = turf.point([p.lon, p.lat]);
      const distance = turf.distance(searchTarget, gridPoint, { units: 'kilometers' });
      
      if (distance < minDistance) {
        minDistance = distance;
        nearest = p;
      }
    }

    setClosestPoint(nearest);
  }, [selectedLocation, data]);

  const getRadiusForZoom = (zoom) => {
    const steppedZoom = Math.floor(zoom);
    return Math.max(100, 1000 * Math.pow(2, 10 - steppedZoom));
  };

  const toggleSport = (sportId) => {
    setSelectedSports(prev => 
      prev.includes(sportId) ? prev.filter(id => id !== sportId) : [...prev, sportId]
    );
  };

  // ── Search Handler ──
  const handleSearch = async (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    
    if (query.length < 3) {
      setSearchResults([]);
      return;
    }

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&viewbox=120.51,31.87,122.12,30.67&bounded=1&limit=10`);
      const searchData = await res.json();
      setSearchResults(searchData);
    } catch (err) {
      console.error("Geocoding failed", err);
    }
  };

  const handleSelectLocation = (loc) => {
    const lon = parseFloat(loc.lon);
    const lat = parseFloat(loc.lat);

    setViewState({
      longitude: lon,
      latitude: lat,
      zoom: 14, 
      pitch: 0,
      bearing: 0
    });

    setSelectedLocation({
      lon,
      lat,
      name: loc.display_name
    });

    setSearchQuery('');
    setSearchResults([]);
  };

  const evaluatePoint = (p) => {
    if (!p) return false; 
    
    const currentAqi = p.aqi || 0;
    if (currentAqi > maxAqi) return false;

    const m = transportMode.charAt(0); 
    const passesBaseline = p[`15m_${m}`] === 1;

    if (activeTrack === 'baseline') {
      return passesBaseline;
    } 
    
    if (activeTrack === 'trackA') {
      if (requireBaselineForTrackA && !passesBaseline) return false;

      const hasBase = p[`base_${m}`] === 1;
      if (!hasBase) return false;

      if (selectedSports.length === 0) return true;

      if (sportMatchMode === 'all') {
        return selectedSports.every(sport => (p[`${SPORT_PREFIX_MAP[sport]}_${m}`] || 0) > 0);
      } else {
        return selectedSports.some(sport => (p[`${SPORT_PREFIX_MAP[sport]}_${m}`] || 0) > 0);
      }
    }
    return false;
  };

  const layers = [
    new GeoJsonLayer({
      id: 'shanghai-mask',
      data: maskData,
      getFillColor: [0, 0, 0, 140],
      stroked: true,
      getLineColor: [255, 255, 255, 40],
      lineWidthMinPixels: 1,
      beforeId: firstLabelLayerId,
    }),

    new HexagonLayer({
      id: 'hexagon-layer',
      data: data,
      pickable: true,
      extruded: false,
      radius: getRadiusForZoom(viewState.zoom),
      coverage: 0.95,
      opacity: 0.65,
      beforeId: firstLabelLayerId,
      getPosition: d => [d?.lon || 0, d?.lat || 0],
      getColorValue: points => {
        if (!points || points.length === 0) return 0;
        const passes = points.filter(evaluatePoint).length;
        return passes / points.length;
      },
      colorDomain: [0, 1],
      colorRange: [
        [0, 0, 0, 0],
        [198, 219, 239],
        [107, 174, 214],
        [49, 130, 189],
        [8, 81, 156]
      ],
      updateTriggers: {
        radius: [Math.floor(viewState.zoom)],
        getColorValue: [transportMode, activeTrack, selectedSports, sportMatchMode, requireBaselineForTrackA, maxAqi]
      },
      onHover: info => setHoverInfo(info)
    }),
  ];

  const tooltipData = useMemo(() => {
    if (!hoverInfo?.object?.points) return null;
    const points = hoverInfo.object.points;
    const total = points.length;
    if (total === 0) return null;

    const passes = points.filter(evaluatePoint).length;
    const percent = Math.round((passes / total) * 100);

    if (percent === 0) return null;

    const m = transportMode.charAt(0);

    const getAvg = (metricPrefix) => {
      const sum = points.reduce((acc, p) => acc + (p?.[`${metricPrefix}_${m}`] || 0), 0);
      return Math.round(sum / total); 
    };

    const avgAqi = Math.round(points.reduce((acc, p) => acc + (p?.aqi || 0), 0) / total);
    const modeNames = { foot: 'Walk', bike: 'Bike', car: 'Drive' };
    const trackName = activeTrack === 'baseline' ? 'Baseline' : 'Healthy (Track A)';
    
    return {
      title: `${trackName} ${modeNames[transportMode]} Score: ${percent}%`,
      gridPasses: `${passes} / ${total}`,
      avgAqi, 
      showStats: activeTrack === 'trackA', 
      stats: [
        { label: 'Nutrition', val: getAvg('nut') },
        { label: 'Medical', val: getAvg('med') },
        { label: 'Pharmacy', val: getAvg('pha') },
        { label: 'Outdoor', val: getAvg('out') },
        { label: 'Pools', val: getAvg('swm') },
        { label: 'Courts', val: getAvg('crt') },
        { label: 'Yoga', val: getAvg('yog') },
        { label: 'Gyms', val: getAvg('gym') },
      ].filter(s => s.val > 0), 
      x: hoverInfo.x,
      y: hoverInfo.y
    };
  }, [hoverInfo, transportMode, activeTrack, selectedSports, sportMatchMode, requireBaselineForTrackA, maxAqi]);

  // Evaluate structural validity parameters for the pin panel metrics panel
  const pinPointEvaluation = useMemo(() => {
    if (!closestPoint) return null;
    const passesCurrentFilters = evaluatePoint(closestPoint);
    const m = transportMode.charAt(0);
    
    return {
      passes: passesCurrentFilters,
      aqi: closestPoint.aqi || 0,
      baselinePassed: closestPoint[`15m_${m}`] === 1,
      trackBasePassed: closestPoint[`base_${m}`] === 1,
      stats: [
        { label: 'Nutrition', val: closestPoint[`nut_${m}`] || 0 },
        { label: 'Medical', val: closestPoint[`med_${m}`] || 0 },
        { label: 'Pharmacy', val: closestPoint[`pha_${m}`] || 0 },
        { label: 'Outdoor Spaces', val: closestPoint[`out_${m}`] || 0 },
        { label: 'Swimming Pools', val: closestPoint[`swm_${m}`] || 0 },
        { label: 'Sports Courts', val: closestPoint[`crt_${m}`] || 0 },
        { label: 'Yoga & Dance', val: closestPoint[`yog_${m}`] || 0 },
        { label: 'Gyms', val: closestPoint[`gym_${m}`] || 0 },
      ]
    };
  }, [closestPoint, transportMode, activeTrack, selectedSports, sportMatchMode, requireBaselineForTrackA, maxAqi]);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      
      <Map
        {...viewState}
        mapStyle={MAP_STYLE}
        onMove={e => setViewState(e.viewState)}
        maxBounds={SHANGHAI_BOUNDS} 
        onLoad={e => {
          const styleLayers = e.target.getStyle().layers;
          const firstSymbolLayer = styleLayers.find(l => l.type === 'symbol');
          if (firstSymbolLayer) setFirstLabelLayerId(firstSymbolLayer.id);
        }}
      >
        <DeckGLOverlay layers={layers} interleaved={true} />

        {/* ── Search Pin Marker Component ── */}
        {selectedLocation && (
          <Marker 
            longitude={selectedLocation.lon} 
            latitude={selectedLocation.lat} 
            anchor="bottom"
          >
            <div style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {/* Simple High-Contrast SVG Pin Pinpoint */}
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0px 3px 5px rgba(0,0,0,0.4))' }}>
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#ef4444"/>
              </svg>
            </div>
          </Marker>
        )}
      </Map>

      {/* Hex Map Hover Tooltip */}
      {tooltipData && (
        <div style={{
          position: 'absolute', zIndex: 10, pointerEvents: 'none',
          left: tooltipData.x, top: tooltipData.y, transform: 'translate(15px, 15px)',
          background: 'rgba(15, 23, 42, 0.95)', color: '#f8fafc', padding: '16px',
          borderRadius: '12px', fontFamily: 'system-ui, sans-serif',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.15)',
          border: '1px solid rgba(255,255,255,0.1)', minWidth: '220px'
        }}>
          <div style={{ 
            fontSize: '14px', fontWeight: 600, 
            marginBottom: '10px', 
            paddingBottom: '8px', 
            borderBottom: '1px solid rgba(255,255,255,0.1)' 
          }}>
            {tooltipData.title}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: tooltipData.showStats ? '10px' : '0', paddingBottom: tooltipData.showStats ? '10px' : '0', borderBottom: tooltipData.showStats ? '1px solid rgba(255,255,255,0.1)' : 'none' }}>
            <span style={{ fontSize: '13px', color: '#cbd5e1' }}>Average AQI:</span>
            <span style={{ fontWeight: 'bold', padding: '2px 6px', borderRadius: '4px', background: 'rgba(0,0,0,0.3)', color: getAqiColor(tooltipData.avgAqi) }}>
              {tooltipData.avgAqi}
            </span>
          </div>
          
          {tooltipData.showStats && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', fontSize: '13px', color: '#cbd5e1' }}>
              <span style={{ gridColumn: '1 / -1', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', marginTop: '4px' }}>
                Avg Reachable Facilities
              </span>
              
              {tooltipData.stats.map(stat => (
                <div key={stat.label} style={{ display: 'contents' }}>
                  <span>{stat.label}:</span>
                  <span style={{ fontWeight: 600, color: '#fff', textAlign: 'right' }}>{stat.val}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Resizing Control Sidebar */}
      <div style={{
        position: 'absolute', top: 20, left: 20, width: '340px', zIndex: 20, 
        background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(12px)',
        padding: '16px', borderRadius: '16px', color: '#f8fafc',
        fontFamily: 'system-ui, sans-serif', border: '1px solid rgba(255,255,255,0.1)',
        transition: 'all 0.4s ease-in-out'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <img 
              src="/favicon.svg" 
              alt="Shanghai Map Logo" 
              style={{ width: '42px', height: '42px', flexShrink: 0, filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.3))' }} 
            />
            <div>
              <h1 style={{ margin: '0 0 2px 0', fontSize: '17px', fontWeight: 600, lineHeight: 1.2 }}>Shanghai Accessibility</h1>
              <p style={{ color: '#94a3b8', margin: 0, fontSize: '12px' }}>15-Minute City Analysis</p>
            </div>
          </div>

          {/* Search Bar */}
          <div style={{ position: 'relative', zIndex: 999 }}>
            <input
              type="text"
              placeholder="Search an address in Shanghai..."
              value={searchQuery}
              onChange={handleSearch}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.4)',
                color: '#fff', outline: 'none', fontSize: '13px', boxSizing: 'border-box'
              }}
            />
            
            {searchResults.length > 0 && (
              <ul style={{
                position: 'absolute', top: '100%', left: 0, right: 0,
                background: '#1e293b', borderRadius: '8px', padding: '0',
                margin: '4px 0 0 0', listStyle: 'none', zIndex: 50,
                border: '1px solid rgba(255,255,255,0.1)', 
                maxHeight: '40vh',
                overflowY: 'auto',  
                overflowX: 'hidden',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
              }}>
                {searchResults.map((result) => (
                  <li 
                    key={result.place_id}
                    onClick={() => handleSelectLocation(result)}
                    style={{
                      padding: '10px 12px', fontSize: '12px', cursor: 'pointer',
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    {result.display_name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em' }}>Analysis Track</h3>
            <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '4px' }}>
              {['baseline', 'trackA'].map(track => (
                <button
                  key={track}
                  onClick={() => setActiveTrack(track)}
                  style={{
                    flex: 1, padding: '6px', border: 'none', borderRadius: '6px', cursor: 'pointer',
                    background: activeTrack === track ? '#3b82f6' : 'transparent',
                    color: activeTrack === track ? '#fff' : '#cbd5e1',
                    fontWeight: activeTrack === track ? 600 : 400,
                    transition: 'all 0.2s', fontSize: '13px'
                  }}
                >
                  {track === 'baseline' ? 'Baseline' : 'Healthy (Track A)'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <h3 style={{ margin: 0, fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em' }}>
                  Air Quality Limit (AQI)
                </h3>
                <button 
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setAqiPopPos({ x: rect.right + 15, y: rect.top - 10 });
                    setShowAqiInfo(true);
                  }}
                  onMouseLeave={() => setShowAqiInfo(false)}
                  style={{
                    background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', 
                    width: '14px', height: '14px', color: '#cbd5e1', fontSize: '10px', fontWeight: 'bold',
                    cursor: 'help', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0
                  }}
                >
                  i
                </button>
              </div>
              <span style={{ fontSize: '12px', fontWeight: 'bold', color: getAqiColor(maxAqi) }}>≤ {maxAqi}</span>
            </div>

            <input
              type="range"
              min="0" max="300" step="5"
              value={maxAqi}
              onChange={(e) => setMaxAqi(Number(e.target.value))}
              style={{ width: '100%', cursor: 'pointer', accentColor: getAqiColor(maxAqi) }}
            />
          </div>

          <div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em' }}>Transport Mode</h3>
            <div style={{ position: 'relative' }}>
              <select 
                value={transportMode} 
                onChange={e => setTransportMode(e.target.value)}
                style={{
                  width: '100%', padding: '8px 30px 8px 12px', borderRadius: '8px', 
                  border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', 
                  color: '#fff', outline: 'none', cursor: 'pointer',
                  appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none', fontSize: '13px'
                }}
              >
                <option value="foot" style={{ background: '#0f172a' }}>🚶 Walking (15 min)</option>
                <option value="bike" style={{ background: '#0f172a' }}>🚲 Biking (15 min)</option>
                <option value="car"  style={{ background: '#0f172a' }}>🚗 Driving (15 min)</option>
              </select>
              <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#94a3b8', fontSize: '10px' }}>▼</div>
            </div>
          </div>
        </div>

        <div style={{ 
          display: 'grid',
          gridTemplateRows: activeTrack === 'trackA' ? '1fr' : '0fr',
          transition: 'grid-template-rows 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease-in-out',
          opacity: activeTrack === 'trackA' ? 1 : 0,
          marginTop: activeTrack === 'trackA' ? '16px' : '0px'
        }}>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px' }}>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ 
                  display: 'flex', alignItems: 'center', padding: '8px 10px', 
                  background: requireBaselineForTrackA ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${requireBaselineForTrackA ? '#10b981' : 'transparent'}`,
                  borderRadius: '6px', cursor: 'pointer', transition: 'all 0.2s', fontSize: '13px',
                  fontWeight: requireBaselineForTrackA ? 600 : 400
                }}>
                  <input type="checkbox" checked={requireBaselineForTrackA} onChange={e => setRequireBaselineForTrackA(e.target.checked)} style={{ marginRight: '8px' }}/>
                  Require 15-Min Baseline
                </label>
              </div>

              <div style={{ background: 'rgba(59, 130, 246, 0.1)', borderLeft: '3px solid #3b82f6', padding: '8px', borderRadius: '0 8px 8px 0', marginBottom: '16px' }}>
                <p style={{ margin: 0, fontSize: '11px', color: '#bfdbfe', lineHeight: 1.4 }}><strong>Base:</strong> Nutrition, Medical, Pharmacy & 1+ Sport (Any).</p>
              </div>

              <h3 style={{ margin: '0 0 8px 0', fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em' }}>Sport Filters</h3>
              
              <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                  <input type="radio" checked={sportMatchMode === 'all'} onChange={() => setSportMatchMode('all')} /> Must have ALL
                </label>
                <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                  <input type="radio" checked={sportMatchMode === 'any'} onChange={() => setSportMatchMode('any')} /> Can have ANY
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {SPORTS_OPTIONS.map(sport => (
                  <label key={sport.id} style={{ 
                    display: 'flex', alignItems: 'center', padding: '6px 8px', 
                    background: selectedSports.includes(sport.id) ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${selectedSports.includes(sport.id) ? '#3b82f6' : 'transparent'}`,
                    borderRadius: '6px', cursor: 'pointer', transition: 'all 0.2s', fontSize: '12px'
                  }}>
                    <input type="checkbox" checked={selectedSports.includes(sport.id)} onChange={() => toggleSport(sport.id)} style={{ marginRight: '6px', transform: 'scale(0.9)' }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sport.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── NEW: Selected Location Data Breakdown Card ── */}
      {selectedLocation && pinPointEvaluation && (
        <div style={{
          position: 'absolute', top: 20, right: 20, width: '320px', zIndex: 20,
          background: 'rgba(15, 23, 42, 0.90)', backdropFilter: 'blur(16px)',
          padding: '20px', borderRadius: '16px', color: '#f8fafc',
          fontFamily: 'system-ui, sans-serif', border: '1px solid rgba(255,255,255,0.15)',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#fff', maxWidth: '85%' }}>
              Nearest Location Metrics
            </h2>
            <button 
              onClick={() => { setSelectedLocation(null); setClosestPoint(null); }}
              style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '16px', padding: 0 }}
            >
              ✕
            </button>
          </div>
          
          <p style={{ margin: '0 0 14px 0', fontSize: '11px', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {selectedLocation.name}
          </p>

          {/* Compliance Badge */}
          <div style={{ 
            display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', 
            borderRadius: '8px', marginBottom: '16px', fontSize: '13px', fontWeight: 500,
            background: pinPointEvaluation.passes ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            border: `1px solid ${pinPointEvaluation.passes ? '#10b981' : '#ef4444'}`,
            color: pinPointEvaluation.passes ? '#34d399' : '#f87171'
          }}>
            <span style={{ fontSize: '14px' }}>{pinPointEvaluation.passes ? '●' : '○'}</span>
            <span>{pinPointEvaluation.passes ? 'Matches Filter Criteria' : 'Fails Filter Criteria'}</span>
          </div>

          {/* Quick Metrics Checklist Grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '14px', marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: '#cbd5e1' }}>Air Quality (AQI):</span>
              <span style={{ fontWeight: 'bold', color: getAqiColor(pinPointEvaluation.aqi) }}>
                {pinPointEvaluation.aqi}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: '#cbd5e1' }}>15-Min Baseline Compliance:</span>
              <span style={{ fontWeight: 'bold', color: pinPointEvaluation.baselinePassed ? '#10b981' : '#ef4444' }}>
                {pinPointEvaluation.baselinePassed ? 'Yes' : 'No'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: '#cbd5e1' }}>Healthy Core Track Base:</span>
              <span style={{ fontWeight: 'bold', color: pinPointEvaluation.trackBasePassed ? '#10b981' : '#ef4444' }}>
                {pinPointEvaluation.trackBasePassed ? 'Passed' : 'Failed'}
              </span>
            </div>
          </div>

          {/* Exact Reachable Facility Count Breakdown */}
          <h3 style={{ margin: '0 0 8px 0', fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em' }}>
            Reachable Facilities Total
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 12px', fontSize: '12px', color: '#cbd5e1', maxHeight: '180px', overflowY: 'auto' }}>
            {pinPointEvaluation.stats.map(stat => (
              <div key={stat.label} style={{ display: 'contents' }}>
                <span>{stat.label}:</span>
                <span style={{ fontWeight: 600, color: stat.val > 0 ? '#fff' : '#64748b' }}>{stat.val}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AQI Legend Overlay Popup */}
      {showAqiInfo && (
        <div style={{
          position: 'absolute', top: aqiPopPos.y, left: aqiPopPos.x, zIndex: 9999,
          background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: '8px', padding: '12px', width: '280px',
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
          pointerEvents: 'none' 
        }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#f8fafc' }}>AQI Categories</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {AQI_INFO.map(info => (
              <div key={info.range} style={{ display: 'flex', gap: '8px', fontSize: '11px', lineHeight: 1.3 }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: info.color, flexShrink: 0, marginTop: '2px' }}></span>
                <div>
                  <strong style={{ color: '#e2e8f0', display: 'block' }}>{info.range} ({info.label})</strong>
                  <span style={{ color: '#94a3b8' }}>{info.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}