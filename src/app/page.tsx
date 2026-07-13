'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppStore, type AppView } from '@/lib/store';
import {
  ArrowLeft,
  Home,
  FileText,
  Phone,
  ChevronDown,
  ChevronUp,
  Car,
  Heart,
  Briefcase,
  DollarSign,
  ClipboardList,
  Calendar,
  Users,
  Menu,
  X,
  Camera,
  RotateCcw,
  Eye,
  RefreshCw,
  QrCode,
  ShieldOff,
  Bell,
  MoreHorizontal,
  ChevronRight,
  Ticket,
  Search,
  Timer,
  Zap,
  CreditCard,
} from 'lucide-react';

// ========================================
// HELPERS & SHARED CONSTANTS
// ========================================
const SYS_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const DNI_TEAL = '#5b8fa8';
const DNI_TEAL_LIGHT = '#7aafca';
const DNI_PINK = '#e8b4b8';
const DNI_PINK_DARK = '#d4909a';
const DNI_DARK = '#1a3a5c';
const DNI_MID = '#4a6a8a';

const MONTHS_ES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const MONTHS_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function resizeImage(base64: string, maxWidth = 800, maxHeight = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width <= maxWidth && height <= maxHeight) {
        resolve(base64);
        return;
      }
      if (width > height) {
        if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; }
      } else {
        if (height > maxHeight) { width *= maxHeight / height; height = maxHeight; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(base64); return; }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => resolve(base64);
    img.src = base64;
  });
}

function formatDniNumber(num: string): string {
  const digits = num.replace(/\D/g, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

async function removeImageBackground(base64: string): Promise<string> {
  const res = await fetch('/api/remove-bg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64 }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Error al eliminar el fondo');
  }
  const data = await res.json();
  return data.image;
}

function formatDateBilingual(d: string): string {
  if (!d) return '-';
  const [y, m, day] = d.split('-');
  const mi = parseInt(m) - 1;
  return `${parseInt(day)} ${MONTHS_ES[mi]}/ ${MONTHS_EN[mi]} ${y}`;
}

function calcExpiryDate(emision: string): string {
  if (!emision) return '-';
  const [y, m, day] = emision.split('-');
  const mi = parseInt(m) - 1;
  return `${parseInt(day)} ${MONTHS_ES[mi]}/ ${MONTHS_EN[mi]} ${parseInt(y) + 15}`;
}

function formatDateYYMMDD(d: string): string {
  if (!d) return '000000';
  const [y, m, day] = d.split('-');
  return `${y.slice(2)}${m}${day}`;
}

// MRZ check digit
function mrzCheckDigit(s: string): string {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let val = 0;
    if (c >= 48 && c <= 57) val = c - 48;
    else if (c >= 65 && c <= 90) val = c - 55;
    else val = 0;
    sum += val * weights[i % 3];
  }
  return String(sum % 10);
}

function padRight(s: string, len: number, ch = '<'): string {
  while (s.length < len) s += ch;
  return s.slice(0, len);
}

function generateMrzLines(dniNumero: string, nacimiento: string, sexo: string, fechaEmision: string, apellido: string, nombre: string): string[] {
  const docNum = padRight(dniNumero, 8, '0');
  const docCheck = mrzCheckDigit(docNum);
  const line1 = `IDARG${docNum}${docCheck}${padRight('', 25)}`;

  const dob = formatDateYYMMDD(nacimiento);
  const sex = sexo === 'M' ? 'M' : 'F';
  const expiry = formatDateYYMMDD(fechaEmision ? `${parseInt(fechaEmision.split('-')[0]) + 15}-${fechaEmision.split('-')[1]}-${fechaEmision.split('-')[2]}` : '');
  const dobCheck = mrzCheckDigit(dob);
  const expCheck = mrzCheckDigit(expiry);
  const midCheck = mrzCheckDigit(dob + sex + expiry + dobCheck + expCheck);
  const line2 = `${dob}${sex}${expiry}${dobCheck}${expCheck}ARG${padRight('', 13)}${midCheck}`;

  const surname = apellido.toUpperCase().replace(/[^A-Z]/g, '');
  const name = nombre.toUpperCase().replace(/[^A-Z]/g, '');
  const line3 = padRight(`${surname}<<${name}`, 30);

  return [line1, line2, line3];
}

// ========================================
// SVG COMPONENTS
// ========================================
function GuillochePattern({ id, width, height, scale = 1 }: { id: string; width: number; height: number; scale?: number }) {
  const lines: React.ReactNode[] = [];
  const step = 5 * scale;
  // Vertical guilloché waves (teal + pink alternating)
  for (let i = -height; i < width + height; i += step) {
    const offset = (i / step) % 2 === 0 ? 10 * scale : -10 * scale;
    const color = (i / step) % 4 < 2 ? DNI_TEAL : DNI_PINK;
    const opacity = 0.18 + (((i / step) % 3) * 0.06);
    lines.push(
      <path
        key={`g1-${i}`}
        d={`M ${i} 0 C ${i + offset * 0.5} ${height * 0.25} ${i - offset * 0.5} ${height * 0.75} ${i} ${height}`}
        fill="none"
        stroke={color}
        strokeWidth={0.6 * scale}
        opacity={opacity}
      />
    );
  }
  // Horizontal guilloché waves (lighter teal + darker pink)
  for (let j = -width; j < height + width; j += step) {
    const offset = (j / step) % 2 === 0 ? 10 * scale : -10 * scale;
    const color = (j / step) % 4 < 2 ? DNI_TEAL_LIGHT : DNI_PINK_DARK;
    const opacity = 0.12 + (((j / step) % 3) * 0.05);
    lines.push(
      <path
        key={`g2-${j}`}
        d={`M 0 ${j} C ${width * 0.25} ${j + offset * 0.5} ${width * 0.75} ${j - offset * 0.5} ${width} ${j}`}
        fill="none"
        stroke={color}
        strokeWidth={0.5 * scale}
        opacity={opacity}
      />
    );
  }
  // Diagonal guilloché (subtle, for added depth)
  for (let k = -width - height; k < width + height; k += step * 1.5) {
    const color = k % (step * 3) < step * 1.5 ? DNI_TEAL : DNI_PINK;
    lines.push(
      <path
        key={`g3-${k}`}
        d={`M ${k} 0 L ${k + height} ${height}`}
        fill="none"
        stroke={color}
        strokeWidth={0.3 * scale}
        opacity={0.06}
      />
    );
  }
  // Circular rosette patterns (left and right)
  for (const cx of [width * 0.2, width * 0.8]) {
    for (let r = 15 * scale; r < 55 * scale; r += 6 * scale) {
      lines.push(
        <circle
          key={`gc-${cx}-${r}`}
          cx={cx}
          cy={height * 0.55}
          r={r}
          fill="none"
          stroke={r % (12 * scale) < 6 * scale ? DNI_TEAL : DNI_PINK}
          strokeWidth={0.35 * scale}
          opacity={0.1}
        />
      );
    }
  }
  // Center star watermark
  const cx = width * 0.5, cy = height * 0.5;
  for (let i = 0; i < 12; i++) {
    const angle = (i * 30 * Math.PI) / 180;
    const outerR = 40 * scale;
    const innerR = 20 * scale;
    lines.push(
      <line
        key={`star-${i}`}
        x1={cx + Math.cos(angle) * innerR}
        y1={cy + Math.sin(angle) * innerR}
        x2={cx + Math.cos(angle) * outerR}
        y2={cy + Math.sin(angle) * outerR}
        stroke={i % 2 === 0 ? DNI_TEAL : DNI_PINK}
        strokeWidth={0.4 * scale}
        opacity={0.07}
      />
    );
  }
  return (
    <svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      <defs>
        <clipPath id={`clip-${id}`}>
          <rect x="0" y="0" width={width} height={height} rx="8" />
        </clipPath>
      </defs>
      <g clipPath={`url(#clip-${id})`}>
        <rect x="0" y="0" width={width} height={height} fill="#eaf0f5" />
        {lines}
      </g>
    </svg>
  );
}

function ArgentineCoatOfArms({ size = 40 }: { size?: number }) {
  const s = size / 60;
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 60 72" fill="none">
      {/* Sun of May at top */}
      <ellipse cx="30" cy="16" rx="10" ry="10" fill="#F4B840" opacity="0.9" />
      <g stroke="#F4B840" strokeWidth="1.2" opacity="0.8">
        {[...Array(16)].map((_, i) => {
          const angle = (i * 22.5 * Math.PI) / 180;
          const innerR = i % 2 === 0 ? 10 : 8;
          const outerR = i % 2 === 0 ? 15 : 13;
          return (
            <line key={i} x1={30 + Math.cos(angle) * innerR} y1={16 + Math.sin(angle) * innerR} x2={30 + Math.cos(angle) * outerR} y2={16 + Math.sin(angle) * outerR} />
          );
        })}
      </g>
      {/* Face in sun */}
      <circle cx="30" cy="16" r="5" fill="#E8A020" opacity="0.6" />
      <circle cx="28" cy="15" r="0.8" fill="#8B6914" />
      <circle cx="32" cy="15" r="0.8" fill="#8B6914" />
      <path d="M 28 18 Q 30 20 32 18" fill="none" stroke="#8B6914" strokeWidth="0.6" />

      {/* Shield */}
      <path d="M 18 24 L 42 24 L 42 48 Q 42 58 30 62 Q 18 58 18 48 Z" fill="#74ACDF" stroke="#1a3a5c" strokeWidth="1.2" />
      {/* White band in shield */}
      <rect x="18" y="34" width="24" height="5" fill="#fff" />

      {/* Hands with pike */}
      <line x1="30" y1="26" x2="30" y2="44" stroke="#8B6914" strokeWidth="1.5" />
      {/* Liberty cap */}
      <path d="M 27 26 L 30 20 L 33 26 Z" fill="#D42426" stroke="#8B6914" strokeWidth="0.6" />

      {/* Left hand */}
      <ellipse cx="25" cy="38" rx="3" ry="4" fill="#F5D6B8" stroke="#c49a6c" strokeWidth="0.5" transform="rotate(-15, 25, 38)" />
      {/* Right hand */}
      <ellipse cx="35" cy="38" rx="3" ry="4" fill="#F5D6B8" stroke="#c49a6c" strokeWidth="0.5" transform="rotate(15, 35, 38)" />

      {/* Laurel branch (left) */}
      <path d="M 18 48 Q 12 42 14 30" fill="none" stroke="#4a7a3a" strokeWidth="1" />
      {[...Array(5)].map((_, i) => (
        <ellipse key={`l${i}`} cx={14 - i * 0.5} cy={32 + i * 4} rx="3" ry="1.5" fill="#5a8a4a" transform={`rotate(${-20 + i * 5}, ${14 - i * 0.5}, ${32 + i * 4})`} opacity="0.8" />
      ))}

      {/* Olive branch (right) */}
      <path d="M 42 48 Q 48 42 46 30" fill="none" stroke="#4a7a3a" strokeWidth="1" />
      {[...Array(5)].map((_, i) => (
        <ellipse key={`r${i}`} cx={46 + i * 0.5} cy={32 + i * 4} rx="3" ry="1.5" fill="#5a8a4a" transform={`rotate(${20 - i * 5}, ${46 + i * 0.5}, ${32 + i * 4})`} opacity="0.8" />
      ))}

      {/* Ribbon at bottom */}
      <path d="M 16 56 L 24 53 L 30 56 L 36 53 L 44 56" fill="none" stroke="#D42426" strokeWidth="1.5" />
      <path d="M 16 56 L 14 62" fill="none" stroke="#74ACDF" strokeWidth="1" />
      <path d="M 44 56 L 46 62" fill="none" stroke="#74ACDF" strokeWidth="1" />
    </svg>
  );
}



function ArgentinaMap({ width = 120, height = 150, color = DNI_PINK_DARK }: { width?: number; height?: number; color?: string }) {
  return (
    <svg width={width} height={height} viewBox="0 0 100 130" fill="none">
      {/* Simplified Argentina outline */}
      <path
        d="M 55 5 L 62 8 L 68 6 L 72 10 L 70 18 L 74 22 L 72 28 L 76 32 L 74 38 L 78 42 L 74 48 L 70 52 L 72 56 L 68 60 L 70 66 L 66 70 L 62 74 L 58 78 L 56 84 L 52 88 L 48 92 L 50 96 L 46 100 L 42 98 L 38 102 L 36 108 L 32 112 L 28 116 L 30 120 L 26 124 L 22 120 L 18 118 L 16 114 L 12 112 L 14 108 L 18 104 L 20 98 L 22 92 L 26 86 L 28 80 L 30 74 L 28 68 L 30 62 L 34 56 L 36 50 L 38 44 L 42 38 L 44 32 L 48 26 L 50 20 L 52 14 L 54 10 Z"
        fill={color}
        opacity="0.25"
        stroke={color}
        strokeWidth="0.5"
        strokeOpacity="0.4"
      />
      {/* Tierra del Fuego */}
      <path
        d="M 30 124 L 36 122 L 38 126 L 34 128 L 28 128 Z"
        fill={color}
        opacity="0.25"
        stroke={color}
        strokeWidth="0.5"
        strokeOpacity="0.4"
      />
      {/* Antártida claim indicator */}
      <path
        d="M 20 128 L 40 128 L 38 130 L 22 130 Z"
        fill={color}
        opacity="0.12"
      />
    </svg>
  );
}

function MercosurLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 40 24" fill="none">
      {/* Simplified MERCOSUR stars in circle */}
      <circle cx="20" cy="12" r="10" fill="none" stroke="#74ACDF" strokeWidth="0.8" opacity="0.5" />
      {[...Array(4)].map((_, i) => {
        const angle = ((i * 90 - 90) * Math.PI) / 180;
        const x = 20 + Math.cos(angle) * 7;
        const y = 12 + Math.sin(angle) * 7;
        return <circle key={i} cx={x} cy={y} r="1.2" fill="#74ACDF" opacity="0.6" />;
      })}
      <text x="20" y="14" textAnchor="middle" fontSize="5" fill="#74ACDF" fontWeight="600" opacity="0.6">M</text>
    </svg>
  );
}

// ========================================
// MAIN APP COMPONENT
// ========================================
export default function MiArgentinaApp() {
  const { view, _hasHydrated } = useAppStore();

  useEffect(() => {
    const hide = () => {
      const portal = document.querySelector('nextjs-portal');
      if (portal instanceof HTMLElement) portal.style.display = 'none';
    };
    hide();
    const obs = new MutationObserver(hide);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  // Handle Mercado Pago redirect after payment
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const paymentSuccess = params.get('payment_success')
    const paymentFailure = params.get('payment_failure')

    if (paymentSuccess === 'true' && user?.id) {
      // Verify payment by looking up the user's payments
      fetch('/api/mercadopago/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      }).then(res => {
        res.json().then(data => {
          if (data.success) {
            setUser({ ...user, tokens: data.tokens })
          }
          setView('tina')
        })
      }).catch(() => {
        setView('tina')
      })
      window.history.replaceState({}, '', window.location.pathname)
    } else if (paymentSuccess === 'true') {
      // User not logged in yet, redirect to login first
      setView('login')
      window.history.replaceState({}, '', window.location.pathname)
    }

    if (paymentFailure === 'true') {
      setView('tina')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, []);

  // Wait for Zustand persist to rehydrate from localStorage before rendering
  // This prevents hydration mismatch (server renders 'login', client has 'home')
  if (!_hasHydrated) {
    return (
      <div className="min-h-screen w-full flex justify-center bg-white">
        <div className="w-full" style={{ maxWidth: '390px', overflow: 'hidden', minHeight: '100vh' }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex justify-center bg-white">
      <div className="w-full" style={{ maxWidth: '390px', overflow: 'hidden', minHeight: '100vh', position: 'relative' }}>
        {view === 'login' && <LoginView />}
        {view === 'register' && <RegisterView />}
        {view === 'home' && <HomeView />}
        {view === 'documentos' && <DocumentosView />}
        {view === 'dni-viewer' && <DniViewerView />}
        {view === 'admin' && <AdminView />}
        {view === 'novedades' && <NovedadesView />}
        {view === 'telefonos' && <TelefonosView />}
        {view === 'salud' && <SaludView />}
        {view === 'cobros' && <CobrosView />}
        {view === 'hijos' && <HijosView />}
        {view === 'tramites' && <TramitesView />}
        {view === 'trabajo' && <TrabajoView />}
        {view === 'vehiculos' && <VehiculosView />}
        {view === 'tina' && <TinaView />}
        <EditMenu />
      </div>
    </div>
  );
}

function EditMenu() {
  const { menuOpen, setMenuOpen, user, updateDni } = useAppStore();
  const dni = user?.dni;

  const [nombre, setNombre] = useState(dni?.nombre || '');
  const [apellido, setApellido] = useState(dni?.apellido || '');
  const [dniNumero, setDniNumero] = useState(dni?.dniNumero || '');
  const [domicilio, setDomicilio] = useState(dni?.domicilio || '');
  const [nacimiento, setNacimiento] = useState(dni?.nacimiento || '');
  const [fechaEmision, setFechaEmision] = useState(dni?.fechaEmision || '');
  const [sexo, setSexo] = useState(dni?.sexo || '');
  const [tramiteNumero, setTramiteNumero] = useState(dni?.tramiteNumero || '');
  const [ejemplar, setEjemplar] = useState(dni?.ejemplar || '');
  const [foto, setFoto] = useState<string | null>(dni?.foto || null);
  const [firma, setFirma] = useState<string | null>(dni?.firma || null);
  const [removingBg, setRemovingBg] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (dni) {
      setNombre(dni.nombre || '');
      setApellido(dni.apellido || '');
      setDniNumero(dni.dniNumero || '');
      setDomicilio(dni.domicilio || '');
      setNacimiento(dni.nacimiento || '');
      setFechaEmision(dni.fechaEmision || '');
      setSexo(dni.sexo || '');
      setTramiteNumero(dni.tramiteNumero || '');
      setEjemplar(dni.ejemplar || '');
      setFoto(dni.foto || null);
      setFirma(dni.firma || null);
    }
  }, [dni]);

  useEffect(() => {
    if (!firma || !sigCanvasRef.current) return;
    const img = new Image();
    img.onload = () => {
      const ctx = sigCanvasRef.current?.getContext('2d');
      if (ctx) ctx.drawImage(img, 0, 0);
    };
    img.src = firma;
  }, [firma]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        const resized = await resizeImage(base64, 800, 800);
        setRemovingBg(true);
        try {
          const cleaned = await removeImageBackground(resized);
          setFoto(cleaned);
        } catch {
          setFoto(resized);
        } finally {
          setRemovingBg(false);
        }
      };
      reader.readAsDataURL(file);
    } catch {
      // fallback: just keep the original
    }
  };

  const handleRemoveBg = async () => {
    if (!foto || removingBg) return;
    setRemovingBg(true);
    try {
      const cleaned = await removeImageBackground(foto);
      setFoto(cleaned);
    } catch {
      // keep original
    } finally {
      setRemovingBg(false);
    }
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e) ? e.touches[0].clientX - rect.left : e.nativeEvent.offsetX;
    const y = ('touches' in e) ? e.touches[0].clientY - rect.top : e.nativeEvent.offsetY;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e) ? e.touches[0].clientX - rect.left : e.nativeEvent.offsetX;
    const y = ('touches' in e) ? e.touches[0].clientY - rect.top : e.nativeEvent.offsetY;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    const canvas = sigCanvasRef.current;
    if (canvas) setFirma(canvas.toDataURL());
  };

  const clearSignature = () => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setFirma(null);
  };

  const handleSave = async () => {
    if (!user?.id) return;
    try {
      const res = await fetch(`/api/dni/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre, apellido, dniNumero, domicilio, nacimiento,
          fechaEmision, sexo, tramiteNumero, ejemplar, foto, firma,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        console.error('Error al guardar:', err.error);
        return;
      }
      updateDni({
        nombre, apellido, dniNumero, domicilio, nacimiento,
        fechaEmision, sexo, tramiteNumero, ejemplar, foto, firma,
      });
      setMenuOpen(false);
    } catch (error) {
      console.error('Error al guardar datos:', error);
    }
  };

  if (!menuOpen) return null;

  return (
    <>
      <div onClick={() => setMenuOpen(false)} style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999,
      }} />
      <div style={{
        position: 'absolute', top: 0, left: 0, bottom: 0, width: '300px', background: '#fff',
        zIndex: 1000, boxShadow: '2px 0 16px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ background: '#362FC1', color: '#fff', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontFamily: SYS_FONT, fontWeight: 600 }}>Editar Datos</h2>
          <button onClick={() => setMenuOpen(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '22px' }}>✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
          <DniPreviewCard nombre={nombre || 'Nombre'} apellido={apellido || 'Apellido'} dniNumero={dniNumero || '00000000'} sexo={sexo} nacimiento={nacimiento} fechaEmision={fechaEmision} foto={foto} firma={firma} tramiteNumero={tramiteNumero} domicilio={domicilio} />
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <input type="file" ref={fileInputRef} accept="image/*" onChange={handlePhotoUpload} style={{ display: 'none' }} />
            <button type="button" onClick={() => fileInputRef.current?.click()} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', margin: '0 auto' }}>
              <div style={{ width: '70px', height: '70px', borderRadius: '50%', border: '3px solid #362FC1', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', boxShadow: '0 4px 8px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                {foto ? <img src={foto} alt="Foto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Camera size={28} color="#362FC1" />}
              </div>
              <span style={{ color: '#362FC1', fontSize: '14px', fontWeight: 500, fontFamily: SYS_FONT }}>Seleccionar foto</span>
            </button>
          </div>
          {foto && (
            <button type="button" onClick={handleRemoveBg} disabled={removingBg} style={{
              background: removingBg ? '#ccc' : '#362FC1',
              border: 'none', borderRadius: '8px', color: '#fff', padding: '8px 16px',
              fontSize: '13px', fontWeight: 500, cursor: removingBg ? 'not-allowed' : 'pointer',
              fontFamily: SYS_FONT, marginBottom: '16px', width: '100%',
            }}>
              {removingBg ? 'Eliminando fondo...' : 'Quitar fondo'}
            </button>
          )}

          <div style={{ marginBottom: '16px' }}>
            <label style={{ color: '#362FC1', fontSize: '14px', fontWeight: 500, display: 'block', marginBottom: '6px', fontFamily: SYS_FONT }}>Firma</label>
            <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #dbdbdb', padding: '8px' }}>
              <canvas ref={sigCanvasRef} width={480} height={100}
                onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing}
                onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing}
                style={{ width: '100%', height: '100px', border: '1px solid #000', borderRadius: '4px', cursor: 'crosshair', touchAction: 'none' }} />
              <button type="button" onClick={clearSignature} style={{ marginTop: '8px', background: '#fff', border: '1px solid #362FC1', borderRadius: '8px', color: '#362FC1', padding: '6px 16px', fontSize: '13px', cursor: 'pointer', fontFamily: SYS_FONT, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <RotateCcw size={14} /> Limpiar
              </button>
            </div>
          </div>

          <EditField label="Nombre" value={nombre} onChange={setNombre} />
          <EditField label="Apellido" value={apellido} onChange={setApellido} />
          <EditField label="DNI" value={dniNumero} onChange={setDniNumero} />
          <EditField label="Domicilio" value={domicilio} onChange={setDomicilio} />
          <EditField label="Fecha de Nacimiento" value={nacimiento} onChange={setNacimiento} />
          <EditField label="Fecha de Emisión" value={fechaEmision} onChange={setFechaEmision} />
          <EditField label="Sexo" value={sexo} onChange={setSexo} />
          <EditField label="Trámite N°" value={tramiteNumero} onChange={setTramiteNumero} />
          <EditField label="Ejemplar" value={ejemplar} onChange={setEjemplar} />
        </div>
        <div style={{ padding: '16px', borderTop: '1px solid #eee' }}>
          <button onClick={handleSave} style={{
            width: '100%', padding: '10px', background: '#3333cc', color: '#fff', border: 'none',
            borderRadius: '25px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: SYS_FONT,
          }}>Guardar</button>
        </div>
      </div>
    </>
  );
}

function EditField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px', fontFamily: SYS_FONT }}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={{
        width: '100%', padding: '8px 10px', border: '1px solid #ccc', borderRadius: '6px',
        fontSize: '14px', fontFamily: SYS_FONT, boxSizing: 'border-box',
      }} />
    </div>
  );
}

// ========================================
// LOGIN VIEW
// ========================================
function LoginView() {
  const { setView, setUser, setLoading, setError, isLoading, error } = useAppStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isEmailFocused, setIsEmailFocused] = useState(false);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);
  const [isButtonHovered, setIsButtonHovered] = useState(false);

  const isFormValid = email.trim() !== '' && password.trim() !== '';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Error al iniciar sesión'); return; }
      setUser(data.user);
      setView('home');
    } catch { setError('Error de conexión'); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex flex-col items-center justify-center w-full" style={{ minHeight: '100vh', maxWidth: '550px', margin: '0 auto' }}>
      <div style={{ background: '#fff', border: '1px solid #dbdbdb', borderRadius: '1px', padding: '10px 0', marginBottom: '10px', width: '100%' }}>
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', padding: '0 5px', width: '100%' }} noValidate>
          <h2 style={{ fontFamily: SYS_FONT, color: '#8e8e8e', fontSize: '20px', fontWeight: 500, margin: '10px 40px 30px', textAlign: 'center' }}>Inicia sesión</h2>
          <FloatingInput label="Correo electronico" value={email} onChange={setEmail} focused={isEmailFocused} setFocused={setIsEmailFocused} margin="0 40px 15px" />
          <FloatingInput label="Contraseña" value={password} onChange={setPassword} focused={isPasswordFocused} setFocused={setIsPasswordFocused} type="password" margin="0 40px 15px" />
          <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'center', width: '100%' }}>
            <button type="submit" disabled={!isFormValid || isLoading}
              onMouseEnter={() => setIsButtonHovered(true)} onMouseLeave={() => setIsButtonHovered(false)}
              style={{ fontFamily: 'Arial, sans-serif', background: !isFormValid || isLoading ? '#362FC180' : isButtonHovered ? '#2a24a0' : '#362FC1', border: 'none', borderRadius: '12px', boxShadow: isButtonHovered && isFormValid ? '0 8px 15px -3px #0000004d' : '0 6px 15px -5px #0000004d', color: '#fff', cursor: isFormValid && !isLoading ? 'pointer' : 'not-allowed', fontSize: '14px', fontWeight: 600, letterSpacing: '0.5px', padding: '12px 25px', textAlign: 'center', textTransform: 'uppercase', transition: 'all 0.3s ease', transform: isButtonHovered && isFormValid ? 'translateY(-2px)' : 'none', width: '80%' }}>
              {isLoading ? 'Entrando...' : 'Entrar'}
            </button>
          </div>
        </form>
        {error && <p style={{ color: 'red', textAlign: 'center', fontSize: '14px', margin: '10px 40px 0' }}>{error}</p>}
        <p style={{ color: '#262626', fontSize: '14px', margin: '15px', textAlign: 'center', fontFamily: SYS_FONT }}>
          <a href="#" style={{ color: '#362FC1', textDecoration: 'none' }} onClick={(e) => e.preventDefault()}>¿Olvidaste tu contraseña?</a>
        </p>
      </div>
      <div style={{ alignItems: 'center', background: '#fff', border: '1px solid #dbdbdb', borderRadius: '1px', display: 'flex', justifyContent: 'center', padding: '10px 0', width: '100%' }}>
        <p style={{ color: '#262626', fontSize: '14px', margin: '15px', fontFamily: SYS_FONT }}>
          ¿No tienes cuenta?{' '}
          <a href="#" style={{ color: '#362FC1', textDecoration: 'none', fontWeight: 600 }} onClick={(e) => { e.preventDefault(); setView('register'); }}>Registrarse</a>
        </p>
      </div>
    </div>
  );
}

// ========================================
// FLOATING INPUT COMPONENT
// ========================================
function FloatingInput({ label, value, onChange, focused, setFocused, type = 'text', margin = '0 40px 15px' }: {
  label: string; value: string; onChange: (v: string) => void; focused: boolean; setFocused: (v: boolean) => void; type?: string; margin?: string;
}) {
  const hasContent = focused || value;
  return (
    <div style={{ margin }}>
      <div style={{ background: '#fafafa', border: focused ? '1px solid #a8a8a8' : '1px solid #dbdbdb', borderRadius: '3px', display: 'flex', transition: 'border-color 0.1s ease-out' }}>
        <label style={{ display: 'flex', height: '36px', minWidth: 0, position: 'relative', width: '100%' }}>
          <span style={{ color: '#8e8e8e', fontSize: '12px', height: '36px', left: '8px', lineHeight: '36px', overflow: 'hidden', pointerEvents: 'none', position: 'absolute', right: 0, textOverflow: 'ellipsis', transformOrigin: 'left', transition: 'transform 0.1s ease-out', userSelect: 'none', whiteSpace: 'nowrap', transform: hasContent ? 'scale(0.83333) translateY(-10px)' : 'none' }}>{label}</span>
          <input type={type} value={value} onChange={(e) => onChange(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            style={{ background: '#fafafa', border: 'none', borderRadius: '3px', fontSize: hasContent ? '12px' : '16px', overflow: 'hidden', padding: hasContent ? '14px 0 2px 8px' : '9px 0 7px 8px', textOverflow: 'ellipsis', width: '100%', outline: 'none', color: '#333', fontFamily: SYS_FONT, boxSizing: 'border-box' }} />
        </label>
      </div>
    </div>
  );
}

// ========================================
// REGISTER VIEW
// ========================================
function RegisterView() {
  const { setView, setUser, setLoading, setError, isLoading, error } = useAppStore();
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [dniNumero, setDniNumero] = useState('');
  const [domicilio, setDomicilio] = useState('');
  const [nacimiento, setNacimiento] = useState('');
  const [fechaEmision, setFechaEmision] = useState('');
  const [sexo, setSexo] = useState('');
  const [tramiteNumero, setTramiteNumero] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firma, setFirma] = useState<string | null>(null);
  const [foto, setFoto] = useState<string | null>(null);
  const [removingBg, setRemovingBg] = useState(false);
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e) ? e.touches[0].clientX - rect.left : e.nativeEvent.offsetX;
    const y = ('touches' in e) ? e.touches[0].clientY - rect.top : e.nativeEvent.offsetY;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e) ? e.touches[0].clientX - rect.left : e.nativeEvent.offsetX;
    const y = ('touches' in e) ? e.touches[0].clientY - rect.top : e.nativeEvent.offsetY;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    const canvas = sigCanvasRef.current;
    if (canvas) setFirma(canvas.toDataURL());
  };

  const clearSignature = () => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setFirma(null);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        const resized = await resizeImage(base64, 800, 800);
        setRemovingBg(true);
        try {
          const cleaned = await removeImageBackground(resized);
          setFoto(cleaned);
        } catch {
          setFoto(resized);
        } finally {
          setRemovingBg(false);
        }
      };
      reader.readAsDataURL(file);
    } catch {
      setError('Error al procesar la imagen');
    }
  };

  const handleRemoveBg = async () => {
    if (!foto || removingBg) return;
    setRemovingBg(true);
    try {
      const cleaned = await removeImageBackground(foto);
      setFoto(cleaned);
    } catch {
      setError('Error al eliminar el fondo');
    } finally {
      setRemovingBg(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) { setError('Las contraseñas no coinciden'); return; }
    if (password.length < 6) { setError('La contraseña debe tener mínimo 6 caracteres'); return; }
    if (!sexo) { setError('Seleccioná tu sexo'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, nombre, apellido, dniNumero, domicilio, nacimiento, fechaEmision, sexo, firma, foto, tramiteNumero }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Error al registrarse'); return; }
      setUser(data.user);
      setView('home');
    } catch { setError('Error de conexión'); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ backgroundColor: '#f0f0f0', minHeight: '100vh' }}>
      <header style={{ background: '#362FC1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '55px 16px 16px', position: 'sticky', top: 0, zIndex: 50 }}>
        <button onClick={() => setView('login')} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0 }}><ArrowLeft size={24} /></button>
        <span style={{ color: '#fff', fontSize: '17px', fontWeight: 600, fontFamily: SYS_FONT }}>Registro</span>
        <div style={{ width: 24 }} />
      </header>

      <div style={{ padding: '16px', maxWidth: '550px', margin: '0 auto' }}>
        <DniPreviewCard nombre={nombre || 'Nombre'} apellido={apellido || 'Apellido'} dniNumero={dniNumero || '00000000'} sexo={sexo} nacimiento={nacimiento} fechaEmision={fechaEmision} foto={foto} firma={firma} tramiteNumero={tramiteNumero} domicilio={domicilio} />

        <p style={{ color: '#8e8e8e', fontSize: '14px', textAlign: 'center', margin: '20px 0 15px', fontFamily: SYS_FONT }}>Completa tus datos</p>

        <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <RegField label="Nombre" value={nombre} onChange={setNombre} />
          <RegField label="Apellido" value={apellido} onChange={setApellido} />
          <RegField label="DNI" value={dniNumero} onChange={setDniNumero} type="number" />
          <RegField label="Tramite No" value={tramiteNumero} onChange={setTramiteNumero} />
          <RegField label="Domicilio" value={domicilio} onChange={setDomicilio} />

          <div>
            <label style={{ color: '#8e8e8e', fontSize: '14px', display: 'block', marginBottom: '4px', fontFamily: SYS_FONT }}>Nacimiento</label>
            <input type="date" value={nacimiento} onChange={(e) => setNacimiento(e.target.value)} style={{ width: '100%', padding: '10px 12px', border: '1px solid #dbdbdb', borderRadius: '3px', fontSize: '14px', background: '#fafafa', color: '#333', fontFamily: SYS_FONT, boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ color: '#8e8e8e', fontSize: '14px', display: 'block', marginBottom: '4px', fontFamily: SYS_FONT }}>Fecha de emisión</label>
            <input type="date" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} style={{ width: '100%', padding: '10px 12px', border: '1px solid #dbdbdb', borderRadius: '3px', fontSize: '14px', background: '#fafafa', color: '#333', fontFamily: SYS_FONT, boxSizing: 'border-box' }} />
          </div>

          <div>
            <label style={{ color: '#8e8e8e', fontSize: '14px', display: 'block', marginBottom: '4px', fontFamily: SYS_FONT }}>Sexo</label>
            <div style={{ display: 'flex', gap: '20px', padding: '8px 0' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontFamily: SYS_FONT, fontSize: '14px', color: '#333' }}>
                <input type="radio" name="sexo" value="M" checked={sexo === 'M'} onChange={() => setSexo('M')} style={{ accentColor: '#362FC1' }} /> Masculino
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontFamily: SYS_FONT, fontSize: '14px', color: '#333' }}>
                <input type="radio" name="sexo" value="F" checked={sexo === 'F'} onChange={() => setSexo('F')} style={{ accentColor: '#362FC1' }} /> Femenino
              </label>
            </div>
          </div>

          <div>
            <label style={{ color: '#362FC1', fontSize: '14px', fontWeight: 500, display: 'block', marginBottom: '6px', fontFamily: SYS_FONT }}>Firma</label>
            <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #dbdbdb', padding: '8px' }}>
              <canvas ref={sigCanvasRef} width={480} height={120}
                onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing}
                onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing}
                style={{ width: '100%', height: '120px', border: '1px solid #000', borderRadius: '4px', cursor: 'crosshair', touchAction: 'none' }} />
              <button type="button" onClick={clearSignature} style={{ marginTop: '8px', background: '#fff', border: '1px solid #362FC1', borderRadius: '8px', color: '#362FC1', padding: '6px 16px', fontSize: '13px', cursor: 'pointer', fontFamily: SYS_FONT, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <RotateCcw size={14} /> Limpiar
              </button>
            </div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <input type="file" ref={fileInputRef} accept="image/*" onChange={handlePhotoUpload} style={{ display: 'none' }} />
            <button type="button" onClick={() => fileInputRef.current?.click()} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', margin: '0 auto' }}>
              <div style={{ width: '70px', height: '70px', borderRadius: '50%', border: '3px solid #362FC1', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', boxShadow: '0 4px 8px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                {foto ? <img src={foto} alt="Foto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Camera size={28} color="#362FC1" />}
              </div>
              <span style={{ color: '#362FC1', fontSize: '14px', fontWeight: 500, fontFamily: SYS_FONT }}>Seleccionar foto</span>
            </button>
          </div>
          {foto && (
            <button type="button" onClick={handleRemoveBg} disabled={removingBg} style={{
              background: removingBg ? '#ccc' : '#362FC1',
              border: 'none', borderRadius: '8px', color: '#fff', padding: '8px 16px',
              fontSize: '13px', fontWeight: 500, cursor: removingBg ? 'not-allowed' : 'pointer',
              fontFamily: SYS_FONT, marginTop: '4px',
            }}>
              {removingBg ? 'Eliminando fondo...' : 'Quitar fondo'}
            </button>
          )}

          <div style={{ borderTop: '1px solid #dbdbdb', margin: '8px 0', paddingTop: '8px' }}>
            <RegField label="Email" value={email} onChange={setEmail} type="email" />
            <RegField label="Contraseña (mínimo 6 caracteres)" value={password} onChange={setPassword} type="password" />
            <RegField label="Confirmar contraseña" value={confirmPassword} onChange={setConfirmPassword} type="password" />
          </div>

          {error && <p style={{ color: 'red', fontSize: '14px', textAlign: 'center', fontFamily: SYS_FONT }}>{error}</p>}

          <button type="submit" disabled={isLoading} style={{ background: isLoading ? '#362FC180' : '#362FC1', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '14px', fontWeight: 600, letterSpacing: '0.5px', padding: '14px 30px', cursor: isLoading ? 'not-allowed' : 'pointer', textTransform: 'uppercase', transition: 'all 0.3s ease', boxShadow: '0 6px 15px -5px rgba(0,0,0,0.3)', width: '100%', fontFamily: 'Arial, sans-serif' }}>
            {isLoading ? 'Registrando...' : 'Registrarse'}
          </button>
          <div style={{ height: 40 }} />
        </form>
      </div>
    </div>
  );
}

function RegField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label style={{ color: '#8e8e8e', fontSize: '14px', display: 'block', marginBottom: '4px', fontFamily: SYS_FONT }}>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', padding: '10px 12px', border: '1px solid #dbdbdb', borderRadius: '3px', fontSize: '14px', background: '#fafafa', color: '#333', fontFamily: SYS_FONT, boxSizing: 'border-box', outline: 'none' }} />
    </div>
  );
}

// ========================================
// DNI PREVIEW CARD (used in registration and edit menu)
// Shows both front and back with flip-to-interact (like DniViewerView)
// ========================================
function DniPreviewCard({ nombre, apellido, dniNumero, sexo, nacimiento, fechaEmision, foto, firma, tramiteNumero, domicilio }: {
  nombre: string; apellido: string; dniNumero: string; sexo: string; nacimiento: string; fechaEmision: string; foto: string | null; firma: string | null; tramiteNumero?: string; domicilio?: string;
}) {
  const DNI_FONT = "Arial, sans-serif";
  const [showFront, setShowFront] = useState(true);
  const [isFlipping, setIsFlipping] = useState(false);

  const toggleSide = () => {
    setIsFlipping(true);
    setTimeout(() => {
      setShowFront(prev => !prev);
      setIsFlipping(false);
    }, 200);
  };

  const touchStartX = useRef(0);
  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(diff) > 50) toggleSide();
  };

  return (
    <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} onClick={toggleSide} style={{ cursor: 'pointer', perspective: '1000px', marginBottom: '8px' }}>
      <div style={{
        transition: 'transform 0.4s ease, opacity 0.2s ease',
        transform: isFlipping ? 'rotateY(90deg) scale(0.95)' : 'rotateY(0) scale(1)',
        opacity: isFlipping ? 0 : 1,
      }}>
        {showFront && (
          <div className="DNI_imgs" style={{ aspectRatio: '1318 / 833', position: 'relative', width: '100%', backfaceVisibility: 'hidden', zIndex: 2 }}>
            <img className="DNI_IMG" src="/arg_front_new_bg.webp" alt="dni_img" style={{ objectFit: 'contain', width: '100%' }} />
            <div style={{ position: 'absolute', left: '7.46%', bottom: '26.22%', width: '21.62%', height: '43.19%' }}>
              {foto ? (
                <img alt="DNI_photoUrl" src={foto} style={{ height: '100%', objectFit: 'cover', width: '100%' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', background: '#d0dde6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Camera size={20} color="#8aa5b8" />
                </div>
              )}
            </div>
            <div style={{ position: 'absolute', top: '14.3%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>Apellido / Surname</div>
            <div style={{ position: 'absolute', top: '20%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '11px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>{apellido.toUpperCase()}</div>
            <div style={{ position: 'absolute', top: '26.45%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>Nombre / Name</div>
            <div style={{ position: 'absolute', top: '31.16%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '11px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>{nombre.split(' ').map((p: string) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ')}</div>
            <div style={{ position: 'absolute', top: '37.7%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '10px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>Sexo / Sex</div>
            <div style={{ position: 'absolute', top: '43.72%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '11px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>{(sexo || 'M').toUpperCase()}</div>
            <div style={{ position: 'absolute', top: '37.7%', left: '47.35%', color: '#000', fontFamily: DNI_FONT, fontSize: '10px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>Nacionalidad / Nacionality</div>
            <div style={{ position: 'absolute', top: '43.72%', left: '47.3%', color: '#000', fontFamily: DNI_FONT, fontSize: '11px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>ARGENTINA</div>
            <div style={{ position: 'absolute', top: '37.7%', left: '83.78%', color: '#000', fontFamily: DNI_FONT, fontSize: '10px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>Ejemplar</div>
            <div style={{ position: 'absolute', top: '43.72%', left: '83.78%', color: '#000', fontFamily: DNI_FONT, fontSize: '10px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>A</div>
            <div style={{ position: 'absolute', top: '49.57%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>Fecha de nacimiento/ Date of birth</div>
            <div style={{ position: 'absolute', top: '54.28%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '12px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>{formatDateBilingual(nacimiento) || '-'}</div>
            <div style={{ position: 'absolute', top: '60.13%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>Fecha de emision/ Date of issue</div>
            <div style={{ position: 'absolute', top: '64%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '12px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>{formatDateBilingual(fechaEmision) || '-'}</div>
            <div style={{ position: 'absolute', top: '69.69%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>Fecha de vencimiento/ Date of expiry</div>
            <div style={{ position: 'absolute', top: '73.4%', left: '32.144%', color: '#000', fontFamily: DNI_FONT, fontSize: '12px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>{calcExpiryDate(fechaEmision)}</div>
            <div style={{ position: 'absolute', top: '66%', left: '66.97%', color: '#000', fontFamily: DNI_FONT, fontSize: '6px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>FIRMA IDENTIFICADO/SIGNATURE</div>
            <div style={{ position: 'absolute', top: '51.08%', left: '79.97%', width: '14.4%', height: '10%' }}>
              <div style={{ position: 'absolute', top: '-8%', left: '-5%', width: '110%', height: '116%', background: '#fff', borderRadius: '2px' }} />
            </div>
            <div style={{ position: 'absolute', top: '51.08%', left: '78.97%', width: '18%', height: '10%' }}>
              {firma ? (
                <img alt="DNI_signature" src={firma} style={{ position: 'relative', height: '100%', objectFit: 'contain', width: '100%' }} />
              ) : (
                <div style={{ width: '100%', height: '100%' }} />
              )}
            </div>
            <div style={{ position: 'absolute', top: '79.61%', left: '5.41%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>Documento / Document</div>
            <div style={{ position: 'absolute', top: '85.72%', left: '5%', color: '#000', fontFamily: DNI_FONT, fontSize: '15px', fontWeight: 600, lineHeight: 1.2, letterSpacing: '-0.3px', whiteSpace: 'nowrap' }}>{formatDniNumber(dniNumero)}</div>
            <div style={{ position: 'absolute', top: '82.25%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '7.5px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>Tramite No / Of ident</div>
            <div style={{ position: 'absolute', top: '89.67%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>{tramiteNumero || '697876124'}</div>
            <div style={{ position: 'absolute', top: '92.67%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>4052</div>
            <div style={{ position: 'absolute', left: '63.81%', bottom: '-9.46%', width: '33.84%', height: '42.19%', overflow: 'hidden' }}>
              <img src="/barcode_relleno_final.png" alt="Codigo de barras" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
            <div style={{ position: 'absolute', bottom: '2%', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#1a3a5c', transition: 'background-color 0.3s ease' }} />
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#a0c4e0', transition: 'background-color 0.3s ease' }} />
            </div>
          </div>
        )}
        {!showFront && (
          <div className="DNI_back" style={{ aspectRatio: '1320 / 833', position: 'relative', width: '100%', backfaceVisibility: 'hidden', zIndex: 1 }}>
            <img src="/dorso.png" alt="back dni" style={{ objectFit: 'contain', width: '100%' }} />
            <div style={{ position: 'absolute', top: '5%', left: '2%', color: '#000', fontFamily: DNI_FONT, fontSize: '11px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
              <span>DOMICILIO: </span>
              <span>{(domicilio || '-').toUpperCase()}</span>
            </div>
            <div style={{ position: 'absolute', top: '15%', left: '2%', color: '#000', fontFamily: DNI_FONT, fontSize: '11px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
              <span>LUGAR DE NACIMIENTO: </span>
              <span>ARGENTINA</span>
            </div>
            <div style={{ position: 'absolute', bottom: '2%', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#a0c4e0', transition: 'background-color 0.3s ease' }} />
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#1a3a5c', transition: 'background-color 0.3s ease' }} />
            </div>
          </div>
        )}
      </div>
      <p style={{ margin: '4px 0 0', fontSize: '10px', color: '#999', textAlign: 'center', fontFamily: SYS_FONT }}>Tocá para ver el dorso</p>
    </div>
  );
}

// ========================================
// BOTTOM NAVIGATION BAR (shared component)
// ========================================
function StatusBar() {
  return (
    <div style={{
      height: '44px',
      width: '100%',
      background: '#362FC1',
    }} />
  );
}

function HeaderBar({ onLogoTap, onMenuClick }: { onLogoTap?: () => void; onMenuClick?: () => void }) {
  return (
    <div style={{
      background: '#362FC1',
      height: '60px',
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      position: 'relative',
      userSelect: 'none',
    }}>
      <button onClick={onMenuClick} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}>
        <Menu size={26} color="#fff" />
      </button>

      <span onClick={onLogoTap} style={{ color: '#fff', fontSize: '26px', fontWeight: 700, fontFamily: SYS_FONT, cursor: onLogoTap ? 'pointer' : 'default', userSelect: 'none', position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
        <span style={{ color: '#7098DB' }}>mi</span>Argentina
      </span>

      <div style={{ width: '38px', height: '38px', borderRadius: '50%', overflow: 'hidden' }}>
        <img src="/icons/profile-user.png" alt="Perfil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    </div>
  );
}

type BottomTab = 'home' | 'novedades' | 'telefonos' | 'tina';

function BottomNavBar({ activeTab }: { activeTab: BottomTab }) {
  const { setView } = useAppStore();
  const tabs: { key: BottomTab; label: string; icon: string; iconStyle: React.CSSProperties; action: () => void; activeIcon?: string }[] = [
    { key: 'home', label: 'Inicio', icon: '/icons/logo-CASA.png', iconStyle: { height: '30px', width: '26px' }, action: () => setView('home') },
    { key: 'novedades', label: 'Novedades', icon: '/icons/novedadesGRIS.png', activeIcon: '/icons/novedadesVIOLETA.png', iconStyle: { height: '37px', width: '80px', marginLeft: '3px' }, action: () => setView('novedades') },
    { key: 'telefonos', label: 'Teléfonos', icon: '/icons/logo-TELEFONO.png', iconStyle: { height: '37px', width: '50px', marginLeft: '-3px' }, action: () => setView('telefonos') },
    { key: 'tina', label: 'Tina', icon: '/icons/logo-USUARIO.png', activeIcon: '/icons/logo-USUARIO.png', iconStyle: { height: '30px', width: '24px' }, action: () => setView('tina') },
  ];

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: '50%',
      transform: 'translateX(-50%)',
      width: '100%',
      maxWidth: '390px',
      background: '#fff',
      borderTop: '1px solid #e0e0e0',
      display: 'flex',
      flexDirection: 'column',
      padding: '6px 0 0px',
      zIndex: 50,
    }}>
      <div style={{ display: 'flex', width: '100%', paddingBottom: '4px' }}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button key={tab.key} onClick={tab.action} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', padding: '2px 0', flex: 1 }}>
              <div style={{ height: '37px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src={isActive && tab.activeIcon ? tab.activeIcon : tab.icon} alt={tab.label} style={{ ...tab.iconStyle, objectFit: 'contain', filter: tab.activeIcon ? 'none' : (isActive ? 'brightness(0) saturate(100%) invert(22%) sepia(95%) saturate(3000%) hue-rotate(240deg)' : 'brightness(0) saturate(0%) invert(46%)') }} />
              </div>
              <span style={{ fontSize: '12px', color: isActive ? '#362FC1' : '#757575', fontWeight: isActive ? 600 : 400, fontFamily: SYS_FONT }}>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ========================================
// HOME VIEW
// ========================================
function HomeView() {
  const { user, setView, logout } = useAppStore();
  const nombre = user?.dni?.nombre || 'Usuario';
  const isActive = user?.isActive ?? false;
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showAdminPrompt, setShowAdminPrompt] = useState(false);
  const [adminPass, setAdminPass] = useState('');
  const [adminError, setAdminError] = useState('');
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleLogoTap = () => {
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, 500);
    if (tapCountRef.current >= 3) {
      tapCountRef.current = 0;
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      setShowAdminPrompt(true);
      setAdminPass('');
      setAdminError('');
    }
  };

  const handleAdminLogin = () => {
    if (adminPass === 'admin123') {
      setShowAdminPrompt(false);
      setView('admin');
    } else {
      setAdminError('Contraseña incorrecta');
    }
  };

  const services = [
    { icon: '/icons/serv-tramites.png', label: 'Documentos', action: () => setView('documentos'), w: 49, h: 49, scale: true },
    { icon: '/icons/serv-vehiculos.png', label: 'Vehículos', action: () => setView('vehiculos'), w: 79, h: 81, scale: true },
    { icon: '/icons/serv-trabajo.png', label: 'Trabajo', action: () => setView('trabajo'), w: 42, h: 44, scale: true },
    { icon: '/icons/serv-salud.png', label: 'Salud', action: () => setView('salud') },
    { icon: '/icons/serv-cobros.png', label: 'Cobros', action: () => setView('cobros'), w: 48, h: 48, scale: true },
    { icon: '/icons/serv-documentos.png', label: 'Trámites', action: () => setView('tramites'), w: 48, h: 48, scale: true },
    { icon: '/icons/serv-turnos.png', label: 'Turnos', action: () => {} },
    { icon: '/icons/serv-hijos.png', label: 'Hijos', action: () => setView('hijos'), w: 45, h: 45, scale: true },
  ];

  return (
    <div style={{ backgroundColor: '#f0f0f0', minHeight: '100vh', paddingBottom: '70px' }}>
      <StatusBar />
      <HeaderBar onLogoTap={handleLogoTap} onMenuClick={() => useAppStore.getState().setMenuOpen(true)} />

      {/* Greeting section - scrolls away, has rounded bottom */}
      <div style={{ background: '#362FC1', textAlign: 'center', paddingBottom: '24px', borderBottomLeftRadius: '30px', borderBottomRightRadius: '30px', position: 'relative' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 400, color: '#fff', fontFamily: SYS_FONT, margin: 0, padding: '0 16px' }}>¡Hola {nombre}!</h1>
      </div>

      {/* Pending activation notice */}
      {!isActive && (
        <div style={{ background: '#fff3e0', margin: '12px 12px 0', borderRadius: '10px', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px', border: '1px solid #ffcc80', cursor: 'pointer' }} onClick={() => setView('tina')}>
          <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#ff9800', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Bell size={18} color="#fff" />
          </div>
          <div>
            <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#e65100', fontFamily: SYS_FONT }}>Documento inactivo</p>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#bf360c', fontFamily: SYS_FONT, lineHeight: 1.4 }}>Activá tu documento desde la sección <strong>Tina</strong> para ver tu DNI digital.</p>
          </div>
        </div>
      )}

      {/* Mundial Card - 1077×298 @3x → 359×99px display */}
      <div style={{ margin: '12px 12px 0' }}>
        <img src="/card-mundial.png" alt="Viví el Mundial 2026" style={{ width: '100%', aspectRatio: '1077 / 298', borderRadius: '10px', objectFit: 'cover', display: 'block' }} />
      </div>

      {/* Credentials Card Image */}
      <div style={{ margin: '8px 12px 0', borderRadius: '10px', overflow: 'hidden' }}>
        <img src="/credenciales.png" alt="Todas tus credenciales están al día" style={{ width: '100%', aspectRatio: '1077 / 298', objectFit: 'cover', display: 'block' }} />
      </div>

      {/* ¿Qué necesitás hoy? Section */}
      <div style={{ margin: '12px 12px 0' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'rgb(51, 51, 51)', fontFamily: "'Mula Rounded', 'MulaRounded', sans-serif", margin: '16px 0 8px', textAlign: 'left' }}>¿Qué necesitás hoy?</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          {services.map((s, i) => (
            <button key={i} onClick={s.action} style={{ background: '#fff', border: 'none', borderRadius: '17px', aspectRatio: 'auto', height: '82px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', transition: 'transform 0.2s', fontFamily: SYS_FONT }}>
              <div style={{ height: '60px', width: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src={s.icon} alt={s.label} style={{ width: (s.w || 52) + 'px', height: (s.h || 52) + 'px', objectFit: 'contain', ...(s.scale ? { transform: 'scale(1.8)' } : {}) }} />
              </div>
              <span style={{ fontSize: '11px', color: 'rgb(51, 51, 51)', fontWeight: 700, fontFamily: "'Mula Rounded', 'MulaRounded', sans-serif", textAlign: 'center', lineHeight: 1.2, marginTop: '-3px' }}>{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Carrusel de carteles */}
      <div className="hide-scrollbar" style={{ margin: '52px 12px 0', display: 'flex', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ flex: '0 0 calc(100% - 40px)', marginRight: '8px', borderRadius: '17px', overflow: 'hidden' }}>
          <img src="/perfil.png" alt="Mantené tu perfil actualizado" style={{ width: '100%', aspectRatio: '1077 / 298', borderRadius: '17px', objectFit: 'cover', display: 'block' }} />
        </div>
        <div style={{ flex: '0 0 calc(100% - 40px)', borderRadius: '17px', overflow: 'hidden' }}>
          <img src="/cartel-secundario.png" alt="Más información" style={{ width: '100%', aspectRatio: '1077 / 298', borderRadius: '17px', objectFit: 'cover', display: 'block' }} />
        </div>
      </div>

      <BottomNavBar activeTab="home" />

      {/* Admin Password Modal */}
      {showAdminPrompt && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowAdminPrompt(false)}>
          <div style={{ background: '#fff', borderRadius: '16px', padding: '24px', width: '85%', maxWidth: '320px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ textAlign: 'center', marginBottom: '16px' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#362FC1', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <ShieldOff size={24} color="#fff" />
              </div>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#212121', fontFamily: SYS_FONT }}>Acceso Admin</h3>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#757575', fontFamily: SYS_FONT }}>Ingresá la contraseña de administrador</p>
            </div>
            <input
              type="password"
              value={adminPass}
              onChange={(e) => { setAdminPass(e.target.value); setAdminError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdminLogin(); }}
              placeholder="Contraseña"
              autoFocus
              style={{ width: '100%', padding: '12px 14px', border: adminError ? '2px solid #f44336' : '2px solid #e0e0e0', borderRadius: '10px', fontSize: '16px', fontFamily: SYS_FONT, outline: 'none', boxSizing: 'border-box', marginBottom: '8px' }}
            />
            {adminError && <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#f44336', fontFamily: SYS_FONT, textAlign: 'center' }}>{adminError}</p>}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setShowAdminPrompt(false)} style={{ flex: 1, padding: '12px', border: '2px solid #e0e0e0', borderRadius: '10px', background: '#fff', color: '#757575', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: SYS_FONT }}>
                Cancelar
              </button>
              <button onClick={handleAdminLogin} style={{ flex: 1, padding: '12px', border: 'none', borderRadius: '10px', background: '#362FC1', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: SYS_FONT }}>
                Entrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ========================================
// DOCUMENTOS VIEW
// ========================================
function DocumentosView() {
  const { user, setView, setUser } = useAppStore();
  const [dniExpanded, setDniExpanded] = useState(true);
  const dni = user?.dni;
  const isActive = user?.isActive ?? false;

  useEffect(() => {
    if (!user?.id) return;
    fetch(`/api/user/${user.id}`).then(res => {
      if (res.ok) {
        res.json().then(data => {
          if (data.user) setUser(data.user);
        });
      }
    }).catch(() => {});
  }, []);

  return (
    <div style={{ backgroundColor: '#f5f6fa', minHeight: '100vh', paddingBottom: '70px' }}>
      <header style={{ background: '#3333cc', display: 'flex', alignItems: 'center', padding: '55px 16px 16px', position: 'sticky', top: 0, zIndex: 50 }}>
        <button onClick={() => setView('home')} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', marginRight: '16px', padding: 0 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M19 12H5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M12 19L5 12L12 5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#fff', fontFamily: SYS_FONT }}>Documentos</h1>
      </header>

      <div style={{ padding: '20px', maxWidth: '375px', margin: '0 auto' }}>
        {!isActive && (
          <div style={{ background: '#fff3e0', borderRadius: '10px', padding: '14px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '12px', border: '1px solid #ffcc80' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#ff9800', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Bell size={18} color="#fff" />
            </div>
            <div>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#e65100', fontFamily: SYS_FONT }}>Cuenta sin tokens disponibles</p>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#bf360c', fontFamily: SYS_FONT, lineHeight: 1.4 }}>Necesitás tokens para ver tu DNI digital. Conseguilos en la sección Tina.</p>
            </div>
          </div>
        )}
        <div style={{ background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden', marginBottom: '20px' }}>
          <button onClick={() => dni ? setDniExpanded(!dniExpanded) : null} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', border: 'none', borderBottom: dniExpanded ? '1px solid #f0f0f0' : 'none', background: 'none', cursor: dni ? 'pointer' : 'default', textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <img src="/icons/dni-icon.png" alt="DNI" style={{ width: '66.248px', height: '47.32px', marginRight: '16px' }} />
              <div style={{ width: '2px', height: '36px', backgroundColor: '#ddd', marginRight: '12px' }} />
              <div>
                <div style={{ fontSize: '14px', color: '#757575', marginBottom: '2px', fontFamily: SYS_FONT }}>Mis documentos</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#333', lineHeight: 1.3, maxWidth: '200px', fontFamily: SYS_FONT }}>Documento Nacional de Identidad (DNI)</div>
              </div>
            </div>
            {dni && (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d={dniExpanded ? "M18 15L12 9L6 15" : "M6 9L12 15L18 9"} stroke="#555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            )}
          </button>
          {dniExpanded && (
            <div style={{ padding: '24px 16px', textAlign: 'center' }}>
              {isActive ? (
                <button onClick={() => dni && setView('dni-viewer')} style={{ width: '100%', background: '#3333cc', color: '#fff', border: 'none', padding: '10px', borderRadius: '25px', fontSize: '14px', fontWeight: 600, cursor: dni ? 'pointer' : 'default', fontFamily: SYS_FONT, marginBottom: '24px' }}>
                  Ver DNI Digital
                </button>
              ) : (
                <div style={{ background: '#fff3e0', borderRadius: '10px', padding: '14px 16px', marginBottom: '24px', border: '1px solid #ffcc80' }}>
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#e65100', fontFamily: SYS_FONT }}>Sin tokens disponibles</p>
                  <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#bf360c', fontFamily: SYS_FONT, lineHeight: 1.4 }}>Necesitás tokens para ver tu DNI digital. Conseguilos en la sección Tina.</p>
                </div>
              )}
              <div style={{ fontSize: '12px', color: '#757575', marginBottom: '40px', fontFamily: SYS_FONT }}>
                Datos suministrados por <span style={{ color: '#33a1de', fontWeight: 600 }}>RENAPER</span>
              </div>
              <div style={{ fontSize: '14px', color: '#666', lineHeight: 1.5, marginBottom: '20px', textAlign: 'left', padding: '0 8px', fontFamily: SYS_FONT }}>
                Recordá que podés solicitar el DNI para vos y tus hijos y tenerlos disponibles en la App.
              </div>
              <button style={{ width: '100%', background: '#fff', color: '#3333cc', border: '2px solid #3333cc', padding: '12px', borderRadius: '25px', fontSize: '16px', fontWeight: 600, cursor: 'pointer', fontFamily: SYS_FONT, marginBottom: '12px' }}>
                Solicitar DNI Digital
              </button>
            </div>
          )}
          <button style={{ display: 'flex', alignItems: 'center', border: 'none', background: 'none', padding: '16px', width: '100%', cursor: 'pointer', fontFamily: SYS_FONT, borderTop: '1px solid #f0f0f0' }}>
            <span style={{ color: '#3333cc', fontSize: '20px', marginRight: '12px', display: 'flex', alignItems: 'center' }}>
              <img src="/icons/help-dispositivo.png" alt="Ayuda" style={{ width: '39px', height: '39px' }} />
            </span>
            <span style={{ color: '#3333cc', fontSize: '14px', fontWeight: 500, fontFamily: SYS_FONT }}>Cambié o voy a cambiar de dispositivo</span>
          </button>
        </div>

      </div>

      <BottomNavBar activeTab="home" />
    </div>
  );
}

// ========================================
// DNI VIEWER VIEW
// Exact replica of Mi Argentina's DNI viewer using original app's
// positioning system (based on 370px reference width, converted to %)
// Templates: arg_front_new_bg.webp (1318x833) / arg_back_new_bg.webp (1320x833)
// ========================================
function DniViewerView() {
  const { user, setView } = useAppStore();
  const dni = user?.dni;
  const [showFront, setShowFront] = useState(true);
  const [isFlipping, setIsFlipping] = useState(false);
  const [showQr, setShowQr] = useState(false);

  // Real Mi Argentina app uses Arial for DNI text (see .DNI_text in main.css)
  const DNI_FONT = "Arial, sans-serif";

  const toggleSide = useCallback(() => {
    setIsFlipping(true);
    setTimeout(() => {
      setShowFront(prev => !prev);
      setIsFlipping(false);
    }, 200);
  }, []);

  const touchStartX = useRef(0);
  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(diff) > 50) toggleSide();
  };

  // Current timestamp for "last updated"
  const lastUpdated = useMemo(() => {
    const now = new Date();
    return now.toLocaleString('es').replace(',', '') + ' hs';
  }, []);

  if (!dni) return <div style={{ padding: 40, textAlign: 'center', fontFamily: SYS_FONT }}>No hay datos de DNI</div>;

  const fullName = `${dni.apellido} ${dni.nombre}`.split(' ').map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');

  return (
    <div style={{ backgroundColor: '#f0f0f0', minHeight: '100vh', paddingBottom: '70px' }}>
      {/* Header - matches Header_container--internal from real app */}
      <header style={{ background: '#362FC1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '55px 16px 16px', position: 'sticky', top: 0, zIndex: 50 }}>
        <button onClick={() => setView('documentos')} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}><ArrowLeft size={24} color="#fff" /></button>
        <span style={{ color: '#fff', fontSize: '18px', fontWeight: 700, fontFamily: SYS_FONT, position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>DNI Digital</span>
        <button onClick={() => window.location.reload()} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}><RefreshCw size={22} color="#fff" /></button>
      </header>

      <div className="DNI_contentContainer" style={{ padding: '20px' }}>
        {/* DNI_content - white card with shadow */}
        <div style={{ backgroundColor: '#fff', borderRadius: '15px', boxShadow: '0 10px 20px -14px', display: 'flex', flexDirection: 'column' }}>

          {/* DNI_contentPaddingAddition */}
          <div style={{ display: 'flex', flexDirection: 'column', padding: '17px 17px 6px' }}>
            {/* DNI_contentUsername */}
            <span style={{ fontSize: '15px', fontWeight: 700, marginBottom: '10px' }}>{fullName}</span>

            {/* DNI card with flip */}
            <div
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onClick={toggleSide}
              style={{ cursor: 'pointer', perspective: '1000px' }}
            >
              <div style={{
                transition: 'transform 0.4s ease, opacity 0.2s ease',
                transform: isFlipping ? 'rotateY(90deg) scale(0.95)' : 'rotateY(0) scale(1)',
                opacity: isFlipping ? 0 : 1,
              }}>
                {showFront ? (
                  /* ======== FRONT OF DNI ======== */
                  <div className="DNI_content1" style={{ alignItems: 'center', display: 'flex', flexDirection: 'column', transformStyle: 'preserve-3d', width: '100%' }}>
                    <div className="DNI_imgs" style={{ aspectRatio: '1318 / 833', position: 'relative', width: 'calc(min(100vw, 390px) - 74px)', backfaceVisibility: 'hidden', transform: 'translateZ(0)', zIndex: 2 }}>
                      <img className="DNI_IMG" src="/arg_front_new_bg.webp" alt="dni_img" style={{ objectFit: 'contain', width: '100%' }} />

                      {/* Profile photo */}
                      <div style={{ position: 'absolute', left: '7.46%', bottom: '26.22%', width: '21.62%', height: '43.19%' }}>
                        {dni.foto ? (
                          <img alt="DNI_photoUrl" src={dni.foto} style={{ height: '100%', objectFit: 'cover', width: '100%' }} />
                        ) : (
                          <div style={{ width: '100%', height: '100%', background: '#d0dde6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Camera size={20} color="#8aa5b8" />
                          </div>
                        )}
                      </div>

                      {/* ====== DATA AREA - Absolute positioned fields ====== */}
                      {/* Apellido / Surname label */}
                      <div style={{ position: 'absolute', top: '14.3%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        Apellido / Surname
                      </div>
                      {/* Apellido value */}
                      <div style={{ position: 'absolute', top: '20%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '11px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        {dni.apellido.toUpperCase()}
                      </div>

                      {/* Nombre / Name label */}
                      <div style={{ position: 'absolute', top: '26.45%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        Nombre / Name
                      </div>
                      {/* Nombre value - only first letter capitalized */}
                      <div style={{ position: 'absolute', top: '31.16%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '11px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        {dni.nombre.split(' ').map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ')}
                      </div>

                      {/* Sexo / Sex label */}
                      <div style={{ position: 'absolute', top: '37.7%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '10px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        Sexo / Sex
                      </div>
                      {/* Sexo value */}
                      <div style={{ position: 'absolute', top: '43.72%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '11px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        {(dni.sexo || 'M').toUpperCase()}
                      </div>

                      {/* Nacionalidad / Nacionality label */}
                      <div style={{ position: 'absolute', top: '37.7%', left: '47.35%', color: '#000', fontFamily: DNI_FONT, fontSize: '10px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        Nacionalidad / Nacionality
                      </div>
                      {/* Nacionalidad value */}
                      <div style={{ position: 'absolute', top: '43.72%', left: '47.3%', color: '#000', fontFamily: DNI_FONT, fontSize: '11px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        ARGENTINA
                      </div>

                      {/* Ejemplar label */}
                      <div style={{ position: 'absolute', top: '37.7%', left: '83.78%', color: '#000', fontFamily: DNI_FONT, fontSize: '10px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        Ejemplar
                      </div>
                      {/* Ejemplar value */}
                      <div style={{ position: 'absolute', top: '43.72%', left: '83.78%', color: '#000', fontFamily: DNI_FONT, fontSize: '10px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        {dni.ejemplar || 'A'}
                      </div>

                      {/* Fecha de nacimiento label */}
                      <div style={{ position: 'absolute', top: '49.57%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        Fecha de nacimiento/ Date of birth
                      </div>
                      {/* Fecha de nacimiento value */}
                      <div style={{ position: 'absolute', top: '54.28%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '12px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        {formatDateBilingual(dni.nacimiento)}
                      </div>

                      {/* Fecha de emisión label */}
                      <div style={{ position: 'absolute', top: '60.13%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        Fecha de emisión/ Date of issue
                      </div>
                      {/* Fecha de emisión value */}
                      <div style={{ position: 'absolute', top: '64%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '12px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        {formatDateBilingual(dni.fechaEmision)}
                      </div>

                      {/* Fecha de vencimiento label */}
                      <div style={{ position: 'absolute', top: '69.69%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        Fecha de vencimiento/ Date of expiry
                      </div>
                      {/* Fecha de vencimiento value */}
                      <div style={{ position: 'absolute', top: '73.4%', left: '32.144%', color: '#000', fontFamily: DNI_FONT, fontSize: '12px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        {calcExpiryDate(dni.fechaEmision)}
                      </div>

                      {/* FIRMA IDENTIFICADO/SIGNATURE */}
                      <div style={{ position: 'absolute', top: '66%', left: '66.97%', color: '#000', fontFamily: DNI_FONT, fontSize: '6px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        FIRMA IDENTIFICADO/SIGNATURE
                      </div>

                      {/* White background behind signature */}
                      <div style={{ position: 'absolute', top: '51.08%', left: '79.97%', width: '14.4%', height: '10%' }}>
                        <div style={{ position: 'absolute', top: '-8%', left: '-5%', width: '110%', height: '116%', background: '#fff', borderRadius: '2px' }} />
                      </div>
                      {/* Signature photo */}
                      <div style={{ position: 'absolute', top: '51.08%', left: '78.97%', width: '18%', height: '10%' }}>
                        {dni.firma ? (
                          <img alt="DNI_signature" src={dni.firma} style={{ position: 'relative', height: '100%', objectFit: 'contain', width: '100%' }} />
                        ) : (
                          <div style={{ width: '100%', height: '100%' }} />
                        )}
                      </div>

                      {/* Documento / Document label */}
                      <div style={{ position: 'absolute', top: '79.61%', left: '5.41%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        Documento / Document
                      </div>

                      {/* DNI number - fontWeight 600 */}
                      <div style={{ position: 'absolute', top: '85.72%', left: '5%', color: '#000', fontFamily: DNI_FONT, fontSize: '15px', fontWeight: 600, lineHeight: 1.2, letterSpacing: '-0.3px', whiteSpace: 'nowrap' }}>
                        {formatDniNumber(dni.dniNumero)}
                      </div>

                      {/* Tramite No / Of ident label */}
                      <div style={{ position: 'absolute', top: '82.25%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '7.5px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        Tramite No / Of ident
                      </div>
                      {/* Tramite number */}
                      <div style={{ position: 'absolute', top: '89.67%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        {dni.tramiteNumero || '697876124'}
                      </div>
                      {/* Office code */}
                      <div style={{ position: 'absolute', top: '92.67%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                        4052
                      </div>

                      {/* Barcode - bottom right */}
                      <div style={{ position: 'absolute', left: '63.81%', bottom: '-9.46%', width: '33.84%', height: '42.19%', overflow: 'hidden' }}>
                        <img src="/barcode_relleno_final.png" alt="Código de barras" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      </div>

                      {/* Dynamic dots indicator - next to barcode */}
                      <div style={{ position: 'absolute', bottom: '2%', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: showFront ? '#a0c4e0' : '#1a3a5c', transition: 'background-color 0.3s ease' }} />
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: showFront ? '#1a3a5c' : '#a0c4e0', transition: 'background-color 0.3s ease' }} />
                      </div>

                    </div>
                  </div>
                ) : (
                  /* ======== BACK OF DNI ======== */
                  <div className="DNI_back" style={{ aspectRatio: '1320 / 833', position: 'relative', width: 'calc(min(100vw, 390px) - 74px)', backfaceVisibility: 'hidden', zIndex: 1 }}>
                    <img src="/dorso.png" alt="back dni" style={{ objectFit: 'contain', width: '100%' }} />

                    {/* DOMICILIO */}
                    <div style={{ position: 'absolute', top: '5%', left: '2%', color: '#000', fontFamily: DNI_FONT, fontSize: '11px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                      <span>DOMICILIO: </span>
                      <span>{(dni.domicilio || '-').toUpperCase()}</span>
                    </div>

                    {/* LUGAR DE NACIMIENTO */}
                    <div style={{ position: 'absolute', top: '15%', left: '2%', color: '#000', fontFamily: DNI_FONT, fontSize: '11px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                      <span>LUGAR DE NACIMIENTO: </span>
                      <span>ARGENTINA</span>
                    </div>

                    {/* Dynamic dots indicator - back side, bottom center */}
                    <div style={{ position: 'absolute', bottom: '2%', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: showFront ? '#a0c4e0' : '#1a3a5c', transition: 'background-color 0.3s ease' }} />
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: showFront ? '#1a3a5c' : '#a0c4e0', transition: 'background-color 0.3s ease' }} />
                    </div>

                  </div>
                )}
              </div>


            </div>
          </div>

          {/* Last updated timestamp - above the line */}
          <span className="DNI_lastAct" style={{ display: 'block', fontSize: '13px', fontWeight: 400, color: '#757575', marginBottom: '10px', marginTop: '10px', textAlign: 'center', fontFamily: SYS_FONT }}>
            Última actualización: {lastUpdated}
          </span>

          {/* DNI_contentInfoContainer - buttons section */}
          <div style={{ borderTop: '1px solid #aeaeae', display: 'flex', flexDirection: 'column' }}>
            {/* Button row 1: Ver detalle + Desactivar DNI */}
            <div className="DNI_contentBtnContainer" style={{ borderBottom: '1px solid #aeaeae', display: 'flex' }}>
              <div className="DNI_contentBtn" style={{ alignItems: 'center', display: 'flex', gap: '12px', padding: '14px 16px', position: 'relative', width: '100%', borderRight: '1px solid #aeaeae' }}>
                <img src="/icons/logo-ojo.png" alt="Ver" style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
                <span style={{ fontSize: '14px', fontWeight: 400, fontFamily: SYS_FONT, color: '#212121' }}>Ver detalle</span>
              </div>
              <div className="DNI_contentBtn" style={{ alignItems: 'center', display: 'flex', gap: '12px', padding: '14px 16px', position: 'relative', width: '100%' }}>
                <img src="/icons/logo-X.png" alt="Desactivar" style={{ width: '17px', height: '24px', objectFit: 'contain' }} />
                <span style={{ fontSize: '14px', fontWeight: 400, fontFamily: SYS_FONT, color: '#212121' }}>Desactivar DNI</span>
              </div>
            </div>

            {/* Button row 2: Verifica código QR */}
            <div className="DNI_contentBtnContainer" style={{ display: 'flex' }}>
              <div className="DNI_contentBtn" onClick={(e) => { e.stopPropagation(); setShowQr(prev => !prev); }} style={{ alignItems: 'center', display: 'flex', gap: '12px', padding: '14px 16px', position: 'relative', width: '100%', cursor: 'pointer' }}>
                <img src="/icons/logo-QR.png" alt="QR" style={{ width: '22px', height: '22px', objectFit: 'contain' }} />
                <span style={{ fontSize: '14px', fontWeight: 400, fontFamily: SYS_FONT, color: '#212121' }}>Verifica código QR</span>
                <div style={{ margin: '0 10px -5px auto' }}>
                  <svg width="15px" viewBox="0 0 25.93 25.93" fill="#565656">
                    <path d="M25.397,4.554h-2.042l-9.974,12.644c-0.101,0.124-0.256,0.197-0.416,0.197c-0.164,0-0.315-0.073-0.419-0.197L2.575,4.554H0.532c-0.206,0-0.392,0.115-0.479,0.299c-0.09,0.184-0.064,0.403,0.06,0.561l12.435,15.762c0.104,0.125,0.255,0.2,0.419,0.2c0.16,0,0.315-0.075,0.416-0.2L25.816,5.413c0.128-0.157,0.148-0.377,0.058-0.561C25.789,4.669,25.601,4.554,25.397,4.554z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* QR expandable section */}
          {showQr && (
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <img src="/icons/logo-QR.png" alt="QR" style={{ width: '22px', height: '22px', objectFit: 'contain' }} />
              <p style={{ color: '#666', fontSize: '12px', fontFamily: SYS_FONT, textAlign: 'center', margin: '4px 0 0' }}>
                Escaneá este código para verificar la autenticidad del documento
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom navigation - matches Home_navContainer from real app */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: '390px',
        background: '#fff',
        borderTop: '1px solid #e0e0e0',
        display: 'flex',
        padding: '6px 0 8px',
        zIndex: 50,
      }}>
        <button onClick={() => setView('home')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', padding: '2px 0', flex: 1 }}>
          <div style={{ height: '37px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src="/icons/logo-CASA.png" alt="Inicio" style={{ height: '30px', width: '26px', objectFit: 'contain' }} />
          </div>
          <span style={{ fontSize: '12px', color: '#362FC1', fontWeight: 600, fontFamily: SYS_FONT }}>Inicio</span>
        </button>
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', padding: '2px 0', flex: 1 }}>
          <div style={{ height: '37px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src="/icons/logo-NOVEDADES.png" alt="Novedades" style={{ height: '37px', width: '80px', marginLeft: '3px', objectFit: 'contain' }} />
          </div>
          <span style={{ fontSize: '12px', color: '#757575', fontFamily: SYS_FONT }}>Novedades</span>
        </button>
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', padding: '2px 0', flex: 1 }}>
          <div style={{ height: '37px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src="/icons/logo-TELEFONO.png" alt="Teléfonos" style={{ height: '37px', width: '50px', marginLeft: '-3px', objectFit: 'contain' }} />
          </div>
          <span style={{ fontSize: '12px', color: '#757575', fontFamily: SYS_FONT }}>Teléfonos</span>
        </button>
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', padding: '2px 0', flex: 1 }}>
          <div style={{ height: '37px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src="/icons/logo-USUARIO.png" alt="Usuario" style={{ height: '30px', width: '24px', objectFit: 'contain' }} />
          </div>
          <span style={{ fontSize: '12px', color: '#757575', fontFamily: SYS_FONT }}>Usuario</span>
        </button>
      </div>
    </div>
  );
}

// ========================================
// ADMIN VIEW
// Secret panel (accessible via triple-tap on "miArgentina" logo)
// Shows all registered users and allows activation/deactivation
// ========================================
function AdminView() {
  const { setView, setUser, user } = useAppStore();
  const [users, setUsers] = useState<Array<{
    id: string;
    email: string;
    isActive: boolean;
    tokens: number;
    createdAt: string;
    dni: { nombre: string; apellido: string; dniNumero: string } | null;
  }> | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);
  const [tokenInputs, setTokenInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const ADMIN_KEY = 'admin123';

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users', {
        headers: { 'x-admin-key': ADMIN_KEY },
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Error al cargar usuarios'); return; }
      setUsers(data.users);
    } catch {
      setError('Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleActivate = async (userId: string, makeActive: boolean) => {
    setActivating(userId);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/admin/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
        body: JSON.stringify({ userId, isActive: makeActive }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Error al activar'); return; }
      setSuccess(makeActive ? 'Cuenta activada ✓' : 'Cuenta desactivada ✓');

      if (user && userId === user.id) {
        setUser({ ...user, isActive: makeActive });
      }

      await fetchUsers();
    } catch {
      setError('Error de conexión');
    } finally {
      setActivating(null);
      setTimeout(() => setSuccess(null), 3000);
    }
  };

  const handleAddTokens = async (userId: string) => {
    const amount = parseInt(tokenInputs[userId] || '0', 10);
    if (!amount || amount <= 0) return;
    setActivating(userId);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/admin/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
        body: JSON.stringify({ userId, addTokens: amount }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Error al asignar tokens'); return; }
      setSuccess(`Se asignaron ${amount} token(s) ✓`);
      setTokenInputs(prev => ({ ...prev, [userId]: '' }));

      if (user && userId === user.id && data.user) {
        setUser(data.user);
      }

      await fetchUsers();
    } catch {
      setError('Error de conexión');
    } finally {
      setActivating(null);
      setTimeout(() => setSuccess(null), 3000);
    }
  };

  const pendingUsers = users?.filter(u => !u.isActive) || [];
  const activeUsers = users?.filter(u => u.isActive) || [];

  return (
    <div style={{ backgroundColor: '#f0f0f0', minHeight: '100vh' }}>
      <header style={{ background: '#362FC1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '55px 16px 16px', position: 'sticky', top: 0, zIndex: 50 }}>
        <button onClick={() => setView('home')} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}><ArrowLeft size={24} /></button>
        <span style={{ color: '#fff', fontSize: '17px', fontWeight: 600, fontFamily: SYS_FONT }}>Admin Panel</span>
        <button onClick={fetchUsers} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}><RefreshCw size={22} /></button>
      </header>

      <div style={{ padding: '16px' }}>
        {error && (
          <div style={{ background: '#ffebee', borderRadius: '8px', padding: '12px 16px', marginBottom: '12px', border: '1px solid #ef9a9a' }}>
            <p style={{ margin: 0, fontSize: '14px', color: '#c62828', fontFamily: SYS_FONT }}>{error}</p>
          </div>
        )}
        {success && (
          <div style={{ background: '#e8f5e9', borderRadius: '8px', padding: '12px 16px', marginBottom: '12px', border: '1px solid #a5d6a7' }}>
            <p style={{ margin: 0, fontSize: '14px', color: '#2e7d32', fontFamily: SYS_FONT }}>{success}</p>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <RefreshCw size={32} color="#362FC1" style={{ animation: 'spin 1s linear infinite' }} />
            <p style={{ color: '#757575', fontFamily: SYS_FONT, marginTop: '12px' }}>Cargando usuarios...</p>
          </div>
        ) : (
          <>
            {/* Pending Users */}
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#e65100', fontFamily: SYS_FONT, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Bell size={18} />
                Pendientes ({pendingUsers.length})
              </h3>
              {pendingUsers.length === 0 ? (
                <div style={{ background: '#fff', borderRadius: '10px', padding: '20px', textAlign: 'center' }}>
                  <p style={{ margin: 0, color: '#9e9e9e', fontFamily: SYS_FONT, fontSize: '14px' }}>No hay usuarios pendientes</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {pendingUsers.map(u => (
                    <div key={u.id} style={{ background: '#fff', borderRadius: '10px', padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', borderLeft: '4px solid #ff9800' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#212121', fontFamily: SYS_FONT }}>
                            {u.dni ? `${u.dni.apellido}, ${u.dni.nombre}` : 'Sin datos'}
                          </p>
                          <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#757575', fontFamily: SYS_FONT }}>{u.email}</p>
                          <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#9e9e9e', fontFamily: SYS_FONT }}>
                            DNI: {u.dni?.dniNumero || '-'} · Tokens: {u.tokens} · Registrado: {new Date(u.createdAt).toLocaleDateString('es')}
                          </p>
                          <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                            <input
                              type="number"
                              min="1"
                              placeholder="Tokens"
                              value={tokenInputs[u.id] || ''}
                              onChange={(e) => setTokenInputs(prev => ({ ...prev, [u.id]: e.target.value }))}
                              style={{ width: '70px', padding: '4px 6px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px' }}
                            />
                            <button
                              onClick={() => handleAddTokens(u.id)}
                              disabled={activating === u.id || !tokenInputs[u.id] || parseInt(tokenInputs[u.id] || '0') <= 0}
                              style={{
                                background: '#ff9800',
                                border: 'none', borderRadius: '6px', color: '#fff',
                                padding: '4px 10px', fontSize: '12px', fontWeight: 600,
                                cursor: 'pointer', fontFamily: SYS_FONT,
                              }}
                            >
                              + Tokens
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Active Users */}
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#2e7d32', fontFamily: SYS_FONT, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldOff size={18} />
                Activas ({activeUsers.length})
              </h3>
              {activeUsers.length === 0 ? (
                <div style={{ background: '#fff', borderRadius: '10px', padding: '20px', textAlign: 'center' }}>
                  <p style={{ margin: 0, color: '#9e9e9e', fontFamily: SYS_FONT, fontSize: '14px' }}>No hay usuarios activos</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {activeUsers.map(u => (
                    <div key={u.id} style={{ background: '#fff', borderRadius: '10px', padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', borderLeft: '4px solid #4caf50' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#212121', fontFamily: SYS_FONT }}>
                            {u.dni ? `${u.dni.apellido}, ${u.dni.nombre}` : 'Sin datos'}
                          </p>
                          <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#757575', fontFamily: SYS_FONT }}>{u.email}</p>
                          <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#9e9e9e', fontFamily: SYS_FONT }}>
                            DNI: {u.dni?.dniNumero || '-'} · Tokens restantes: {u.tokens}
                          </p>
                          <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                            <input
                              type="number"
                              min="1"
                              placeholder="Tokens"
                              value={tokenInputs[u.id] || ''}
                              onChange={(e) => setTokenInputs(prev => ({ ...prev, [u.id]: e.target.value }))}
                              style={{ width: '70px', padding: '4px 6px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px' }}
                            />
                            <button
                              onClick={() => handleAddTokens(u.id)}
                              disabled={activating === u.id || !tokenInputs[u.id] || parseInt(tokenInputs[u.id] || '0') <= 0}
                              style={{
                                background: '#4caf50',
                                border: 'none', borderRadius: '6px', color: '#fff',
                                padding: '4px 10px', fontSize: '12px', fontWeight: 600,
                                cursor: 'pointer', fontFamily: SYS_FONT,
                              }}
                            >
                              + Tokens
                            </button>
                          </div>
                        </div>
                        <button
                          onClick={() => handleActivate(u.id, false)}
                          disabled={activating === u.id}
                          style={{
                            background: activating === u.id ? '#ef9a9a' : '#f44336',
                            border: 'none', borderRadius: '8px', color: '#fff',
                            padding: '8px 14px', fontSize: '13px', fontWeight: 600,
                            cursor: activating === u.id ? 'not-allowed' : 'pointer',
                            fontFamily: SYS_FONT, whiteSpace: 'nowrap', flexShrink: 0, marginLeft: '10px',
                          }}
                        >
                          {activating === u.id ? '...' : 'Desactivar'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ========================================
// ========================================
// NOVEDADES VIEW
// ========================================
function NovedadesView() {
  const { setView } = useAppStore();

  return (
    <div style={{ backgroundColor: '#f0f0f0', minHeight: '100vh', paddingBottom: '70px' }}>
      <div style={{ background: '#3133B4' }}>
        <StatusBar />
        <div style={{ height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
          <button onClick={() => useAppStore.getState().setMenuOpen(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '18px', width: '24px', padding: 0 }}>
            <span style={{ display: 'block', height: '2px', width: '100%', background: '#fff', borderRadius: '2px' }} />
            <span style={{ display: 'block', height: '2px', width: '100%', background: '#fff', borderRadius: '2px' }} />
            <span style={{ display: 'block', height: '2px', width: '100%', background: '#fff', borderRadius: '2px' }} />
          </button>
          <div style={{ fontSize: '24px', letterSpacing: '-0.5px', marginLeft: '10px' }}>
            <span style={{ color: '#79A3F5', fontWeight: 400, fontFamily: SYS_FONT }}>mi</span>
            <span style={{ color: '#fff', fontWeight: 700, fontFamily: SYS_FONT }}>Argentina</span>
          </div>
          <div style={{ width: '36px', height: '36px', borderRadius: '50%', overflow: 'hidden' }}>
            <img src="/icons/profile-user.png" alt="Perfil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '80px' }}>
        <svg viewBox="0 0 100 100" width="130" height="130">
          <path d="M 55 23 L 75 23 C 78.3 23 81 25.7 81 29 L 81 74 C 81 77.3 78.3 80 75 80 L 55 80" fill="none" stroke="#4139be" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"/>
          <rect x="23" y="12" width="46" height="68" rx="4" fill="#ffffff" stroke="#4139be" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"/>
          <line x1="33" y1="30" x2="55" y2="30" stroke="#4139be" strokeWidth="4.5" strokeLinecap="round"/>
          <line x1="33" y1="46" x2="55" y2="46" stroke="#4139be" strokeWidth="4.5" strokeLinecap="round"/>
          <line x1="33" y1="62" x2="55" y2="62" stroke="#4139be" strokeWidth="4.5" strokeLinecap="round"/>
        </svg>
        <p style={{ color: '#2c2c2c', fontSize: '16px', fontWeight: 600, textAlign: 'center', width: '280px', lineHeight: 1.4, margin: '24px 0 30px', fontFamily: SYS_FONT }}>
          No hay novedades para mostrar en<br />este momento
        </p>
        <button onClick={() => setView('home')} style={{ background: '#3530BA', color: '#fff', fontSize: '16px', fontWeight: 700, width: '88%', padding: '16px 0', border: 'none', borderRadius: '30px', cursor: 'pointer', fontFamily: SYS_FONT }}>
          Volver al inicio
        </button>
      </div>

      <BottomNavBar activeTab="novedades" />
    </div>
  );
}

// ========================================
// TELÉFONOS VIEW
// ========================================
function TelefonosView() {
  const { user } = useAppStore();

  const emergencyPhones = [
    { number: '911', label: 'Central de emergencias nacionales' },
    { number: '144', label: 'Víctimas de violencia' },
    { number: '107', label: 'Emergencias Médicas' },
    { number: '100', label: 'Bomberos' },
    { number: '102', label: 'La línea de las chicas y los chicos' },
    { number: '103', label: 'Defensa Civil' },
    { number: '106', label: 'Emergencia Náutica' },
    { number: '135', label: 'Asistencia al Suicida' },
  ];

  return (
    <div style={{ backgroundColor: '#efefef', minHeight: '100vh', paddingBottom: '70px' }}>
      <StatusBar />
      <HeaderBar onMenuClick={() => useAppStore.getState().setMenuOpen(true)} />

      {/* Phone list */}
      <div style={{ padding: '12px 12px 0' }}>
        {emergencyPhones.map((phone, i) => (
          <div key={i} style={{
            background: '#fff',
            borderRadius: '10px',
            padding: '16px 20px',
            marginBottom: '10px',
            display: 'flex',
            alignItems: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            border: '1px solid #eaeaea'
          }}>
            {/* Number */}
            <div style={{
              fontSize: '26px',
              fontWeight: 800,
              color: '#362FC1',
              fontFamily: "'Kapra Neue', 'KapraNeue', sans-serif",
              width: '64px',
              textAlign: 'left',
              flexShrink: 0
            }}>
              {phone.number}
            </div>
            
            {/* Vertical line */}
            <div style={{
              width: '1px',
              height: '32px',
              backgroundColor: '#e2e2e7',
              margin: '0 16px'
            }} />

            {/* Label */}
            <div style={{
              flex: 1,
              minWidth: 0,
              fontSize: '15px',
              color: '#1c1c1e',
              fontWeight: 600,
              fontFamily: SYS_FONT,
              lineHeight: 1.2,
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textAlign: 'left'
            }}>
              {phone.label}
            </div>

            {/* Phone icon */}
            <div style={{
              flexShrink: 0,
              marginLeft: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <img src="/icons/icon-telefono.png" alt="Teléfono" style={{ width: '44px', height: '30px' }} />
            </div>
          </div>
        ))}
      </div>

      <BottomNavBar activeTab="telefonos" />
    </div>
  );
}

// ========================================
// SALUD VIEW
// ========================================
function SaludView() {
  const { setView } = useAppStore();

  return (
    <div style={{ backgroundColor: '#f5f6fa', minHeight: '100vh', paddingBottom: '70px' }}>
      <StatusBar />
      <header style={{ background: '#3333cc', color: 'white', padding: '55px 16px 16px', display: 'flex', alignItems: 'center', height: '60px', boxSizing: 'border-box', flexShrink: 0 }}>
        <svg onClick={() => setView('home')} style={{ marginRight: '16px', cursor: 'pointer', width: '24px', height: '24px' }} viewBox="0 0 24 24" fill="none">
          <path d="M19 12H5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12 19L5 12L12 5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#fff', fontFamily: SYS_FONT }}>Salud</h1>
      </header>

      <div style={{ padding: '20px 20px 40px' }}>
        <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#333', margin: '0 0 12px', letterSpacing: '-0.2px', fontFamily: SYS_FONT }}>Credenciales</h2>

        <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #dcdce0', display: 'flex', alignItems: 'center', padding: '16px', marginBottom: '12px', cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
          <svg width="38" height="26" viewBox="0 0 38 26" fill="none" stroke="#3333cc" stroke-width="1.2" style={{ flexShrink: 0 }}>
            <rect x="2" y="2" width="34" height="22" rx="3" />
            <circle cx="19" cy="13" r="3.5" />
            <path d="M19 6v3.5 M19 16.5v3.5 M12 13h3.5 M22.5 13h3.5 M14 8l2.5 2.5 M21.5 18l2.5 2.5 M24 8l-2.5 2.5 M14 18l2.5-2.5" stroke-width="1"/>
            <circle cx="19" cy="5" r="0.8" fill="#3333cc"/>
            <circle cx="19" cy="21" r="0.8" fill="#3333cc"/>
            <circle cx="11" cy="13" r="0.8" fill="#3333cc"/>
            <circle cx="27" cy="13" r="0.8" fill="#3333cc"/>
            <circle cx="13" cy="7" r="0.8" fill="#3333cc"/>
            <circle cx="25" cy="19" r="0.8" fill="#3333cc"/>
            <circle cx="25" cy="7" r="0.8" fill="#3333cc"/>
            <circle cx="13" cy="19" r="0.8" fill="#3333cc"/>
          </svg>
          <div style={{ width: '1px', height: '34px', background: '#e5e5ea', marginLeft: '12px', marginRight: '16px', flexShrink: 0 }} />
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#222', flex: 1, lineHeight: 1.3, fontFamily: SYS_FONT }}>Certificado de vacunación<br/>COVID 19</div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <path d="M6 9l6 6 6-6" stroke="#8e8e93" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>

        <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #dcdce0', display: 'flex', alignItems: 'center', padding: '16px', marginBottom: '12px', cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
          <svg width="38" height="26" viewBox="0 0 38 26" fill="none" stroke="#3333cc" stroke-width="1.2" style={{ flexShrink: 0 }}>
            <rect x="2" y="2" width="34" height="22" rx="3" />
            <path d="M14.5 10.5 C14.5 8, 9.5 8, 9.5 11.5 C9.5 15, 14.5 18.5, 14.5 18.5 C14.5 18.5, 19.5 15, 19.5 11.5 C19.5 8, 14.5 8, 14.5 10.5 Z" stroke-linejoin="round"/>
            <line x1="23" y1="9" x2="31" y2="9" stroke-linecap="round"/>
            <line x1="23" y1="13" x2="31" y2="13" stroke-linecap="round"/>
            <line x1="23" y1="17" x2="28" y2="17" stroke-linecap="round"/>
          </svg>
          <div style={{ width: '1px', height: '34px', background: '#e5e5ea', marginLeft: '12px', marginRight: '16px', flexShrink: 0 }} />
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#222', flex: 1, lineHeight: 1.3, fontFamily: SYS_FONT }}>Donación de órganos</div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <path d="M6 9l6 6 6-6" stroke="#8e8e93" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>

        <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#333', margin: '28px 0 12px', letterSpacing: '-0.2px', fontFamily: SYS_FONT }}>Más información de salud</h2>

        <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #dcdce0', marginBottom: '24px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '18px 16px' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3333cc" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style={{ flexShrink: 0 }}>
              <g transform="rotate(45 12 12)">
                <path d="M12 2v4" />
                <path d="M9 2h6" />
                <rect x="9" y="6" width="6" height="11" rx="1" />
                <path d="M9 8h2" />
                <path d="M9 11h2" />
                <path d="M9 14h2" />
                <path d="M10 17v1h4v-1" />
                <path d="M12 18v4" />
              </g>
            </svg>
            <div style={{ width: '1px', height: '34px', background: '#e5e5ea', marginLeft: '12px', marginRight: '16px', flexShrink: 0 }} />
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#222', flex: 1, lineHeight: 1.3, fontFamily: SYS_FONT }}>Vacunas de calendario</div>
          </div>
          <hr style={{ height: '1px', background: '#e5e5ea', border: 'none', margin: 0 }} />
          <div style={{ padding: '20px 20px 24px' }}>
            <p style={{ fontSize: '14px', color: '#444', lineHeight: 1.45, margin: '0 0 18px', fontFamily: SYS_FONT }}>Consultá tus vacunas de calendario registradas en el Ministerio de Salud de la Nación.</p>
            <p style={{ fontSize: '14px', color: '#444', lineHeight: 1.45, margin: '0 0 18px', fontFamily: SYS_FONT }}>Es posible que algunas dosis aplicadas no se muestren porque el registro es obligatorio desde el 2023.</p>
            <button style={{ width: '100%', background: '#fff', color: '#3333cc', border: '1.5px solid #3333cc', padding: '13px', borderRadius: '25px', fontSize: '15px', fontWeight: 600, cursor: 'pointer', fontFamily: SYS_FONT, display: 'block', textAlign: 'center' }}>Ver vacunas</button>
          </div>
        </div>
      </div>

      <BottomNavBar activeTab="home" />
    </div>
  );
}

// ========================================
// COBROS VIEW
// ========================================
function CobrosView() {
  const { setView } = useAppStore();

  return (
    <div style={{ backgroundColor: '#f5f6fa', minHeight: '100vh', paddingBottom: '70px' }}>
      <StatusBar />
      <header style={{ background: '#3333cc', color: 'white', padding: '55px 16px 16px', display: 'flex', alignItems: 'center', height: '60px', boxSizing: 'border-box', flexShrink: 0 }}>
        <svg onClick={() => setView('home')} style={{ marginRight: '16px', cursor: 'pointer', width: '24px', height: '24px' }} viewBox="0 0 24 24" fill="none">
          <path d="M19 12H5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12 19L5 12L12 5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#fff', fontFamily: SYS_FONT }}>Cobros</h1>
      </header>

      <div style={{ padding: '20px' }}>
        <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0', padding: '24px 20px', marginBottom: '16px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#222', margin: '0 0 14px', fontFamily: SYS_FONT }}>Actualización de datos - PAS</h2>
          <p style={{ fontSize: '15px', color: '#444', lineHeight: 1.45, margin: '0 0 24px', fontFamily: SYS_FONT }}>Si sos beneficiario del Programa de Acompañamiento Social debés completar el formulario de actualización de datos.</p>
          <button style={{ width: '100%', background: '#3333cc', color: '#fff', border: 'none', padding: '10px', borderRadius: '25px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: SYS_FONT, display: 'block', textAlign: 'center' }}>Ingresar</button>
        </div>

        <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0', padding: '24px 20px', marginBottom: '16px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#222', margin: '0 0 14px', fontFamily: SYS_FONT }}>¿Necesitás ayuda?</h2>
          <p style={{ fontSize: '15px', color: '#444', lineHeight: 1.45, margin: '0 0 24px', fontFamily: SYS_FONT }}>Podés realizar consultas o denunciar cualquier irregularidad en los programas del Ministerio de Capital Humano de manera segura y confidencial.</p>
          <button style={{ width: '100%', background: '#3333cc', color: '#fff', border: 'none', padding: '10px', borderRadius: '25px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: SYS_FONT, display: 'block', textAlign: 'center' }}>Contactanos</button>
        </div>
      </div>

      <BottomNavBar activeTab="home" />
    </div>
  );
}

// ========================================
// HIJOS VIEW
// ========================================
function HijosView() {
  const { setView } = useAppStore();

  return (
    <div style={{ backgroundColor: '#f5f6fa', minHeight: '100vh', paddingBottom: '70px' }}>
      <StatusBar />
      <header style={{ background: '#3333cc', color: 'white', padding: '55px 16px 16px', display: 'flex', alignItems: 'center', height: '60px', boxSizing: 'border-box', flexShrink: 0 }}>
        <svg onClick={() => setView('home')} style={{ marginRight: '16px', cursor: 'pointer', width: '24px', height: '24px' }} viewBox="0 0 24 24" fill="none">
          <path d="M19 12H5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12 19L5 12L12 5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#fff', fontFamily: SYS_FONT }}>Hijos</h1>
      </header>

      <div style={{ padding: '20px' }}>
        <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0', boxShadow: '0 1px 2px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '24px 20px' }}>
            <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#222', margin: 0, lineHeight: 1.35, fontFamily: SYS_FONT }}>Asociá a tus hijos menores a tu perfil para acceder a sus documentos.</h2>
          </div>
          <hr style={{ height: '1px', background: '#f0f0f5', border: 'none', margin: 0 }} />
          <div style={{ padding: '24px 20px' }}>
            <p style={{ fontSize: '15px', color: '#444', lineHeight: 1.45, margin: '0 0 24px', fontFamily: SYS_FONT }}>Recordá que sólo vas a poder asociar a tus hijos menores de 18 años que estén declarados en RENAPER.</p>
            <button style={{ width: '100%', background: '#3333cc', color: '#fff', border: 'none', padding: '10px', borderRadius: '25px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: SYS_FONT, display: 'block', textAlign: 'center' }}>Asociar un hijo/a</button>
          </div>
        </div>
      </div>

      <BottomNavBar activeTab="home" />
    </div>
  );
}

// ========================================
// TRABAJO VIEW
// ========================================
// TRÁMITES VIEW
// ========================================
function TramitesView() {
  const { setView } = useAppStore();

  return (
    <div style={{ backgroundColor: '#f5f6fa', minHeight: '100vh', paddingBottom: '70px' }}>
      <StatusBar />
      <header style={{ background: '#3333cc', color: 'white', padding: '55px 16px 16px', display: 'flex', alignItems: 'center', height: '60px', boxSizing: 'border-box', flexShrink: 0 }}>
        <svg onClick={() => setView('home')} style={{ marginRight: '16px', cursor: 'pointer', width: '24px', height: '24px' }} viewBox="0 0 24 24" fill="none">
          <path d="M19 12H5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12 19L5 12L12 5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#fff', fontFamily: SYS_FONT }}>Trámites</h1>
      </header>

      <div style={{ padding: '20px' }}>
        <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0', marginBottom: '16px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '20px' }}>
            <p style={{ fontSize: '15px', color: '#444', lineHeight: 1.45, margin: '0 0 20px', fontFamily: SYS_FONT }}>
              Consultá más trámites en <span style={{ color: '#5b8def', textDecoration: 'none' }}>TramitAR</span> o sacá un turno en <span style={{ color: '#5b8def', textDecoration: 'none' }}>Turnos</span>
            </p>
            <button style={{ width: '100%', background: '#3333cc', color: '#fff', border: 'none', padding: '10px', borderRadius: '25px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: SYS_FONT, display: 'block', textAlign: 'center' }}>Ir a Turnos</button>
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0', marginBottom: '16px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '18px 16px' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3333cc" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style={{ flexShrink: 0, marginRight: '16px' }}>
              <path d="M9 18h4v1H9zM10 20h2v1h-2z" />
              <path d="M11 16a5 5 0 10-3.5-8.5 5.5 5.5 0 00.5 7.5v1h6v-1a5.5 5.5 0 001.5-6" />
              <path d="M17 14s1-1 1-3a3 3 0 00-3-3" stroke-dasharray="2 2" />
              <path d="M16 20c1.5 0 2.5-1 2.5-2.5S17 15 17 15s-1.5 2.5-1.5 4c0 1.5.5 1 2 1z" />
            </svg>
            <div style={{ width: '1px', height: '34px', background: '#e5e5ea', marginRight: '16px' }} />
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#222', flex: 1, lineHeight: 1.3, fontFamily: SYS_FONT }}>Subsidios a la luz, gas y garrafa</div>
          </div>
          <hr style={{ height: '1px', background: '#f0f0f5', border: 'none', margin: 0 }} />
          <div style={{ padding: '20px' }}>
            <p style={{ fontSize: '15px', color: '#444', lineHeight: 1.45, margin: '0 0 20px', fontFamily: SYS_FONT }}>No existe un registro con tu DNI. Verificá si alguno de tus convivientes realizó la inscripción y sino, completá la solicitud</p>
            <button style={{ width: '100%', background: '#3333cc', color: '#fff', border: 'none', padding: '10px', borderRadius: '25px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: SYS_FONT, display: 'block', textAlign: 'center' }}>Solicitar subsidios</button>
          </div>
          <hr style={{ height: '1px', background: '#f0f0f5', border: 'none', margin: 0 }} />
          <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3333cc" stroke-width="1.5" style={{ flexShrink: 0, marginRight: '16px' }}>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" stroke-width="2" stroke-linecap="round"/>
              <path d="M12 8h.01" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <div style={{ color: '#444', fontSize: '14px', lineHeight: 1.4, fontFamily: SYS_FONT }}>
              Para más información ingresá a<br/>
              <span style={{ color: '#3333cc', fontWeight: 600 }}>www.argentina.gob.ar/subsidios</span>
            </div>
          </div>
        </div>
      </div>

      <BottomNavBar activeTab="home" />
    </div>
  );
}

// ========================================
// TRABAJO VIEW
// ========================================
function TrabajoView() {
  const { user, setView } = useAppStore();
  const nombre = user?.dni?.nombre || '';
  const apellido = user?.dni?.apellido || '';
  const dniNumero = user?.dni?.dniNumero || '';

  // Generate a placeholder CUIL based on DNI (20 + DNI + check digit)
  const cuil = dniNumero ? `20${dniNumero.replace(/\D/g, '')}5` : '00000000000';

  return (
    <div style={{ backgroundColor: '#f0f0f0', minHeight: '100vh', paddingBottom: '70px' }}>
      {/* Header with back arrow */}
      <header style={{ background: '#362FC1', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '55px 16px 16px', position: 'sticky', top: 0, zIndex: 50 }}>
        <button onClick={() => setView('home')} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', position: 'absolute', left: '16px', top: '55px' }}><ArrowLeft size={24} /></button>
        <span style={{ color: '#fff', fontSize: '17px', fontWeight: 600, fontFamily: SYS_FONT }}>Trabajo</span>
      </header>

      <div style={{ padding: '16px 12px' }}>
        <div style={{ background: '#fff', borderRadius: '12px', padding: '24px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {/* Nombre */}
          <div style={{ marginBottom: '20px' }}>
            <p style={{ margin: 0, fontSize: '12px', color: '#9e9e9e', fontFamily: SYS_FONT, marginBottom: '4px' }}>Nombre</p>
            <p style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#333', fontFamily: SYS_FONT }}>{nombre.toUpperCase()}</p>
          </div>
          {/* Apellido */}
          <div style={{ marginBottom: '20px' }}>
            <p style={{ margin: 0, fontSize: '12px', color: '#9e9e9e', fontFamily: SYS_FONT, marginBottom: '4px' }}>Apellido</p>
            <p style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#333', fontFamily: SYS_FONT }}>{apellido.toUpperCase()}</p>
          </div>
          {/* CUIL */}
          <div style={{ marginBottom: '24px' }}>
            <p style={{ margin: 0, fontSize: '12px', color: '#9e9e9e', fontFamily: SYS_FONT, marginBottom: '4px' }}>Número de CUIL</p>
            <p style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#333', fontFamily: SYS_FONT }}>{cuil}</p>
          </div>
          {/* Download button */}
          <button
            style={{ width: '100%', background: '#362FC1', color: '#fff', border: 'none', borderRadius: '25px', padding: '14px', fontSize: '15px', fontWeight: 600, cursor: 'pointer', fontFamily: SYS_FONT, marginBottom: '16px' }}
          >
            Descargar constancia de CUIL
          </button>
          {/* Data source */}
          <p style={{ margin: 0, fontSize: '12px', color: '#9e9e9e', fontFamily: SYS_FONT, textAlign: 'center' }}>
            Datos suministrados por <span style={{ color: '#362FC1', fontWeight: 600 }}>ANSES</span>
          </p>
        </div>
      </div>

      <BottomNavBar activeTab="home" />
    </div>
  );
}

// ========================================
// VEHÍCULOS VIEW
// ========================================
function VehiculosView() {
  const { setView } = useAppStore();

  return (
    <div style={{ backgroundColor: '#f0f0f0', minHeight: '100vh', paddingBottom: '70px' }}>
      {/* Header with back arrow */}
      <header style={{ background: '#362FC1', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '55px 16px 16px', position: 'sticky', top: 0, zIndex: 50 }}>
        <button onClick={() => setView('home')} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', position: 'absolute', left: '16px', top: '55px' }}><ArrowLeft size={24} /></button>
        <span style={{ color: '#fff', fontSize: '17px', fontWeight: 600, fontFamily: SYS_FONT }}>Vehículos</span>
      </header>

      <div style={{ padding: '16px 12px' }}>
        {/* Blue info card */}
        <div style={{ background: '#e3f2fd', borderRadius: '12px', padding: '16px', marginBottom: '12px', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#362FC1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Car size={20} color="#fff" />
          </div>
          <p style={{ margin: 0, fontSize: '13px', color: '#333', fontFamily: SYS_FONT, lineHeight: 1.5 }}>
            Si viajas al exterior y no contás con cédula física y/o patente, comunicate con la DNRPA para asesorarte.
          </p>
        </div>

        {/* White card - Agregá servicios */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '24px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 700, color: '#212121', fontFamily: SYS_FONT }}>Agregá servicios</h3>
          <p style={{ margin: '0 0 20px', fontSize: '14px', color: '#757575', fontFamily: SYS_FONT, lineHeight: 1.5 }}>
            Asociá servicios para ver tu licencia de conducir y las cédulas de vehículos asociados a tu DNI.
          </p>
          <button
            onClick={() => setView('home')}
            style={{ width: '100%', background: '#362FC1', color: '#fff', border: 'none', borderRadius: '25px', padding: '14px', fontSize: '15px', fontWeight: 600, cursor: 'pointer', fontFamily: SYS_FONT }}
          >
            Agregar servicios
          </button>
        </div>
      </div>

      <BottomNavBar activeTab="home" />
    </div>
  );
}

// ========================================
// TINA VIEW
// ========================================
function TinaView() {
  const { setView, user, setUser } = useAppStore();
  const [selectedPack, setSelectedPack] = useState<'1' | '5'>('1');
  const [loading, setLoading] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remainingTime, setRemainingTime] = useState<string | null>(null);
  const [activatedAtDate, setActivatedAtDate] = useState<Date | null>(null);
  const [verifyingPayment, setVerifyingPayment] = useState(false);

  // Refresh user data on mount
  useEffect(() => {
    if (!user?.id) return;
    fetch(`/api/user/${user.id}`).then(res => {
      if (res.ok) res.json().then(data => {
        if (data.user) setUser(data.user);
      });
    }).catch(() => {});
  }, []);

  // Calculate remaining time
  useEffect(() => {
    if (!user?.isActive) {
      setRemainingTime(null);
      setActivatedAtDate(null);
      return
    }

    // We need activatedAt from the user - fetch the latest if not available
    const fetchUser = async () => {
      if (!user.id) return
      try {
        const res = await fetch(`/api/user/${user.id}`)
        if (res.ok) {
          const data = await res.json()
          if (data.user) {
            setUser(data.user)
            if (data.user.activatedAt) {
              setActivatedAtDate(new Date(data.user.activatedAt))
            }
          }
        }
      } catch {}
    }

    if (!user.activatedAt) {
      fetchUser()
    } else {
      setActivatedAtDate(new Date(user.activatedAt))
    }
  }, [user?.isActive, user?.activatedAt])

  // Update remaining time every second
  useEffect(() => {
    if (!activatedAtDate) {
      setRemainingTime(null)
      return
    }

    const update = () => {
      const now = Date.now()
      const end = activatedAtDate.getTime() + 24 * 60 * 60 * 1000
      const diff = end - now

      if (diff <= 0) {
        setRemainingTime('Expirado')
        if (user?.id && user.isActive) {
          fetch('/api/tokens/deactivate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id }),
          }).then(res => {
            if (res.ok) return res.json()
          }).then(data => {
            if (data) {
              setUser({ ...user, isActive: false, activatedAt: null, tokens: data.tokensLeft })
            }
          }).catch(() => {})
        }
        return
      }

      const h = Math.floor(diff / (1000 * 60 * 60))
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const s = Math.floor((diff % (1000 * 60)) / 1000)
      setRemainingTime(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`)
    }

    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [activatedAtDate])

  const handleMpPayment = async () => {
    if (!user?.id || !user?.email) {
      setError('Debes iniciar sesión para comprar tokens')
      return
    }
    setPaymentLoading(true)
    setError(null)
    setMessage(null)
    try {
      const quantity = selectedPack === '1' ? 1 : 5
      const unitPrice = selectedPack === '1' ? 2500 : 10000
      const title = selectedPack === '1' ? '1 Token miArgentina' : '5 Tokens miArgentina'

      const res = await fetch('/api/mercadopago/create-preference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          email: user.email,
          title,
          quantity,
          unitPrice,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail || data.error || 'Error al crear el pago'); return }
      window.location.href = data.init_point
    } catch {
      setError('Error de conexión')
    } finally {
      setPaymentLoading(false)
    }
  }

  const handleUseToken = async () => {
    if (!user?.id) return
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/tokens/use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Error al usar token'); return }

      setUser({
        ...user,
        isActive: data.isActive,
        tokens: data.tokensLeft,
      })
      setMessage(data.message || 'Token activado correctamente')
      setTimeout(() => setMessage(null), 5000)
    } catch {
      setError('Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyPayment = async () => {
    if (!user?.id) return
    setVerifyingPayment(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/mercadopago/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'No se encontró un pago aprobado'); return }
      setUser({ ...user, tokens: data.tokens })
      setMessage(`Pago verificado! Se acreditaron ${data.quantity} token(s).`)
      setTimeout(() => setMessage(null), 5000)
    } catch {
      setError('Error de conexión')
    } finally {
      setVerifyingPayment(false)
    }
  }

  return (
    <div style={{ backgroundColor: '#f0f0f0', minHeight: '100vh', paddingBottom: '70px' }}>
      <header style={{ background: '#362FC1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '55px 16px 16px', position: 'sticky', top: 0, zIndex: 50 }}>
        <button onClick={() => setView('home')} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}><ArrowLeft size={24} /></button>
        <span style={{ color: '#fff', fontSize: '17px', fontWeight: 600, fontFamily: SYS_FONT }}>Tina</span>
        <div style={{ width: 24 }} />
      </header>

      <div style={{ padding: '16px', maxWidth: '550px', margin: '0 auto' }}>

        {/* Token Balance Card */}
        {user ? (
          <div style={{ background: '#fff', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: '16px', textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
              <Zap size={24} color="#362FC1" />
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#212121', fontFamily: SYS_FONT }}>
                Tus Tokens
              </h2>
            </div>
            <div style={{ fontSize: '48px', fontWeight: 800, color: '#362FC1', fontFamily: SYS_FONT, lineHeight: 1.2 }}>
              {user.tokens}
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#757575', fontFamily: SYS_FONT }}>
              tokens disponibles
            </p>

            {/* Active status & timer */}
            {user.isActive && remainingTime && (
              <div style={{ marginTop: '16px', background: '#e8f5e9', borderRadius: '12px', padding: '12px', border: '1px solid #a5d6a7' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  <Timer size={16} color="#2e7d32" />
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#2e7d32', fontFamily: SYS_FONT }}>
                    Documento activo
                  </span>
                </div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#2e7d32', fontFamily: 'monospace', marginTop: '4px' }}>
                  {remainingTime}
                </div>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#558b2f', fontFamily: SYS_FONT }}>
                  tiempo restante de tu token actual
                </p>
              </div>
            )}

            {!user.isActive && user.tokens > 0 && (
              <div style={{ marginTop: '16px' }}>
                <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#757575', fontFamily: SYS_FONT }}>
                  Tenés tokens disponibles. Activá uno para ver tu documento.
                </p>
                <button onClick={handleUseToken} disabled={loading} style={{
                  width: '100%', padding: '14px', background: loading ? '#362FC180' : '#362FC1',
                  color: '#fff', border: 'none', borderRadius: '12px', fontSize: '15px',
                  fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
                  fontFamily: SYS_FONT, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: '8px',
                  boxShadow: '0 4px 12px rgba(54, 47, 193, 0.3)',
                }}>
                  {loading ? 'Activando...' : <><Zap size={18} /> Activar documento (24hs)</>}
                </button>
              </div>
            )}

            {!user.isActive && user.tokens === 0 && (
              <div style={{ marginTop: '12px', background: '#fff8e1', borderRadius: '8px', padding: '10px', border: '1px solid #ffe082' }}>
                <p style={{ margin: 0, fontSize: '12px', color: '#e65100', fontFamily: SYS_FONT }}>
                  No tenés tokens. Comprá un pack para activar tu documento.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div style={{ background: '#fff', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: '16px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 12px', fontSize: '14px', color: '#757575', fontFamily: SYS_FONT }}>
              Iniciá sesión para ver tus tokens
            </p>
            <button onClick={() => setView('login')} style={{
              padding: '12px 30px', background: '#362FC1', color: '#fff', border: 'none',
              borderRadius: '12px', fontSize: '15px', fontWeight: 600, cursor: 'pointer',
              fontFamily: SYS_FONT,
            }}>
              Iniciar sesión
            </button>
          </div>
        )}

        {message && (
          <div style={{ background: '#e8f5e9', borderRadius: '12px', padding: '12px 16px', marginBottom: '16px', border: '1px solid #a5d6a7' }}>
            <p style={{ margin: 0, fontSize: '14px', color: '#2e7d32', fontFamily: SYS_FONT, textAlign: 'center' }}>{message}</p>
          </div>
        )}

        {error && (
          <div style={{ background: '#ffebee', borderRadius: '12px', padding: '12px 16px', marginBottom: '16px', border: '1px solid #ef9a9a' }}>
            <p style={{ margin: 0, fontSize: '14px', color: '#c62828', fontFamily: SYS_FONT, textAlign: 'center' }}>{error}</p>
          </div>
        )}

        {/* Buy Tokens Card */}
        {user && (
          <div style={{ background: '#fff', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: '16px' }}>
            <h2 style={{ margin: '0 0 12px', fontSize: '18px', fontWeight: 700, color: '#212121', fontFamily: SYS_FONT, textAlign: 'center' }}>
              Comprar Tokens
            </h2>
            <p style={{ margin: '0 0 16px', fontSize: '14px', color: '#555', fontFamily: SYS_FONT, lineHeight: 1.6, textAlign: 'center' }}>
              Cada token te habilita el documento por <strong>24 horas</strong>.
            </p>

            {/* Pack Selector */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
              <button onClick={() => setSelectedPack('1')} style={{
                flex: 1, padding: '16px', borderRadius: '12px', cursor: 'pointer',
                background: selectedPack === '1' ? '#362FC1' : '#f5f5f5',
                border: selectedPack === '1' ? '2px solid #362FC1' : '2px solid #e0e0e0',
                color: selectedPack === '1' ? '#fff' : '#333',
                fontFamily: SYS_FONT, textAlign: 'center', transition: 'all 0.2s',
              }}>
                <div style={{ fontSize: '20px', fontWeight: 700 }}>1 Token</div>
                <div style={{ fontSize: '14px', fontWeight: 600, marginTop: '4px' }}>$2.500</div>
                <div style={{ fontSize: '12px', opacity: 0.8, marginTop: '2px' }}>24hs de acceso</div>
              </button>
              <button onClick={() => setSelectedPack('5')} style={{
                flex: 1, padding: '16px', borderRadius: '12px', cursor: 'pointer',
                background: selectedPack === '5' ? '#362FC1' : '#f5f5f5',
                border: selectedPack === '5' ? '2px solid #362FC1' : '2px solid #e0e0e0',
                color: selectedPack === '5' ? '#fff' : '#333',
                fontFamily: SYS_FONT, textAlign: 'center', transition: 'all 0.2s',
              }}>
                <div style={{ fontSize: '20px', fontWeight: 700 }}>5 Tokens</div>
                <div style={{ fontSize: '14px', fontWeight: 600, marginTop: '4px' }}>$10.000</div>
                <div style={{ fontSize: '12px', opacity: 0.8, marginTop: '2px' }}>$2.000 c/u · Ahorrá $2.500</div>
              </button>
            </div>

            {/* Mercado Pago Button */}
            <button onClick={handleMpPayment} disabled={paymentLoading} style={{
              width: '100%', padding: '14px', background: paymentLoading ? '#00a1e0' : '#009EE3',
              color: '#fff', border: 'none', borderRadius: '12px', fontSize: '15px',
              fontWeight: 600, cursor: paymentLoading ? 'not-allowed' : 'pointer',
              fontFamily: SYS_FONT, display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: '8px',
              boxShadow: '0 4px 12px rgba(0, 158, 227, 0.3)',
            }}>
              {paymentLoading ? 'Redirigiendo...' : <><CreditCard size={18} /> Pagar con Mercado Pago</>}
            </button>

            {/* Verify pending payment */}
            <button onClick={handleVerifyPayment} disabled={verifyingPayment} style={{
              width: '100%', padding: '10px', marginTop: '8px', background: 'none',
              color: '#009EE3', border: '1px solid #009EE3', borderRadius: '12px', fontSize: '13px',
              fontWeight: 500, cursor: verifyingPayment ? 'not-allowed' : 'pointer',
              fontFamily: SYS_FONT,
            }}>
              {verifyingPayment ? 'Verificando...' : 'Ya hice el pago, verificar'}
            </button>



            <div style={{ background: '#fff8e1', borderRadius: '8px', padding: '12px', marginTop: '16px', border: '1px solid #ffe082' }}>
              <p style={{ margin: 0, fontSize: '12px', color: '#e65100', fontFamily: SYS_FONT, lineHeight: 1.5, textAlign: 'center' }}>
                ⚠️ Los tokens no son transferibles a otras cuentas. Solo se pueden usar en la cuenta para la que fueron adquiridos.
              </p>
            </div>
          </div>
        )}

        {/* Register button */}
        <button onClick={() => setView('register')} style={{
          width: '100%', padding: '14px', background: '#362FC1', color: '#fff', border: 'none',
          borderRadius: '12px', fontSize: '15px', fontWeight: 600, cursor: 'pointer',
          fontFamily: SYS_FONT, boxShadow: '0 4px 12px rgba(54, 47, 193, 0.3)',
          marginTop: user ? '16px' : '0',
        }}>
          {user ? 'Crear cuenta nueva' : 'Registrarse'}
        </button>
      </div>

      <BottomNavBar activeTab="tina" />
    </div>
  );
}
