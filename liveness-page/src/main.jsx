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
// Prefer a session already created by the native app (avoids WebView hang).
const PRESET_SESSION_ID = params.get('session_id') || '';
const USER_ID = params.get('user_id') || '';
const REGION = params.get('region') || 'ap-south-1';
const IDENTITY_POOL_ID = params.get('identity_pool_id') || 'ap-south-1:518a81c9-8722-431a-9d1b-2e988ab4f0b5';

Amplify.configure({
  Auth: {
    Cognito: {
      identityPoolId: IDENTITY_POOL_ID,
      allowGuestAccess: true,
    },
  },
});

function postToRN(data) {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify(data));
  }
  console.log('[Liveness→RN]', JSON.stringify(data));
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function App() {
  const [sessionId, setSessionId] = useState(PRESET_SESSION_ID || null);
  const [loading, setLoading] = useState(true);
  const [statusText, setStatusText] = useState(
    PRESET_SESSION_ID ? 'Preparing camera…' : 'Creating AWS Rekognition session…',
  );
  const [error, setError] = useState(null);
  const retrying = useRef(false);
  const errorCountRef = useRef(0);

  const createSession = async () => {
    setLoading(true);
    setError(null);
    setStatusText('Creating AWS Rekognition session…');

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      setError('Missing Supabase config in liveness URL (supabase_url / supabase_key).');
      setLoading(false);
      return;
    }

    try {
      const res = await withTimeout(
        fetch(`${SUPABASE_URL}/functions/v1/face-liveness-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE_KEY}`,
            apikey: SUPABASE_KEY,
          },
          body: JSON.stringify({ action: 'create' }),
        }),
        25000,
        'Create session',
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.error || `Create session failed (HTTP ${res.status})`);
      }
      if (!data.session_id) throw new Error('Create session returned no session_id');

      setSessionId(data.session_id);
      setLoading(false);
    } catch (e) {
      setError(e.message || 'Failed to create liveness session');
      setLoading(false);
      postToRN({ type: 'liveness_error', error: e.message || 'create session failed' });
    }
  };

  useEffect(() => {
    let cancelled = false;

    const warmAndStart = async () => {
      // 1) Warm Cognito guest credentials (needed by FaceLivenessDetector WebSocket).
      //    Never block forever — a hang here used to leave users on "Creating session…".
      setStatusText('Connecting to AWS…');
      try {
        await withTimeout(fetchAuthSession(), 12000, 'AWS auth');
        console.log('[Liveness] Auth warmed');
      } catch (err) {
        console.warn('[Liveness] Auth warmup failed (continuing):', err);
      }
      if (cancelled) return;

      // 2) Camera warmup is best-effort and short. Never block session creation on it —
      //    RN WebViews often leave getUserMedia pending without a visible prompt.
      try {
        if (navigator.mediaDevices?.getUserMedia) {
          const stream = await withTimeout(
            navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } }),
            4000,
            'Camera warmup',
          );
          stream.getTracks().forEach((t) => t.stop());
        }
      } catch (err) {
        console.warn('[Liveness] Camera warmup skipped:', err);
      }
      if (cancelled) return;

      // 3) Session: use native-provided session_id when present (preferred path).
      if (PRESET_SESSION_ID) {
        setSessionId(PRESET_SESSION_ID);
        setLoading(false);
        return;
      }

      await createSession();
    };

    warmAndStart();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleComplete = async () => {
    setLoading(true);
    setStatusText('Verifying result…');
    try {
      const res = await withTimeout(
        fetch(`${SUPABASE_URL}/functions/v1/face-liveness-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE_KEY}`,
            apikey: SUPABASE_KEY,
          },
          body: JSON.stringify({
            action: 'get_results',
            session_id: sessionId,
            user_id: USER_ID,
          }),
        }),
        30000,
        'Get results',
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.error || `Get results failed (HTTP ${res.status})`);
      }
      postToRN({ type: 'liveness_result', ...data });
    } catch (e) {
      postToRN({ type: 'liveness_error', error: e.message });
      setError(e.message);
      setLoading(false);
    }
  };

  const handleError = (err) => {
    console.error('[Liveness] Error:', err);
    if (retrying.current) return;
    retrying.current = true;
    errorCountRef.current += 1;

    // Cold-start workaround: silently retry the first two detector errors.
    if (errorCountRef.current <= 2) {
      setSessionId(null);
      setLoading(true);
      setStatusText('Retrying liveness session…');
      const delay = 800 * errorCountRef.current;
      setTimeout(async () => {
        retrying.current = false;
        // Always re-create — a failed detector session cannot be reused.
        await createSession();
      }, delay);
      return;
    }

    const detail =
      err?.error?.message || err?.message || err?.name || (typeof err === 'string' ? err : '');
    setError(detail ? `Liveness failed: ${detail}` : 'Liveness check failed');
    setTimeout(() => {
      retrying.current = false;
    }, 2000);
  };

  const handleCancel = () => {
    postToRN({ type: 'liveness_cancel' });
  };

  if (loading) {
    return (
      <div style={styles.center}>
        <div style={styles.spinner} />
        <p>{statusText}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.center}>
        <p style={{ fontSize: 20 }}>⚠️</p>
        <p style={styles.errorText}>{error}</p>
        <button
          style={styles.btn}
          onClick={() => {
            errorCountRef.current = 0;
            createSession();
          }}
        >
          Retry
        </button>
        <button style={styles.btnOutline} onClick={handleCancel}>
          Cancel
        </button>
      </div>
    );
  }

  // getUserMedia only exists in a secure context (HTTPS / localhost).
  // Plain HTTP on a LAN IP leaves navigator.mediaDevices undefined.
  const secureCamera =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function';

  if (!secureCamera) {
    const insecureHint =
      window.isSecureContext === false
        ? 'This page is not HTTPS. Camera access requires a secure origin (https://…). Deploy the liveness page or use a tunnel.'
        : 'Camera API unavailable in this WebView. Grant camera permission and open the page over HTTPS.';
    return (
      <div style={styles.center}>
        <p style={{ fontSize: 20 }}>📷</p>
        <p style={styles.errorText}>{insecureHint}</p>
        <p style={{ color: '#9ca3af', fontSize: 12, textAlign: 'center', maxWidth: 320 }}>
          Current origin: {window.location.origin}
        </p>
        <button style={styles.btnOutline} onClick={handleCancel}>
          Cancel
        </button>
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
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    gap: 16,
    padding: 24,
  },
  spinner: {
    width: 40,
    height: 40,
    border: '3px solid rgba(255,255,255,0.2)',
    borderTopColor: '#3b82f6',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  errorText: {
    color: '#f87171',
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 1.5,
    maxWidth: 300,
  },
  btn: {
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    padding: '14px 28px',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnOutline: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.3)',
    color: '#fff',
    padding: '10px 20px',
    borderRadius: 8,
    fontSize: 14,
    cursor: 'pointer',
  },
};

const styleSheet = document.createElement('style');
styleSheet.textContent = '@keyframes spin { to { transform: rotate(360deg) } }';
document.head.appendChild(styleSheet);

createRoot(document.getElementById('root')).render(<App />);
