export default function LoginPage() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#192635' }}>Pieslēgties — Admin konsole</h1>
      <p style={{ color: '#6B7B8D', fontSize: 14 }}>Autentifikācijas forma drīzumā.</p>
      <a href="/" style={{ color: '#1ec97b', fontWeight: 600 }}>← Atpakaļ</a>
    </div>
  );
}
