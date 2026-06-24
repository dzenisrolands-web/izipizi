export default function Home() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 48, fontWeight: 800, background: 'linear-gradient(90deg, #53F3A4, #AD47FF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
        IziPizi
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#192635', margin: 0 }}>Admin konsole</h1>
      <p style={{ color: '#6B7B8D', fontSize: 15 }}>admin.izipizi.lv — drīzumā</p>
    </div>
  );
}
