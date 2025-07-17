import React, { useState } from 'react';
import Chat from './Chat';

function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem('token') || '');
  const [showRegister, setShowRegister] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', avatar: '' });
  const [error, setError] = useState('');

  const handleChange = e => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleLogin = async e => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.username, password: form.password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      setUser(data.user);
      setToken(data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('token', data.token);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRegister = async e => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      setShowRegister(false);
      setError('Registration successful! Please log in.');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setToken('');
    localStorage.removeItem('user');
    localStorage.removeItem('token');
  };

  if (!user) {
  return (
      <div style={{ maxWidth: 400, margin: '4rem auto', padding: 20, border: '1px solid #ccc', borderRadius: 8, background: '#f0f2f5' }}>
        <h2 style={{ textAlign: 'center', color: '#075E54' }}>{showRegister ? 'Register' : 'Login'}</h2>
        <form onSubmit={showRegister ? handleRegister : handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="text"
            name="username"
            value={form.username}
            onChange={handleChange}
            placeholder="Username"
            required
            style={{ padding: 10, borderRadius: 4, border: '1px solid #ccc' }}
          />
          <input
            type="password"
            name="password"
            value={form.password}
            onChange={handleChange}
            placeholder="Password"
            required
            style={{ padding: 10, borderRadius: 4, border: '1px solid #ccc' }}
          />
          {showRegister && (
            <input
              type="text"
              name="avatar"
              value={form.avatar}
              onChange={handleChange}
              placeholder="Avatar URL (optional)"
              style={{ padding: 10, borderRadius: 4, border: '1px solid #ccc' }}
            />
          )}
          <button type="submit" style={{ background: '#25D366', color: '#fff', border: 'none', borderRadius: 4, padding: 10, fontWeight: 'bold' }}>{showRegister ? 'Register' : 'Login'}</button>
        </form>
        <div style={{ marginTop: 10, textAlign: 'center' }}>
          <button onClick={() => { setShowRegister(r => !r); setError(''); }} style={{ background: 'none', border: 'none', color: '#075E54', cursor: 'pointer', textDecoration: 'underline' }}>
            {showRegister ? 'Already have an account? Login' : 'No account? Register'}
          </button>
        </div>
        {error && <div style={{ color: 'red', marginTop: 10, textAlign: 'center' }}>{error}</div>}
    </div>
  );
  }

  return <Chat user={user} onLogout={handleLogout} />;
}

export default App;
