import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import './styles.css';
import RedesignedHomepage from './homepage.jsx';
import {
  PROVINCES,
  DISTRICTS_BY_PROVINCE,
  ALL_DISTRICTS,
  DISTRICT_COORDINATES,
  getDistrictsForProvince,
  getMunicipalitiesForDistrict,
  getWardsForMunicipality,
  getProvinceForDistrict
} from './nepalLocationData.js';

// Fix Leaflet's default marker icon paths in bundled Vite build
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

// ── Utilities ─────────────────────────────────────────────────────────────────
async function request(url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('Service unavailable. Please refresh in a moment.');
  }
  if (!res.ok) {
    const e = new Error(data.error || data.message || 'Request failed.');
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

function fmtDate(v) {
  if (!v) return '';
  return new Date(v).toLocaleString('en-GB', { timeZone: 'Asia/Kathmandu',
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtShort(v) {
  if (!v) return '';
  return new Date(v).toLocaleDateString('en-GB', { timeZone: 'Asia/Kathmandu',
    day: '2-digit', month: 'short', year: 'numeric' });
}

function roleLabel(r) {
  return ({ ADMIN: 'Administrator', RESPONDER: 'Responder', RESIDENT: 'Resident' })[r] || r;
}

const HAZARDS = [
  'Flood', 'Landslide', 'Earthquake', 'Fire', 'Road accident',
  'Severe storm', 'Rising water', 'Land crack', 'Other emergency', 'Other concern'
];

// Kathmandu center default coordinates
const KTM_LAT = 27.7172;
const KTM_LNG = 85.3240;

// Section persistence via localStorage (non-sensitive UI state only)
const VALID_SECTIONS = {
  RESIDENT: ['report', 'my-reports', 'community', 'notifications', 'profile'],
  ADMIN: ['admin-overview', 'admin-reports', 'admin-map', 'admin-orgs', 'admin-users', 'notifications', 'profile'],
  RESPONDER: ['responder', 'community', 'notifications', 'profile'],
};

function getSavedSection(role) {
  try {
    const saved = localStorage.getItem('cdw_section');
    if (!saved) return null;
    const { section, savedRole } = JSON.parse(saved);
    if (savedRole !== role) return null;
    if (!VALID_SECTIONS[role]?.includes(section)) return null;
    return section;
  } catch { return null; }
}

function saveSection(section, role) {
  try { localStorage.setItem('cdw_section', JSON.stringify({ section, savedRole: role })); } catch {}
}

function clearSection() {
  try { localStorage.removeItem('cdw_section'); } catch {}
}

// ── Cascading Nepal Administrative Location Selector ─────────────────────────
// Step 1: Province → Step 2: District (77 districts) → Step 3: Municipality → Step 4: Ward / Area
function NepalLocationSelector({
  province,
  district,
  municipality,
  ward,
  wardOther,
  onProvinceChange,
  onDistrictChange,
  onMunicipalityChange,
  onWardChange,
  onWardOtherChange,
  onDistrictCenterSelected,
  disabled = false,
  required = false
}) {
  const availableDistricts = province ? getDistrictsForProvince(province) : ALL_DISTRICTS.map(d => d.name);
  const availableMunicipalities = district ? getMunicipalitiesForDistrict(district) : [];
  const availableWards = (district && municipality && municipality !== 'Other')
    ? getWardsForMunicipality(district, municipality)
    : [];

  function handleProvinceSelect(e) {
    const val = e.target.value;
    onProvinceChange(val);
    onDistrictChange('');
    onMunicipalityChange('');
    onWardChange('');
    if (onWardOtherChange) onWardOtherChange('');
  }

  function handleDistrictSelect(e) {
    const val = e.target.value;
    onDistrictChange(val);
    if (val && !province) {
      const p = getProvinceForDistrict(val);
      if (p) onProvinceChange(p);
    }
    onMunicipalityChange('');
    onWardChange('');
    if (onWardOtherChange) onWardOtherChange('');
    if (val && DISTRICT_COORDINATES[val] && onDistrictCenterSelected) {
      onDistrictCenterSelected(DISTRICT_COORDINATES[val]);
    }
  }

  function handleMunicipalitySelect(e) {
    const val = e.target.value;
    onMunicipalityChange(val);
    onWardChange('');
    if (onWardOtherChange) onWardOtherChange('');
  }

  function handleWardSelect(e) {
    const val = e.target.value;
    onWardChange(val);
    if (val !== 'Other' && onWardOtherChange) onWardOtherChange('');
  }

  const showOtherField = municipality === 'Other' || ward === 'Other';

  return (
    <div className="nepal-location-cascade">
      <div className="location-steps-grid">
        {/* Step 1: Province */}
        <div className="location-step-field">
          <label className="location-step-label">
            <span className="step-badge">1</span> Province {required && <span className="required">*</span>}
            <select
              className="location-select"
              value={province || ''}
              onChange={handleProvinceSelect}
              disabled={disabled}
              required={required}
              aria-label="Select Province"
            >
              <option value="">— Select Province (7 Provinces) —</option>
              {PROVINCES.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Step 2: District */}
        <div className="location-step-field">
          <label className="location-step-label">
            <span className="step-badge">2</span> District {required && <span className="required">*</span>}
            <select
              className="location-select"
              value={district || ''}
              onChange={handleDistrictSelect}
              disabled={disabled}
              required={required}
              aria-label="Select District"
            >
              <option value="">
                {!province ? '— Select District (All 77 Districts) —' : `— Select District (${availableDistricts.length} in ${province}) —`}
              </option>
              {availableDistricts.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Step 3: Municipality */}
        <div className="location-step-field">
          <label className="location-step-label">
            <span className="step-badge">3</span> Municipality / Local Body {required && <span className="required">*</span>}
            <select
              className="location-select"
              value={municipality || ''}
              onChange={handleMunicipalitySelect}
              disabled={disabled || !district}
              required={required}
              aria-label="Select Municipality or Rural Municipality"
            >
              <option value="">
                {!district ? '— First select a district —' : `— Select Municipality (${availableMunicipalities.length} local levels) —`}
              </option>
              {availableMunicipalities.map(m => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
              <option value="Other">⊕ Other / Not listed</option>
            </select>
          </label>
        </div>

        {/* Step 4: Ward */}
        <div className="location-step-field">
          <label className="location-step-label">
            <span className="step-badge">4</span> Ward / Area
            <select
              className="location-select"
              value={ward || ''}
              onChange={handleWardSelect}
              disabled={disabled || !municipality || municipality === 'Other'}
              aria-label="Select Ward"
            >
              <option value="">
                {!municipality ? '— First select municipality —' : municipality === 'Other' ? '— Specify locality below —' : '— Select Ward —'}
              </option>
              {availableWards.map(w => (
                <option key={w} value={w}>{w}</option>
              ))}
              <option value="Other">⊕ Other / Ward not listed</option>
            </select>
          </label>
        </div>
      </div>

      {/* Other / Specific Locality Name Input */}
      {showOtherField && (
        <div className="location-other-container">
          <label className="location-other-label">
            Specific locality / neighborhood / village name <span className="required">*</span>
            <input
              type="text"
              className="location-other-input"
              value={wardOther || ''}
              onChange={e => onWardOtherChange && onWardOtherChange(e.target.value)}
              placeholder="e.g. Tole name, chowk, landmark, or village area"
              maxLength={120}
              disabled={disabled}
              required={required}
            />
          </label>
          <small className="hint">For rural settlements, unlisted wards, or specific local landmarks.</small>
        </div>
      )}
    </div>
  );
}

// ── Interactive Leaflet Location Picker Map (bundled dependency, no CDN script) ─
function LocationPickerMap({ lat, lng, onLocationSelect, readOnly, centerCoordinates }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState('');

  const initLat = lat || (centerCoordinates?.lat ?? KTM_LAT);
  const initLng = lng || (centerCoordinates?.lng ?? KTM_LNG);

  // Initialize Leaflet map instance cleanly
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;
    try {
      const map = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: true
      }).setView([initLat, initLng], lat ? 15 : 12);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
      }).addTo(map);

      mapInstanceRef.current = map;

      // Initial marker if coordinates already provided
      if (lat && lng) {
        const marker = L.marker([lat, lng], { draggable: !readOnly }).addTo(map);
        markerRef.current = marker;
        if (!readOnly) {
          marker.on('dragend', () => {
            const pos = marker.getLatLng();
            onLocationSelect(pos.lat, pos.lng);
            reverseGeocode(pos.lat, pos.lng);
          });
        }
      }

      if (!readOnly) {
        map.on('click', e => {
          const { lat: clickLat, lng: clickLng } = e.latlng;
          if (markerRef.current) {
            markerRef.current.setLatLng([clickLat, clickLng]);
          } else {
            const marker = L.marker([clickLat, clickLng], { draggable: true }).addTo(map);
            markerRef.current = marker;
            marker.on('dragend', () => {
              const pos = marker.getLatLng();
              onLocationSelect(pos.lat, pos.lng);
              reverseGeocode(pos.lat, pos.lng);
            });
          }
          onLocationSelect(clickLat, clickLng);
          reverseGeocode(clickLat, clickLng);
        });
      }
    } catch (err) {
      console.error('Error initializing map:', err);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
      }
    };
  }, []);

  // Update map view when district center coordinates change
  useEffect(() => {
    if (!mapInstanceRef.current || !centerCoordinates || lat) return;
    mapInstanceRef.current.setView([centerCoordinates.lat, centerCoordinates.lng], 12);
  }, [centerCoordinates?.lat, centerCoordinates?.lng]);

  // Sync marker position when props change externally
  useEffect(() => {
    if (!mapInstanceRef.current || !lat || !lng) return;
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      const marker = L.marker([lat, lng], { draggable: !readOnly }).addTo(mapInstanceRef.current);
      markerRef.current = marker;
      if (!readOnly) {
        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          onLocationSelect(pos.lat, pos.lng);
          reverseGeocode(pos.lat, pos.lng);
        });
      }
    }
  }, [lat, lng]);

  function reverseGeocode(targetLat, targetLng) {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${targetLat}&lon=${targetLng}&format=json&accept-language=en`;
    fetch(url, { headers: { 'Accept-Language': 'en' } })
      .then(r => r.json())
      .then(data => {
        if (data && data.address && onLocationSelect) {
          onLocationSelect(targetLat, targetLng, data);
        }
      })
      .catch(() => {});
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser.');
      return;
    }
    setGeoLoading(true);
    setGeoError('');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        setGeoLoading(false);
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setView([latitude, longitude], 16);
          if (markerRef.current) {
            markerRef.current.setLatLng([latitude, longitude]);
          } else {
            const marker = L.marker([latitude, longitude], { draggable: !readOnly }).addTo(mapInstanceRef.current);
            markerRef.current = marker;
            if (!readOnly) {
              marker.on('dragend', () => {
                const p = marker.getLatLng();
                onLocationSelect(p.lat, p.lng);
                reverseGeocode(p.lat, p.lng);
              });
            }
          }
          onLocationSelect(latitude, longitude);
          reverseGeocode(latitude, longitude);
        }
      },
      err => {
        setGeoLoading(false);
        setGeoError(`Could not retrieve location: ${err.message}`);
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  }

  return (
    <div className="map-picker-wrapper">
      {geoError && <p className="map-error-note">{geoError}</p>}
      <div className="map-picker-container ready">
        <div ref={mapRef} className="map-picker-leaflet" style={{ height: '300px', width: '100%' }} />
      </div>
      {!readOnly && (
        <div className="map-picker-controls">
          <button type="button" className="btn-locate" onClick={useCurrentLocation} disabled={geoLoading}>
            {geoLoading ? <><Spinner /> Locating…</> : '📍 Use my location'}
          </button>
          <small className="hint map-hint">Click anywhere on the map or drag the pin to set precise disaster coordinates.</small>
        </div>
      )}
      {readOnly && lat && lng && (
        <div className="map-picker-controls">
          <small className="hint">Saved coordinates: {Number(lat).toFixed(5)}, {Number(lng).toFixed(5)}</small>
        </div>
      )}
    </div>
  );
}

// ── Extract address suggestion from Nominatim reverse geocode result ─────────
function extractAddressSuggestion(nominatimData) {
  if (!nominatimData || !nominatimData.address) return null;
  const addr = nominatimData.address;
  const locality = addr.suburb || addr.neighbourhood || addr.quarter || addr.hamlet || addr.village || addr.town || addr.city_district || '';
  const district = addr.county || addr.district || '';
  const municipality = addr.city || addr.town || addr.municipality || '';
  const state = addr.state || '';
  const displayName = nominatimData.display_name ? nominatimData.display_name.split(',').slice(0, 3).join(', ') : '';
  return { locality, district, municipality, state, displayName };
}

// ── Shared UI Atoms ───────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  return <span className={`status status-${(status||'').toLowerCase()}`} aria-label={`Status: ${status}`}>{status}</span>;
}

function SeverityBadge({ severity }) {
  const s = severity || 'Medium';
  return <span className={`severity severity-${s.toLowerCase()}`}>{s}</span>;
}

function Spinner() {
  return <span className="spinner" aria-hidden="true"/>;
}

function EmptyState({ icon='📭', title, body }) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      {body && <p>{body}</p>}
    </div>
  );
}

function Toast({ error, message }) {
  if (!error && !message) return null;
  return (
    <>
      {error && <p className="toast toast-error" role="alert">{error}</p>}
      {message && <p className="toast toast-success" role="status">{message}</p>}
    </>
  );
}

function AIBadge({ status, label }) {
  const cls = {
    Completed: 'ai-badge-ok',
    Pending: 'ai-badge-pending',
    Processing: 'ai-badge-pending',
    Failed: 'ai-badge-fail',
    unavailable: 'ai-badge-na',
  }[status] || 'ai-badge-na';
  return <span className={`ai-badge ${cls}`} title={label}>{label || 'AI check unavailable'}</span>;
}

function ViewLocationLink({ lat, lng, address }) {
  if (lat != null && lng != null) {
    const url = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="view-location-link">
        🗺 View location
      </a>
    );
  }
  if (address) {
    const q = encodeURIComponent(address);
    return (
      <a href={`https://www.openstreetmap.org/search?query=${q}`} target="_blank" rel="noopener noreferrer" className="view-location-link">
        🔍 Search address
      </a>
    );
  }
  return <span className="hint">No location recorded</span>;
}

// ── Auth Form ─────────────────────────────────────────────────────────────────
function AuthForm({ onAuthenticated, busy, initialMode = 'login', onClose }) {
  const [register, setRegister] = useState(initialMode === 'register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setRegister(initialMode === 'register');
    setFormError('');
    setConflict(false);
  }, [initialMode]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting || busy) return;
    setFormError('');
    setConflict(false);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setFormError('Please enter a valid email address.');
      return;
    }

    if (register) {
      if (!name.trim()) {
        setFormError('Please enter your full name.');
        return;
      }
      if (password.length < 12) {
        setFormError('Password must be at least 12 characters long.');
        return;
      }
    } else {
      if (!password) {
        setFormError('Please enter your password.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const endpoint = register ? '/api/auth/register' : '/api/auth/login';
      const payload = register
        ? { name: name.trim(), email: trimmedEmail, password }
        : { email: trimmedEmail, password };
      const user = await request(endpoint, 'POST', payload);
      onAuthenticated(user);
    } catch (err) {
      if (err.status === 409) {
        setConflict(true);
        setFormError('An account with this email already exists.');
      } else if (err.status === 401) {
        setFormError('Email or password is incorrect.');
      } else {
        setFormError(err.message || 'Authentication failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function toggleMode() {
    setRegister(r => !r);
    setFormError('');
    setConflict(false);
  }

  const isWorking = submitting || busy;

  return (
    <section className="auth-panel panel">
      <div className="auth-header">
        <span className="brand-mark-lg" aria-hidden="true">CDW</span>
        <p className="eyebrow">COMMUNITY DISASTER WATCH</p>
        <h2>{register ? 'Create your account' : 'Sign in to your account'}</h2>
        <p className="hint">
          {register
            ? 'New accounts have resident access. Privileged roles are assigned by an administrator.'
            : 'Sign in to submit incident reports and receive community notifications.'}
        </p>
      </div>

      {formError && (
        <div className="auth-alert auth-alert-error" role="alert">
          {conflict ? (
            <div className="auth-conflict">
              <span>{formError}</span>
              <button type="button" className="auth-switch-btn" onClick={() => { setRegister(false); setFormError(''); setConflict(false); }}>
                Sign in with this email instead →
              </button>
            </div>
          ) : (
            formError
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        {register && (
          <label>
            Full name
            <input
              name="name"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              maxLength={80}
              autoComplete="name"
              placeholder="e.g. Ramesh Sharma"
              disabled={isWorking}
            />
          </label>
        )}
        <label>
          Email address
          <input
            name="email"
            type="email"
            value={email}
            onChange={e => {
              setEmail(e.target.value);
              if (conflict) setConflict(false);
            }}
            required
            maxLength={254}
            autoComplete="username"
            placeholder="your@email.com"
            disabled={isWorking}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={register ? 12 : undefined}
            maxLength={128}
            autoComplete={register ? 'new-password' : 'current-password'}
            placeholder={register ? 'At least 12 characters' : 'Your password'}
            disabled={isWorking}
          />
        </label>
        <button className="primary" disabled={isWorking} type="submit" style={{ width: '100%' }}>
          {isWorking ? <><Spinner/> Please wait...</> : register ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <button className="text-button" type="button" disabled={isWorking} onClick={toggleMode} style={{ width: '100%', marginTop: '12px' }}>
        {register ? 'Already registered? Sign in' : 'New here? Create a resident account'}
      </button>
    </section>
  );
}

// ── Report Submission Form (All 77 Districts Cascading Selector) ──────────────
function ReportForm({ areas, run, busy, onSubmitted }) {
  const [photo, setPhoto] = useState('');
  const [photoErr, setPhotoErr] = useState('');
  const [reading, setReading] = useState(false);
  const [done, setDone] = useState(false);

  // Cascading location state
  const [province, setProvince] = useState('');
  const [district, setDistrict] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [ward, setWard] = useState('');
  const [wardOther, setWardOther] = useState('');
  const [locality, setLocality] = useState('');
  const [districtCenter, setDistrictCenter] = useState(null);

  // Coordinates
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [addressSuggestion, setAddressSuggestion] = useState('');
  const [addressConfirmed, setAddressConfirmed] = useState(false);
  const [formErr, setFormErr] = useState('');

  // Default incidentAt to now in Nepal time
  function nowNepalDatetimeLocal() {
    const now = new Date();
    const npOffset = 5 * 60 + 45;
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const npTime = new Date(utc + npOffset * 60000);
    const pad = n => String(n).padStart(2, '0');
    return `${npTime.getFullYear()}-${pad(npTime.getMonth()+1)}-${pad(npTime.getDate())}T${pad(npTime.getHours())}:${pad(npTime.getMinutes())}`;
  }
  const [incidentAt, setIncidentAt] = useState(nowNepalDatetimeLocal());

  function choosePhoto(e) {
    setPhoto(''); setPhotoErr('');
    const file = e.target.files[0];
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 3145728) {
      setPhotoErr('Choose a JPEG, PNG or WebP photo up to 3 MB.'); e.target.value = ''; return;
    }
    setReading(true);
    const r = new FileReader();
    r.onload = () => { setPhoto(r.result); setReading(false); };
    r.onerror = () => { setPhotoErr('Photo could not be read.'); setReading(false); };
    r.readAsDataURL(file);
  }

  function handleLocationSelect(newLat, newLng, nominatimData) {
    setLat(newLat.toFixed(6));
    setLng(newLng.toFixed(6));
    if (nominatimData) {
      const sug = extractAddressSuggestion(nominatimData);
      if (sug) {
        setAddressSuggestion(sug.displayName);
        setAddressConfirmed(false);
        if (!locality && sug.locality) setLocality(sug.locality);
        if (!district && sug.district) {
          // Attempt matching district to one of the 77 districts
          const matchedDist = ALL_DISTRICTS.find(d => d.name.toLowerCase() === sug.district.toLowerCase());
          if (matchedDist) {
            setDistrict(matchedDist.name);
            setProvince(matchedDist.province);
          }
        }
        if (!municipality && sug.municipality) setMunicipality(sug.municipality);
      }
    }
  }

  function acceptSuggestion() {
    setAddressConfirmed(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormErr('');
    if (!photo) { setFormErr('Select a photo before submitting.'); return; }
    if ((municipality === 'Other' || ward === 'Other') && !wardOther.trim()) {
      setFormErr('Please specify the area/locality name.');
      return;
    }

    // Resolve an areaId for backward compatibility
    let chosenAreaId = '';
    if (areas && areas.length > 0) {
      const match = district ? areas.find(a => a.name.toLowerCase().includes(district.toLowerCase())) : null;
      chosenAreaId = match ? match.id : areas[0].id;
    }

    const body = {
      hazard: e.currentTarget.hazard.value,
      severity: e.currentTarget.severity.value,
      areaId: chosenAreaId,
      description: e.currentTarget.description.value,
      province: province || undefined,
      district: district || undefined,
      municipality: municipality || undefined,
      ward: ward || undefined,
      wardOther: wardOther || undefined,
      locality: locality || (wardOther ? wardOther : undefined),
      latitude: lat ? parseFloat(lat) : undefined,
      longitude: lng ? parseFloat(lng) : undefined,
      incidentAt: incidentAt || undefined,
      photo,
    };

    run(async () => {
      await request('/api/reports', 'POST', body);
      e.currentTarget.reset();
      setPhoto(''); setProvince(''); setDistrict(''); setMunicipality('');
      setWard(''); setWardOther(''); setLocality('');
      setLat(''); setLng('');
      setAddressSuggestion(''); setAddressConfirmed(false);
      setIncidentAt(nowNepalDatetimeLocal());
      setDone(true);
      await onSubmitted();
    });
  }

  if (done) return (
    <div className="submit-success panel">
      <span className="success-icon" aria-hidden="true">✓</span>
      <h2>Report submitted successfully</h2>
      <p>Your observation is recorded in the nationwide disaster management database and operational reviewers have been notified.</p>
      <p className="hint ai-note">ℹ️ Automated weather context analysis has been queued in the background.</p>
      <button className="primary" onClick={() => setDone(false)}>Submit another report</button>
    </div>
  );

  return (
    <div className="layout">
      <form className="panel" onSubmit={handleSubmit}>
        <p className="eyebrow">NEW OBSERVATION</p>
        <h2>Submit an incident report</h2>

        {formErr && <p className="toast toast-error" role="alert">{formErr}</p>}

        <div className="form-grid-2">
          <label>Incident type <span className="required">*</span>
            <select name="hazard" required>{HAZARDS.map(h => <option key={h}>{h}</option>)}</select>
          </label>
          <label>Severity <span className="required">*</span>
            <select name="severity" defaultValue="Medium">
              {['Low','Medium','High','Critical'].map(s => <option key={s}>{s}</option>)}
            </select>
          </label>
        </div>

        {/* ── Nationwide Nepal Cascading Location Selector (Issue 1) ── */}
        <div className="form-section-label">📍 Administrative location (All 77 Nepal Districts)</div>
        <p className="hint">Select your Province, District, Local Government, and Ward to route this report accurately.</p>

        <NepalLocationSelector
          province={province}
          district={district}
          municipality={municipality}
          ward={ward}
          wardOther={wardOther}
          onProvinceChange={setProvince}
          onDistrictChange={setDistrict}
          onMunicipalityChange={setMunicipality}
          onWardChange={setWard}
          onWardOtherChange={setWardOther}
          onDistrictCenterSelected={setDistrictCenter}
          required={false}
        />

        <label style={{ marginTop: '12px' }}>
          Specific locality / tole / landmark
          <input
            type="text"
            value={locality}
            onChange={e => setLocality(e.target.value)}
            placeholder="e.g. Samakhusi chowk, near river bridge, ward office lane"
            maxLength={120}
          />
        </label>

        {/* ── Incident Map (Bundled Leaflet - Issue 2) ── */}
        <div className="form-section-label">🗺️ Geographic pin on map</div>
        <p className="hint">Click anywhere on the map or drag the pin to set the exact incident coordinates.</p>
        <LocationPickerMap
          lat={lat ? parseFloat(lat) : null}
          lng={lng ? parseFloat(lng) : null}
          onLocationSelect={handleLocationSelect}
          centerCoordinates={districtCenter}
          readOnly={false}
        />

        {addressSuggestion && !addressConfirmed && (
          <div className="address-suggestion">
            <span className="suggestion-label">📌 Suggested location from map:</span>
            <span className="suggestion-text">{addressSuggestion}</span>
            <div className="suggestion-actions">
              <button type="button" className="btn-suggestion-accept" onClick={acceptSuggestion}>Accept suggestion</button>
              <button type="button" className="btn-suggestion-dismiss" onClick={() => { setAddressSuggestion(''); setAddressConfirmed(false); }}>Dismiss</button>
            </div>
          </div>
        )}

        {(lat || lng) && (
          <div className="coordinates-display">
            <span>📡 Selected: {lat && parseFloat(lat).toFixed(5)}, {lng && parseFloat(lng).toFixed(5)}</span>
            <button type="button" className="btn-clear-coords" onClick={() => { setLat(''); setLng(''); }}>Clear</button>
          </div>
        )}

        <label style={{ marginTop: '14px' }}>Description <span className="required">*</span>
          <textarea
            name="description"
            required
            maxLength={1000}
            rows={4}
            placeholder="Describe what you observed: what changed, when, and nearby landmarks. Max 1000 characters."
          />
        </label>

        {/* Incident Date & Time */}
        <div className="form-section-label">🕒 Incident occurrence time</div>
        <div className="form-grid-2">
          <label>
            When did this occur? <span className="hint-inline">(Nepal time)</span>
            <input
              name="incidentAt"
              type="datetime-local"
              value={incidentAt}
              onChange={e => setIncidentAt(e.target.value)}
              max={nowNepalDatetimeLocal()}
            />
            <small className="hint">Leave as-is if it just happened. Change to the actual incident time.</small>
          </label>
        </div>

        {/* Photo Evidence Upload */}
        <div className="form-section-label">📷 Photo evidence <span className="required">*</span></div>
        <label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={choosePhoto}
            required
            disabled={reading || busy}
          />
        </label>
        {photoErr && <p className="toast toast-error">{photoErr}</p>}
        {reading && <p className="hint"><Spinner/> Processing image preview...</p>}
        {photo && (
          <div className="photo-preview-box">
            <img src={photo} alt="Upload preview" className="photo-preview-img" style={{ maxHeight: '200px', borderRadius: '6px', marginTop: '8px' }}/>
          </div>
        )}

        <button className="primary" type="submit" disabled={busy || reading || !photo} style={{ marginTop: '16px' }}>
          {busy ? <><Spinner/> Submitting report...</> : 'Submit Incident Report'}
        </button>
      </form>
    </div>
  );
}

// ── My Reports View ───────────────────────────────────────────────────────────
function MyReports({ reports, run, busy, refresh }) {
  return (
    <section className="panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">YOUR OBSERVATIONS</p>
          <h2>My submitted reports</h2>
        </div>
        <button disabled={busy} onClick={() => run(refresh)}>Refresh</button>
      </div>
      {reports.length === 0 ? (
        <EmptyState icon="📝" title="No reports yet" body="Reports you submit will appear here with their review status."/>
      ) : (
        <div className="reports-list">
          {reports.map(r => (
            <article key={r.id} className="my-report-card">
              <div className="report-card-head">
                <span className="hazard-title">{r.hazard}</span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <SeverityBadge severity={r.severity} />
                  <StatusBadge status={r.status} />
                </div>
              </div>
              <div className="report-meta">
                <span>📍 {r.district ? `${r.district}, ` : ''}{r.municipality || r.area?.name || 'Nepal'}{r.ward ? ` (${r.ward})` : ''}</span>
                <span>🕒 {fmtDate(r.createdAt)}</span>
              </div>
              <p className="report-desc">{r.description}</p>
              <div className="view-location-row">
                <ViewLocationLink lat={r.latitude} lng={r.longitude} address={[r.locality, r.district, r.municipality].filter(Boolean).join(', ')}/>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Community Feed ────────────────────────────────────────────────────────────
function CommunityFeed({ reports, areas, run, busy, refresh }) {
  const [filterHazard, setFilterHazard] = useState('');
  const [filterDistrict, setFilterDistrict] = useState('');
  const [search, setSearch] = useState('');

  const visible = reports.filter(r => {
    if (filterHazard && r.hazard !== filterHazard) return false;
    if (filterDistrict && r.district !== filterDistrict) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const match = (r.hazard + ' ' + (r.district || '') + ' ' + (r.municipality || '') + ' ' + (r.locality || '') + ' ' + r.description).toLowerCase();
      if (!match.includes(q)) return false;
    }
    return true;
  });

  return (
    <section className="panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">COMMUNITY INTEL</p>
          <h2>Public community feed</h2>
        </div>
        <button disabled={busy} onClick={() => run(refresh)}>Refresh</button>
      </div>

      <div className="filter-bar">
        <label>
          Search
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search hazard, tole, district..."
          />
        </label>
        <label>
          Hazard
          <select value={filterHazard} onChange={e => setFilterHazard(e.target.value)}>
            <option value="">All hazards</option>
            {HAZARDS.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>
        <label>
          District (All 77)
          <select value={filterDistrict} onChange={e => setFilterDistrict(e.target.value)}>
            <option value="">All 77 districts</option>
            {ALL_DISTRICTS.map(d => <option key={d.name} value={d.name}>{d.name} ({d.province.split(' ')[0]})</option>)}
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <EmptyState icon="🔍" title="No matching observations" body="Try resetting your filters to view more records."/>
      ) : (
        <div className="reports-feed">
          {visible.map(r => (
            <article key={r.id} className="feed-card">
              <div className="feed-card-header">
                <strong>{r.hazard}</strong>
                <StatusBadge status={r.status}/>
              </div>
              <div className="report-meta">
                <span>📍 {r.district ? `${r.district}, ` : ''}{r.municipality || r.area?.name || 'Monitored area'}{r.ward ? ` · ${r.ward}` : ''}</span>
                <span>🕒 {fmtDate(r.createdAt)}</span>
              </div>
              <p>{r.description}</p>
              <div className="view-location-row">
                <ViewLocationLink lat={r.latitude} lng={r.longitude} address={[r.locality, r.district, r.municipality].filter(Boolean).join(', ')}/>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Admin: Analytics Overview ─────────────────────────────────────────────────
function Distribution({ title, values }) {
  const entries = Object.entries(values || {}).sort((a,b) => b[1]-a[1]);
  const max = Math.max(1, ...entries.map(([,c]) => c));
  return (
    <section className="distribution" aria-label={title + ' breakdown'}>
      <h3>{title}</h3>
      {entries.length ? <ul>{entries.map(([label, count]) => (
        <li key={label}>
          <div className="distribution-label"><span>{label}</span><strong>{count}</strong></div>
          <div className="distribution-track" aria-hidden="true"><span style={{ width: Math.max(3, count/max*100) + '%' }}/></div>
        </li>
      ))}</ul> : <p className="hint">No data.</p>}
    </section>
  );
}

function AdminAnalytics({ analytics }) {
  if (!analytics) return <p className="hint">No analytics available.</p>;
  const metrics = [
    ['Total', analytics.total, 'metric-neutral'],
    ['Awaiting review', analytics.byStatus?.Reported || 0, 'metric-blue'],
    ['Verified', analytics.byStatus?.Verified || 0, 'metric-blue'],
    ['Responding', analytics.byStatus?.Responding || 0, 'metric-orange'],
    ['Resolved', analytics.byStatus?.Resolved || 0, 'metric-green'],
    ['Rejected', analytics.byStatus?.Rejected || 0, 'metric-red'],
  ];
  return (
    <section className="dashboard-overview">
      <div className="section-title">
        <div><p className="eyebrow">YOUR ASSIGNED JURISDICTION</p><h2>Operational overview</h2></div>
        <span className="data-caption">Live counts - assigned areas only</span>
      </div>
      <div className="metric-grid">
        {metrics.map(([label, value, cls]) => (
          <div key={label} className={`metric-card ${cls}`}><span>{label}</span><strong>{value}</strong></div>
        ))}
      </div>
      {analytics.total === 0 ? <p className="hint" style={{marginTop:'16px'}}>No incidents in your assigned areas yet.</p>
        : <div className="distribution-grid">
            <Distribution title="By severity" values={analytics.bySeverity}/>
            <Distribution title="By incident type" values={analytics.byType}/>
          </div>}
    </section>
  );
}

// ── Admin: Incident Review and Approvals ──────────────────────────────────────
function Timeline({ events }) {
  if (!events || events.length === 0) return null;
  return (
    <div className="timeline">
      <p className="eyebrow">INCIDENT HISTORY</p>
      <ul>{events.map(e => (
        <li key={e.id}>
          <strong>{e.type.replace(/_/g, ' ')}</strong>
          {e.note && <p>{e.note}</p>}
          <small>{fmtDate(e.createdAt)} · {e.actor?.name || 'System'}</small>
        </li>
      ))}</ul>
    </div>
  );
}

function Assessment({ analysis, retry, busy }) {
  if (!analysis) return null;
  return (
    <div className="assessment">
      <p className="eyebrow">AUTOMATED CONTEXT - {analysis.status.toUpperCase()}</p>
      {analysis.status === 'Pending' && <p>Waiting for analysis. Attempts: {analysis.attempts}.</p>}
      {analysis.status === 'Processing' && <p>Analysis in progress...</p>}
      {analysis.error && <p className="hint">Last error: {analysis.error}</p>}
      {analysis.status === 'Failed' && <button disabled={busy} onClick={retry}>Retry analysis</button>}
      {analysis.result && <>
        <p>{analysis.result.summary}</p>
        <p>{analysis.result.weatherContext}</p>
        <strong>Uncertainties</strong><ul>{analysis.result.uncertainties.map((x,i)=><li key={i}>{x}</li>)}</ul>
        <strong>Review questions</strong><ul>{analysis.result.reviewQuestions.map((x,i)=><li key={i}>{x}</li>)}</ul>
        <p className="hint">{analysis.result.disclaimer}</p>
        <small>Model: {analysis.model} · {Math.round(analysis.result.durationMs/1000)}s · {fmtDate(analysis.completedAt)}</small>
      </>}
    </div>
  );
}

function AdminReports({ reports, areas, teams, run, busy, refresh }) {
  const [districtFilter, setDistrictFilter] = useState('');
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [search, setSearch] = useState('');
  const [teamPick, setTeamPick] = useState({});
  const [pending, setPending] = useState(null);
  const [note, setNote] = useState('');

  const visible = reports.filter(r =>
    (!districtFilter || r.district === districtFilter) &&
    (!status || r.status === status) &&
    (!severity || r.severity === severity) &&
    (!search.trim() || (r.id+' '+r.hazard+' '+r.description+' '+(r.district||'')+' '+(r.municipality||'')+' '+(r.area?.name||'')+' '+(r.locality||'')).toLowerCase().includes(search.trim().toLowerCase()))
  );

  return (
    <section className="panel">
      <div className="section-title">
        <div><p className="eyebrow">INCIDENT TRIAGE</p><h2>Review and manage reports</h2></div>
        <button disabled={busy} onClick={() => run(refresh)}>Refresh</button>
      </div>

      <div className="filter-bar">
        <label>Search
          <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="ID, type, locality, description"/>
        </label>
        <label>District
          <select value={districtFilter} onChange={e=>setDistrictFilter(e.target.value)}>
            <option value="">All 77 districts</option>
            {ALL_DISTRICTS.map(d=><option key={d.name} value={d.name}>{d.name}</option>)}
          </select>
        </label>
        <label>Status
          <select value={status} onChange={e=>setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['Reported','Verified','Responding','Resolved','Rejected'].map(s=><option key={s}>{s}</option>)}
          </select>
        </label>
        <label>Severity
          <select value={severity} onChange={e=>setSeverity(e.target.value)}>
            <option value="">All severities</option>
            {['Critical','High','Medium','Low'].map(s=><option key={s}>{s}</option>)}
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <EmptyState icon="📂" title={reports.length ? 'No incidents match filters' : 'No incidents in your jurisdiction'}/>
      ) : (
        <div className="reports">{visible.map(r => (
          <article key={r.id} className="report-item">
            <div className="report-thumb-col">
              <img src={`/api/reports/${r.id}/photo`} alt="Evidence" className="report-photo" onError={e => { e.target.style.display='none'; }}/>
            </div>
            <div className="report-details-col">
              <div className="report-top-meta">
                <span className="hazard-tag">{r.hazard}</span>
                <SeverityBadge severity={r.severity}/>
                <StatusBadge status={r.status}/>
              </div>
              <p className="report-desc-main">{r.description}</p>
              <div className="location-pill">
                📍 {r.district ? `${r.district}, ` : ''}{r.municipality || r.area?.name || 'Area'}{r.ward ? ` (${r.ward})` : ''}
                {r.locality ? ` · ${r.locality}` : ''}
              </div>
              <div className="view-location-row">
                <ViewLocationLink lat={r.latitude} lng={r.longitude} address={[r.locality, r.district, r.municipality].filter(Boolean).join(', ')}/>
              </div>
              <small>Reported: {fmtDate(r.createdAt)}</small>

              <div className="admin-actions">
                <label>Incident Action
                  <select
                    value={r.status}
                    disabled={busy || ['Resolved','Rejected'].includes(r.status)}
                    onChange={ev => {
                      const s = ev.target.value;
                      if (s === 'Rejected' || s === 'Resolved') { setNote(''); setPending({ r, s }); return; }
                      run(async () => {
                        await request(`/api/reports/${r.id}`, 'PATCH', { status: s });
                        await refresh();
                      }, s === 'Verified' ? 'Incident marked as Verified.' : `Status updated to ${s}`);
                    }}
                  >
                    {r.status === 'Reported' && <>
                      <option value="Reported">Reported - Awaiting review</option>
                      <option value="Verified">Verify report</option>
                      <option value="Rejected">Reject report</option>
                    </>}
                    {r.status === 'Verified' && <>
                      <option value="Verified">Verified</option>
                      <option value="Responding">Mark Responding</option>
                      <option value="Resolved">Resolve incident</option>
                    </>}
                    {r.status === 'Responding' && <>
                      <option value="Responding">Responding</option>
                      <option value="Resolved">Resolve incident</option>
                    </>}
                    {['Resolved','Rejected'].includes(r.status) && <option value={r.status}>{r.status} - Final</option>}
                  </select>
                </label>

                {r.status === 'Verified' && teams && teams.length > 0 && (
                  <label>Assign response team
                    <div className="assign-row">
                      <select value={teamPick[r.id] || ''} onChange={e => setTeamPick(c => ({...c, [r.id]: e.target.value}))}>
                        <option value="">Select active team...</option>
                        {teams.map(t => <option key={t.id} value={t.id}>{t.organization?.name} - {t.name}</option>)}
                      </select>
                      <button disabled={busy || !teamPick[r.id]} onClick={() => run(async () => {
                        await request(`/api/reports/${r.id}/assignments`, 'POST', { teamId: teamPick[r.id] });
                        await refresh();
                      }, 'Assignment recorded.')}>Assign</button>
                    </div>
                  </label>
                )}
              </div>

              {r.incidentAssignments?.length > 0 && (
                <div className="assignment-list">
                  {r.incidentAssignments.map(a => (
                    <div key={a.id} className="assignment-chip">
                      <span>🚒 {a.team?.organization?.name} / {a.team?.name}</span>
                      <span className={a.acknowledgedAt ? 'ack-yes' : 'ack-pending'}>
                        {a.acknowledgedAt ? 'Acknowledged ' + fmtShort(a.acknowledgedAt) : 'Awaiting acknowledgement'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <Timeline events={r.events}/>
              <Assessment analysis={r.analysis} busy={busy} retry={() => run(async () => {
                await request(`/api/reports/${r.id}/retry`, 'POST', {}); await refresh();
              })}/>
            </div>
          </article>
        ))}</div>
      )}

      {pending && (
        <div className="dialog-backdrop">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <p className="eyebrow">CONFIRM ACTION</p>
            <h2 id="confirm-title">{pending.s === 'Rejected' ? 'Reject this report?' : 'Resolve this incident?'}</h2>
            <p>{pending.s === 'Rejected' ? 'The reporter will see that the report was rejected.' : 'Record a resolution summary.'}</p>
            <label>{pending.s === 'Rejected' ? 'Rejection reason' : 'Resolution summary'}
              <textarea autoFocus rows={4} maxLength={pending.s === 'Rejected' ? 500 : 1000}
                required value={note} onChange={e=>setNote(e.target.value)}
                placeholder={pending.s === 'Rejected' ? 'e.g. Observation does not match a disaster hazard.' : 'e.g. Cleared by emergency responder unit.'}/>
            </label>
            <div className="dialog-actions">
              <button disabled={busy} onClick={() => setPending(null)}>Cancel</button>
              <button className={pending.s === 'Rejected' ? 'danger' : 'primary'}
                disabled={busy || !note.trim()}
                onClick={() => run(async () => {
                  const payload = pending.s === 'Rejected' ? { status: 'Rejected', reason: note.trim() } : { status: 'Resolved', resolutionSummary: note.trim() };
                  await request(`/api/reports/${pending.r.id}`, 'PATCH', payload);
                  setPending(null); await refresh();
                }, pending.s + ' recorded.')}>
                {busy ? <><Spinner/> Saving...</> : `Confirm ${pending.s}`}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

// ── Interactive Real Leaflet Incident Map (Bundled Leaflet - Issue 2) ─────────
function IncidentMap({ reports }) {
  const mapped = reports.filter(r => r.latitude != null && r.longitude != null);
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;
    try {
      const map = L.map(mapRef.current, { zoomControl: true }).setView([KTM_LAT, KTM_LNG], 7);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
      }).addTo(map);
      mapInstanceRef.current = map;

      mapped.forEach(r => {
        const color = { Reported: '#f59e0b', Verified: '#2563eb', Responding: '#f97316', Resolved: '#059669', Rejected: '#dc2626' }[r.status] || '#64748b';
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:14px;height:14px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
          iconSize: [14, 14], iconAnchor: [7, 7]
        });
        L.marker([r.latitude, r.longitude], { icon })
          .addTo(map)
          .bindPopup(`<strong>${r.hazard}</strong><br>${r.district ? r.district + ', ' : ''}${r.municipality || r.area?.name || ''}${r.ward ? ' (' + r.ward + ')' : ''}<br><span style="color:${color};font-weight:bold">${r.status}</span><br>${fmtShort(r.createdAt)}`);
      });

      if (mapped.length > 1) {
        const bounds = L.latLngBounds(mapped.map(r => [r.latitude, r.longitude]));
        map.fitBounds(bounds, { padding: [30, 30] });
      } else if (mapped.length === 1) {
        map.setView([mapped[0].latitude, mapped[0].longitude], 14);
      }
    } catch (err) {
      console.error('Error rendering incident map:', err);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [reports]);

  return (
    <section className="panel">
      <p className="eyebrow">GEOGRAPHIC INFORMATION SYSTEM</p>
      <h2>Nepal Emergency Incident Map</h2>
      <p className="hint">{mapped.length} of {reports.length} incidents have recorded coordinates. Dot color = status.</p>
      <div style={{ position: 'relative' }}>
        <div ref={mapRef} style={{ height: '440px', width: '100%', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--line)' }}/>
      </div>

      {mapped.length > 0 && (
        <div className="table-scroll" style={{ marginTop: '16px' }}>
          <table className="data-table">
            <thead>
              <tr><th>Type</th><th>Location</th><th>Ward</th><th>Status</th><th>Severity</th><th>Coordinates</th><th>Reported</th><th>Map</th></tr>
            </thead>
            <tbody>
              {mapped.map(r => (
                <tr key={r.id}>
                  <td><strong>{r.hazard}</strong></td>
                  <td>{r.district ? `${r.district}, ` : ''}{r.municipality || r.area?.name}</td>
                  <td>{r.ward || '—'}</td>
                  <td><StatusBadge status={r.status}/></td>
                  <td><SeverityBadge severity={r.severity}/></td>
                  <td className="font-mono">{r.latitude?.toFixed(4)}, {r.longitude?.toFixed(4)}</td>
                  <td><small>{fmtShort(r.createdAt)}</small></td>
                  <td><ViewLocationLink lat={r.latitude} lng={r.longitude}/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Admin: User Management ────────────────────────────────────────────────────
function AdminUsers({ run, busy, currentUserId }) {
  const [users, setUsers] = useState(null);
  const load = useCallback(async () => { setUsers(await request('/api/admin/users')); }, []);
  useEffect(() => { run(load); }, []);
  if (!users) return <div className="panel"><div className="loading-state"><Spinner/><span>Loading users...</span></div></div>;
  return (
    <section className="panel">
      <div className="section-title">
        <div><p className="eyebrow">USER MANAGEMENT</p><h2>All registered accounts</h2></div>
        <button disabled={busy} onClick={() => run(load)}>Refresh</button>
      </div>
      <p className="hint">Role changes are immediate. You cannot change your own role.</p>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Registered</th><th>Change Role</th></tr></thead>
          <tbody>{users.map(u => (
            <tr key={u.id}>
              <td><strong>{u.name}</strong></td>
              <td>{u.email}</td>
              <td><span className={`role-tag role-${u.role.toLowerCase()}`}>{roleLabel(u.role)}</span></td>
              <td><small>{fmtShort(u.createdAt)}</small></td>
              <td>
                <select
                  value={u.role}
                  disabled={busy || u.id === currentUserId}
                  onChange={e => run(async () => {
                    await request(`/api/admin/users/${u.id}/role`, 'PATCH', { role: e.target.value });
                    await load();
                  }, `Role changed for ${u.name}.`)}
                >
                  <option value="RESIDENT">Resident</option>
                  <option value="RESPONDER">Responder</option>
                  <option value="ADMIN">Administrator</option>
                </select>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

// ── Admin: Organizations & Response Teams ────────────────────────────────────
function AdminOrganizations({ run, busy }) {
  const [orgs, setOrgs] = useState(null);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgType, setNewOrgType] = useState('Search & Rescue');
  const [newTeamName, setNewTeamName] = useState({});

  const load = useCallback(async () => { setOrgs(await request('/api/admin/organizations')); }, []);
  useEffect(() => { run(load); }, []);

  async function handleCreateOrg(e) {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    run(async () => {
      await request('/api/admin/organizations', 'POST', { name: newOrgName.trim(), type: newOrgType });
      setNewOrgName('');
      await load();
    }, 'Organization created.');
  }

  async function handleCreateTeam(orgId) {
    const name = newTeamName[orgId];
    if (!name?.trim()) return;
    run(async () => {
      await request(`/api/admin/organizations/${orgId}/teams`, 'POST', { name: name.trim() });
      setNewTeamName(c => ({ ...c, [orgId]: '' }));
      await load();
    }, 'Team created.');
  }

  if (!orgs) return <div className="panel"><div className="loading-state"><Spinner/><span>Loading organizations...</span></div></div>;

  return (
    <section className="panel">
      <div className="section-title">
        <div><p className="eyebrow">CIVIL DEFENSE & RESPONSE</p><h2>Response organizations & units</h2></div>
        <button disabled={busy} onClick={() => run(load)}>Refresh</button>
      </div>

      <form onSubmit={handleCreateOrg} className="form-grid-3" style={{ marginBottom: '20px' }}>
        <label>Organization Name
          <input value={newOrgName} onChange={e => setNewOrgName(e.target.value)} placeholder="e.g. Nepal Red Cross Society" required/>
        </label>
        <label>Organization Type
          <input value={newOrgType} onChange={e => setNewOrgType(e.target.value)} placeholder="e.g. Disaster Relief, Medical" required/>
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button type="submit" disabled={busy || !newOrgName.trim()} className="primary" style={{ width: '100%' }}>Add Organization</button>
        </div>
      </form>

      <div className="orgs-list">
        {orgs.map(org => (
          <div key={org.id} className="org-card" style={{ padding: '16px', border: '1px solid var(--line)', borderRadius: '8px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0 }}>{org.name}</h3>
                <span className="role-tag role-responder">{org.type}</span>
              </div>
            </div>
            <div style={{ marginTop: '12px' }}>
              <strong>Operational Teams ({org.teams?.length || 0}):</strong>
              <ul>
                {org.teams?.map(t => (
                  <li key={t.id} style={{ margin: '4px 0' }}>🚒 {t.name} ({t.members?.length || 0} responders)</li>
                ))}
              </ul>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <input
                  type="text"
                  placeholder="New team name..."
                  value={newTeamName[org.id] || ''}
                  onChange={e => setNewTeamName({ ...newTeamName, [org.id]: e.target.value })}
                  style={{ maxWidth: '240px' }}
                />
                <button type="button" disabled={busy || !newTeamName[org.id]?.trim()} onClick={() => handleCreateTeam(org.id)}>Add Team</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Responder Dashboard ───────────────────────────────────────────────────────
function ResponderDashboard({ run, busy }) {
  const [assignments, setAssignments] = useState(null);
  const load = useCallback(async () => { setAssignments(await request('/api/responder/assignments')); }, []);
  useEffect(() => { run(load); }, []);

  if (!assignments) return <div className="panel"><div className="loading-state"><Spinner/><span>Loading assignments...</span></div></div>;

  return (
    <section className="panel">
      <div className="section-title">
        <div><p className="eyebrow">FIELD OPERATIONS</p><h2>Active incident dispatch</h2></div>
        <button disabled={busy} onClick={() => run(load)}>Refresh</button>
      </div>
      {assignments.length === 0 ? (
        <EmptyState icon="🚒" title="No active dispatches" body="When an administrator assigns your team to an incident, it will appear here."/>
      ) : (
        <div className="assignments-list">
          {assignments.map(a => (
            <article key={a.id} className="assignment-card" style={{ padding: '16px', border: '1px solid var(--line)', borderRadius: '8px', marginBottom: '12px' }}>
              <h3>{a.report?.hazard}</h3>
              <p>📍 {a.report?.district ? `${a.report.district}, ` : ''}{a.report?.municipality || a.report?.area?.name} · {a.report?.locality || ''}</p>
              <p>{a.report?.description}</p>
              <ViewLocationLink lat={a.report?.latitude} lng={a.report?.longitude}/>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Notifications View ────────────────────────────────────────────────────────
function NotificationsView({ areas, subscriptions, notifications, run, busy, refresh }) {
  const [selected, setSelected] = useState(subscriptions);
  useEffect(() => setSelected(subscriptions), [subscriptions.join('|')]);
  const unread = notifications.filter(n => !n.readAt).length;

  return (
    <div className="layout">
      <section className="panel">
        <div className="section-title">
          <div><p className="eyebrow">NOTIFICATIONS</p>
            <h2>Your updates {unread > 0 && <span className="notif-count">{unread}</span>}</h2>
          </div>
          <button disabled={busy} onClick={() => run(refresh)}>Refresh</button>
        </div>
        <p className="hint">In-app notifications only. No SMS or push notifications are sent.</p>
        {notifications.length === 0 ? (
          <EmptyState icon="🔔" title="No notifications yet" body="Subscribe to an area to receive new report notifications."/>
        ) : (
          notifications.map(n => (
            <div className={'notification ' + (n.readAt ? '' : 'unread')} key={n.id}>
              <p>{n.message}</p>
              <small>{fmtDate(n.createdAt)} - Nepal time</small>
              {!n.readAt && <button disabled={busy} onClick={() => run(async () => {
                await request(`/api/notifications/${n.id}`, 'PATCH', {}); await refresh();
              })}>Mark as read</button>}
            </div>
          ))
        )}
      </section>

      <aside className="panel">
        <p className="eyebrow">AREA SUBSCRIPTIONS</p>
        <h2>Follow your community</h2>
        <p className="hint">Subscriptions apply to future reports and updates.</p>
        {areas.map(area => (
          <label className="checkbox" key={area.id}>
            <input
              type="checkbox"
              checked={selected.includes(area.id)}
              onChange={e => {
                setSelected(e.target.checked ? [...selected, area.id] : selected.filter(id => id !== area.id));
              }}
            />
            {area.name}
          </label>
        ))}
        <button
          className="primary"
          disabled={busy}
          style={{ marginTop: '12px', width: '100%' }}
          onClick={() => run(async () => {
            await request('/api/subscriptions', 'PUT', { areaIds: selected });
            await refresh();
          }, 'Subscriptions saved.')}
        >
          Save subscriptions
        </button>
      </aside>
    </div>
  );
}

// ── User Profile & Permanent Address Editor (All 77 Districts) ─────────────────
function ProfileView({ run, busy }) {
  const [profile, setProfile] = useState(null);
  const [province, setProvince] = useState('');
  const [district, setDistrict] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [ward, setWard] = useState('');
  const [wardOther, setWardOther] = useState('');
  const [locality, setLocality] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    const p = await request('/api/auth/profile');
    setProfile(p);
    setProvince(p.province || '');
    setDistrict(p.district || '');
    setMunicipality(p.municipality || '');
    setWard(p.ward || '');
    setLocality(p.locality || '');
  }, []);

  useEffect(() => { run(load); }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(''); setSuccess('');
    const data = {
      province: province || null,
      district: district || null,
      municipality: municipality || null,
      ward: ward || null,
      wardOther: wardOther || '',
      locality: locality || (wardOther ? wardOther : null),
    };
    setSaving(true);
    try {
      const updated = await request('/api/auth/profile', 'PATCH', data);
      setProfile(updated);
      setSuccess('Profile address updated successfully.');
    } catch (error) {
      setErr(error.message || 'Could not save profile address.');
    } finally {
      setSaving(false);
    }
  }

  if (!profile) return <div className="panel"><div className="loading-state"><Spinner/><span>Loading profile...</span></div></div>;

  return (
    <section className="panel">
      <div className="section-title">
        <div><p className="eyebrow">USER PROFILE</p><h2>Manage your account address</h2></div>
      </div>

      {err && <p className="toast toast-error" role="alert">{err}</p>}
      {success && <p className="toast toast-success" role="status">{success}</p>}

      <div className="profile-address-preview">
        <strong>Current saved location:</strong>
        <div className="address-display">
          <div><strong>Province</strong> {profile.province || '—'}</div>
          <div><strong>District</strong> {profile.district || '—'}</div>
          <div><strong>Municipality</strong> {profile.municipality || '—'}</div>
          <div><strong>Ward</strong> {profile.ward || '—'}</div>
          <div><strong>Locality</strong> {profile.locality || '—'}</div>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ marginTop: '20px' }}>
        <p className="eyebrow">UPDATE LOCATION</p>
        <h3>Cascading Administrative Address (All 77 Nepal Districts)</h3>
        <p className="hint">Set your home or office address to help prioritize alerts and community reports.</p>

        <NepalLocationSelector
          province={province}
          district={district}
          municipality={municipality}
          ward={ward}
          wardOther={wardOther}
          onProvinceChange={setProvince}
          onDistrictChange={setDistrict}
          onMunicipalityChange={setMunicipality}
          onWardChange={setWard}
          onWardOtherChange={setWardOther}
          required={false}
        />

        <label style={{ marginTop: '12px' }}>
          Specific locality / tole / landmark
          <input
            type="text"
            value={locality}
            onChange={e => setLocality(e.target.value)}
            placeholder="e.g. Putalisadak, near campus, main chowk"
            maxLength={120}
          />
        </label>

        <button className="primary" type="submit" disabled={saving || busy} style={{ marginTop: '16px' }}>
          {saving ? <><Spinner/> Saving address...</> : 'Save Profile Address'}
        </button>
      </form>
    </section>
  );
}

// ── Main Application Component ────────────────────────────────────────────────
function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('home');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  // Auth modal dialog
  const [authModal, setAuthModal] = useState({ open: false, mode: 'login' });

  // Workspace domain data
  const [areas, setAreas] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [reports, setReports] = useState([]);
  const [adminReports, setAdminReports] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [adminTeams, setAdminTeams] = useState([]);

  // Close menus on Escape key
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        if (authModal.open) setAuthModal({ open: false, mode: 'login' });
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [authModal.open]);

  const run = useCallback(async (action, successMsg) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      if (successMsg) setMessage(successMsg);
    } catch (e) {
      setError(e.message || 'Operation could not be completed.');
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(async (currentUser = user) => {
    const [a, s, n, r] = await Promise.all([
      request('/api/areas'),
      currentUser ? request('/api/subscriptions') : [],
      currentUser ? request('/api/notifications') : [],
      currentUser ? request('/api/reports') : [],
    ]);
    setAreas(a);
    setSubscriptions(s);
    setNotifications(n);
    setReports(r);

    if (currentUser?.role === 'ADMIN') {
      const [ar, an, at] = await Promise.all([
        request('/api/admin/reports'),
        request('/api/admin/analytics'),
        request('/api/admin/teams')
      ]);
      setAdminReports(ar);
      setAnalytics(an);
      setAdminTeams(at);
    }
  }, [user]);

  // Initial user check
  useEffect(() => {
    let mounted = true;
    request('/api/auth/me')
      .then(async u => {
        if (!mounted) return;
        setUser(u);
        const saved = getSavedSection(u.role);
        if (saved) setView(saved);
        await refresh(u);
      })
      .catch(() => {
        if (mounted) setUser(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  // Poll notifications when signed in
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => {
      refresh(user).catch(e => {
        if (e.status === 401) {
          setUser(null);
          setView('home');
        }
      });
    }, 25000);
    return () => clearInterval(t);
  }, [user, refresh]);

  function nav(key) {
    setView(key);
    setMenuOpen(false);
    setError('');
    setMessage('');
    if (user) saveSection(key, user.role);
  }

  const unreadCount = notifications.filter(n => !n.readAt).length;

  const navItems = !user ? [] : user.role === 'ADMIN' ? [
    { key: 'home', label: 'Public Portal' },
    { key: 'admin-overview', label: 'Overview' },
    { key: 'admin-reports', label: 'Incidents' },
    { key: 'admin-map', label: 'Map' },
    { key: 'admin-orgs', label: 'Organizations' },
    { key: 'admin-users', label: 'Users' },
    { key: 'notifications', label: `Notifications${unreadCount > 0 ? ` (${unreadCount})` : ''}` },
    { key: 'profile', label: 'Profile Address' }
  ] : user.role === 'RESPONDER' ? [
    { key: 'home', label: 'Public Portal' },
    { key: 'responder', label: 'My Assignments' },
    { key: 'community', label: 'Community Feed' },
    { key: 'notifications', label: `Notifications${unreadCount > 0 ? ` (${unreadCount})` : ''}` },
    { key: 'profile', label: 'Profile Address' }
  ] : [
    { key: 'home', label: 'Public Portal' },
    { key: 'report', label: 'Submit Report' },
    { key: 'my-reports', label: 'My Reports' },
    { key: 'community', label: 'Community Feed' },
    { key: 'notifications', label: `Notifications${unreadCount > 0 ? ` (${unreadCount})` : ''}` },
    { key: 'profile', label: 'Profile Address' }
  ];

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>

      {view === 'home' ? (
        <RedesignedHomepage
          user={user}
          onOpenAuth={mode => setAuthModal({ open: true, mode })}
          onOpenReport={() => {
            if (user) nav('report');
            else setAuthModal({ open: true, mode: 'login' });
          }}
          onGoToDashboard={dest => {
            const defaultDest = user?.role === 'ADMIN' ? 'admin-overview' : user?.role === 'RESPONDER' ? 'responder' : 'my-reports';
            nav(dest || defaultDest);
          }}
          onSignOut={() => run(async () => {
            await request('/api/auth/logout', 'POST', {});
            setUser(null);
            setView('home');
            setNotifications([]);
            clearSection();
          }, 'Signed out successfully.')}
        />
      ) : (
        <>
          {/* ── National Emergency Ribbon ── */}
          <div className="cdw-top-ribbon" role="region" aria-label="National Emergency Hotlines">
            <div className="cdw-container ribbon-flex">
              <div className="ribbon-brand-mark">
                <span className="nepal-flag-badge" aria-hidden="true">🇳🇵</span>
                <span className="ribbon-title">NATIONAL EMERGENCY DISPATCH CHANNELS</span>
                <span className="ribbon-sep" aria-hidden="true">/</span>
                <span className="ribbon-sub">TOLL-FREE IMMEDIATE ACCESS</span>
              </div>
              <div className="ribbon-hotline-strip">
                <a href="tel:100" className="ribbon-link"><span>Police</span> <strong>100</strong></a>
                <span className="dot-sep" aria-hidden="true">·</span>
                <a href="tel:101" className="ribbon-link"><span>Fire</span> <strong>101</strong></a>
                <span className="dot-sep" aria-hidden="true">·</span>
                <a href="tel:102" className="ribbon-link"><span>Ambulance</span> <strong>102</strong></a>
                <span className="dot-sep" aria-hidden="true">·</span>
                <a href="tel:1149" className="ribbon-link highlight-neoc"><span>NEOC Disaster</span> <strong>1149</strong></a>
              </div>
            </div>
          </div>

          {/* ── Responsive Workspace Header (Issue 3 & 4) ── */}
          <header className="workspace-header">
            <div className="workspace-header-inner">
              <a className="workspace-brand" href="/" onClick={e => { e.preventDefault(); setView('home'); }} aria-label="Return to Public Portal">
                <span className="workspace-crest" aria-hidden="true">🛡️</span>
                <span className="workspace-brand-text">
                  <strong className="workspace-title">Community Disaster Watch</strong>
                  <span className="workspace-subtitle">Nepal Operational Workspace</span>
                </span>
              </a>

              <div className="workspace-header-controls">
                <button
                  type="button"
                  className="btn-return-portal"
                  onClick={() => setView('home')}
                  title="Switch back to public portal"
                >
                  ← Public Portal
                </button>

                {user ? (
                  <div className="workspace-account-chip">
                    <div className="account-info">
                      <strong className="user-name">{user.name}</strong>
                      <span className={`role-tag role-${user.role.toLowerCase()}`}>{roleLabel(user.role)}</span>
                    </div>
                    <button
                      type="button"
                      className="btn-workspace-signout"
                      disabled={busy}
                      onClick={() => run(async () => {
                        await request('/api/auth/logout', 'POST', {});
                        setUser(null);
                        setView('home');
                        setNotifications([]);
                        clearSection();
                      })}
                    >
                      Sign out
                    </button>
                  </div>
                ) : (
                  <div className="workspace-auth-btns">
                    <button type="button" className="btn-workspace-login" onClick={() => setAuthModal({ open: true, mode: 'login' })}>Sign In</button>
                    <button type="button" className="btn-workspace-register" onClick={() => setAuthModal({ open: true, mode: 'register' })}>Register</button>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* ── Responsive Workspace Subnav Tabs Bar (Issue 3) ── */}
          {user && (
            <div className="workspace-subnav-bar">
              <div className="workspace-subnav-inner">
                <div className="subnav-status-label">
                  <span className="status-kicker">OPERATIONAL JURISDICTION</span>
                  <strong className="jurisdiction-name">{roleLabel(user.role)} Dashboard</strong>
                </div>

                {/* Accessible Hamburger Toggle for Mobile Devices */}
                <button
                  type="button"
                  className="workspace-menu-toggle"
                  aria-expanded={menuOpen}
                  aria-controls="workspace-nav"
                  onClick={() => setMenuOpen(v => !v)}
                  aria-label="Toggle workspace views menu"
                >
                  {menuOpen ? '✕ Close' : '☰ Views'}
                </button>

                <nav id="workspace-nav" className={`workspace-tabs ${menuOpen ? 'nav-open' : ''}`} aria-label="Application views">
                  {navItems.filter(item => item.key !== 'home').map(item => (
                    <button
                      key={item.key}
                      disabled={busy}
                      aria-current={view === item.key ? 'page' : undefined}
                      className={`tab-btn ${view === item.key ? 'active' : ''}`}
                      onClick={() => nav(item.key)}
                    >
                      {item.label}
                    </button>
                  ))}
                </nav>
              </div>
            </div>
          )}

          <main id="main-content">
            <div className="workspace-notice" role="note">
              <span className="notice-icon" aria-hidden="true">ℹ️</span>
              <div className="notice-body">
                <strong>Operational Workspace Active:</strong> You are viewing authenticated services for {user ? `${user.name} (${roleLabel(user.role)})` : 'visitors'}. Operational records and submissions update in real time. Return to the <button className="text-button" onClick={() => setView('home')}>Public Portal</button> at any time.
              </div>
            </div>

            <Toast error={error} message={message}/>

            {loading ? (
              <div className="loading-state" role="status"><Spinner/><span>Loading your account...</span></div>
            ) : !user ? (
              <AuthForm busy={busy} onAuthenticated={async u => {
                setUser(u);
                const defaultView = u.role === 'ADMIN' ? 'admin-overview' : u.role === 'RESPONDER' ? 'responder' : 'report';
                setView(defaultView);
                await refresh(u);
              }}/>
            ) : (
              <>
                {view === 'report' && user.role === 'RESIDENT' && <ReportForm areas={areas} run={run} busy={busy} onSubmitted={() => refresh()}/>}
                {view === 'my-reports' && user.role === 'RESIDENT' && <MyReports reports={reports} run={run} busy={busy} refresh={() => refresh()}/>}
                {view === 'community' && <CommunityFeed reports={reports} areas={areas} run={run} busy={busy} refresh={() => refresh()}/>}
                {view === 'admin-overview' && user.role === 'ADMIN' && <AdminAnalytics analytics={analytics}/>}
                {view === 'admin-reports' && user.role === 'ADMIN' && <AdminReports reports={adminReports} areas={areas} teams={adminTeams} run={run} busy={busy} refresh={() => refresh()}/>}
                {view === 'admin-map' && user.role === 'ADMIN' && <IncidentMap reports={adminReports}/>}
                {view === 'admin-orgs' && user.role === 'ADMIN' && <AdminOrganizations run={run} busy={busy}/>}
                {view === 'admin-users' && user.role === 'ADMIN' && <AdminUsers run={run} busy={busy} currentUserId={user.id}/>}
                {view === 'responder' && user.role === 'RESPONDER' && <ResponderDashboard run={run} busy={busy}/>}
                {view === 'notifications' && <NotificationsView areas={areas} subscriptions={subscriptions} notifications={notifications} run={run} busy={busy} refresh={() => refresh()}/>}
                {view === 'profile' && <ProfileView run={run} busy={busy}/>}
              </>
            )}

            <footer className="workspace-footer">
              <div className="footer-meta-line">
                <strong>Community Disaster Watch</strong> · Centralized Emergency Response System for Nepal
              </div>
              <div className="footer-partnership-line">
                Himalayan WhiteHouse International College, Putalisadak, Kathmandu · Affiliated with Purbanchal University
              </div>
            </footer>
          </main>
        </>
      )}

      {/* Auth Modal Overlay */}
      {authModal.open && (
        <div className="auth-modal-overlay" role="dialog" aria-modal="true" aria-label="Sign in or register" onClick={() => setAuthModal({ open: false, mode: 'login' })}>
          <div className="auth-modal-container" onClick={e => e.stopPropagation()}>
            <button className="auth-modal-close" onClick={() => setAuthModal({ open: false, mode: 'login' })} aria-label="Close dialog">✕</button>
            <AuthForm
              run={run}
              busy={busy}
              initialMode={authModal.mode}
              onAuthenticated={async u => {
                setUser(u);
                setAuthModal({ open: false, mode: 'login' });
                const defaultView = u.role === 'ADMIN' ? 'admin-overview' : u.role === 'RESPONDER' ? 'responder' : 'report';
                setView(defaultView);
                await refresh(u);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById('root')).render(<App/>);
