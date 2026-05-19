'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';

const partners = [
  { src: '/logos/FullLogo_Transparent.png', alt: 'Swift Display', tall: false },
  { src: '/logos/IMG_0072.PNG', alt: 'SimTeam', tall: false },
  { src: '/logos/RaceData.webp', alt: 'RaceData', tall: true },
  { src: '/logos/racedata_blue.png', alt: 'RaceData.AI', tall: false },
];

const features = [
  { title: 'Telemetry Analysis', desc: 'Upload and analyze your iRacing telemetry files with professional-grade tools and insights.' },
  { title: 'AI Coaching', desc: 'Get personalized coaching feedback powered by advanced AI to improve your driving technique.' },
  { title: 'Race Strategy', desc: 'Calculate fuel usage, tire wear, and optimal pit strategies for endurance racing.' },
  { title: 'Team Management', desc: 'Coordinate driver rotations, practice sessions, and team communications in one place.' },
  { title: 'Lap Library', desc: 'Compare your laps against reference times from coaches and top drivers.' },
  { title: 'Progress Tracking', desc: 'Monitor your improvement over time with detailed performance analytics and metrics.' },
];

interface DownloadFile {
  id: string;
  title: string;
  description?: string;
  originalName: string;
  size: number;
  uploadedAt: string;
  url: string;
}

function NavBtn({ label, onClick }: { label: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '0.8rem 2rem',
        border: '2px solid #fff',
        background: hovered ? '#fff' : 'transparent',
        color: hovered ? '#0066cc' : '#fff',
        fontFamily: "'Montserrat', sans-serif",
        fontWeight: 600,
        fontSize: '0.95rem',
        cursor: 'pointer',
        textTransform: 'uppercase',
        letterSpacing: 1,
        borderRadius: 4,
        transition: 'all 0.3s',
      }}
    >
      {label}
    </button>
  );
}

function LandingInner() {
  const { user, isLoading, login, signup } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [signupName, setSignupName] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupDiscordUserId, setSignupDiscordUserId] = useState('');
  const [signupTelegramChatId, setSignupTelegramChatId] = useState('');
  const [signupLoading, setSignupLoading] = useState(false);
  const [downloads, setDownloads] = useState<DownloadFile[]>([]);
  const [downloadTitle, setDownloadTitle] = useState('');
  const [downloadDescription, setDownloadDescription] = useState('');
  const [downloadFile, setDownloadFile] = useState<File | null>(null);
  const [downloadUploading, setDownloadUploading] = useState(false);

  useEffect(() => {
    if (!isLoading && user && window.location.hash !== '#downloads') router.replace('/dashboard');
  }, [user, isLoading, router]);

  const loadDownloads = async () => {
    try {
      const res = await fetch('/api/downloads', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load downloads');
      const data = await res.json();
      setDownloads(Array.isArray(data.files) ? data.files : []);
    } catch (err: any) {
      toast(err.message || 'Failed to load downloads', 'error');
    }
  };

  useEffect(() => {
    loadDownloads();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToDownloads = () => {
    window.location.hash = 'downloads';
    document.getElementById('downloads')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    try {
      await login(loginEmail, loginPassword);
    } catch (err: any) {
      toast(err.message || 'Login failed', 'error');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signupUsername.trim()) { toast('Username is required', 'error'); return; }
    if (!/^[a-zA-Z0-9_-]{3,30}$/.test(signupUsername)) { toast('Username must be 3–30 characters (letters, numbers, _ or -)', 'error'); return; }
    if (!signupDiscordUserId.trim()) { toast('Discord ID is required', 'error'); return; }
    if (signupPassword.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
    setSignupLoading(true);
    try {
      await signup(
        signupName,
        signupUsername,
        signupEmail,
        signupPassword,
        signupDiscordUserId.trim(),
        signupTelegramChatId.trim() || undefined
      );
    } catch (err: any) {
      toast(err.message || 'Signup failed', 'error');
    } finally {
      setSignupLoading(false);
    }
  };

  const handleDownloadUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!downloadFile) { toast('Choose a file to upload', 'error'); return; }

    const form = new FormData();
    form.append('file', downloadFile);
    form.append('title', downloadTitle.trim() || downloadFile.name);
    form.append('description', downloadDescription.trim());

    setDownloadUploading(true);
    try {
      const res = await fetch('/api/downloads', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (!res.ok) {
        let message = `Upload failed (${res.status})`;
        try { message = (await res.json()).error || message; } catch {}
        throw new Error(message);
      }
      setDownloadTitle('');
      setDownloadDescription('');
      setDownloadFile(null);
      await loadDownloads();
      toast('Download uploaded', 'success');
    } catch (err: any) {
      toast(err.message || 'Upload failed', 'error');
    } finally {
      setDownloadUploading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.9rem', border: '2px solid #e0e0e0',
    borderRadius: 4, fontSize: '1rem', fontFamily: "'Rajdhani', sans-serif",
    outline: 'none', background: '#f8f9fa', color: '#2c3e50',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', marginBottom: 6, fontWeight: 600,
    textTransform: 'uppercase', fontSize: '0.85rem', letterSpacing: '0.5px', color: '#2c3e50',
  };
  const submitStyle: React.CSSProperties = {
    width: '100%', padding: '1rem', background: '#0066cc', border: 'none',
    color: '#fff', fontFamily: "'Montserrat', sans-serif", fontWeight: 700,
    fontSize: '1rem', cursor: 'pointer', textTransform: 'uppercase',
    letterSpacing: '1.5px', borderRadius: 4, marginTop: 4,
  };

  return (
    <div style={{ fontFamily: "'Rajdhani', sans-serif", background: '#fff', color: '#2c3e50', overflowX: 'hidden' }}>

      {/* ── HERO ─────────────────────────────────────────────── */}
      <div style={{
        position: 'relative', minHeight: '100vh',
        background: 'linear-gradient(135deg, #0a0f1c 0%, #1a2332 50%, #0066cc 100%)',
        overflow: 'hidden',
      }}>
        {/* Background image */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: "url('/img/smcorse5.png')",
          backgroundSize: 'cover', backgroundPosition: 'center',
          opacity: 0.15, zIndex: 0,
        }} />
        {/* Grid overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'linear-gradient(rgba(0,102,204,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(0,102,204,0.05) 1px,transparent 1px)',
          backgroundSize: '60px 60px', zIndex: 1,
        }} />

        <div style={{ position: 'relative', zIndex: 2, maxWidth: 1400, margin: '0 auto', padding: '2rem' }}>
          {/* Header */}
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1.5rem', marginBottom: '4rem' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/img/sm_corse_only_blue.png" alt="SM CORSE" style={{ height: 60, width: 'auto', filter: 'brightness(0) invert(1)' }} />
            <nav style={{ display: 'flex', gap: '1rem' }}>
              <NavBtn label="Downloads" onClick={scrollToDownloads} />
              <NavBtn label="Login" onClick={() => setLoginOpen(true)} />
              <NavBtn label="Join Team" onClick={() => setSignupOpen(true)} />
            </nav>
          </header>

          {/* 2-column layout */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4rem',
            alignItems: 'center', minHeight: 'calc(100vh - 220px)', padding: '2rem 0',
          }}>
            {/* Left: text + CTAs */}
            <div>
              <h1 style={{
                fontFamily: "'Montserrat', sans-serif", fontSize: 'clamp(2.2rem,4vw,4rem)',
                fontWeight: 800, lineHeight: 1.1, marginBottom: '1.5rem',
                color: '#fff', textTransform: 'uppercase', letterSpacing: 2,
              }}>
                Welcome to{' '}
                <span style={{ color: '#00aaff', display: 'block' }}>SM CORSE</span>
              </h1>
              <p style={{ fontSize: '1.2rem', lineHeight: 1.7, marginBottom: '2.5rem', color: 'rgba(255,255,255,0.9)' }}>
                Elite iRacing endurance team platform. Professional telemetry analysis,
                AI-powered coaching, and advanced race strategy tools to drive your
                performance to the next level.
              </p>
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setSignupOpen(true)}
                  style={{ padding: '1.2rem 2.5rem', background: '#0066cc', border: 'none', color: '#fff', fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: '1.1rem', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '1.5px', borderRadius: 4, boxShadow: '0 4px 15px rgba(0,102,204,0.4)' }}
                >
                  Join Our Team
                </button>
                <button
                  onClick={() => setLoginOpen(true)}
                  style={{ padding: '1.2rem 2.5rem', background: 'transparent', border: '2px solid #fff', color: '#fff', fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: '1.1rem', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '1.5px', borderRadius: 4 }}
                >
                  Team Login
                </button>
                <button
                  onClick={scrollToDownloads}
                  style={{ padding: '1.2rem 2.5rem', background: 'rgba(255,255,255,0.12)', border: '2px solid rgba(255,255,255,0.45)', color: '#fff', fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: '1.1rem', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '1.5px', borderRadius: 4 }}
                >
                  Downloads
                </button>
              </div>
            </div>

            {/* Right: 2 car images stacked */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {['/img/smcorse3.png', '/img/smcorse4.png'].map((src, i) => (
                <div key={i} style={{ borderRadius: 12, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', border: '3px solid rgba(255,255,255,0.2)', position: 'relative' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`SM CORSE Racing ${i + 1}`} style={{ width: '100%', height: 'auto', display: 'block' }} />
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg,rgba(0,102,204,0.25),transparent)', pointerEvents: 'none' }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── FEATURES ─────────────────────────────────────────── */}
      <div style={{ background: '#f8f9fa', padding: '5rem 2rem' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>
          <h2 style={{ fontFamily: "'Montserrat',sans-serif", fontSize: '2.5rem', fontWeight: 800, textAlign: 'center', marginBottom: '3rem', color: '#2c3e50', textTransform: 'uppercase' }}>
            Team Platform Features
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: '2rem' }}>
            {features.map(f => (
              <div key={f.title} style={{ background: '#fff', padding: '2rem', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', borderLeft: '4px solid #0066cc' }}>
                <h3 style={{ fontFamily: "'Montserrat',sans-serif", fontSize: '1.4rem', fontWeight: 700, marginBottom: '1rem', color: '#0066cc' }}>{f.title}</h3>
                <p style={{ fontSize: '1.1rem', lineHeight: 1.6, color: '#2c3e50' }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── PARTNERS ─────────────────────────────────────────── */}
      <div id="downloads" style={{ background: '#fff', padding: '5rem 2rem' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: '2rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
            <div>
              <p style={{ color: '#0066cc', fontFamily: "'Montserrat',sans-serif", fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>Downloads</p>
              <h2 style={{ fontFamily: "'Montserrat',sans-serif", fontSize: '2.5rem', fontWeight: 800, color: '#0a0f1c', textTransform: 'uppercase', margin: 0 }}>Team Files & Tools</h2>
              <p style={{ marginTop: 12, color: '#536173', fontSize: '1.1rem', maxWidth: 620 }}>
                Get the latest SM CORSE tools, installers, setup packs, documents, and shared race files.
              </p>
            </div>
            <span style={{ color: user?.is_admin ? '#0f8a4b' : '#667085', background: user?.is_admin ? '#e8f8ef' : '#f3f5f7', border: `1px solid ${user?.is_admin ? '#b7ebc8' : '#d8dee6'}`, padding: '0.6rem 0.9rem', borderRadius: 999, fontWeight: 700 }}>
              {user?.is_admin ? 'Admin upload enabled' : 'Public downloads'}
            </span>
          </div>

          {user?.is_admin && (
            <form onSubmit={handleDownloadUpload} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr auto', gap: '1rem', alignItems: 'end', background: '#0a0f1c', border: '1px solid #1a2540', borderRadius: 14, padding: '1.2rem', marginBottom: '2rem' }}>
              <div>
                <label style={{ ...labelStyle, color: '#aeb8c7' }}>Title</label>
                <input value={downloadTitle} onChange={e => setDownloadTitle(e.target.value)} placeholder="e.g. iRacing Enduro Client" style={{ ...inputStyle, background: '#10182a', borderColor: '#24314f', color: '#fff' }} />
              </div>
              <div>
                <label style={{ ...labelStyle, color: '#aeb8c7' }}>Description</label>
                <input value={downloadDescription} onChange={e => setDownloadDescription(e.target.value)} placeholder="Optional short note" style={{ ...inputStyle, background: '#10182a', borderColor: '#24314f', color: '#fff' }} />
              </div>
              <div>
                <label style={{ ...labelStyle, color: '#aeb8c7' }}>File</label>
                <input type="file" onChange={e => setDownloadFile(e.target.files?.[0] ?? null)} style={{ ...inputStyle, background: '#10182a', borderColor: '#24314f', color: '#fff', maxWidth: 260 }} />
              </div>
              <button type="submit" disabled={downloadUploading} style={{ ...submitStyle, marginTop: 0, opacity: downloadUploading ? 0.6 : 1, gridColumn: '1 / -1' }}>
                {downloadUploading ? 'Uploading...' : 'Upload Download'}
              </button>
            </form>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '1rem' }}>
            {downloads.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', border: '1px dashed #cbd5e1', borderRadius: 12, padding: '2rem', textAlign: 'center', color: '#667085' }}>
                No downloads uploaded yet.
              </div>
            ) : downloads.map(file => (
              <a key={file.id} href={file.url} download style={{ display: 'block', textDecoration: 'none', color: 'inherit', background: '#f8fafc', border: '1px solid #dbe3ee', borderRadius: 14, padding: '1.2rem', boxShadow: '0 8px 24px rgba(15,23,42,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.8rem' }}>
                  <strong style={{ fontFamily: "'Montserrat',sans-serif", color: '#0a0f1c', fontSize: '1rem' }}>{file.title || file.originalName}</strong>
                  <span style={{ color: '#0066cc', fontWeight: 800 }}>↓</span>
                </div>
                {file.description && <p style={{ color: '#536173', margin: '0 0 0.8rem', lineHeight: 1.5 }}>{file.description}</p>}
                <p style={{ color: '#7b8794', fontSize: '0.9rem', margin: 0 }}>
                  {formatBytes(file.size)} · {new Date(file.uploadedAt).toLocaleDateString()}
                </p>
              </a>
            ))}
          </div>
        </div>
      </div>

      <div style={{ background: '#0a0f1c', padding: '4rem 2rem' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontFamily: "'Montserrat',sans-serif", fontSize: '1.6rem', fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 3, marginBottom: '2.5rem' }}>
            Our Partners
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4rem', flexWrap: 'wrap' }}>
            {partners.map(p => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.alt} src={p.src} alt={p.alt}
                style={{ height: p.tall ? 70 : 55, width: 'auto', opacity: 0.7, filter: 'grayscale(30%)', transition: 'all 0.3s', cursor: 'pointer' }}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                onMouseEnter={e => { const el = e.target as HTMLImageElement; el.style.opacity = '1'; el.style.filter = 'grayscale(0%)'; el.style.transform = 'scale(1.05)'; }}
                onMouseLeave={e => { const el = e.target as HTMLImageElement; el.style.opacity = '0.7'; el.style.filter = 'grayscale(30%)'; el.style.transform = 'scale(1)'; }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <div style={{ background: '#060a14', padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'rgba(255,255,255,0.3)', fontFamily: "'Rajdhani',sans-serif", fontSize: '0.9rem' }}>
          SM CORSE Esports Racing Team
        </p>
      </div>

      {/* ── LOGIN MODAL ────────────────────────────────────────── */}
      <Modal open={loginOpen} onClose={() => setLoginOpen(false)} title="Team Login">
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          <div>
            <label style={labelStyle}>Email</label>
            <input type="email" required autoFocus value={loginEmail} onChange={e => setLoginEmail(e.target.value)} style={inputStyle}
              onFocus={e => (e.target.style.borderColor = '#0066cc')} onBlur={e => (e.target.style.borderColor = '#e0e0e0')} />
          </div>
          <div>
            <label style={labelStyle}>Password</label>
            <input type="password" required value={loginPassword} onChange={e => setLoginPassword(e.target.value)} style={inputStyle}
              onFocus={e => (e.target.style.borderColor = '#0066cc')} onBlur={e => (e.target.style.borderColor = '#e0e0e0')} />
          </div>
          <button type="submit" disabled={loginLoading} style={{ ...submitStyle, opacity: loginLoading ? 0.7 : 1 }}>
            {loginLoading ? 'Logging in…' : 'Login'}
          </button>
          <p style={{ textAlign: 'center', color: '#666', fontSize: '0.95rem' }}>
            New to the team?{' '}
            <button type="button" onClick={() => { setLoginOpen(false); setSignupOpen(true); }}
              style={{ background: 'none', border: 'none', color: '#0066cc', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline', fontSize: '0.95rem' }}>
              Create account
            </button>
          </p>
        </form>
      </Modal>

      {/* ── SIGNUP MODAL ─────────────────────────────────────────── */}
      <Modal open={signupOpen} onClose={() => setSignupOpen(false)} title="Join SM CORSE">
        <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input type="text" required autoFocus value={signupName} onChange={e => setSignupName(e.target.value)} style={inputStyle}
              onFocus={e => (e.target.style.borderColor = '#0066cc')} onBlur={e => (e.target.style.borderColor = '#e0e0e0')} />
          </div>
          <div>
            <label style={labelStyle}>Username</label>
            <input type="text" required placeholder="e.g. max_verstappen" value={signupUsername} onChange={e => setSignupUsername(e.target.value)} style={inputStyle}
              onFocus={e => (e.target.style.borderColor = '#0066cc')} onBlur={e => (e.target.style.borderColor = '#e0e0e0')} />
          </div>
          <div>
            <label style={labelStyle}>Email</label>
            <input type="email" required value={signupEmail} onChange={e => setSignupEmail(e.target.value)} style={inputStyle}
              onFocus={e => (e.target.style.borderColor = '#0066cc')} onBlur={e => (e.target.style.borderColor = '#e0e0e0')} />
          </div>
          <div>
            <label style={labelStyle}>Password</label>
            <input type="password" required placeholder="Min 8 characters" value={signupPassword} onChange={e => setSignupPassword(e.target.value)} style={inputStyle}
              onFocus={e => (e.target.style.borderColor = '#0066cc')} onBlur={e => (e.target.style.borderColor = '#e0e0e0')} />
          </div>
          <div>
            <label style={labelStyle}>Discord ID</label>
            <input type="text" required placeholder="e.g. 123456789012345678" value={signupDiscordUserId} onChange={e => setSignupDiscordUserId(e.target.value)} style={inputStyle}
              onFocus={e => (e.target.style.borderColor = '#0066cc')} onBlur={e => (e.target.style.borderColor = '#e0e0e0')} />
          </div>
          <div>
            <label style={labelStyle}>Telegram ID <span style={{ color: '#667085', textTransform: 'none' }}>(optional)</span></label>
            <input type="text" placeholder="e.g. 987654321" value={signupTelegramChatId} onChange={e => setSignupTelegramChatId(e.target.value)} style={inputStyle}
              onFocus={e => (e.target.style.borderColor = '#0066cc')} onBlur={e => (e.target.style.borderColor = '#e0e0e0')} />
          </div>
          <button type="submit" disabled={signupLoading} style={{ ...submitStyle, opacity: signupLoading ? 0.7 : 1 }}>
            {signupLoading ? 'Creating account…' : 'Create Account'}
          </button>
          <p style={{ textAlign: 'center', color: '#666', fontSize: '0.95rem' }}>
            Already have an account?{' '}
            <button type="button" onClick={() => { setSignupOpen(false); setLoginOpen(true); }}
              style={{ background: 'none', border: 'none', color: '#0066cc', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline', fontSize: '0.95rem' }}>
              Login
            </button>
          </p>
        </form>
      </Modal>
    </div>
  );
}

export default function LandingPage() {
  return (
    <AuthProvider>
      <ToastProvider>
        <LandingInner />
      </ToastProvider>
    </AuthProvider>
  );
}
