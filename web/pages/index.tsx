import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { 
  Layers, 
  MapPin, 
  Calendar, 
  CheckCircle2, 
  Cloud, 
  Send, 
  History, 
  AlertTriangle, 
  Check, 
  UploadCloud, 
  Download, 
  ChevronDown, 
  ChevronRight, 
  Info, 
  Sliders, 
  Eye, 
  Search,
  Filter,
  ZoomIn,
  ZoomOut,
  Maximize2
} from 'lucide-react';

interface Sector {
  id: string;
  r: number;
  c: number;
  valid_ha: number;
  candidate_water_ha: number;
  permanent_water_ha: number;
  disagreement_ha: number;
  disagreement_alert: string;
  triage_category: string;
  rank: number;
}

interface Scene {
  metadata: {
    id: string;
    name: string;
    region: string;
    date: string;
    sensor: string;
    lat: number;
    lon: number;
  };
  valid_coverage_pct: number;
  total_candidate_water_ha: number;
  total_permanent_water_ha: number;
  total_disagreement_ha: number;
  img_sar_b64: string;
  img_cand_water_b64: string;
  img_disagreement_b64: string;
  sectors: Sector[];
  metrics?: {
    total_latency_ms?: number;
    warm_prediction_ms?: number;
    pixel_area_m2?: number;
    max_sector_ha?: number;
  };
}

export default function SatelliteWorkspace() {
  const [scenes, setScenes] = useState<Record<string, Scene>>({});
  const [selectedKey, setSelectedKey] = useState<string>('India_591317');
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Map layer controls
  const [radarOpacity, setRadarOpacity] = useState<number>(100);
  const [predictionOpacity, setPredictionOpacity] = useState<number>(75);
  const [showPermanentWater, setShowPermanentWater] = useState<boolean>(true);
  const [showDisagreement, setShowDisagreement] = useState<boolean>(true);
  const [showSectors, setShowSectors] = useState<boolean>(true);
  const [showPlaceLabels, setShowPlaceLabels] = useState<boolean>(true);
  const [selectedSector, setSelectedSector] = useState<string>('SEC_34');
  const [zoomLevel, setZoomLevel] = useState<number>(1);

  // Filter & Queue search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');

  // Task form state
  const [assignedCrew, setAssignedCrew] = useState<string>('Field Verification Unit Alpha');
  const [taskStatus, setTaskStatus] = useState<string>('assigned');
  const [taskNotes, setTaskNotes] = useState<string>('Candidate water observed outside permanent river channel. Embankment inspection scheduled.');
  const [taskEvidence, setTaskEvidence] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  // Technical details drawer
  const [showTechDetails, setShowTechDetails] = useState<boolean>(false);

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLat, setUploadLat] = useState<string>('26.63');
  const [uploadLon, setUploadLon] = useState<string>('92.91');
  const [uploadName, setUploadName] = useState<string>('Sentinel-1 Verification Scene');
  const [uploading, setUploading] = useState<boolean>(false);

  useEffect(() => {
    loadScenes();
    loadTasks();
  }, []);

  const loadScenes = () => {
    fetch('/api/scenes')
      .then((res) => res.json())
      .then((data) => {
        setScenes(data);
        setLoading(false);
      })
      .catch((err) => console.error(err));
  };

  const loadTasks = () => {
    fetch('/api/tasks')
      .then((res) => res.json())
      .then((data) => setTasks(data))
      .catch((err) => console.error(err));
  };

  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveFeedback(null);

    const payload = {
      task_id: `TASK_${selectedKey}_${selectedSector}`,
      chip_id: selectedKey,
      sector_id: selectedSector,
      actor: 'Satellite Analyst',
      assigned_team: assignedCrew,
      status: taskStatus,
      evidence: taskEvidence,
      notes: taskNotes
    };

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      setIsSaving(false);

      if (res.ok) {
        setSaveFeedback('Task updated and persisted to S3');
        loadTasks();
        setTimeout(() => setSaveFeedback(null), 4000);
      } else {
        setSaveFeedback(data.error || 'Failed to update task.');
      }
    } catch {
      setIsSaving(false);
      setSaveFeedback('Network error while persisting task.');
    }
  };

  const handleUploadInference = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      alert("Please choose a GeoTIFF (.tif) file");
      return;
    }
    setUploading(true);

    const formData = new FormData();
    formData.append('file', uploadFile);
    formData.append('lat', uploadLat);
    formData.append('lon', uploadLon);
    formData.append('name', uploadName);

    try {
      const res = await fetch('/api/infer', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      setUploading(false);

      if (res.ok) {
        setShowUploadModal(false);
        loadScenes();
        setSelectedKey(data.metadata.id);
        setSelectedSector(data.sectors?.[0]?.id || 'SEC_1');
      } else {
        alert(data.error || 'Inference upload failed.');
      }
    } catch (err: any) {
      setUploading(false);
      alert("Upload failed: " + err.message);
    }
  };

  const exportManifest = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tasks, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `floodproof_manifest_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  if (loading || !scenes[selectedKey]) {
    return (
      <div style={{ display: 'flex', height: '100vh', width: '100%', alignItems: 'center', justifyContent: 'center', background: '#090a0d', color: '#94a3b8' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '15px', fontWeight: '600', color: '#f8fafc' }}>Loading Satellite Workspace...</div>
          <div style={{ fontSize: '13px', marginTop: '6px' }}>Preparing Sentinel-1 SAR georeferenced rasters</div>
        </div>
      </div>
    );
  }

  const current = scenes[selectedKey];
  const meta = current.metadata;
  const activeSectorData = current.sectors.find((s) => s.id === selectedSector);

  // Calculate geodetic invariants dynamically based on scene latitude
  const latVal = meta.lat || 26.63;
  const a = 6378137.0;
  const b = 6356752.3142;
  const phi = (Math.abs(latVal) * Math.PI) / 180.0;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const e2 = 1.0 - (Math.pow(b, 2) / Math.pow(a, 2));
  const m = ((Math.PI / 180.0) * a * (1.0 - e2)) / Math.pow(1.0 - e2 * Math.pow(sinPhi, 2), 1.5);
  const p = ((Math.PI / 180.0) * a * cosPhi) / Math.sqrt(1.0 - e2 * Math.pow(sinPhi, 2));
  const resDeg = 0.00008983152841195215;
  const dy = m * resDeg;
  const dx = p * resDeg;
  const pixelAreaM2 = (dy * dx).toFixed(2);
  const maxSectorHa = ((64 * 64 * (dy * dx)) / 10000.0).toFixed(2);

  // Filtered queue
  const filteredSectors = current.sectors.filter((sec) => {
    const matchesSearch = sec.id.toLowerCase().includes(searchQuery.toLowerCase());
    if (filterSeverity === 'severe') return matchesSearch && sec.candidate_water_ha > 15;
    if (filterSeverity === 'moderate') return matchesSearch && sec.candidate_water_ha > 5 && sec.candidate_water_ha <= 15;
    if (filterSeverity === 'conflict') return matchesSearch && sec.disagreement_ha > 4;
    return matchesSearch;
  });

  return (
    <div style={{ minHeight: '100vh', width: '100%', background: '#090a0d', color: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
      <Head>
        <title>FloodProof | Satellite Analysis Workspace</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      {/* ================= 1. RESTRAINED TOP WORKSPACE BAR ================= */}
      <header style={{ 
        height: '56px', 
        borderBottom: '1px solid #1e2433', 
        padding: '0 20px', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        background: '#0d1017'
      }}>
        {/* Brand & Scene Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '16px', fontWeight: '700', letterSpacing: '-0.02em', color: '#ffffff' }}>FloodProof</span>
            <span style={{ fontSize: '11px', color: '#64748b', borderLeft: '1px solid #232a3b', paddingLeft: '10px' }}>Satellite Analysis Workspace</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>Scene:</span>
            <select 
              value={selectedKey} 
              onChange={(e) => {
                setSelectedKey(e.target.value);
                const nextSec = scenes[e.target.value]?.sectors?.[0]?.id || 'SEC_1';
                setSelectedSector(nextSec);
              }}
              style={{ 
                padding: '6px 12px', 
                background: '#151923', 
                color: '#f8fafc', 
                border: '1px solid #232a3b', 
                borderRadius: '6px', 
                fontSize: '12px', 
                fontWeight: '500', 
                cursor: 'pointer' 
              }}
            >
              {Object.keys(scenes).map((k) => (
                <option key={k} value={k}>{scenes[k].metadata.name}</option>
              ))}
            </select>

            <span style={{ 
              fontSize: '11px', 
              color: '#d97706', 
              background: 'rgba(217, 119, 6, 0.1)', 
              padding: '3px 8px', 
              borderRadius: '4px', 
              border: '1px solid rgba(217, 119, 6, 0.25)', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '4px' 
            }}>
              <Calendar size={12} />
              Historical: {meta.date}
            </span>
          </div>
        </div>

        {/* Global Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button 
            onClick={() => setShowUploadModal(true)}
            style={{ 
              padding: '6px 12px', 
              background: '#151923', 
              color: '#94a3b8', 
              border: '1px solid #232a3b', 
              borderRadius: '6px', 
              fontSize: '12px', 
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <UploadCloud size={14} />
            Upload SAR (.tif)
          </button>

          <button 
            onClick={exportManifest}
            style={{ 
              padding: '6px 12px', 
              background: '#151923', 
              color: '#94a3b8', 
              border: '1px solid #232a3b', 
              borderRadius: '6px', 
              fontSize: '12px', 
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Download size={14} />
            Export Tasks JSON
          </button>

          <div style={{ height: '16px', width: '1px', background: '#232a3b' }}></div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#64748b' }}>
            <span style={{ height: '7px', width: '7px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }}></span>
            <span>S3 Sync Active</span>
          </div>
        </div>
      </header>

      {/* ================= 2. MAIN WORKSPACE (2/3 MAP CANVAS, 1/3 INSPECTION PANEL) ================= */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 420px', height: 'calc(100vh - 56px)', overflow: 'hidden' }}>
        
        {/* ================= LEFT 2/3: MAP CANVAS ================= */}
        <div style={{ background: '#0b0d13', position: 'relative', display: 'flex', flexDirection: 'column', borderRight: '1px solid #1e2433' }}>
          
          {/* Floating Canvas Layer Bar */}
          <div style={{ 
            position: 'absolute', 
            top: '16px', 
            left: '20px', 
            zIndex: 30, 
            display: 'flex', 
            alignItems: 'center', 
            gap: '12px', 
            background: 'rgba(15, 18, 26, 0.92)', 
            backdropFilter: 'blur(8px)', 
            border: '1px solid #232a3b', 
            padding: '8px 14px', 
            borderRadius: '8px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '500' }}>Radar:</span>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={radarOpacity} 
                onChange={(e) => setRadarOpacity(Number(e.target.value))}
                style={{ width: '70px', accentColor: '#2563eb', cursor: 'pointer' }}
              />
              <span className="font-mono" style={{ fontSize: '10px', color: '#64748b' }}>{radarOpacity}%</span>
            </div>

            <div style={{ height: '14px', width: '1px', background: '#232a3b' }}></div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '500' }}>Predictions:</span>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={predictionOpacity} 
                onChange={(e) => setPredictionOpacity(Number(e.target.value))}
                style={{ width: '70px', accentColor: '#e11d48', cursor: 'pointer' }}
              />
              <span className="font-mono" style={{ fontSize: '10px', color: '#64748b' }}>{predictionOpacity}%</span>
            </div>

            <div style={{ height: '14px', width: '1px', background: '#232a3b' }}></div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#94a3b8', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={showPermanentWater} 
                onChange={(e) => setShowPermanentWater(e.target.checked)}
                style={{ accentColor: '#0284c7' }}
              />
              Permanent Baseline
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#94a3b8', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={showDisagreement} 
                onChange={(e) => setShowDisagreement(e.target.checked)}
                style={{ accentColor: '#d97706' }}
              />
              Disagreement
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#94a3b8', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={showSectors} 
                onChange={(e) => setShowSectors(e.target.checked)}
                style={{ accentColor: '#2563eb' }}
              />
              Sectors Grid
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#94a3b8', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={showPlaceLabels} 
                onChange={(e) => setShowPlaceLabels(e.target.checked)}
                style={{ accentColor: '#10b981' }}
              />
              Place Context
            </label>
          </div>

          {/* Floating Zoom & Fit Controls */}
          <div style={{ 
            position: 'absolute', 
            top: '16px', 
            right: '20px', 
            zIndex: 30, 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '4px',
            background: 'rgba(15, 18, 26, 0.92)', 
            backdropFilter: 'blur(8px)', 
            border: '1px solid #232a3b', 
            padding: '4px', 
            borderRadius: '6px' 
          }}>
            <button 
              onClick={() => setZoomLevel((z) => Math.min(z + 0.2, 2.0))}
              title="Zoom In"
              style={{ background: 'transparent', border: 'none', color: '#94a3b8', padding: '6px', cursor: 'pointer', borderRadius: '4px' }}
            >
              <ZoomIn size={16} />
            </button>
            <button 
              onClick={() => setZoomLevel((z) => Math.max(z - 0.2, 0.8))}
              title="Zoom Out"
              style={{ background: 'transparent', border: 'none', color: '#94a3b8', padding: '6px', cursor: 'pointer', borderRadius: '4px' }}
            >
              <ZoomOut size={16} />
            </button>
            <button 
              onClick={() => setZoomLevel(1)}
              title="Reset View"
              style={{ background: 'transparent', border: 'none', color: '#94a3b8', padding: '6px', cursor: 'pointer', borderRadius: '4px' }}
            >
              <Maximize2 size={16} />
            </button>
          </div>

          {/* Map Viewer Viewport */}
          <div style={{ 
            flex: 1, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            overflow: 'hidden', 
            position: 'relative' 
          }}>
            <div style={{ 
              position: 'relative', 
              width: '560px', 
              height: '560px', 
              transform: `scale(${zoomLevel})`, 
              transition: 'transform 0.15s ease-out',
              borderRadius: '4px',
              overflow: 'hidden',
              boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
              background: '#07090e'
            }}>
              
              {/* Layer 1: SAR Base Backscatter Raster */}
              <img 
                src={`data:image/png;base64,${current.img_sar_b64}`}
                alt="SAR Base Raster"
                style={{ 
                  position: 'absolute', 
                  top: 0, 
                  left: 0, 
                  width: '100%', 
                  height: '100%', 
                  objectFit: 'contain', 
                  opacity: radarOpacity / 100 
                }}
              />

              {/* Layer 2: Model Prediction Mask (Candidate Water + Permanent Baseline) */}
              <img 
                src={`data:image/png;base64,${current.img_cand_water_b64}`}
                alt="Prediction Mask"
                style={{ 
                  position: 'absolute', 
                  top: 0, 
                  left: 0, 
                  width: '100%', 
                  height: '100%', 
                  objectFit: 'contain', 
                  opacity: predictionOpacity / 100,
                  mixBlendMode: 'screen' 
                }}
              />

              {/* Layer 3: Model Disagreement Overlay */}
              {showDisagreement && (
                <img 
                  src={`data:image/png;base64,${current.img_disagreement_b64}`}
                  alt="Model Disagreement"
                  style={{ 
                    position: 'absolute', 
                    top: 0, 
                    left: 0, 
                    width: '100%', 
                    height: '100%', 
                    objectFit: 'contain', 
                    opacity: (predictionOpacity / 100) * 0.8,
                    mixBlendMode: 'screen' 
                  }}
                />
              )}

              {/* Layer 4: Interactive 8x8 Sectors Grid Overlay */}
              {showSectors && (
                <div style={{ 
                  position: 'absolute', 
                  top: 0, 
                  left: 0, 
                  width: '100%', 
                  height: '100%', 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(8, 1fr)', 
                  gridTemplateRows: 'repeat(8, 1fr)',
                  pointerEvents: 'auto'
                }}>
                  {Array.from({ length: 64 }).map((_, i) => {
                    const secId = `SEC_${i + 1}`;
                    const secData = current.sectors.find((s) => s.id === secId);
                    const isSelected = selectedSector === secId;

                    return (
                      <div 
                        key={secId}
                        onClick={() => setSelectedSector(secId)}
                        title={`${secId}: ${secData?.candidate_water_ha || 0} ha candidate water`}
                        style={{ 
                          border: isSelected ? '2px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.08)',
                          background: isSelected 
                            ? 'rgba(56, 189, 248, 0.22)' 
                            : (secData && secData.candidate_water_ha > 15 
                                ? 'rgba(225, 29, 72, 0.12)' 
                                : 'transparent'),
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'flex-start',
                          padding: '2px 4px',
                          transition: 'background-color 0.15s'
                        }}
                      >
                        <span style={{ 
                          fontSize: '10px', 
                          fontWeight: '800', 
                          color: '#000000', 
                          background: isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.85)',
                          padding: '1px 4px',
                          borderRadius: '3px',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                          fontFamily: 'JetBrains Mono',
                          lineHeight: 1
                        }}>
                          {i + 1}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Layer 5: Real OSM Place Labels Context */}
              {showPlaceLabels && (
                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                  <div style={{ position: 'absolute', top: '18%', right: '28%', background: 'rgba(15, 18, 26, 0.85)', padding: '2px 6px', borderRadius: '3px', fontSize: '10px', color: '#e2e8f0', border: '1px solid #232a3b' }}>
                    Panpur (Village)
                  </div>
                  <div style={{ position: 'absolute', bottom: '26%', right: '35%', background: 'rgba(15, 18, 26, 0.85)', padding: '2px 6px', borderRadius: '3px', fontSize: '10px', color: '#e2e8f0', border: '1px solid #232a3b' }}>
                    Silghat (Embankment)
                  </div>
                  <div style={{ position: 'absolute', top: '48%', left: '16%', background: 'rgba(15, 18, 26, 0.85)', padding: '2px 6px', borderRadius: '3px', fontSize: '10px', color: '#93c5fd', border: '1px solid #1e3a8a' }}>
                    Brahmaputra River Channel
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* Bottom Canvas Footer: Legend & Map Scale */}
          <div style={{ 
            height: '42px', 
            background: '#0d1017', 
            borderTop: '1px solid #1e2433', 
            padding: '0 20px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            fontSize: '11px',
            color: '#94a3b8'
          }}>
            {/* Legend items */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ height: '8px', width: '8px', borderRadius: '2px', background: '#e11d48', display: 'inline-block' }}></span>
                <span>Candidate Water (Outside baseline)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ height: '8px', width: '8px', borderRadius: '2px', background: '#0284c7', display: 'inline-block' }}></span>
                <span>Permanent Water (JRC Baseline)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ height: '8px', width: '8px', borderRadius: '2px', background: '#d97706', display: 'inline-block' }}></span>
                <span>Model Disagreement (Triage suggested)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ height: '8px', width: '8px', borderRadius: '2px', border: '1px solid #38bdf8', display: 'inline-block' }}></span>
                <span>Selected Sector ({selectedSector})</span>
              </div>
            </div>

            {/* Scale indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#64748b' }}>
              <span className="font-mono">Footprint: 4.58 km × 5.10 km (23.34 km²)</span>
              <span>•</span>
              <span className="font-mono">{pixelAreaM2} m²/px</span>
            </div>
          </div>

        </div>

        {/* ================= RIGHT 1/3: FOCUSED INSPECTION & TASK PANEL ================= */}
        <div style={{ background: '#0f1117', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          
          {/* Section 1: Scene Overview */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e2433' }}>
            <div style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
              Scene Details
            </div>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#f8fafc', marginBottom: '4px' }}>
              {meta.name}
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <MapPin size={13} /> {meta.region} ({meta.lat}°N, {meta.lon}°E)
            </div>

            {/* Top stats pills */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '12px' }}>
              <div style={{ background: '#151821', border: '1px solid #202534', borderRadius: '6px', padding: '8px' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>Candidate Water</div>
                <div className="font-mono" style={{ fontSize: '15px', fontWeight: '700', color: '#f43f5e', marginTop: '2px' }}>
                  {current.total_candidate_water_ha} ha
                </div>
              </div>

              <div style={{ background: '#151821', border: '1px solid #202534', borderRadius: '6px', padding: '8px' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>Permanent Baseline</div>
                <div className="font-mono" style={{ fontSize: '15px', fontWeight: '700', color: '#38bdf8', marginTop: '2px' }}>
                  {current.total_permanent_water_ha} ha
                </div>
              </div>

              <div style={{ background: '#151821', border: '1px solid #202534', borderRadius: '6px', padding: '8px' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>Disagreement</div>
                <div className="font-mono" style={{ fontSize: '15px', fontWeight: '700', color: '#f59e0b', marginTop: '2px' }}>
                  {current.total_disagreement_ha} ha
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Sector Queue & Verification Priority */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e2433' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Verification Queue ({filteredSectors.length})
              </div>

              {/* Filter pills */}
              <div style={{ display: 'flex', gap: '4px' }}>
                <button 
                  onClick={() => setFilterSeverity('all')}
                  style={{ padding: '2px 8px', fontSize: '10px', background: filterSeverity === 'all' ? '#2563eb' : '#151821', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                >
                  All
                </button>
                <button 
                  onClick={() => setFilterSeverity('severe')}
                  style={{ padding: '2px 8px', fontSize: '10px', background: filterSeverity === 'severe' ? '#e11d48' : '#151821', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                >
                  Severe
                </button>
                <button 
                  onClick={() => setFilterSeverity('conflict')}
                  style={{ padding: '2px 8px', fontSize: '10px', background: filterSeverity === 'conflict' ? '#d97706' : '#151821', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                >
                  Conflict
                </button>
              </div>
            </div>

            {/* Search Input */}
            <div style={{ position: 'relative', marginBottom: '10px' }}>
              <Search size={13} style={{ position: 'absolute', top: '8px', left: '10px', color: '#64748b' }} />
              <input 
                type="text" 
                placeholder="Search sector (e.g. SEC_34)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: '100%', padding: '6px 10px 6px 28px', background: '#151821', color: '#f8fafc', border: '1px solid #202534', borderRadius: '6px', fontSize: '12px' }}
              />
            </div>

            {/* Scrollable Queue List */}
            <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {filteredSectors.slice(0, 10).map((sec) => {
                const isSelected = selectedSector === sec.id;
                return (
                  <div 
                    key={sec.id}
                    onClick={() => setSelectedSector(sec.id)}
                    className="table-hover-row"
                    style={{ 
                      padding: '8px 10px', 
                      borderRadius: '6px', 
                      background: isSelected ? '#1e2433' : '#151821', 
                      border: isSelected ? '1px solid #38bdf8' : '1px solid #202534',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="font-mono" style={{ fontSize: '11px', fontWeight: '700', color: isSelected ? '#38bdf8' : '#e2e8f0' }}>
                          #{sec.rank} {sec.id}
                        </span>
                        {sec.disagreement_ha > 4 && (
                          <span style={{ fontSize: '9px', background: 'rgba(217, 119, 6, 0.15)', color: '#d97706', padding: '1px 4px', borderRadius: '2px' }}>
                            Conflict
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>
                        Sector Extent: {sec.valid_ha} ha
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <span className="font-mono" style={{ fontSize: '12px', fontWeight: '700', color: '#f43f5e' }}>
                        {sec.candidate_water_ha} ha
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 3: Selected Sector & Task Assignment */}
          <div style={{ padding: '16px 20px', flex: 1 }}>
            <div style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Sector Inspection & Task Assignment
            </div>

            {/* Selected Sector Summary Card */}
            <div style={{ background: '#151821', border: '1px solid #202534', borderRadius: '6px', padding: '10px 12px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="font-mono" style={{ fontSize: '13px', fontWeight: '700', color: '#38bdf8' }}>{selectedSector}</span>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>Rank #{activeSectorData?.rank || '-'} in Queue</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px', fontSize: '11px' }}>
                <div>Candidate Water: <strong style={{ color: '#f43f5e' }}>{activeSectorData?.candidate_water_ha || 0} ha</strong></div>
                <div>Permanent Water: <strong style={{ color: '#38bdf8' }}>{activeSectorData?.permanent_water_ha || 0} ha</strong></div>
                <div>Model Disagreement: <strong style={{ color: '#f59e0b' }}>{activeSectorData?.disagreement_ha || 0} ha</strong></div>
                <div>Max Sector Extent: <strong style={{ color: '#94a3b8' }}>{activeSectorData?.valid_ha || maxSectorHa} ha</strong></div>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveTask} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Assigned Verification Team</label>
                <input 
                  type="text" 
                  value={assignedCrew} 
                  onChange={(e) => setAssignedCrew(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', background: '#12151e', color: '#f8fafc', border: '1px solid #202534', borderRadius: '5px', fontSize: '12px' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Task Status</label>
                <select 
                  value={taskStatus} 
                  onChange={(e) => setTaskStatus(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', background: '#12151e', color: '#f8fafc', border: '1px solid #202534', borderRadius: '5px', fontSize: '12px' }}
                >
                  <option value="assigned">assigned (Queued for dispatch)</option>
                  <option value="in_progress">in_progress (Field team en route)</option>
                  <option value="operator_reviewed">operator_reviewed (Analyst corroboration)</option>
                  <option value="field_verified">field_verified (Requires ground evidence)</option>
                  <option value="rejected">rejected (Dry / False Alarm)</option>
                  <option value="inconclusive">inconclusive (Access blocked)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
                  Recorded Ground Evidence (Required for field_verified)
                </label>
                <input 
                  type="text" 
                  value={taskEvidence} 
                  onChange={(e) => setTaskEvidence(e.target.value)}
                  placeholder="e.g. Drone imagery #2016-08, high water mark photo"
                  style={{ width: '100%', padding: '7px 10px', background: '#12151e', color: '#10b981', border: '1px solid #202534', borderRadius: '5px', fontSize: '12px' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Operational Notes</label>
                <textarea 
                  rows={2} 
                  value={taskNotes} 
                  onChange={(e) => setTaskNotes(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', background: '#12151e', color: '#f8fafc', border: '1px solid #202534', borderRadius: '5px', fontSize: '12px' }}
                />
              </div>

              {saveFeedback && (
                <div style={{ fontSize: '11px', color: saveFeedback.includes('persisted') ? '#10b981' : '#f43f5e', padding: '4px 0' }}>
                  {saveFeedback}
                </div>
              )}

              <button 
                type="submit" 
                disabled={isSaving}
                style={{ 
                  padding: '9px', 
                  background: isSaving ? '#1e2433' : '#2563eb', 
                  color: '#fff', 
                  border: 'none', 
                  borderRadius: '5px', 
                  fontSize: '12px', 
                  fontWeight: '600', 
                  cursor: isSaving ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <Send size={13} />
                {isSaving ? 'Persisting to S3...' : 'Save Task & Persist'}
              </button>
            </form>
          </div>

          {/* Section 4: Expandable Technical Telemetry Accordion */}
          <div style={{ borderTop: '1px solid #1e2433' }}>
            <button 
              onClick={() => setShowTechDetails(!showTechDetails)}
              style={{ 
                width: '100%', 
                padding: '12px 20px', 
                background: 'transparent', 
                border: 'none', 
                color: '#64748b', 
                fontSize: '11px', 
                fontWeight: '600',
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                cursor: 'pointer' 
              }}
            >
              <span>TECHNICAL GEODESY & CLOUD METRICS</span>
              {showTechDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>

            {showTechDetails && (
              <div style={{ padding: '0 20px 16px', fontSize: '11px', color: '#94a3b8', lineHeight: '1.6' }}>
                <div>• Reference Ellipsoid: <strong>WGS84</strong></div>
                <div>• Scene Latitude: <strong>{meta.lat}°N</strong></div>
                <div>• Calculated Pixel Footprint: <strong>{pixelAreaM2} m²/px</strong></div>
                <div>• Sector Capacity Invariant: <strong>≤ {maxSectorHa} ha</strong></div>
                <div>• Model Architecture: <strong>XGBoost Gradient Boosted Trees (v1.2)</strong></div>
                <div>• S3 Destination: <code>s3://floodproof-verification-artifacts-699158992887</code></div>
              </div>
            )}
          </div>

        </div>

      </div>

      {/* ================= 3. MODAL: LIVE GEO-TIFF INFERENCE UPLOAD ================= */}
      {showUploadModal && (
        <div style={{ 
          position: 'fixed', 
          top: 0, 
          left: 0, 
          right: 0, 
          bottom: 0, 
          background: 'rgba(0,0,0,0.75)', 
          backdropFilter: 'blur(4px)', 
          zIndex: 100, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center' 
        }}>
          <div style={{ width: '480px', background: '#0f1117', border: '1px solid #232a3b', borderRadius: '8px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#fff', margin: 0 }}>
                Upload Sentinel-1 SAR GeoTIFF (.tif)
              </h3>
              <button onClick={() => setShowUploadModal(false)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}>✕</button>
            </div>

            <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '16px' }}>
              Upload a 2-band [VV, VH] SAR GRD scene. The system will execute the XGBoost pipeline, compute geodetic metrics, generate sector rankings, and sync to S3.
            </p>

            <form onSubmit={handleUploadInference} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Select GeoTIFF File</label>
                <input 
                  type="file" 
                  accept=".tif,.tiff" 
                  onChange={(e) => setUploadFile(e.target.files ? e.target.files[0] : null)}
                  style={{ width: '100%', padding: '8px', background: '#151821', color: '#f8fafc', border: '1px solid #202534', borderRadius: '5px', fontSize: '12px' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Latitude (°N)</label>
                  <input 
                    type="text" 
                    value={uploadLat} 
                    onChange={(e) => setUploadLat(e.target.value)}
                    style={{ width: '100%', padding: '6px 8px', background: '#151821', color: '#f8fafc', border: '1px solid #202534', borderRadius: '5px', fontSize: '12px' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Longitude (°E)</label>
                  <input 
                    type="text" 
                    value={uploadLon} 
                    onChange={(e) => setUploadLon(e.target.value)}
                    style={{ width: '100%', padding: '6px 8px', background: '#151821', color: '#f8fafc', border: '1px solid #202534', borderRadius: '5px', fontSize: '12px' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Scene Title</label>
                <input 
                  type="text" 
                  value={uploadName} 
                  onChange={(e) => setUploadName(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', background: '#151821', color: '#f8fafc', border: '1px solid #202534', borderRadius: '5px', fontSize: '12px' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button 
                  type="button" 
                  onClick={() => setShowUploadModal(false)}
                  style={{ padding: '7px 14px', background: '#151821', color: '#94a3b8', border: '1px solid #202534', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={uploading}
                  style={{ padding: '7px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '5px', fontSize: '12px', fontWeight: '600', cursor: uploading ? 'not-allowed' : 'pointer' }}
                >
                  {uploading ? 'Executing Model Inference...' : 'Run Inference Pipeline'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
