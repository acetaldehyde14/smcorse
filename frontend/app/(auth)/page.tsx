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
  const [signupLoading, setSignupLoading] = useState(false);

  useEffect(() => {
    if (!isLoading && user) router.replace('/dashboard');
  }, [user, isLoading, router]);

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
    if (signupPassword.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
    setSignupLoading(true);
    try {
      await signup(signupName, signupUsername, signupEmail, signupPassword);
    } catch (err: any) {
      toast(err.message || 'Signup failed', 'error');
    } finally {
      setSignupLoading(false);
    }
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
