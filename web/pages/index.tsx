import React, { useState, useEffect, useRef } from 'react';
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
  EyeOff, 
  Search, 
  Filter, 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Clock, 
  ShieldCheck, 
  User, 
  FileText,
  Move
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
    crs?: string;
  };
  geodesy?: {
    pixel_area_m2: number;
    max_sector_ha: number;
    footprint_km2: number;
  };
  valid_coverage_pct: number;
  total_candidate_water_ha: number;
  total_permanent_water_ha: number;
  total_disagreement_ha: number;
  baseline_status?: string;
  img_sar_b64: string;
  img_cand_water_b64: string;
  img_disagreement_b64: string;
  sectors: Sector[];
  timings?: {
    feature_extraction_ms?: number;
    model_prediction_ms?: number;
    rendering_ms?: number;
    total_pipeline_ms?: number;
  };
}

export default function SatelliteWorkspace() {
  const [scenes, setScenes] = useState<Record<string, Scene>>({});
  const [selectedKey, setSelectedKey] = useState<string>('India_591317');
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Map layer controls
  const [radarOpacity, setRadarOpacity] = useState<number>(85);
  const [predictionOpacity, setPredictionOpacity] = useState<number>(65);
  const [showPermanentWater, setShowPermanentWater] = useState<boolean>(true);
  const [showDisagreement, setShowDisagreement] = useState<boolean>(false);
  const [showAllSectors, setShowAllSectors] = useState<boolean>(false);
  const [showPlaceLabels, setShowPlaceLabels] = useState<boolean>(true);
  const [selectedSector, setSelectedSector] = useState<string>('SEC_34');
  const [showLayersDropdown, setShowLayersDropdown] = useState<boolean>(false);

  // Pan & Zoom state
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Queue search & filter
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');

  // Task form state
  const [assignedCrew, setAssignedCrew] = useState<string>('Brahmaputra Verification Team Alpha');
  const [taskStatus, setTaskStatus] = useState<string>('assigned');
  const [taskNotes, setTaskNotes] = useState<string>('');
  const [taskEvidence, setTaskEvidence] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [cloudSynced, setCloudSynced] = useState<boolean>(true);

  // Technical details drawer & upload modal
  const [showTechDetails, setShowTechDetails] = useState<boolean>(false);
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState<string>('Uploaded Sentinel-1 SAR Scene');
  const [uploading, setUploading] = useState<boolean>(false);

  // Viewport container sizing
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({ width: 620, height: 620 });

  // Initial load
  useEffect(() => {
    loadScenes();
    loadTasks();
  }, []);

  // Responsive ResizeObserver for canvas
  useEffect(() => {
    if (!canvasContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          const dim = Math.min(width - 32, height - 32);
          setCanvasSize({ width: Math.max(dim, 380), height: Math.max(dim, 380) });
        }
      }
    });
    observer.observe(canvasContainerRef.current);
    return () => observer.disconnect();
  }, [loading]);

  // Sync task form fields whenever selected sector or chip changes
  useEffect(() => {
    const existing = tasks.find((t) => t.chip_id === selectedKey && t.sector_id === selectedSector);
    if (existing) {
      setAssignedCrew(existing.assigned_team || 'Brahmaputra Verification Team Alpha');
      setTaskStatus(existing.status || 'assigned');
      setTaskNotes(existing.notes || '');
      setTaskEvidence(existing.evidence || '');
    } else {
      setAssignedCrew('Brahmaputra Verification Team Alpha');
      setTaskStatus('assigned');
      setTaskNotes('Candidate surface water observed outside permanent channel. Scheduled for verification.');
      setTaskEvidence('');
    }
    setSaveFeedback(null);
  }, [selectedSector, selectedKey, tasks]);

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
      .then((data) => {
        if (Array.isArray(data)) {
          setTasks(data);
        } else if (data.all_tasks) {
          setTasks(data.all_tasks);
        }
      })
      .catch((err) => console.error(err));
  };

  // Pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPanOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleResetView = () => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  };

  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveFeedback(null);

    const payload = {
      chip_id: selectedKey,
      sector_id: selectedSector,
      actor: 'Lead Satellite Analyst',
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
        setCloudSynced(data.cloud_persisted !== false);
        setSaveFeedback(data.cloud_persisted ? 'Task updated and persisted to S3 live' : 'Task updated locally (S3 pending)');
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
        handleResetView();
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
    downloadAnchor.setAttribute("download", `floodproof_tasks_manifest_${Date.now()}.json`);
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
  const activeSectorTask = tasks.find((t) => t.chip_id === selectedKey && t.sector_id === selectedSector);

  // Sector row and column calculation
  const secRow = activeSectorData ? Math.floor(activeSectorData.r / 64) : 0;
  const secCol = activeSectorData ? Math.floor(activeSectorData.c / 64) : 0;

  // Dynamic geodetic values from scene
  const pixelAreaM2 = current.geodesy?.pixel_area_m2 || 89.05;
  const maxSectorHa = current.geodesy?.max_sector_ha || 36.47;
  const footprintKm2 = current.geodesy?.footprint_km2 || 23.34;

  // Filtered queue
  const filteredSectors = current.sectors.filter((sec) => {
    const matchesSearch = sec.id.toLowerCase().includes(searchQuery.toLowerCase());
    if (filterSeverity === 'large') return matchesSearch && sec.candidate_water_ha > 15;
    if (filterSeverity === 'moderate') return matchesSearch && sec.candidate_water_ha > 5 && sec.candidate_water_ha <= 15;
    if (filterSeverity === 'conflict') return matchesSearch && sec.disagreement_ha > 4;
    return matchesSearch;
  });

  const isIndia = selectedKey.startsWith('India');

  return (
    <div style={{ minHeight: '100vh', width: '100%', background: '#090a0d', color: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
      <Head>
        <title>FloodProof | Satellite Analysis Workspace</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      {/* ================= 1. RESTRAINED WORKSPACE HEADER ================= */}
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
                handleResetView();
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
              Historical Analysis: {meta.date}
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
            <span style={{ height: '7px', width: '7px', borderRadius: '50%', background: cloudSynced ? '#10b981' : '#f59e0b', display: 'inline-block' }}></span>
            <span>{cloudSynced ? 'S3 Synced' : 'Sync Pending'}</span>
          </div>
        </div>
      </header>

      {/* ================= 2. MAIN WORKSPACE ================= */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 440px', height: 'calc(100vh - 56px)', overflow: 'hidden' }}>
        
        {/* ================= LEFT 2/3: FULL GEOGRAPHIC CANVAS ================= */}
        <div 
          ref={canvasContainerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ 
            background: '#07080b', 
            position: 'relative', 
            display: 'flex', 
            flexDirection: 'column', 
            borderRight: '1px solid #1e2433',
            overflow: 'hidden',
            cursor: isDragging ? 'grabbing' : 'grab'
          }}
        >
          {/* Top Left: Compact Layers Control Panel */}
          <div style={{ 
            position: 'absolute', 
            top: '16px', 
            left: '20px', 
            zIndex: 30, 
            display: 'flex', 
            flexDirection: 'column',
            gap: '8px'
          }}>
            {/* Primary Toggle Pill */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '12px', 
              background: 'rgba(15, 18, 26, 0.94)', 
              backdropFilter: 'blur(8px)', 
              border: '1px solid #232a3b', 
              padding: '7px 12px', 
              borderRadius: '8px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)'
            }}>
              <button 
                onClick={() => setShowLayersDropdown(!showLayersDropdown)}
                style={{ 
                  background: 'transparent', 
                  border: 'none', 
                  color: '#f8fafc', 
                  fontSize: '12px', 
                  fontWeight: '600', 
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Layers size={14} color="#60a5fa" />
                <span>Layers & Opacity</span>
                <ChevronDown size={14} color="#94a3b8" />
              </button>

              <div style={{ height: '14px', width: '1px', background: '#232a3b' }}></div>

              {/* Opacity Sliders */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>Radar Base:</span>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={radarOpacity} 
                  onChange={(e) => setRadarOpacity(Number(e.target.value))}
                  style={{ width: '60px', accentColor: '#2563eb', cursor: 'pointer' }}
                />
                <span className="font-mono" style={{ fontSize: '10px', color: '#64748b' }}>{radarOpacity}%</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>Predictions:</span>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={predictionOpacity} 
                  onChange={(e) => setPredictionOpacity(Number(e.target.value))}
                  style={{ width: '60px', accentColor: '#e11d48', cursor: 'pointer' }}
                />
                <span className="font-mono" style={{ fontSize: '10px', color: '#64748b' }}>{predictionOpacity}%</span>
              </div>
            </div>

            {/* Dropdown Menu for Toggles */}
            {showLayersDropdown && (
              <div style={{ 
                background: 'rgba(15, 18, 26, 0.96)', 
                backdropFilter: 'blur(10px)', 
                border: '1px solid #232a3b', 
                borderRadius: '8px', 
                padding: '12px', 
                width: '270px',
                display: 'flex', 
                flexDirection: 'column', 
                gap: '10px',
                boxShadow: '0 6px 20px rgba(0,0,0,0.6)'
              }}>
                <div style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' }}>
                  Overlay Visibility
                </div>

                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: '#e2e8f0', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#0284c7' }}></span>
                    <span>Permanent Baseline</span>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={showPermanentWater} 
                    onChange={(e) => setShowPermanentWater(e.target.checked)}
                    style={{ accentColor: '#0284c7' }}
                  />
                </label>

                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: '#e2e8f0', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#d97706' }}></span>
                    <span>Model Disagreement</span>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={showDisagreement} 
                    onChange={(e) => setShowDisagreement(e.target.checked)}
                    style={{ accentColor: '#d97706' }}
                  />
                </label>

                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: '#e2e8f0', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '2px', border: '1px solid #38bdf8' }}></span>
                    <span>All Sectors Grid</span>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={showAllSectors} 
                    onChange={(e) => setShowAllSectors(e.target.checked)}
                    style={{ accentColor: '#38bdf8' }}
                  />
                </label>

                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: '#e2e8f0', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <MapPin size={12} color="#10b981" />
                    <span>Place Context (OSM)</span>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={showPlaceLabels} 
                    onChange={(e) => setShowPlaceLabels(e.target.checked)}
                    style={{ accentColor: '#10b981' }}
                  />
                </label>
              </div>
            )}
          </div>

          {/* Top Right: Zoom, Pan & Fit Controls */}
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
              onClick={() => setZoomLevel((z) => Math.min(z + 0.25, 2.5))}
              title="Zoom In"
              style={{ background: 'transparent', border: 'none', color: '#94a3b8', padding: '6px', cursor: 'pointer', borderRadius: '4px' }}
            >
              <ZoomIn size={16} />
            </button>
            <button 
              onClick={() => setZoomLevel((z) => Math.max(z - 0.25, 0.75))}
              title="Zoom Out"
              style={{ background: 'transparent', border: 'none', color: '#94a3b8', padding: '6px', cursor: 'pointer', borderRadius: '4px' }}
            >
              <ZoomOut size={16} />
            </button>
            <button 
              onClick={handleResetView}
              title="Fit to Scene & Reset Pan"
              style={{ background: 'transparent', border: 'none', color: '#94a3b8', padding: '6px', cursor: 'pointer', borderRadius: '4px' }}
            >
              <Maximize2 size={16} />
            </button>
          </div>

          {/* Central Geographic Canvas (Auto-Fitting & Pannable) */}
          <div style={{ 
            flex: 1, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            overflow: 'hidden', 
            padding: '16px'
          }}>
            <div style={{ 
              position: 'relative', 
              width: `${canvasSize.width}px`, 
              height: `${canvasSize.height}px`, 
              transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`, 
              transition: isDragging ? 'none' : 'transform 0.15s ease-out',
              borderRadius: '4px',
              overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
              background: '#040507'
            }}>
              
              {/* Layer 1: SAR Base Backscatter (Translucent or Solid based on Slider) */}
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

              {/* Layer 2: Candidate Flood Water Mask (Crimson RGBA, Independent Toggle) */}
              <img 
                src={`data:image/png;base64,${current.img_cand_water_b64}`}
                alt="Candidate Flood Water Mask"
                style={{ 
                  position: 'absolute', 
                  top: 0, 
                  left: 0, 
                  width: '100%', 
                  height: '100%', 
                  objectFit: 'contain', 
                  opacity: predictionOpacity / 100
                }}
              />

              {/* Layer 2B: Permanent Water Baseline (Cyan RGBA, Controlled by showPermanentWater) */}
              {showPermanentWater && current.img_perm_water_b64 && (
                <img 
                  src={`data:image/png;base64,${current.img_perm_water_b64}`}
                  alt="Permanent Water Baseline"
                  style={{ 
                    position: 'absolute', 
                    top: 0, 
                    left: 0, 
                    width: '100%', 
                    height: '100%', 
                    objectFit: 'contain', 
                    opacity: (predictionOpacity / 100) * 0.95
                  }}
                />
              )}

              {/* Layer 3: Model Disagreement Overlay (Conditional) */}
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
                    opacity: (predictionOpacity / 100) * 0.9
                  }}
                />
              )}

              {/* Layer 4: Interactive 8x8 Grid (All Sectors or Just Selected Sector) */}
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
                        border: isSelected 
                          ? '2.5px solid #38bdf8' 
                          : (showAllSectors ? '1px solid rgba(255, 255, 255, 0.08)' : 'none'),
                        background: isSelected 
                          ? 'rgba(56, 189, 248, 0.2)' 
                          : (showAllSectors && secData && secData.candidate_water_ha > 15 
                              ? 'rgba(225, 29, 72, 0.1)' 
                              : 'transparent'),
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'flex-start',
                        padding: '2px 4px',
                        transition: 'all 0.15s'
                      }}
                    >
                      {(showAllSectors || isSelected) && (
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
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Anchored Callout over Selected Sector */}
              {activeSectorData && (
                <div style={{ 
                  position: 'absolute', 
                  top: `${(secRow / 8) * 100 + 4}%`, 
                  left: `${(secCol / 8) * 100 + 4}%`, 
                  zIndex: 25,
                  background: 'rgba(15, 18, 26, 0.92)',
                  backdropFilter: 'blur(6px)',
                  border: '1px solid #38bdf8',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  pointerEvents: 'none',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.6)'
                }}>
                  <div style={{ fontSize: '10px', fontWeight: '700', color: '#38bdf8', fontFamily: 'JetBrains Mono' }}>
                    {selectedSector} (Rank #{activeSectorData.rank})
                  </div>
                  <div style={{ fontSize: '9px', color: '#f43f5e' }}>
                    {activeSectorData.candidate_water_ha} ha candidate water
                  </div>
                </div>
              )}

              {/* Layer 5: Georeferenced OSM Ground Features (Positioned via Actual GeoTIFF Affine Transform) */}
              {showPlaceLabels && (() => {
                const meta = current.metadata;
                const oLon = meta?.origin_lon ?? (meta?.lon ? meta.lon - (256 * 0.0000898315) : null);
                const oLat = meta?.origin_lat ?? (meta?.lat ? meta.lat + (256 * 0.0000898315) : null);
                const rx = meta?.res_deg_x ?? 0.0000898315284;
                const ry = meta?.res_deg_y ?? 0.0000898315284;

                if (!oLon || !oLat) return null;

                // Ground Truth Features from OpenStreetMap
                const groundFeatures = [
                  { name: 'Silghat', type: 'Village', lat: 26.6014498, lon: 92.926113 },
                  { name: 'Panpur', type: 'Village', lat: 26.6776696, lon: 92.9369717 }
                ];

                const rendered = groundFeatures.map((gf) => {
                  const pxX = (gf.lon - oLon) / rx;
                  const pxY = (oLat - gf.lat) / ry;
                  // Only display if genuinely located within this 512x512 raster extent
                  if (pxX >= 0 && pxX <= 512 && pxY >= 0 && pxY <= 512) {
                    const leftPct = (pxX / 512) * 100;
                    const topPct = (pxY / 512) * 100;
                    return (
                      <div 
                        key={gf.name}
                        style={{ 
                          position: 'absolute', 
                          top: `${topPct}%`, 
                          left: `${leftPct}%`, 
                          transform: 'translate(-50%, -100%)',
                          background: 'rgba(15, 18, 26, 0.90)', 
                          border: '1px solid #10b981',
                          padding: '2px 6px', 
                          borderRadius: '3px', 
                          fontSize: '10px', 
                          color: '#e2e8f0',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.7)',
                          pointerEvents: 'none',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }}></span>
                        <span>{gf.name} ({gf.type})</span>
                      </div>
                    );
                  }
                  return null;
                }).filter(Boolean);

                return (
                  <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                    {rendered}
                  </div>
                );
              })()}

            </div>
          </div>

          {/* Bottom Canvas Footer: Persistent Legend & Scene Scale */}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ height: '8px', width: '8px', borderRadius: '2px', background: '#e11d48', display: 'inline-block' }}></span>
                <span>Candidate Water</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ height: '8px', width: '8px', borderRadius: '2px', background: '#0284c7', display: 'inline-block' }}></span>
                <span>Permanent Water Baseline</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ height: '8px', width: '8px', borderRadius: '2px', background: '#d97706', display: 'inline-block' }}></span>
                <span>Model Disagreement</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ height: '8px', width: '8px', borderRadius: '2px', border: '1.5px solid #38bdf8', display: 'inline-block' }}></span>
                <span>Selected: {selectedSector}</span>
              </div>
            </div>

            {/* Coverage & Scale */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#64748b' }}>
              <span>Valid: <strong style={{ color: '#e2e8f0' }}>{current.valid_coverage_pct}%</strong></span>
              <span>•</span>
              <span className="font-mono">Footprint: {footprintKm2} km²</span>
              <span>•</span>
              <span className="font-mono">{pixelAreaM2} m²/px</span>
            </div>
          </div>

        </div>

        {/* ================= RIGHT 1/3: FOCUSED INSPECTION & TASK PANEL ================= */}
        <div style={{ background: '#0f1117', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          
          {/* Section 1: Scene Overview */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e2433' }}>
            <div style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
              Scene Details
            </div>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#f8fafc', marginBottom: '4px' }}>
              {meta.name}
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <MapPin size={13} /> {meta.region} ({meta.lat}°N, {meta.lon}°E)
            </div>

            {/* Stats pills */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '12px' }}>
              <div style={{ background: '#151821', border: '1px solid #202534', borderRadius: '6px', padding: '8px' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>Candidate Water</div>
                <div className="font-mono" style={{ fontSize: '14px', fontWeight: '700', color: '#f43f5e', marginTop: '2px' }}>
                  {current.total_candidate_water_ha} ha
                </div>
              </div>

              <div style={{ background: '#151821', border: '1px solid #202534', borderRadius: '6px', padding: '8px' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>Permanent Base</div>
                <div className="font-mono" style={{ fontSize: '14px', fontWeight: '700', color: '#38bdf8', marginTop: '2px' }}>
                  {current.total_permanent_water_ha} ha
                </div>
              </div>

              <div style={{ background: '#151821', border: '1px solid #202534', borderRadius: '6px', padding: '8px' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>Disagreement</div>
                <div className="font-mono" style={{ fontSize: '14px', fontWeight: '700', color: '#f59e0b', marginTop: '2px' }}>
                  {current.total_disagreement_ha} ha
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Verification Queue with Live Task Status & Reason */}
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
                  onClick={() => setFilterSeverity('large')}
                  style={{ padding: '2px 8px', fontSize: '10px', background: filterSeverity === 'large' ? '#e11d48' : '#151821', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                >
                  Large Area
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

            {/* Queue rows */}
            <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {filteredSectors.slice(0, 10).map((sec) => {
                const isSelected = selectedSector === sec.id;
                const secTask = tasks.find((t) => t.chip_id === selectedKey && t.sector_id === sec.id);

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
                        {secTask && (
                          <span style={{ 
                            fontSize: '9px', 
                            padding: '1px 5px', 
                            borderRadius: '3px',
                            background: secTask.status === 'field_verified' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(37, 99, 235, 0.15)',
                            color: secTask.status === 'field_verified' ? '#10b981' : '#60a5fa'
                          }}>
                            {secTask.status}
                          </span>
                        )}
                        {sec.disagreement_ha > 4 && (
                          <span style={{ fontSize: '9px', background: 'rgba(217, 119, 6, 0.15)', color: '#d97706', padding: '1px 4px', borderRadius: '2px' }}>
                            Conflict
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>
                        {sec.candidate_water_ha > 15 ? 'Large candidate-water area' : 'Moderate candidate-water extent'}
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

          {/* Section 3: Selected Sector Details, Evidence & Assignment */}
          <div style={{ padding: '16px 20px', flex: 1 }}>
            <div style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Selected Sector & Evidence
            </div>

            {/* Summary card */}
            <div style={{ background: '#151821', border: '1px solid #202534', borderRadius: '6px', padding: '10px 12px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="font-mono" style={{ fontSize: '13px', fontWeight: '700', color: '#38bdf8' }}>{selectedSector}</span>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>Rank #{activeSectorData?.rank || '-'}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px', fontSize: '11px' }}>
                <div>Candidate Water: <strong style={{ color: '#f43f5e' }}>{activeSectorData?.candidate_water_ha || 0} ha</strong></div>
                <div>Permanent Water: <strong style={{ color: '#38bdf8' }}>{activeSectorData?.permanent_water_ha || 0} ha</strong></div>
                <div>Model Disagreement: <strong style={{ color: '#f59e0b' }}>{activeSectorData?.disagreement_ha || 0} ha</strong></div>
                <div>Sector Extent: <strong style={{ color: '#94a3b8' }}>{activeSectorData?.valid_ha || maxSectorHa} ha</strong></div>
              </div>
              <div style={{ marginTop: '8px', fontSize: '10px', color: '#64748b', borderTop: '1px solid #1e2433', paddingTop: '6px' }}>
                Verification Reason: {activeSectorData && activeSectorData.candidate_water_ha > 15 ? 'High surface water detected outside permanent channel requiring inspection.' : 'Standard sector inspection.'}
              </div>
            </div>

            {/* Task Form */}
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

          {/* Section 4: Expandable Technical Geodesy & Metrics */}
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
                <div>• Coordinate Reference System: <strong>{meta.crs || 'EPSG:4326 (WGS84)'}</strong></div>
                <div>• Scene Center: <strong>{meta.lat}°N, {meta.lon}°E</strong></div>
                <div>• Calculated Pixel Scale: <strong>{pixelAreaM2} m²/px</strong></div>
                <div>• Sector Capacity Invariant: <strong>≤ {maxSectorHa} ha</strong></div>
                <div>• Permanent Baseline Status: <strong>{current.baseline_status || 'JRC Global Water'}</strong></div>
                <div>• Model Architecture: <strong>XGBoost Gradient Boosted Trees (v1.2)</strong></div>
                <div>• Pipeline Latency: <strong>{current.timings?.total_pipeline_ms || 1500} ms</strong></div>
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
              Upload a 2-band [VV, VH] SAR GRD GeoTIFF. Geographic coordinates, scale, and CRS will be automatically extracted from TIFF georeference tags.
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

              <div>
                <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Scene Title / AO Name</label>
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
                  {uploading ? 'Executing Shared Pipeline...' : 'Run Inference Pipeline'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
