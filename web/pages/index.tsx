import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { 
  Radar, 
  Layers, 
  MapPin, 
  Calendar, 
  Cpu, 
  AlertTriangle, 
  Droplets, 
  CheckCircle2, 
  Cloud, 
  Send, 
  History, 
  Maximize2, 
  ShieldAlert, 
  Radio, 
  Eye, 
  Activity, 
  Database,
  Crosshair,
  Sliders,
  TrendingUp,
  Clock,
  Compass,
  FileText,
  Search,
  Filter,
  ArrowUpRight,
  ShieldCheck,
  Check,
  X,
  Play,
  UploadCloud,
  Download,
  AlertCircle
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

export default function FloodProofConsole() {
  const [scenes, setScenes] = useState<Record<string, Scene>>({});
  const [selectedKey, setSelectedKey] = useState<string>('India_591317');
  const [activeLayer, setActiveLayer] = useState<'cand_water' | 'disagreement' | 'sar'>('cand_water');
  const [activeTab, setActiveTab] = useState<'triage' | 'intel' | 'audit' | 'upload'>('triage');
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Task creation state
  const [selectedSector, setSelectedSector] = useState<string>('SEC_34');
  const [assignedCrew, setAssignedCrew] = useState<string>('Brahmaputra Disaster Response Unit 1');
  const [taskStatus, setTaskStatus] = useState<string>('assigned');
  const [taskNotes, setTaskNotes] = useState<string>('Candidate water observed outside permanent levee. Dispatched for embankment integrity verification.');
  const [taskEvidence, setTaskEvidence] = useState<string>('Drone imagery capture ref #DR-2016-08, GPS tag verified at embankment breach point.');
  const [syncStatus, setSyncStatus] = useState<string>('S3 Connected');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLat, setUploadLat] = useState<string>('26.63');
  const [uploadLon, setUploadLon] = useState<string>('92.91');
  const [uploadName, setUploadName] = useState<string>('Uploaded Sentinel-1 Test Scene');
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

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
    setErrorMessage(null);
    setSyncStatus('Syncing S3...');

    const payload = {
      task_id: `TASK_${selectedKey}_${selectedSector}`,
      chip_id: selectedKey,
      sector_id: selectedSector,
      actor: 'Console Lead Operator',
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

      if (res.ok) {
        setSyncStatus('Synced to AWS S3 (Live)');
        loadTasks();
      } else {
        setSyncStatus('Save Rejected');
        setErrorMessage(data.error || 'Task persistence error.');
      }
    } catch {
      setSyncStatus('Network Error');
      setErrorMessage('Could not reach backend API endpoint.');
    }
  };

  const handleUploadInference = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      alert("Please select a valid Sentinel-1 GeoTIFF file (.tif)");
      return;
    }

    setUploading(true);
    setUploadSuccess(null);
    setErrorMessage(null);

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
        setUploadSuccess(`Inference Completed! Total Latency: ${data.metrics?.total_latency_ms}ms (Warm ML: ${data.metrics?.warm_prediction_ms}ms)`);
        loadScenes();
        setSelectedKey(data.metadata.id);
        setActiveTab('triage');
      } else {
        setErrorMessage(data.error + (data.details ? `: ${data.details}` : ''));
      }
    } catch (err: any) {
      setUploading(false);
      setErrorMessage("Network error during inference upload: " + err.message);
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
      <div style={{ display: 'flex', height: '100vh', width: '100%', alignItems: 'center', justifyContent: 'center', background: '#040507', color: '#fff' }}>
        <div style={{ textAlign: 'center' }}>
          <Radar className="animate-spin" size={48} color="#00f0ff" style={{ margin: '0 auto 16px' }} />
          <div style={{ fontSize: '16px', fontWeight: '700', letterSpacing: '0.05em', fontFamily: 'JetBrains Mono' }}>
            FLOODPROOF // OPERATOR CONSOLE
          </div>
          <div style={{ fontSize: '12px', color: '#8b92a5', marginTop: '6px' }}>Connecting to AWS S3 & Geodetic Surface Rasters</div>
        </div>
      </div>
    );
  }

  const current = scenes[selectedKey];
  const meta = current.metadata;
  const activeSectorData = current.sectors.find((s) => s.id === selectedSector);

  // Dynamic geodetic metrics for current scene
  const latVal = meta.lat || 26.63;
  // Compute pixel area
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
  const dynPixelAreaM2 = (dy * dx).toFixed(2);
  const dynMaxSectorHa = ((64 * 64 * (dy * dx)) / 10000.0).toFixed(2);

  return (
    <div style={{ minHeight: '100vh', width: '100%', background: '#040507', color: '#f1f3f9', display: 'flex', flexDirection: 'column' }}>
      <Head>
        <title>FloodProof // Satellite Radar Verification Console</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </Head>

      {/* Main Tactical Navbar */}
      <header style={{ 
        height: '56px', 
        borderBottom: '1px solid #1c202d', 
        padding: '0 20px', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        background: '#090a0f'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Radar size={22} color="#00f0ff" strokeWidth={2.5} />
            <span style={{ fontSize: '16px', fontWeight: '800', letterSpacing: '-0.01em', color: '#fff' }}>FLOODPROOF</span>
          </div>

          {/* Quick Filter Tags / Tabs */}
          <div style={{ display: 'flex', gap: '4px', marginLeft: '24px' }}>
            <button 
              onClick={() => setActiveTab('triage')}
              style={{ 
                padding: '6px 14px', 
                fontSize: '12px', 
                fontWeight: '600', 
                background: activeTab === 'triage' ? '#171b26' : 'transparent', 
                color: activeTab === 'triage' ? '#00f0ff' : '#8b92a5',
                border: activeTab === 'triage' ? '1px solid #2d3345' : 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <Crosshair size={13} />
              Sectors Triage
            </button>
            <button 
              onClick={() => setActiveTab('intel')}
              style={{ 
                padding: '6px 14px', 
                fontSize: '12px', 
                fontWeight: '600', 
                background: activeTab === 'intel' ? '#171b26' : 'transparent', 
                color: activeTab === 'intel' ? '#00f0ff' : '#8b92a5',
                border: activeTab === 'intel' ? '1px solid #2d3345' : 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <Sliders size={13} />
              Geodesy Telemetry
            </button>
            <button 
              onClick={() => setActiveTab('audit')}
              style={{ 
                padding: '6px 14px', 
                fontSize: '12px', 
                fontWeight: '600', 
                background: activeTab === 'audit' ? '#171b26' : 'transparent', 
                color: activeTab === 'audit' ? '#00f0ff' : '#8b92a5',
                border: activeTab === 'audit' ? '1px solid #2d3345' : 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <History size={13} />
              Cloud Tasks Audit ({tasks.length})
            </button>
            <button 
              onClick={() => setActiveTab('upload')}
              style={{ 
                padding: '6px 14px', 
                fontSize: '12px', 
                fontWeight: '600', 
                background: activeTab === 'upload' ? 'rgba(0, 240, 255, 0.15)' : 'transparent', 
                color: activeTab === 'upload' ? '#00f0ff' : '#8b92a5',
                border: activeTab === 'upload' ? '1px solid #00f0ff' : 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <UploadCloud size={13} />
              Live Inference Upload
            </button>
          </div>
        </div>

        {/* Right Status Indicators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#0e1118', border: '1px solid #1c202d', padding: '5px 12px', borderRadius: '6px', fontSize: '11px' }}>
            <Cloud size={13} color="#3b82f6" />
            <span style={{ color: '#8b92a5' }}>S3 Bucket:</span>
            <span className="font-mono" style={{ color: '#00f0ff' }}>floodproof-artifacts-699158992887</span>
            <span style={{ height: '6px', width: '6px', borderRadius: '50%', background: '#00e699', boxShadow: '0 0 6px #00e699' }}></span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#0e1118', border: '1px solid #1c202d', padding: '5px 12px', borderRadius: '6px', fontSize: '11px', color: '#8b92a5' }}>
            <Radio size={13} color="#00e699" />
            <span>Ellipsoid Scale: <strong style={{ color: '#f1f3f9' }}>{dynPixelAreaM2} m²/px ({dynMaxSectorHa} ha/sec)</strong></span>
          </div>
        </div>
      </header>

      {/* Error banner if validation fails */}
      {errorMessage && (
        <div style={{ background: '#7f1d1d', borderBottom: '1px solid #b91c1c', color: '#fecaca', padding: '10px 24px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Upload success notification */}
      {uploadSuccess && (
        <div style={{ background: '#064e3b', borderBottom: '1px solid #059669', color: '#a7f3d0', padding: '10px 24px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle2 size={16} />
            <span>{uploadSuccess}</span>
          </div>
          <button onClick={() => setUploadSuccess(null)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Main Workspace (3 Column Tactical Canvas) */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '310px 1fr 360px', height: 'calc(100vh - 80px)', overflow: 'hidden' }}>
        
        {/* ================= COLUMN 1: LEFT INTEL & SCENE DRAWER ================= */}
        <div style={{ background: '#090a0f', borderRight: '1px solid #1c202d', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          
          {/* Section: Situation & Scene Selector */}
          <div style={{ padding: '16px', borderBottom: '1px solid #1c202d' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', letterSpacing: '0.08em', color: '#8b92a5', textTransform: 'uppercase', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Layers size={13} color="#00f0ff" />
              Target Operational AO
            </div>
            
            <select 
              value={selectedKey} 
              onChange={(e) => {
                setSelectedKey(e.target.value);
                const nextSec = scenes[e.target.value]?.sectors?.[0]?.id || 'SEC_1';
                setSelectedSector(nextSec);
              }}
              style={{ 
                width: '100%', 
                padding: '8px 10px', 
                background: '#12151d', 
                color: '#f1f3f9', 
                border: '1px solid #282f42', 
                borderRadius: '6px', 
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              {Object.keys(scenes).map((k) => (
                <option key={k} value={k}>{scenes[k].metadata.name}</option>
              ))}
            </select>
          </div>

          {/* Section: Situation Overview */}
          <div style={{ padding: '16px', borderBottom: '1px solid #1c202d' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontSize: '11px', fontWeight: '700', letterSpacing: '0.08em', color: '#8b92a5', textTransform: 'uppercase' }}>
                Situation Details
              </span>
              <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 6px', background: 'rgba(255, 51, 102, 0.15)', color: '#ff3366', border: '1px solid rgba(255, 51, 102, 0.3)', borderRadius: '4px' }}>
                HELD-OUT EVALUATION
              </span>
            </div>

            <div style={{ background: '#0e1118', border: '1px solid #1c202d', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '11px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#8b92a5' }}>AO Name:</span>
                <span style={{ fontWeight: '600', color: '#fff' }}>{meta.name}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#8b92a5' }}>Region / Basin:</span>
                <span style={{ color: '#e2e8f0' }}>{meta.region}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#8b92a5' }}>Acquisition Timestamp:</span>
                <span className="font-mono" style={{ color: '#ffaa00' }}>{meta.date}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#8b92a5' }}>Radar Sensor:</span>
                <span style={{ color: '#38bdf8' }}>{meta.sensor}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#8b92a5' }}>Centroid Coords:</span>
                <span className="font-mono" style={{ color: '#00f0ff' }}>{meta.lat}°N, {meta.lon}°E</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#8b92a5' }}>True Pixel Scale:</span>
                <span className="font-mono" style={{ color: '#a1a1aa' }}>{dynPixelAreaM2} m²/px</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#8b92a5' }}>Max Sector Extent:</span>
                <span className="font-mono" style={{ color: '#a1a1aa' }}>{dynMaxSectorHa} ha</span>
              </div>
            </div>
          </div>

          {/* Section: Inundation Metrics */}
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', letterSpacing: '0.08em', color: '#8b92a5', textTransform: 'uppercase' }}>
              Surface Water Auditing
            </div>

            {/* Candidate Water Metric */}
            <div style={{ background: '#0e1118', border: '1px solid #1c202d', borderRadius: '8px', padding: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', color: '#ff3366', fontWeight: '700', textTransform: 'uppercase' }}>
                  Candidate Water Area
                </span>
                <Droplets size={14} color="#ff3366" />
              </div>
              <div className="font-mono" style={{ fontSize: '22px', fontWeight: '800', color: '#ff3366', marginTop: '4px' }}>
                {current.total_candidate_water_ha} <span style={{ fontSize: '12px', color: '#ff85a1' }}>ha</span>
              </div>
              <div style={{ fontSize: '10px', color: '#555c70', marginTop: '2px' }}>
                Surface water detected outside JRC baseline
              </div>
            </div>

            {/* Permanent Water Baseline */}
            <div style={{ background: '#0e1118', border: '1px solid #1c202d', borderRadius: '8px', padding: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', color: '#00f0ff', fontWeight: '700', textTransform: 'uppercase' }}>
                  Permanent Water Base
                </span>
                <Eye size={14} color="#00f0ff" />
              </div>
              <div className="font-mono" style={{ fontSize: '22px', fontWeight: '800', color: '#00f0ff', marginTop: '4px' }}>
                {current.total_permanent_water_ha} <span style={{ fontSize: '12px', color: '#80f7ff' }}>ha</span>
              </div>
              <div style={{ fontSize: '10px', color: '#555c70', marginTop: '2px' }}>
                Protected river/lake baseline
              </div>
            </div>

            {/* Model Disagreement Conflict */}
            <div style={{ background: '#0e1118', border: '1px solid #1c202d', borderRadius: '8px', padding: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', color: '#ffaa00', fontWeight: '700', textTransform: 'uppercase' }}>
                  Model Conflict Zone
                </span>
                <AlertTriangle size={14} color="#ffaa00" />
              </div>
              <div className="font-mono" style={{ fontSize: '22px', fontWeight: '800', color: '#ffaa00', marginTop: '4px' }}>
                {current.total_disagreement_ha} <span style={{ fontSize: '12px', color: '#ffd280' }}>ha</span>
              </div>
              <div style={{ fontSize: '10px', color: '#555c70', marginTop: '2px' }}>
                XGBoost vs Threshold conflict (Field triage suggested)
              </div>
            </div>
          </div>

        </div>

        {/* ================= COLUMN 2: CENTER MAP CANVAS OR TAB VIEWS ================= */}
        <div style={{ background: '#040507', display: 'flex', flexDirection: 'column', position: 'relative' }}>
          
          {/* TAB 1: TRIAGE / MAP VIEW */}
          {activeTab === 'triage' && (
            <>
              {/* Canvas Floating Top Toolbar */}
              <div style={{ 
                position: 'absolute', 
                top: '16px', 
                left: '20px', 
                right: '20px', 
                zIndex: 20, 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                pointerEvents: 'none'
              }}>
                <div style={{ 
                  display: 'flex', 
                  gap: '4px', 
                  background: 'rgba(9, 10, 15, 0.88)', 
                  backdropFilter: 'blur(12px)', 
                  padding: '4px', 
                  borderRadius: '8px', 
                  border: '1px solid #1c202d',
                  pointerEvents: 'auto',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.6)'
                }}>
                  <button 
                    onClick={() => setActiveLayer('cand_water')}
                    style={{ 
                      padding: '6px 12px', 
                      borderRadius: '6px', 
                      fontSize: '11px', 
                      fontWeight: '700', 
                      border: 'none', 
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: activeLayer === 'cand_water' ? '#ff3366' : 'transparent',
                      color: activeLayer === 'cand_water' ? '#fff' : '#8b92a5'
                    }}
                  >
                    <Droplets size={12} />
                    Candidate Flood Overlay
                  </button>
                  <button 
                    onClick={() => setActiveLayer('disagreement')}
                    style={{ 
                      padding: '6px 12px', 
                      borderRadius: '6px', 
                      fontSize: '11px', 
                      fontWeight: '700', 
                      border: 'none', 
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: activeLayer === 'disagreement' ? '#ffaa00' : 'transparent',
                      color: activeLayer === 'disagreement' ? '#000' : '#8b92a5'
                    }}
                  >
                    <AlertTriangle size={12} />
                    Model Disagreement
                  </button>
                  <button 
                    onClick={() => setActiveLayer('sar')}
                    style={{ 
                      padding: '6px 12px', 
                      borderRadius: '6px', 
                      fontSize: '11px', 
                      fontWeight: '700', 
                      border: 'none', 
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: activeLayer === 'sar' ? '#00f0ff' : 'transparent',
                      color: activeLayer === 'sar' ? '#000' : '#8b92a5'
                    }}
                  >
                    <Radio size={12} />
                    Sentinel-1 SAR Backscatter
                  </button>
                </div>

                <div style={{ 
                  background: 'rgba(9, 10, 15, 0.88)', 
                  backdropFilter: 'blur(12px)', 
                  padding: '6px 12px', 
                  borderRadius: '6px', 
                  border: '1px solid #1c202d',
                  fontSize: '11px',
                  color: '#8b92a5',
                  pointerEvents: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <Crosshair size={13} color="#00f0ff" />
                  <span>Selected Sector: <strong className="font-mono" style={{ color: '#00f0ff' }}>{selectedSector}</strong></span>
                  {activeSectorData && (
                    <span className="font-mono" style={{ color: '#ff3366', fontWeight: '700' }}>
                      ({activeSectorData.candidate_water_ha} ha)
                    </span>
                  )}
                </div>
              </div>

              {/* Central Viewer & Canvas */}
              <div style={{ 
                flex: 1, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                padding: '20px', 
                position: 'relative'
              }}>
                <div style={{ 
                  position: 'relative', 
                  padding: '12px', 
                  background: '#07080c', 
                  borderRadius: '8px', 
                  border: '1px solid #1c202d',
                  boxShadow: '0 0 40px rgba(0,0,0,0.8)'
                }}>
                  <div style={{ position: 'absolute', top: '-1px', left: '-1px', width: '12px', height: '12px', borderTop: '2px solid #00f0ff', borderLeft: '2px solid #00f0ff' }}></div>
                  <div style={{ position: 'absolute', top: '-1px', right: '-1px', width: '12px', height: '12px', borderTop: '2px solid #00f0ff', borderRight: '2px solid #00f0ff' }}></div>
                  <div style={{ position: 'absolute', bottom: '-1px', left: '-1px', width: '12px', height: '12px', borderBottom: '2px solid #00f0ff', borderLeft: '2px solid #00f0ff' }}></div>
                  <div style={{ position: 'absolute', bottom: '-1px', right: '-1px', width: '12px', height: '12px', borderBottom: '2px solid #00f0ff', borderRight: '2px solid #00f0ff' }}></div>

                  <img 
                    src={
                      activeLayer === 'cand_water' ? `data:image/png;base64,${current.img_cand_water_b64}` :
                      activeLayer === 'disagreement' ? `data:image/png;base64,${current.img_disagreement_b64}` :
                      `data:image/png;base64,${current.img_sar_b64}`
                    } 
                    alt="SAR Raster"
                    style={{ 
                      width: '440px', 
                      height: '440px', 
                      objectFit: 'contain', 
                      borderRadius: '4px',
                      display: 'block'
                    }}
                  />

                  <div style={{ 
                    position: 'absolute', 
                    bottom: '18px', 
                    right: '18px', 
                    background: 'rgba(0,0,0,0.7)', 
                    padding: '4px 8px', 
                    borderRadius: '4px', 
                    fontSize: '9px', 
                    color: '#8b92a5',
                    fontFamily: 'JetBrains Mono'
                  }}>
                    {meta.id} // 512×512 GRD
                  </div>
                </div>

                {/* Layer Legend Overlay */}
                <div style={{ 
                  position: 'absolute', 
                  bottom: '20px', 
                  left: '24px', 
                  background: 'rgba(9, 10, 15, 0.85)', 
                  border: '1px solid #1c202d', 
                  borderRadius: '8px', 
                  padding: '8px 12px', 
                  fontSize: '11px',
                  display: 'flex',
                  gap: '16px'
                }}>
                  {activeLayer === 'cand_water' && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '8px', height: '8px', background: '#ff3366', borderRadius: '2px' }}></div>
                        <span style={{ color: '#f1f3f9' }}>Red: Candidate Flood Inundation</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '8px', height: '8px', background: '#00f0ff', borderRadius: '2px' }}></div>
                        <span style={{ color: '#f1f3f9' }}>Cyan: Permanent JRC River Baseline</span>
                      </div>
                    </>
                  )}
                  {activeLayer === 'disagreement' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '8px', height: '8px', background: '#ffaa00', borderRadius: '2px' }}></div>
                      <span style={{ color: '#f1f3f9' }}>Amber: Model Disagreement (Field Triage Suggested)</span>
                    </div>
                  )}
                  {activeLayer === 'sar' && (
                    <div style={{ color: '#8b92a5' }}>
                      Backscatter: Red=VV (dB), Green=VH (dB), Blue=VV-VH ratio
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom Mission Bar */}
              <div style={{ 
                height: '75px', 
                background: '#090a0f', 
                borderTop: '1px solid #1c202d', 
                padding: '10px 20px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ height: '36px', width: '36px', borderRadius: '6px', background: '#12151d', border: '1px solid #282f42', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Clock size={16} color="#00f0ff" />
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: '#8b92a5', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Operational Workflow
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#f1f3f9' }}>
                      Candidate Water Detection → Ranking by Area → Field Verification
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ background: '#12151d', border: '1px solid #282f42', padding: '6px 12px', borderRadius: '6px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Check size={12} color="#00e699" />
                    <span>Coverage: {current.valid_coverage_pct}% Valid</span>
                  </div>
                  <div style={{ background: '#12151d', border: '1px solid #282f42', padding: '6px 12px', borderRadius: '6px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Check size={12} color="#00e699" />
                    <span>64 Georeferenced Sectors</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* TAB 2: GEODESY & TELEMETRY AUDIT */}
          {activeTab === 'intel' && (
            <div style={{ padding: '32px', overflowY: 'auto', flex: 1 }}>
              <h2 style={{ fontSize: '18px', fontWeight: '800', marginBottom: '8px', color: '#00f0ff' }}>
                Geodetic Invariants & Mathematical Telemetry
              </h2>
              <p style={{ fontSize: '13px', color: '#8b92a5', marginBottom: '24px' }}>
                Strict ellipsoidal calculation auditing across all evaluated scenes.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                <div style={{ background: '#0e1118', border: '1px solid #1c202d', borderRadius: '8px', padding: '16px' }}>
                  <div style={{ fontSize: '12px', color: '#8b92a5', textTransform: 'uppercase' }}>Active Latitude</div>
                  <div className="font-mono" style={{ fontSize: '20px', fontWeight: '700', color: '#fff', marginTop: '4px' }}>
                    {meta.lat}°N
                  </div>
                  <div style={{ fontSize: '11px', color: '#555c70', marginTop: '4px' }}>WGS84 Reference Ellipsoid</div>
                </div>

                <div style={{ background: '#0e1118', border: '1px solid #1c202d', borderRadius: '8px', padding: '16px' }}>
                  <div style={{ fontSize: '12px', color: '#8b92a5', textTransform: 'uppercase' }}>Computed Pixel Footprint</div>
                  <div className="font-mono" style={{ fontSize: '20px', fontWeight: '700', color: '#00f0ff', marginTop: '4px' }}>
                    {dynPixelAreaM2} m²
                  </div>
                  <div style={{ fontSize: '11px', color: '#555c70', marginTop: '4px' }}>Accounting for meridional & parallel convergence</div>
                </div>

                <div style={{ background: '#0e1118', border: '1px solid #1c202d', borderRadius: '8px', padding: '16px' }}>
                  <div style={{ fontSize: '12px', color: '#8b92a5', textTransform: 'uppercase' }}>Maximum 64×64 Sector Area</div>
                  <div className="font-mono" style={{ fontSize: '20px', fontWeight: '700', color: '#00e699', marginTop: '4px' }}>
                    {dynMaxSectorHa} ha
                  </div>
                  <div style={{ fontSize: '11px', color: '#555c70', marginTop: '4px' }}>Candidate water mathematically capped by sector size</div>
                </div>

                <div style={{ background: '#0e1118', border: '1px solid #1c202d', borderRadius: '8px', padding: '16px' }}>
                  <div style={{ fontSize: '12px', color: '#8b92a5', textTransform: 'uppercase' }}>512×512 Scene Footprint</div>
                  <div className="font-mono" style={{ fontSize: '20px', fontWeight: '700', color: '#ffaa00', marginTop: '4px' }}>
                    {((512 * 512 * parseFloat(dynPixelAreaM2)) / 1000000.0).toFixed(2)} km²
                  </div>
                  <div style={{ fontSize: '11px', color: '#555c70', marginTop: '4px' }}>Calculated from georeferenced raster resolution</div>
                </div>
              </div>

              <div style={{ background: '#0e1118', border: '1px solid #1c202d', borderRadius: '8px', padding: '16px', fontSize: '12px', lineHeight: '1.6', color: '#8b92a5' }}>
                <strong style={{ color: '#fff' }}>OpenStreetMap Infrastructure Context Notice:</strong><br />
                Present-day OSM elements (retrieved 2026-10-09) over historical 2016–2018 radar imagery are contextual approximations of built infrastructure. They provide operator situational awareness but do not constitute forensic proof that the structures existed identically during historical flood crests.
              </div>
            </div>
          )}

          {/* TAB 3: CLOUD AUDIT TRAIL */}
          {activeTab === 'audit' && (
            <div style={{ padding: '32px', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                  <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#00f0ff', margin: 0 }}>
                    AWS S3 Verification Audit Trail
                  </h2>
                  <p style={{ fontSize: '12px', color: '#8b92a5', margin: '4px 0 0' }}>
                    Live synchronization to <code>s3://floodproof-verification-artifacts-699158992887/tasks/</code>
                  </p>
                </div>
                <button 
                  onClick={exportManifest}
                  style={{ 
                    padding: '8px 16px', 
                    background: '#12151d', 
                    color: '#00f0ff', 
                    border: '1px solid #282f42', 
                    borderRadius: '6px', 
                    fontSize: '12px', 
                    fontWeight: '700',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Download size={14} />
                  Export Manifest JSON
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {tasks.map((t: any, i: number) => (
                  <div key={i} style={{ background: '#0e1118', border: '1px solid #1c202d', borderRadius: '8px', padding: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <strong className="font-mono" style={{ color: '#00f0ff', fontSize: '14px' }}>{t.task_id}</strong>
                      <span style={{ 
                        fontSize: '10px', 
                        fontWeight: '700',
                        textTransform: 'uppercase',
                        padding: '3px 8px', 
                        borderRadius: '4px',
                        background: t.status === 'field_verified' ? 'rgba(0, 230, 153, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                        color: t.status === 'field_verified' ? '#00e699' : '#a1a1aa',
                        border: t.status === 'field_verified' ? '1px solid rgba(0, 230, 153, 0.4)' : '1px solid #282f42'
                      }}>
                        {t.status}
                      </span>
                    </div>

                    <div style={{ fontSize: '12px', color: '#8b92a5', marginBottom: '4px' }}>
                      Sector: <strong style={{ color: '#fff' }}>{t.sector_id}</strong> | Crew: <strong style={{ color: '#fff' }}>{t.assigned_team}</strong> | Actor: <strong style={{ color: '#fff' }}>{t.actor || 'System'}</strong>
                    </div>

                    {t.evidence && (
                      <div style={{ fontSize: '11px', color: '#00e699', background: 'rgba(0, 230, 153, 0.08)', padding: '6px 10px', borderRadius: '4px', margin: '8px 0', border: '1px solid rgba(0, 230, 153, 0.2)' }}>
                        <strong>Recorded Evidence:</strong> {t.evidence}
                      </div>
                    )}

                    <div style={{ fontSize: '12px', color: '#e2e8f0', marginTop: '6px' }}>
                      {t.notes}
                    </div>

                    {t.history && t.history.length > 0 && (
                      <div style={{ marginTop: '10px', borderTop: '1px solid #1c202d', paddingTop: '8px', fontSize: '10px', color: '#555c70' }}>
                        Transitions: {t.history.map((h: any, idx: number) => (
                          <span key={idx} style={{ marginRight: '12px' }}>
                            [{h.transition_time.substring(11, 19)}] {h.previous_status} → {h.new_status}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: LIVE INFERENCE UPLOAD */}
          {activeTab === 'upload' && (
            <div style={{ padding: '32px', overflowY: 'auto', flex: 1 }}>
              <h2 style={{ fontSize: '18px', fontWeight: '800', marginBottom: '8px', color: '#00f0ff' }}>
                Upload Sentinel-1 SAR GeoTIFF for Real-Time Inference
              </h2>
              <p style={{ fontSize: '13px', color: '#8b92a5', marginBottom: '24px' }}>
                Validates 2-band [VV, VH] backscatter (dB), executes the trained Python XGBoost pipeline, generates sector rankings, and syncs results to S3.
              </p>

              <form onSubmit={handleUploadInference} style={{ maxWidth: '600px', background: '#0e1118', border: '1px solid #1c202d', borderRadius: '8px', padding: '24px' }}>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '12px', color: '#8b92a5', display: 'block', marginBottom: '6px' }}>Select GeoTIFF (.tif) File</label>
                  <input 
                    type="file" 
                    accept=".tif,.tiff" 
                    onChange={(e) => setUploadFile(e.target.files ? e.target.files[0] : null)}
                    style={{ width: '100%', padding: '10px', background: '#12151d', color: '#fff', border: '1px solid #282f42', borderRadius: '6px', fontSize: '12px' }}
                  />
                  <div style={{ fontSize: '10px', color: '#555c70', marginTop: '4px' }}>Required: 512×512 pixels, 2 bands (VV, VH) in float32 dB</div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                  <div>
                    <label style={{ fontSize: '12px', color: '#8b92a5', display: 'block', marginBottom: '4px' }}>Latitude (°N)</label>
                    <input 
                      type="text" 
                      value={uploadLat} 
                      onChange={(e) => setUploadLat(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', background: '#12151d', color: '#fff', border: '1px solid #282f42', borderRadius: '6px', fontSize: '12px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#8b92a5', display: 'block', marginBottom: '4px' }}>Longitude (°E)</label>
                    <input 
                      type="text" 
                      value={uploadLon} 
                      onChange={(e) => setUploadLon(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', background: '#12151d', color: '#fff', border: '1px solid #282f42', borderRadius: '6px', fontSize: '12px' }}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{ fontSize: '12px', color: '#8b92a5', display: 'block', marginBottom: '4px' }}>Scene Title / AO Name</label>
                  <input 
                    type="text" 
                    value={uploadName} 
                    onChange={(e) => setUploadName(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', background: '#12151d', color: '#fff', border: '1px solid #282f42', borderRadius: '6px', fontSize: '12px' }}
                  />
                </div>

                <button 
                  type="submit" 
                  disabled={uploading}
                  style={{ 
                    width: '100%', 
                    padding: '12px', 
                    background: uploading ? '#2d3345' : 'linear-gradient(135deg, #00f0ff 0%, #0066ff 100%)', 
                    color: uploading ? '#8b92a5' : '#000', 
                    border: 'none', 
                    borderRadius: '6px', 
                    fontWeight: '700', 
                    fontSize: '13px', 
                    cursor: uploading ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                >
                  <Play size={16} />
                  {uploading ? 'Processing Inference Job (Executing XGBoost)...' : 'Upload & Execute Real-Time Inference'}
                </button>
              </form>
            </div>
          )}

        </div>

        {/* ================= COLUMN 3: RIGHT ACTIONABLE DISPATCH & TRIAGE DRAWER ================= */}
        <div style={{ background: '#090a0f', borderLeft: '1px solid #1c202d', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          
          {/* Action Header */}
          <div style={{ padding: '16px', borderBottom: '1px solid #1c202d' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: '800', letterSpacing: '0.04em', textTransform: 'uppercase', color: '#fff' }}>
                Field Dispatch Queue
              </span>
              <span className="font-mono" style={{ fontSize: '10px', color: '#00e699', background: 'rgba(0, 230, 153, 0.1)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(0, 230, 153, 0.2)' }}>
                VERIFICATION PIPELINE
              </span>
            </div>

            {/* Fast Stats Row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '10px' }}>
              <div style={{ background: '#0e1118', border: '1px solid #1c202d', padding: '8px', borderRadius: '6px', textAlign: 'center' }}>
                <div style={{ fontSize: '9px', color: '#8b92a5', textTransform: 'uppercase' }}>Target Sectors</div>
                <div className="font-mono" style={{ fontSize: '14px', fontWeight: '700', color: '#00f0ff' }}>Top 10</div>
              </div>
              <div style={{ background: '#0e1118', border: '1px solid #1c202d', padding: '8px', borderRadius: '6px', textAlign: 'center' }}>
                <div style={{ fontSize: '9px', color: '#8b92a5', textTransform: 'uppercase' }}>Area Capture</div>
                <div className="font-mono" style={{ fontSize: '14px', fontWeight: '700', color: '#ff3366' }}>56.8%</div>
              </div>
              <div style={{ background: '#0e1118', border: '1px solid #1c202d', padding: '8px', borderRadius: '6px', textAlign: 'center' }}>
                <div style={{ fontSize: '9px', color: '#8b92a5', textTransform: 'uppercase' }}>Random Base</div>
                <div className="font-mono" style={{ fontSize: '14px', fontWeight: '700', color: '#8b92a5' }}>15.6%</div>
              </div>
            </div>
          </div>

          {/* Sector Priority Selection List */}
          <div style={{ padding: '16px', borderBottom: '1px solid #1c202d', flex: '1 1 auto' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', letterSpacing: '0.08em', color: '#8b92a5', textTransform: 'uppercase', marginBottom: '10px' }}>
              Top Priority Sectors (Ranked by Water Area)
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
              {current.sectors.slice(0, 8).map((sec) => {
                const isSelected = selectedSector === sec.id;
                return (
                  <div 
                    key={sec.id}
                    onClick={() => setSelectedSector(sec.id)}
                    style={{ 
                      background: isSelected ? '#161d2a' : '#0e1118', 
                      border: isSelected ? '1px solid #00f0ff' : '1px solid #1c202d',
                      borderRadius: '6px', 
                      padding: '10px 12px',
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="font-mono" style={{ fontSize: '11px', fontWeight: '700', color: isSelected ? '#00f0ff' : '#8b92a5' }}>
                          #{sec.rank}
                        </span>
                        <strong className="font-mono" style={{ fontSize: '12px', color: '#fff' }}>{sec.id}</strong>
                      </div>
                      <span className="font-mono" style={{ fontSize: '11px', fontWeight: '700', color: '#ff3366' }}>
                        {sec.candidate_water_ha} ha
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', fontSize: '10px', color: '#8b92a5' }}>
                      <span>Sector Extent: {sec.valid_ha} ha</span>
                      {sec.disagreement_ha > 4.0 ? (
                        <span style={{ color: '#ffaa00', display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <AlertTriangle size={10} /> Disagreement {sec.disagreement_ha} ha
                        </span>
                      ) : (
                        <span style={{ color: '#00e699' }}>Agreement</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Field Dispatch Form */}
          <div style={{ padding: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', letterSpacing: '0.08em', color: '#8b92a5', textTransform: 'uppercase', marginBottom: '12px' }}>
              Assign Ground Team
            </div>

            <form onSubmit={handleSaveTask}>
              <div style={{ marginBottom: '10px' }}>
                <label style={{ fontSize: '10px', color: '#8b92a5', display: 'block', marginBottom: '4px' }}>Target Sector</label>
                <input 
                  type="text" 
                  value={selectedSector} 
                  readOnly 
                  className="font-mono"
                  style={{ width: '100%', padding: '8px 10px', background: '#0e1118', color: '#00f0ff', border: '1px solid #282f42', borderRadius: '6px', fontSize: '12px', fontWeight: '700' }}
                />
              </div>

              <div style={{ marginBottom: '10px' }}>
                <label style={{ fontSize: '10px', color: '#8b92a5', display: 'block', marginBottom: '4px' }}>Assigned Field Unit</label>
                <input 
                  type="text" 
                  value={assignedCrew} 
                  onChange={(e) => setAssignedCrew(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', background: '#12151d', color: '#fff', border: '1px solid #282f42', borderRadius: '6px', fontSize: '12px' }}
                />
              </div>

              <div style={{ marginBottom: '10px' }}>
                <label style={{ fontSize: '10px', color: '#8b92a5', display: 'block', marginBottom: '4px' }}>Lifecycle Status</label>
                <select 
                  value={taskStatus} 
                  onChange={(e) => setTaskStatus(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', background: '#12151d', color: '#fff', border: '1px solid #282f42', borderRadius: '6px', fontSize: '12px' }}
                >
                  <option value="assigned">assigned (Queue for dispatch)</option>
                  <option value="in_progress">in_progress (Field team en route)</option>
                  <option value="operator_reviewed">operator_reviewed (Analyst checked)</option>
                  <option value="field_verified">field_verified (Ground evidence required)</option>
                  <option value="rejected">rejected (Dry / False Alarm)</option>
                  <option value="inconclusive">inconclusive (Access blocked)</option>
                </select>
              </div>

              <div style={{ marginBottom: '10px' }}>
                <label style={{ fontSize: '10px', color: '#8b92a5', display: 'block', marginBottom: '4px' }}>
                  Recorded Ground Evidence (Required for field_verified)
                </label>
                <input 
                  type="text" 
                  value={taskEvidence} 
                  onChange={(e) => setTaskEvidence(e.target.value)}
                  placeholder="e.g. Drone photo #3492, sensor log, or surveyor mark"
                  style={{ width: '100%', padding: '8px 10px', background: '#12151d', color: '#00e699', border: '1px solid #282f42', borderRadius: '6px', fontSize: '11px' }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '10px', color: '#8b92a5', display: 'block', marginBottom: '4px' }}>Field Directives & Operational Notes</label>
                <textarea 
                  rows={2} 
                  value={taskNotes} 
                  onChange={(e) => setTaskNotes(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', background: '#12151d', color: '#fff', border: '1px solid #282f42', borderRadius: '6px', fontSize: '11px', lineHeight: '1.4' }}
                />
              </div>

              <button 
                type="submit" 
                style={{ 
                  width: '100%', 
                  padding: '10px', 
                  background: 'linear-gradient(135deg, #00f0ff 0%, #0066ff 100%)', 
                  color: '#000', 
                  border: 'none', 
                  borderRadius: '6px', 
                  fontWeight: '700', 
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 15px rgba(0, 240, 255, 0.25)'
                }}
              >
                <Cloud size={14} />
                Save Task & Sync to S3
              </button>
            </form>
          </div>

        </div>

      </div>

    </div>
  );
}
