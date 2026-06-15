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
  User,
  ChevronRight,
  Ticket,
  Check,
  Search,
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

function formatDniNumber(num: string): string {
  const digits = num.replace(/\D/g, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
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
      <div className="w-full" style={{ maxWidth: '390px', overflow: 'hidden', minHeight: '100vh' }}>
        {view === 'login' && <LoginView />}
        {view === 'register' && <RegisterView />}
        {view === 'home' && <HomeView />}
        {view === 'documentos' && <DocumentosView />}
        {view === 'dni-viewer' && <DniViewerView />}
        {view === 'admin' && <AdminView />}
        {view === 'novedades' && <NovedadesView />}
        {view === 'telefonos' && <TelefonosView />}
        {view === 'trabajo' && <TrabajoView />}
        {view === 'vehiculos' && <VehiculosView />}
      </div>
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
              style={{ fontFamily: 'Arial, sans-serif', background: !isFormValid || isLoading ? '#3730ba80' : isButtonHovered ? '#2a24a0' : '#3730ba', border: 'none', borderRadius: '12px', boxShadow: isButtonHovered && isFormValid ? '0 8px 15px -3px #0000004d' : '0 6px 15px -5px #0000004d', color: '#fff', cursor: isFormValid && !isLoading ? 'pointer' : 'not-allowed', fontSize: '14px', fontWeight: 600, letterSpacing: '0.5px', padding: '12px 25px', textAlign: 'center', textTransform: 'uppercase', transition: 'all 0.3s ease', transform: isButtonHovered && isFormValid ? 'translateY(-2px)' : 'none', width: '80%' }}>
              {isLoading ? 'Entrando...' : 'Entrar'}
            </button>
          </div>
        </form>
        {error && <p style={{ color: 'red', textAlign: 'center', fontSize: '14px', margin: '10px 40px 0' }}>{error}</p>}
        <p style={{ color: '#262626', fontSize: '14px', margin: '15px', textAlign: 'center', fontFamily: SYS_FONT }}>
          <a href="#" style={{ color: '#3730ba', textDecoration: 'none' }} onClick={(e) => e.preventDefault()}>¿Olvidaste tu contraseña?</a>
        </p>
      </div>
      <div style={{ alignItems: 'center', background: '#fff', border: '1px solid #dbdbdb', borderRadius: '1px', display: 'flex', justifyContent: 'center', padding: '10px 0', width: '100%' }}>
        <p style={{ color: '#262626', fontSize: '14px', margin: '15px', fontFamily: SYS_FONT }}>
          ¿No tienes cuenta?{' '}
          <a href="#" style={{ color: '#3730ba', textDecoration: 'none', fontWeight: 600 }} onClick={(e) => { e.preventDefault(); setView('register'); }}>Registrarse</a>
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

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setFoto(reader.result as string);
    reader.readAsDataURL(file);
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
    <div style={{ backgroundColor: '#f5f5f5', minHeight: '100vh' }}>
      <header style={{ background: '#3730ba', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '55px 16px 16px', position: 'sticky', top: 0, zIndex: 50 }}>
        <button onClick={() => setView('login')} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0 }}><ArrowLeft size={24} /></button>
        <span style={{ color: '#fff', fontSize: '17px', fontWeight: 600, fontFamily: SYS_FONT }}>Registro</span>
        <div style={{ width: 24 }} />
      </header>

      <div style={{ padding: '16px', maxWidth: '550px', margin: '0 auto' }}>
        <DniPreviewCard nombre={nombre || 'Nombre'} apellido={apellido || 'Apellido'} dniNumero={dniNumero || '00000000'} sexo={sexo} nacimiento={nacimiento} fechaEmision={fechaEmision} foto={foto} firma={firma} tramiteNumero={tramiteNumero} />

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
                <input type="radio" name="sexo" value="M" checked={sexo === 'M'} onChange={() => setSexo('M')} style={{ accentColor: '#3730ba' }} /> Masculino
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontFamily: SYS_FONT, fontSize: '14px', color: '#333' }}>
                <input type="radio" name="sexo" value="F" checked={sexo === 'F'} onChange={() => setSexo('F')} style={{ accentColor: '#3730ba' }} /> Femenino
              </label>
            </div>
          </div>

          <div>
            <label style={{ color: '#3730ba', fontSize: '14px', fontWeight: 500, display: 'block', marginBottom: '6px', fontFamily: SYS_FONT }}>Firma</label>
            <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #dbdbdb', padding: '8px' }}>
              <canvas ref={sigCanvasRef} width={480} height={120}
                onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing}
                onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing}
                style={{ width: '100%', height: '120px', border: '1px solid #000', borderRadius: '4px', cursor: 'crosshair', touchAction: 'none' }} />
              <button type="button" onClick={clearSignature} style={{ marginTop: '8px', background: '#fff', border: '1px solid #3730ba', borderRadius: '8px', color: '#3730ba', padding: '6px 16px', fontSize: '13px', cursor: 'pointer', fontFamily: SYS_FONT, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <RotateCcw size={14} /> Limpiar
              </button>
            </div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <input type="file" ref={fileInputRef} accept="image/*" onChange={handlePhotoUpload} style={{ display: 'none' }} />
            <button type="button" onClick={() => fileInputRef.current?.click()} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', margin: '0 auto' }}>
              <div style={{ width: '70px', height: '70px', borderRadius: '50%', border: '3px solid #3730ba', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', boxShadow: '0 4px 8px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                {foto ? <img src={foto} alt="Foto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Camera size={28} color="#3730ba" />}
              </div>
              <span style={{ color: '#3730ba', fontSize: '14px', fontWeight: 500, fontFamily: SYS_FONT }}>Seleccionar foto</span>
            </button>
          </div>

          <div style={{ borderTop: '1px solid #dbdbdb', margin: '8px 0', paddingTop: '8px' }}>
            <RegField label="Email" value={email} onChange={setEmail} type="email" />
            <RegField label="Contraseña (mínimo 6 caracteres)" value={password} onChange={setPassword} type="password" />
            <RegField label="Confirmar contraseña" value={confirmPassword} onChange={setConfirmPassword} type="password" />
          </div>

          {error && <p style={{ color: 'red', fontSize: '14px', textAlign: 'center', fontFamily: SYS_FONT }}>{error}</p>}

          <button type="submit" disabled={isLoading} style={{ background: isLoading ? '#3730ba80' : '#3730ba', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '14px', fontWeight: 600, letterSpacing: '0.5px', padding: '14px 30px', cursor: isLoading ? 'not-allowed' : 'pointer', textTransform: 'uppercase', transition: 'all 0.3s ease', boxShadow: '0 6px 15px -5px rgba(0,0,0,0.3)', width: '100%', fontFamily: 'Arial, sans-serif' }}>
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
// DNI PREVIEW CARD (used in registration)
// Pixel-perfect copy of DniViewerView's front card
// Same container, same template, same positioning — only values differ
// ========================================
function DniPreviewCard({ nombre, apellido, dniNumero, sexo, nacimiento, fechaEmision, foto, firma, tramiteNumero }: {
  nombre: string; apellido: string; dniNumero: string; sexo: string; nacimiento: string; fechaEmision: string; foto: string | null; firma: string | null; tramiteNumero?: string;
}) {
  const DNI_FONT = "Arial, sans-serif";

  return (
    <div className="DNI_content1" style={{ alignItems: 'center', display: 'flex', flexDirection: 'column', transformStyle: 'preserve-3d', width: '100%' }}>
      <div className="DNI_imgs" style={{ aspectRatio: '1318 / 833', position: 'relative', width: '100%', backfaceVisibility: 'hidden', transform: 'translateZ(0)', zIndex: 2 }}>
        <img className="DNI_IMG" src="/arg_front_new_bg.webp" alt="dni_img" style={{ objectFit: 'contain', width: '100%' }} />

        {/* Profile photo */}
        <div style={{ position: 'absolute', left: '7.46%', bottom: '26.22%', width: '21.62%', height: '43.19%' }}>
          {foto ? (
            <img alt="DNI_photoUrl" src={foto} style={{ height: '100%', objectFit: 'cover', width: '100%' }} />
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
          {apellido.toUpperCase()}
        </div>

        {/* Nombre / Name label */}
        <div style={{ position: 'absolute', top: '26.45%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
          Nombre / Name
        </div>
        {/* Nombre value - only first letter capitalized */}
        <div style={{ position: 'absolute', top: '31.16%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '11px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
          {nombre.split(' ').map((p: string) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ')}
        </div>

        {/* Sexo / Sex label */}
        <div style={{ position: 'absolute', top: '37.7%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '10px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
          Sexo / Sex
        </div>
        {/* Sexo value */}
        <div style={{ position: 'absolute', top: '43.72%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '11px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
          {(sexo || 'M').toUpperCase()}
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
          A
        </div>

        {/* Fecha de nacimiento label */}
        <div style={{ position: 'absolute', top: '49.57%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
          Fecha de nacimiento/ Date of birth
        </div>
        {/* Fecha de nacimiento value */}
        <div style={{ position: 'absolute', top: '54.28%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '12px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
          {formatDateBilingual(nacimiento) || '-'}
        </div>

        {/* Fecha de emisión label */}
        <div style={{ position: 'absolute', top: '60.13%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
          Fecha de emisión/ Date of issue
        </div>
        {/* Fecha de emisión value */}
        <div style={{ position: 'absolute', top: '64%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '12px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
          {formatDateBilingual(fechaEmision) || '-'}
        </div>

        {/* Fecha de vencimiento label */}
        <div style={{ position: 'absolute', top: '69.69%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
          Fecha de vencimiento/ Date of expiry
        </div>
        {/* Fecha de vencimiento value */}
        <div style={{ position: 'absolute', top: '73.4%', left: '32.144%', color: '#000', fontFamily: DNI_FONT, fontSize: '12px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
          {calcExpiryDate(fechaEmision)}
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
          {firma ? (
            <img alt="DNI_signature" src={firma} style={{ position: 'relative', height: '100%', objectFit: 'contain', width: '100%' }} />
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
          {formatDniNumber(dniNumero)}
        </div>

        {/* Tramite No / Of ident label */}
        <div style={{ position: 'absolute', top: '82.25%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '7.5px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
          Tramite No / Of ident
        </div>
        {/* Tramite number */}
        <div style={{ position: 'absolute', top: '89.67%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
          {tramiteNumero || '697876124'}
        </div>
        {/* Office code */}
        <div style={{ position: 'absolute', top: '92.67%', left: '32.14%', color: '#000', fontFamily: DNI_FONT, fontSize: '8px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
          4052
        </div>

        {/* Barcode - bottom right */}
        <div style={{ position: 'absolute', left: '63.81%', bottom: '-9.46%', width: '33.84%', height: '42.19%', overflow: 'hidden' }}>
          <img src="/barcode_relleno_final.png" alt="Código de barras" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>

      </div>
    </div>
  );
}

// ========================================
// BOTTOM NAVIGATION BAR (shared component)
// ========================================
type BottomTab = 'home' | 'novedades' | 'telefonos' | 'usuario';

function BottomNavBar({ activeTab }: { activeTab: BottomTab }) {
  const { setView } = useAppStore();
  const tabs: { key: BottomTab; label: string; icon: string; iconStyle: React.CSSProperties; action: () => void }[] = [
    { key: 'home', label: 'Inicio', icon: '/icons/logo-CASA.png', iconStyle: { height: '24px', width: '24px' }, action: () => setView('home') },
    { key: 'novedades', label: 'Novedades', icon: '/icons/logo-NOVEDADES.png', iconStyle: { height: '37px', width: '80px' }, action: () => setView('novedades') },
    { key: 'telefonos', label: 'Teléfonos', icon: '/icons/logo-TELEFONO.png', iconStyle: { height: '37px', width: '50px' }, action: () => setView('telefonos') },
    { key: 'usuario', label: 'Usuario', icon: '/icons/logo-USUARIO.png', iconStyle: { height: '24px', width: '24px' }, action: () => setView('home') },
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
      padding: '6px 0 8px',
      zIndex: 50,
    }}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <button key={tab.key} onClick={tab.action} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', padding: '2px 0', flex: 1 }}>
            <div style={{ height: '37px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img src={tab.icon} alt={tab.label} style={{ ...tab.iconStyle, objectFit: 'contain' }} />
            </div>
            <span style={{ fontSize: '12px', color: isActive ? '#342BCB' : '#757575', fontWeight: isActive ? 600 : 400, fontFamily: SYS_FONT }}>{tab.label}</span>
          </button>
        );
      })}
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
    { icon: '/icons/serv-tramites.png', label: 'Documentos', action: () => setView('documentos') },
    { icon: '/icons/serv-vehiculos.png', label: 'Vehículos', action: () => setView('vehiculos') },
    { icon: '/icons/serv-trabajo.png', label: 'Trabajo', action: () => setView('trabajo') },
    { icon: '/icons/serv-salud.png', label: 'Salud', action: () => {} },
    { icon: '/icons/serv-cobros.png', label: 'Cobros', action: () => {} },
    { icon: '/icons/serv-documentos.png', label: 'Trámites', action: () => {} },
    { icon: '/icons/serv-turnos.png', label: 'Turnos', action: () => {} },
    { icon: '/icons/serv-hijos.png', label: 'Hijos', action: () => {} },
  ];

  return (
    <div style={{ backgroundColor: '#f5f5f5', minHeight: '100vh', paddingBottom: '70px' }}>
      {/* Header - redesigned with rounded bottom */}
      <header style={{ background: '#342BCB', position: 'relative', height: '26vh', minHeight: '200px', borderBottomLeftRadius: '40px', borderBottomRightRadius: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* Top row: logo centered + avatar right */}
        <div style={{ width: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: '50px' }}>
          <span onClick={handleLogoTap} style={{ color: '#fff', fontSize: '38px', fontWeight: 700, fontFamily: SYS_FONT, cursor: 'pointer', userSelect: 'none' }}>
            <span style={{ color: '#7098DB' }}>mi</span>Argentina
          </span>
          {/* Avatar */}
          <div style={{ position: 'absolute', right: '30px', top: '50px' }}>
            <div style={{ width: '62px', height: '62px', borderRadius: '50%', background: '#d0d0d0', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
              <User size={30} color="#555" />
              {/* Check overlay */}
              <div style={{ position: 'absolute', bottom: '-2px', left: '-2px', width: '22px', height: '22px', borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}>
                <Check size={13} color="#7098DB" strokeWidth={3} />
              </div>
            </div>
          </div>
        </div>
        {/* Greeting */}
        <div style={{ marginTop: '20px', textAlign: 'center' }}>
          <h1 style={{ fontSize: '30px', fontWeight: 400, color: '#fff', fontFamily: SYS_FONT, margin: 0 }}>¡Hola {nombre}!</h1>
        </div>
        {/* Scrollbar indicator on right edge */}
        <div style={{ position: 'absolute', right: '2px', top: '50%', transform: 'translateY(-50%)', width: '4px', height: '80px', background: '#000', borderRadius: '4px' }} />
      </header>

      {/* Pending activation notice */}
      {!isActive && (
        <div style={{ background: '#fff3e0', margin: '12px 12px 0', borderRadius: '10px', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px', border: '1px solid #ffcc80' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#ff9800', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Bell size={18} color="#fff" />
          </div>
          <div>
            <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#e65100', fontFamily: SYS_FONT }}>Cuenta pendiente de activación</p>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#bf360c', fontFamily: SYS_FONT, lineHeight: 1.4 }}>Tu documento aún no está disponible. Un administrador debe activar tu cuenta para que puedas acceder a tu DNI digital.</p>
          </div>
        </div>
      )}

      {/* Mundial Card - 1077×298 @3x → 359×99px display */}
      <div style={{ margin: '12px 12px 0' }}>
        <img src="/card-mundial.png" alt="Viví el Mundial 2026" style={{ width: '100%', aspectRatio: '1077 / 298', borderRadius: '10px', objectFit: 'cover', display: 'block' }} />
      </div>

      {/* Turnos Card - 1076×360 @3x → 359×120px display */}
      <div style={{ margin: '8px 12px 0' }}>
        <img src="/card-turnos.png" alt="No tenés turnos programados" style={{ width: '100%', aspectRatio: '1076 / 360', borderRadius: '10px', objectFit: 'cover', display: 'block' }} />
      </div>

      {/* ¿Qué necesitás hoy? Section */}
      <div style={{ margin: '12px 12px 0' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#212121', fontFamily: SYS_FONT, margin: '0 0 6px' }}>¿Qué necesitás hoy?</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
          {services.map((s, i) => (
            <button key={i} onClick={s.action} style={{ background: '#fff', border: 'none', borderRadius: '10px', aspectRatio: '1 / 1.15', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', transition: 'transform 0.2s', fontFamily: SYS_FONT }}>
              <div style={{ height: '42px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src={s.icon} alt={s.label} style={{ maxWidth: '60%', maxHeight: '42px', objectFit: 'contain' }} />
              </div>
              <span style={{ fontSize: '11px', color: '#212121', fontWeight: 700, fontFamily: SYS_FONT, textAlign: 'center', lineHeight: 1.2, marginTop: '4px' }}>{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Próximo feriado Card */}
      <div style={{ background: '#e3f2fd', margin: '12px 12px 0', borderRadius: '10px', padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#3730ba', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px' }}>
          <Calendar size={18} color="#fff" />
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#212121', fontFamily: SYS_FONT }}>Próximo feriado</p>
          <p style={{ margin: '4px 0 2px', fontSize: '15px', fontWeight: 700, color: '#212121', fontFamily: SYS_FONT }}>15 de Junio</p>
          <p style={{ margin: 0, fontSize: '12px', color: '#616161', fontFamily: SYS_FONT, lineHeight: 1.4 }}>17 de junio. Paso a la Inmortalidad del Gral. Don Martín Miguel de Güemes.</p>
        </div>
      </div>

      {/* Mantené tu perfil actualizado - Image */}
      <div style={{ margin: '8px 12px 0' }}>
        <img src="/perfil.png" alt="Mantené tu perfil actualizado" style={{ width: '100%', borderRadius: '10px', display: 'block' }} />
      </div>

      <BottomNavBar activeTab="home" />

      {/* Admin Password Modal */}
      {showAdminPrompt && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowAdminPrompt(false)}>
          <div style={{ background: '#fff', borderRadius: '16px', padding: '24px', width: '85%', maxWidth: '320px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ textAlign: 'center', marginBottom: '16px' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#3730ba', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
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
              <button onClick={handleAdminLogin} style={{ flex: 1, padding: '12px', border: 'none', borderRadius: '10px', background: '#3730ba', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: SYS_FONT }}>
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
  const { user, setView } = useAppStore();
  const [dniExpanded, setDniExpanded] = useState(true);
  const dni = user?.dni;
  const isActive = user?.isActive ?? false;

  return (
    <div style={{ backgroundColor: '#f5f5f5', minHeight: '100vh', paddingBottom: '70px' }}>
      <header style={{ background: '#3730ba', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '55px 16px 16px', position: 'sticky', top: 0, zIndex: 50 }}>
        <button onClick={() => setView('home')} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', position: 'absolute', left: '16px', top: '55px' }}><ArrowLeft size={24} /></button>
        <span style={{ color: '#fff', fontSize: '17px', fontWeight: 600, fontFamily: SYS_FONT }}>Documentos</span>
      </header>

      <div style={{ padding: '12px', maxWidth: '550px', margin: '0 auto' }}>
        {!isActive && (
          <div style={{ background: '#fff3e0', borderRadius: '10px', padding: '14px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '12px', border: '1px solid #ffcc80' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#ff9800', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Bell size={18} color="#fff" />
            </div>
            <div>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#e65100', fontFamily: SYS_FONT }}>Cuenta pendiente de activación</p>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#bf360c', fontFamily: SYS_FONT, lineHeight: 1.4 }}>Tu DNI digital no está disponible hasta que un administrador active tu cuenta.</p>
            </div>
          </div>
        )}
        <div style={{ background: '#fff', borderRadius: '12px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          <button onClick={() => setDniExpanded(!dniExpanded)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' }}>
            <FileText size={24} color="#3730ba" />
            <span style={{ flex: 1, fontSize: '15px', fontWeight: 600, color: '#333', fontFamily: SYS_FONT }}>Documento Nacional de Identidad (DNI)</span>
            {dniExpanded ? <ChevronUp size={20} color="#999" /> : <ChevronDown size={20} color="#999" />}
          </button>
          {dniExpanded && isActive && dni && (
            <div style={{ padding: '0 16px 16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                <div><p style={{ margin: 0, fontSize: '12px', color: '#9e9e9e', fontFamily: SYS_FONT }}>Documento</p><p style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#333', fontFamily: SYS_FONT }}>{formatDniNumber(dni.dniNumero)}</p></div>
                <div><p style={{ margin: 0, fontSize: '12px', color: '#9e9e9e', fontFamily: SYS_FONT }}>Fecha de vencimiento</p><p style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#333', fontFamily: SYS_FONT }}>{calcExpiryDate(dni.fechaEmision)}</p></div>
                <div><p style={{ margin: 0, fontSize: '12px', color: '#9e9e9e', fontFamily: SYS_FONT }}>Nombre</p><p style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#333', fontFamily: SYS_FONT }}>{dni.nombre.toUpperCase()}</p></div>
                <div><p style={{ margin: 0, fontSize: '12px', color: '#9e9e9e', fontFamily: SYS_FONT }}>Apellido</p><p style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#333', fontFamily: SYS_FONT }}>{dni.apellido.toUpperCase()}</p></div>
              </div>
              <button onClick={() => setView('dni-viewer')} style={{ width: '100%', background: '#3730ba', color: '#fff', border: 'none', borderRadius: '25px', padding: '12px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: SYS_FONT, letterSpacing: '0.5px' }}>
                Ver DNI Digital
              </button>
            </div>
          )}
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
    <div style={{ backgroundColor: '#f5f5f5', minHeight: '100vh', paddingBottom: '70px' }}>
      {/* Header - matches Header_container--internal from real app */}
      <header style={{ background: '#3730ba', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '55px 16px 16px', position: 'sticky', top: 0, zIndex: 50 }}>
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
                        <img alt="DNI_photoUrl" src={dni.foto || '/sample_dniphoto.png'} style={{ height: '100%', objectFit: 'cover', width: '100%' }} />
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
                        <img alt="DNI_signature" src={dni.firma || '/sample_signature.png'} style={{ position: 'relative', height: '100%', objectFit: 'contain', width: '100%' }} />
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
            <img src="/icons/logo-CASA.png" alt="Inicio" style={{ height: '24px', width: '24px', objectFit: 'contain' }} />
          </div>
          <span style={{ fontSize: '12px', color: '#3730ba', fontWeight: 600, fontFamily: SYS_FONT }}>Inicio</span>
        </button>
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', padding: '2px 0', flex: 1 }}>
          <div style={{ height: '37px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src="/icons/logo-NOVEDADES.png" alt="Novedades" style={{ height: '37px', width: '80px', objectFit: 'contain' }} />
          </div>
          <span style={{ fontSize: '12px', color: '#757575', fontFamily: SYS_FONT }}>Novedades</span>
        </button>
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', padding: '2px 0', flex: 1 }}>
          <div style={{ height: '37px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src="/icons/logo-TELEFONO.png" alt="Teléfonos" style={{ height: '37px', width: '50px', objectFit: 'contain' }} />
          </div>
          <span style={{ fontSize: '12px', color: '#757575', fontFamily: SYS_FONT }}>Teléfonos</span>
        </button>
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', padding: '2px 0', flex: 1 }}>
          <div style={{ height: '37px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src="/icons/logo-USUARIO.png" alt="Usuario" style={{ height: '24px', width: '24px', objectFit: 'contain' }} />
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
    createdAt: string;
    dni: { nombre: string; apellido: string; dniNumero: string } | null;
  }> | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);
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

      // If activating the current logged-in user, update the store
      if (user && userId === user.id) {
        setUser({ ...user, isActive: makeActive });
      }

      // Refresh the list
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
    <div style={{ backgroundColor: '#f5f5f5', minHeight: '100vh' }}>
      <header style={{ background: '#3730ba', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '55px 16px 16px', position: 'sticky', top: 0, zIndex: 50 }}>
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
            <RefreshCw size={32} color="#3730ba" style={{ animation: 'spin 1s linear infinite' }} />
            <p style={{ color: '#757575', fontFamily: SYS_FONT, marginTop: '12px' }}>Cargando usuarios...</p>
          </div>
        ) : (
          <>
            {/* Pending Users */}
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#e65100', fontFamily: SYS_FONT, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Bell size={18} />
                Pendientes de activación ({pendingUsers.length})
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
                          <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#757575', fontFamily: SYS_FONT }}>
                            {u.email}
                          </p>
                          <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#9e9e9e', fontFamily: SYS_FONT }}>
                            DNI: {u.dni?.dniNumero || '-'} · Registrado: {new Date(u.createdAt).toLocaleDateString('es')}
                          </p>
                        </div>
                        <button
                          onClick={() => handleActivate(u.id, true)}
                          disabled={activating === u.id}
                          style={{
                            background: activating === u.id ? '#81c784' : '#4caf50',
                            border: 'none',
                            borderRadius: '8px',
                            color: '#fff',
                            padding: '8px 14px',
                            fontSize: '13px',
                            fontWeight: 600,
                            cursor: activating === u.id ? 'not-allowed' : 'pointer',
                            fontFamily: SYS_FONT,
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                            marginLeft: '10px',
                          }}
                        >
                          {activating === u.id ? '...' : 'Activar'}
                        </button>
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
                Cuentas activas ({activeUsers.length})
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
                          <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#757575', fontFamily: SYS_FONT }}>
                            {u.email}
                          </p>
                          <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#9e9e9e', fontFamily: SYS_FONT }}>
                            DNI: {u.dni?.dniNumero || '-'} · Registrado: {new Date(u.createdAt).toLocaleDateString('es')}
                          </p>
                        </div>
                        <button
                          onClick={() => handleActivate(u.id, false)}
                          disabled={activating === u.id}
                          style={{
                            background: activating === u.id ? '#ef9a9a' : '#f44336',
                            border: 'none',
                            borderRadius: '8px',
                            color: '#fff',
                            padding: '8px 14px',
                            fontSize: '13px',
                            fontWeight: 600,
                            cursor: activating === u.id ? 'not-allowed' : 'pointer',
                            fontFamily: SYS_FONT,
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                            marginLeft: '10px',
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
// SHARED BLUE HEADER (rounded bottom, used in home/novedades/telefonos)
// ========================================
function BlueRoundedHeader({ nombre, onLogoTap }: { nombre: string; onLogoTap?: () => void }) {
  return (
    <header style={{ background: '#342BCB', position: 'relative', height: '26vh', minHeight: '200px', borderBottomLeftRadius: '40px', borderBottomRightRadius: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Top row: logo centered + avatar right */}
      <div style={{ width: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: '50px' }}>
        <span onClick={onLogoTap} style={{ color: '#fff', fontSize: '38px', fontWeight: 700, fontFamily: SYS_FONT, cursor: onLogoTap ? 'pointer' : 'default', userSelect: 'none' }}>
          <span style={{ color: '#7098DB' }}>mi</span>Argentina
        </span>
        {/* Avatar */}
        <div style={{ position: 'absolute', right: '30px', top: '50px' }}>
          <div style={{ width: '62px', height: '62px', borderRadius: '50%', background: '#d0d0d0', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            <User size={30} color="#555" />
            {/* Check overlay */}
            <div style={{ position: 'absolute', bottom: '-2px', left: '-2px', width: '22px', height: '22px', borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}>
              <Check size={13} color="#7098DB" strokeWidth={3} />
            </div>
          </div>
        </div>
      </div>
      {/* Greeting */}
      <div style={{ marginTop: '20px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '30px', fontWeight: 400, color: '#fff', fontFamily: SYS_FONT, margin: 0 }}>¡Hola {nombre}!</h1>
      </div>
      {/* Scrollbar indicator on right edge */}
      <div style={{ position: 'absolute', right: '2px', top: '50%', transform: 'translateY(-50%)', width: '4px', height: '80px', background: '#000', borderRadius: '4px' }} />
    </header>
  );
}

// ========================================
// NOVEDADES VIEW
// ========================================
function NovedadesView() {
  const { user, setView } = useAppStore();
  const nombre = user?.dni?.nombre || 'Usuario';

  return (
    <div style={{ backgroundColor: '#f5f5f5', minHeight: '100vh', paddingBottom: '70px' }}>
      <BlueRoundedHeader nombre={nombre} />

      {/* Content */}
      <div style={{ padding: '40px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '40px 24px', maxWidth: '340px', width: '100%', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', textAlign: 'center' }}>
          {/* Document/News icon */}
          <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
            <FileText size={40} color="#999" />
          </div>
          <p style={{ margin: 0, fontSize: '16px', color: '#757575', fontFamily: SYS_FONT, lineHeight: 1.5 }}>
            No hay novedades para mostrar en este momento
          </p>
          <button
            onClick={() => setView('home')}
            style={{ marginTop: '24px', background: '#7B1FA2', color: '#fff', border: 'none', borderRadius: '25px', padding: '14px 32px', fontSize: '16px', fontWeight: 600, cursor: 'pointer', fontFamily: SYS_FONT, width: '100%' }}
          >
            Volver al inicio
          </button>
        </div>
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
  const nombre = user?.dni?.nombre || 'Usuario';

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
    <div style={{ backgroundColor: '#f5f5f5', minHeight: '100vh', paddingBottom: '70px' }}>
      <BlueRoundedHeader nombre={nombre} />

      {/* Phone list */}
      <div style={{ padding: '16px 12px 0' }}>
        {emergencyPhones.map((phone, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: '12px', padding: '16px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Phone size={20} color="#342BCB" />
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: '22px', fontWeight: 700, color: '#342BCB', fontFamily: SYS_FONT, marginRight: '12px' }}>{phone.number}</span>
              <span style={{ fontSize: '14px', color: '#616161', fontFamily: SYS_FONT, lineHeight: 1.3 }}>{phone.label}</span>
            </div>
          </div>
        ))}
      </div>

      <BottomNavBar activeTab="telefonos" />
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
    <div style={{ backgroundColor: '#f5f5f5', minHeight: '100vh', paddingBottom: '70px' }}>
      {/* Header with back arrow */}
      <header style={{ background: '#342BCB', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '55px 16px 16px', position: 'sticky', top: 0, zIndex: 50 }}>
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
            style={{ width: '100%', background: '#342BCB', color: '#fff', border: 'none', borderRadius: '25px', padding: '14px', fontSize: '15px', fontWeight: 600, cursor: 'pointer', fontFamily: SYS_FONT, marginBottom: '16px' }}
          >
            Descargar constancia de CUIL
          </button>
          {/* Data source */}
          <p style={{ margin: 0, fontSize: '12px', color: '#9e9e9e', fontFamily: SYS_FONT, textAlign: 'center' }}>
            Datos suministrados por <span style={{ color: '#342BCB', fontWeight: 600 }}>ANSES</span>
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
    <div style={{ backgroundColor: '#f5f5f5', minHeight: '100vh', paddingBottom: '70px' }}>
      {/* Header with back arrow */}
      <header style={{ background: '#342BCB', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '55px 16px 16px', position: 'sticky', top: 0, zIndex: 50 }}>
        <button onClick={() => setView('home')} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', position: 'absolute', left: '16px', top: '55px' }}><ArrowLeft size={24} /></button>
        <span style={{ color: '#fff', fontSize: '17px', fontWeight: 600, fontFamily: SYS_FONT }}>Vehículos</span>
      </header>

      <div style={{ padding: '16px 12px' }}>
        {/* Blue info card */}
        <div style={{ background: '#e3f2fd', borderRadius: '12px', padding: '16px', marginBottom: '12px', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#342BCB', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
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
            style={{ width: '100%', background: '#342BCB', color: '#fff', border: 'none', borderRadius: '25px', padding: '14px', fontSize: '15px', fontWeight: 600, cursor: 'pointer', fontFamily: SYS_FONT }}
          >
            Agregar servicios
          </button>
        </div>
      </div>

      <BottomNavBar activeTab="home" />
    </div>
  );
}
