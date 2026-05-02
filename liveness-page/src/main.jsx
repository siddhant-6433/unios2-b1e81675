import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';
import { ThemeProvider } from '@aws-amplify/ui-react';
import { FaceLivenessDetector } from '@aws-amplify/ui-react-liveness';
import '@aws-amplify/ui-react/styles.css';

const params = new URLSearchParams(window.location.search);
const SUPABASE_URL = params.get('supabase_url') || '';
const SUPABASE_KEY = params.get('supabase_key') || '';
const USER_ID = params.get('user_id') || '';
const REGION = params.get('region') || 'ap-south-1';
const IDENTITY_POOL_ID = params.get('identity_pool_id') || 'ap-south-1:518a81c9-8722-431a-9d1b-2e988ab4f0b5';

Amplify.configure({
  Auth: {
    Cognito: {
      identityPoolId: IDENTITY_POOL_ID,
      allowGuestAccess: true,
    }
  }
});

function postToRN(data) {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify(data));
  }
  console.log('[Liveness→RN]', JSON.stringify(data));
}

function App() {
  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const retrying = useRef(false);
  const errorCountRef = useRef(0);

  const createSession = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/face-liveness-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ action: 'create' }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSessionId(data.session_id);
      setLoading(false);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  };

  useEffect(() => {
    // Cold-start fix: AWS Amplify lazily fetches Cognito guest credentials on the
    // first AWS call. That fetch races with the FaceLivenessDetector's WebSocket
    // open and the WebSocket times out before credentials arrive → onError. Second
    // attempt works because credentials are now cached. We pre-fetch credentials
    // here, then warm the WebView's camera permission, before creating the session.
    let cancelled = false;
    const warmAndStart = async () => {
      try {
        const session = await fetchAuthSession();
        console.log('[Liveness] Auth warmed:', !!session.credentials);
      } catch (err) {
        console.warn('[Liveness] Auth warmup failed:', err);
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        stream.getTracks().forEach((t) => t.stop());
      } catch (err) {
        console.warn('[Liveness] Camera warmup failed:', err);
      }
      if (!cancelled) await createSession();
    };
    warmAndStart();
    return () => { cancelled = true; };
  }, []);

  const handleComplete = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/face-liveness-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ action: 'get_results', session_id: sessionId, user_id: USER_ID }),
      });
      const data = await res.json();
      postToRN({ type: 'liveness_result', ...data });
    } catch (e) {
      postToRN({ type: 'liveness_error', error: e.message });
    }
  };

  const handleError = (err) => {
    console.error('[Liveness] Error:', err);
    if (retrying.current) return;
    retrying.current = true;
    errorCountRef.current += 1;

    // Cold-start workaround: silently retry the first two errors before showing
    // the error UI. Most cold-starts resolve within one extra attempt; allow two
    // for safety.
    if (errorCountRef.current <= 2) {
      setSessionId(null);
      setLoading(true);
      const delay = 800 * errorCountRef.current; // 800ms, 1600ms
      setTimeout(async () => {
        retrying.current = false;
        await createSession();
      }, delay);
      return;
    }

    const detail = err?.error?.message || err?.message || err?.name || (typeof err === 'string' ? err : '');
    setError(detail ? `Liveness failed: ${detail}` : 'Liveness check failed');
    setTimeout(() => { retrying.current = false; }, 2000);
  };

  const handleCancel = () => {
    postToRN({ type: 'liveness_cancel' });
  };

  if (loading) {
    return (
      <div style={styles.center}>
        <div style={styles.spinner} />
        <p>{sessionId ? 'Verifying result...' : 'Creating session...'}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.center}>
        <p style={{ fontSize: 20 }}>⚠️</p>
        <p style={styles.errorText}>{error}</p>
        <button style={styles.btn} onClick={createSession}>Retry</button>
        <button style={styles.btnOutline} onClick={handleCancel}>Cancel</button>
      </div>
    );
  }

  return (
    <ThemeProvider colorMode="dark">
      <div style={{ height: '100vh' }}>
        <FaceLivenessDetector
          sessionId={sessionId}
          region={REGION}
          onAnalysisComplete={handleComplete}
          onError={handleError}
          onUserCancel={handleCancel}
          disableStartScreen={true}
        />
      </div>
    </ThemeProvider>
  );
}

const styles = {
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16, padding: 24 },
  spinner: { width: 40, height: 40, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  errorText: { color: '#f87171', textAlign: 'center', fontSize: 14, lineHeight: 1.5, maxWidth: 300 },
  btn: { background: '#3b82f6', color: '#fff', border: 'none', padding: '14px 28px', borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: 'pointer' },
  btnOutline: { background: 'transparent', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '10px 20px', borderRadius: 8, fontSize: 14, cursor: 'pointer' },
};

// Inject spinner keyframe
const styleSheet = document.createElement('style');
styleSheet.textContent = '@keyframes spin { to { transform: rotate(360deg) } }';
document.head.appendChild(styleSheet);

createRoot(document.getElementById('root')).render(<App />);
