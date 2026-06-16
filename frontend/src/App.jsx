import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Auth from './Auth';
import Dashboard from './Dashboard';
import { FontSizeProvider } from './context/FontSizeContext';
import { LanguageProvider } from './context/LanguageContext';
function App() {
  // Auth state is the JWT token. userId is kept only as a convenience value for
  // the dashboard UI — the backend derives identity from the token, never from it.
  const [token, setToken] = useState(localStorage.getItem('token'));

  const handleLogin = (data) => {
    localStorage.setItem('token', data.access_token);
    if (data.user_id != null) localStorage.setItem('userId', data.user_id);
    setToken(data.access_token);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    setToken(null);
  };

  const userId = localStorage.getItem('userId');

  return (
      <LanguageProvider>
    <FontSizeProvider>
      <BrowserRouter>
        <div style={{ minHeight: '100vh', backgroundColor: '#f4f7f6' }}>
          <Routes>
            <Route
              path="/login"
              element={token ? <Navigate to="/" replace /> : <Auth onLogin={handleLogin} />}
            />
            <Route
              path="/"
              element={token ? <Dashboard userId={userId} onLogout={handleLogout} /> : <Navigate to="/login" replace />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </BrowserRouter>
    </FontSizeProvider>
    </LanguageProvider>
  );
}

export default App;