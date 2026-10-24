import { Routes, Route, Link, useLocation } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Host from './pages/Host.jsx';
import Client from './pages/Client.jsx';

export default function App() {
  const loc = useLocation();
  return (
    <div className="app">
      <div className="topbar">
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'inherit' }}>
          <span style={{ fontSize: 20 }}>🖥️</span>
          <h1>ScreenBridge</h1>
        </Link>
        <span className="spacer" />
        <Link to="/host" className="btn secondary" style={{ padding: '6px 12px' }}>Host</Link>
        <Link to="/client" className="btn secondary" style={{ padding: '6px 12px' }}>Client</Link>
      </div>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/host" element={<Host />} />
        <Route path="/client" element={<Client />} />
      </Routes>
    </div>
  );
}
