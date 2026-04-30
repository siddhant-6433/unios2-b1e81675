import { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  ActivityIndicator, Alert, Image,
} from 'react-native';
import * as Location from 'expo-location';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { colors, spacing, radius, typography } from '../../constants/Colors';
import {
  MapPin, Camera, CheckCircle, WifiOff, Fingerprint,
  AlertTriangle, LogOut, UserCheck, RefreshCw,
} from 'lucide-react-native';

import { WebView } from 'react-native-webview';

type PunchStep =
  | 'loading' | 'face_register' | 'face_pending'
  | 'checking_location' | 'location_ok' | 'selfie' | 'liveness' | 'submitting'
  | 'done' | 'error';

interface Geofence {
  lat: number;
  lng: number;
  radiusMeters: number;
  campusName: string;
  campusId: string;
  isCustom?: boolean;
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const p = Math.PI / 180;
  const a = 0.5 - Math.cos((lat2 - lat1) * p) / 2 +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lon2 - lon1) * p)) / 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

export default function PunchScreen() {
  const { user, profile } = useAuth();
  const [step, setStep] = useState<PunchStep>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [punchTime, setPunchTime] = useState<string | null>(null);
  const [punchOutTime, setPunchOutTime] = useState<string | null>(null);
  const [isPunchedIn, setIsPunchedIn] = useState(false);
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [matchedCampus, setMatchedCampus] = useState<Geofence | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [faceRegistered, setFaceRegistered] = useState<'none' | 'pending' | 'approved'>('none');
  const [faceImageUrl, setFaceImageUrl] = useState<string | null>(null);
  const [regPhotos, setRegPhotos] = useState<string[]>([]);
  const [regStep, setRegStep] = useState(0);
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  useEffect(() => { init(); }, []);

  const init = async () => {
    setStep('loading');

    // 1. Check face registration status
    const { data: faceReg } = await supabase
      .from('employee_face_registrations')
      .select('status, image_url')
      .eq('user_id', user?.id)
      .maybeSingle();

    if (!faceReg) {
      setFaceRegistered('none');
      setStep('face_register');
      return;
    }
    if (faceReg.status === 'pending') {
      setFaceRegistered('pending');
      setFaceImageUrl(faceReg.image_url);
      setStep('face_pending');
      return;
    }
    if (faceReg.status === 'rejected') {
      setFaceRegistered('none');
      setStep('face_register');
      return;
    }
    setFaceRegistered('approved');
    setFaceImageUrl(faceReg.image_url);

    // 2. Fetch geofences
    const [campusRes, customRes] = await Promise.all([
      supabase.from('campuses')
        .select('id, name, latitude, longitude, geofence_radius_meters')
        .not('latitude', 'is', null)
        .not('longitude', 'is', null),
      supabase.from('geofence_locations')
        .select('id, name, latitude, longitude, radius_meters')
        .eq('is_active', true),
    ]);

    const allFences: Geofence[] = [];
    if (campusRes.data) {
      for (const c of campusRes.data) {
        allFences.push({
          lat: c.latitude!, lng: c.longitude!,
          radiusMeters: c.geofence_radius_meters || 500,
          campusName: c.name, campusId: c.id,
        });
      }
    }
    if (customRes.data) {
      for (const g of customRes.data as any[]) {
        allFences.push({
          lat: g.latitude, lng: g.longitude,
          radiusMeters: g.radius_meters || 500,
          campusName: g.name, campusId: g.id,
          isCustom: true,
        });
      }
    }
    if (allFences.length === 0) {
      setErrorMsg('No geofence configured. Contact your administrator.');
      setStep('error');
      return;
    }
    setGeofences(allFences);

    // 3. Check today's punch status — get the LATEST record
    const today = new Date().toISOString().slice(0, 10);
    const { data: attendanceRecords } = await supabase
      .from('employee_attendance')
      .select('id, punch_in, punch_out')
      .eq('user_id', user?.id)
      .eq('date', today)
      .order('punch_in', { ascending: false })
      .limit(1);

    const latest = attendanceRecords?.[0];

    if (latest && !latest.punch_out) {
      // Currently punched in (no punch_out on latest record)
      setPunchTime(latest.punch_in);
      setIsPunchedIn(true);
      setStep('done');
    } else {
      // Either no records today, or last record is completed — allow new punch-in
      if (latest) {
        // Show last punch times for context
        setPunchTime(latest.punch_in);
        setPunchOutTime(latest.punch_out);
      }
      checkLocation(allFences);
    }
  };

  // ── Upload photo to S3 via edge function ──
  const uploadSelfie = async (uri: string, folder: string): Promise<string | null> => {
    try {
      const filename = `${user?.id}/${folder}/${Date.now()}.jpg`;

      const formData = new FormData();
      formData.append('file', {
        uri,
        name: `${Date.now()}.jpg`,
        type: 'image/jpeg',
      } as any);
      formData.append('key', filename);
      formData.append('bucket', 'unios-selfies');

      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token || supabaseKey;

      const res = await fetch(
        `${supabaseUrl}/functions/v1/s3-upload`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData,
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        console.error('[Punch] S3 upload error:', res.status, errText);
        return null;
      }

      const data = await res.json();
      return data.url || null;
    } catch (err) {
      console.error('[Punch] Upload exception:', err);
      return null;
    }
  };

  // ── Face Registration ──
  const handleFaceRegister = async () => {
    if (!cameraPermission?.granted) {
      const { granted } = await requestCameraPermission();
      if (!granted) {
        setErrorMsg('Camera access denied. Go to Settings > UniOs > Camera');
        setStep('error');
        return;
      }
    }
    setRegPhotos([]);
    setRegStep(0);
    setStep('selfie');
  };

  const REG_PROMPTS = [
    'Look straight at the camera',
    'Turn your head slightly to the LEFT',
    'Turn your head slightly to the RIGHT',
  ];

  const captureFaceRegistration = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      if (!photo?.uri) { setErrorMsg('Could not capture photo.'); setStep('error'); return; }

      const updatedPhotos = [...regPhotos, photo.uri];
      setRegPhotos(updatedPhotos);

      if (updatedPhotos.length < 3) {
        setRegStep(updatedPhotos.length);
        return;
      }

      setStep('submitting');
      setSelfieUri(updatedPhotos[0]);

      const urls: string[] = [];
      for (const uri of updatedPhotos) {
        const url = await uploadSelfie(uri, 'face-registration');
        if (!url) {
          setErrorMsg('Failed to upload photo. Check your internet.');
          setStep('error');
          setRegPhotos([]);
          setRegStep(0);
          return;
        }
        urls.push(url);
      }

      console.log('[FaceReg] Registering faces with matching service...');
      try {
        const { data: regResult, error: regError } = await supabase.functions.invoke('face-match', {
          body: {
            action: 'register',
            registered_image_urls: urls,
            user_id: user?.id,
          },
        });

        if (regError) {
          console.warn('[FaceReg] Registration service error:', regError.message);
        } else if (regResult?.error) {
          setErrorMsg(regResult.error);
          setStep('error');
          setRegPhotos([]);
          setRegStep(0);
          return;
        } else {
          console.log('[FaceReg] Faces indexed:', regResult?.indexed_count);
        }
      } catch (err) {
        console.warn('[FaceReg] Service unavailable:', err);
      }

      const { error } = await supabase.from('employee_face_registrations').upsert({
        user_id: user?.id,
        image_url: urls[0],
        image_urls: urls,
        status: 'pending',
      }, { onConflict: 'user_id' });

      if (error) { setErrorMsg(error.message); setStep('error'); setRegPhotos([]); setRegStep(0); return; }

      setFaceRegistered('pending');
      setRegPhotos([]);
      setRegStep(0);
      setStep('face_pending');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to capture photo.');
      setStep('error');
      setRegPhotos([]);
      setRegStep(0);
    }
  };

  // ── Location Check ──
  const checkLocation = async (fences?: Geofence[]) => {
    setStep('checking_location');
    setErrorMsg(null);

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setErrorMsg('Enable location services in Settings to mark attendance.');
      setStep('error');
      return;
    }

    try {
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude } = location.coords;
      setUserLocation({ lat: latitude, lng: longitude });

      const activeFences = fences || geofences;
      let closestCampus: Geofence | null = null;
      let closestDist = Infinity;

      for (const fence of activeFences) {
        const dist = distanceMeters(latitude, longitude, fence.lat, fence.lng);
        if (dist < closestDist) {
          closestDist = dist;
          closestCampus = fence;
        }
      }

      if (!closestCampus || closestDist > closestCampus.radiusMeters) {
        const distText = closestDist < 1000
          ? `${Math.round(closestDist)}m away`
          : `${(closestDist / 1000).toFixed(1)}km away`;
        setErrorMsg(`You're outside campus (${distText} from ${closestCampus?.campusName || 'nearest location'}). Move closer and try again.`);
        setStep('error');
        return;
      }

      setMatchedCampus(closestCampus);
      setStep('location_ok');
      setTimeout(() => startSelfiePunch(), 800);
    } catch {
      setErrorMsg('Could not determine your location. Make sure GPS is enabled.');
      setStep('error');
    }
  };

  // ── Selfie for Punch ──
  const startSelfiePunch = async () => {
    if (!cameraPermission?.granted) {
      const { granted } = await requestCameraPermission();
      if (!granted) {
        setErrorMsg('Camera access is required for attendance. Go to Settings > UniOs > Camera.');
        setStep('error');
        return;
      }
    }
    setStep('selfie');
  };

  const capturePunchSelfie = async () => {
    if (!cameraRef.current) {
      setErrorMsg('Camera not available. Please restart the app.');
      setStep('error');
      return;
    }
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5 });
      if (!photo?.uri) {
        setErrorMsg('Failed to capture photo. Try again.');
        setStep('error');
        return;
      }
      console.log('[Punch] Photo captured:', photo.uri.slice(0, 60));
      setSelfieUri(photo.uri);
      submitPunch(photo.uri);
    } catch (err: any) {
      console.error('[Punch] Camera error:', err);
      setErrorMsg('Camera error: ' + (err?.message || 'Unknown error'));
      setStep('error');
    }
  };

  // ── AWS Rekognition Liveness WebView ──
  const livenessUrlRef = useRef<string | null>(null);

  const startLivenessCheck = () => {
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
    const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

    const params = new URLSearchParams({
      supabase_url: supabaseUrl,
      supabase_key: supabaseKey,
      user_id: user?.id || '',
      region: 'ap-south-1',
      identity_pool_id: 'ap-south-1:518a81c9-8722-431a-9d1b-2e988ab4f0b5',
    });

    livenessUrlRef.current = `https://uni.nimt.ac.in/liveness/?${params.toString()}`;
    setStep('liveness');
  };

  const handleLivenessMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log('[Liveness] Result:', JSON.stringify(data).slice(0, 200));

      if (data.type === 'liveness_result') {
        if (data.is_live) {
          // Liveness passed — proceed with punch
          console.log(`[Liveness] PASSED: ${data.confidence}%`);
          setStep('submitting');
          finalizePunch(data.confidence);
        } else {
          setErrorMsg(`Liveness check failed (${data.confidence}%). Please try again with your real face.`);
          setStep('error');
        }
      } else if (data.type === 'liveness_error') {
        setErrorMsg(`Liveness error: ${data.error}`);
        setStep('error');
      } else if (data.type === 'liveness_cancel') {
        setStep('selfie');
      }
    } catch (e) {
      console.error('[Liveness] Parse error:', e);
    }
  };

  // ── Submit Punch ──
  const [faceMatchResult, setFaceMatchResult] = useState<{ match: boolean; confidence: number; reason: string } | null>(null);

  const [pendingSelfieUrl, setPendingSelfieUrl] = useState<string | null>(null);

  const submitPunch = async (photoUri: string | null) => {
    setStep('submitting');
    const debugLog: string[] = [];
    try {
      const today = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();

      debugLog.push(`photoUri: ${photoUri ? 'YES' : 'NULL'}`);
      debugLog.push(`isPunchedIn: ${isPunchedIn}`);

      // Step 1: Upload selfie
      let selfieUrl: string | null = null;
      if (photoUri) {
        debugLog.push('Uploading selfie...');
        selfieUrl = await uploadSelfie(photoUri, 'punches');
        debugLog.push(`Upload: ${selfieUrl ? 'OK' : 'FAILED'}`);

        if (!selfieUrl) {
          setErrorMsg('Failed to upload selfie. Check your internet.');
          setStep('error');
          return;
        }
      } else {
        setErrorMsg('No photo was captured.');
        setStep('error');
        return;
      }

      // Step 2: Face match (AWS Rekognition SearchFacesByImage)
      if (!isPunchedIn && selfieUrl) {
        debugLog.push('Calling face-match...');
        try {
          const { data: matchData, error: matchError } = await supabase.functions.invoke('face-match', {
            body: {
              punch_image_url: selfieUrl,
              user_id: user?.id,
            },
          });

          debugLog.push(`Response: ${JSON.stringify(matchData || matchError?.message || 'empty').slice(0, 100)}`);

          if (matchError) {
            debugLog.push(`Match error: ${matchError.message}`);
            const msg = matchError.message?.toLowerCase() || '';
            if (msg.includes('no face') || msg.includes('invalidparameterexception')) {
              setErrorMsg('No face detected in photo. Please take a clear selfie with your face visible.');
            } else {
              setErrorMsg(`Face verification failed: ${matchError.message}`);
            }
            setStep('error');
            return;
          }

          if (matchData?.error) {
            debugLog.push(`Match API error: ${matchData.error}`);
            const msg = (matchData.error as string).toLowerCase();
            if (msg.includes('no face') || msg.includes('invalidparameterexception')) {
              setErrorMsg('No face detected in photo. Please take a clear selfie with your face visible.');
            } else {
              setErrorMsg(`Face verification failed: ${matchData.error}`);
            }
            setStep('error');
            return;
          }

          setFaceMatchResult(matchData);
          debugLog.push(`Match: ${matchData.match}, Confidence: ${matchData.confidence}%`);

          if (!matchData.match) {
            const reason = matchData.reason?.toLowerCase() || '';
            if (reason.includes('no face')) {
              setErrorMsg('No face detected in photo. Please take a clear selfie with your face visible.');
            } else {
              setErrorMsg(`Face does not match (${matchData.confidence}%). ${matchData.reason || 'Try better lighting.'}`);
            }
            setStep('error');
            return;
          }

          // Step 3: Face matched — now do AWS Rekognition Liveness check
          debugLog.push('Face matched. Starting AWS liveness check...');
          setPendingSelfieUrl(selfieUrl);
          startLivenessCheck();
          return; // Liveness WebView will call finalizePunch on success
        } catch (faceErr: any) {
          debugLog.push(`Match exception: ${faceErr?.message}`);
          const msg = faceErr?.message?.toLowerCase() || '';
          if (msg.includes('no face') || msg.includes('invalidparameterexception')) {
            setErrorMsg('No face detected in photo. Please take a clear selfie with your face visible.');
          } else {
            setErrorMsg(`Face verification error: ${faceErr?.message || 'Unknown error'}`);
          }
          setStep('error');
          return;
        }
      } else {
        debugLog.push(`SKIPPED face match. selfieUrl=${!!selfieUrl}, faceImageUrl=${!!faceImageUrl}`);
      }

      if (isPunchedIn) {
        const { error } = await supabase
          .from('employee_attendance')
          .update({ punch_out: now })
          .eq('user_id', user?.id)
          .eq('date', today);
        if (error) throw error;
        setPunchOutTime(now);
        setIsPunchedIn(false);
      } else {
        const { error } = await supabase
          .from('employee_attendance')
          .insert({
            user_id: user?.id,
            campus_id: matchedCampus && !matchedCampus.isCustom ? matchedCampus.campusId : null,
            geofence_location_id: matchedCampus?.isCustom ? matchedCampus.campusId : null,
            date: today,
            punch_in: now,
            selfie_url: selfieUrl,
            location_lat: userLocation?.lat,
            location_lng: userLocation?.lng,
            face_match_score: faceMatchResult?.confidence || null,
            face_match_result: faceMatchResult ? (faceMatchResult.match ? 'match' : 'no_match') : null,
          });
        if (error) throw error;
        setPunchTime(now);
        setIsPunchedIn(true);
      }
      setStep('done');
    } catch (err: any) {
      debugLog.push(`Exception: ${err?.message}`);
      setErrorMsg((err?.message || 'Failed to record attendance.') + '\n\nDebug:\n' + debugLog.join('\n'));
      setStep('error');
    }
  };

  // Called after AWS Rekognition Liveness passes
  const finalizePunch = async (livenessConfidence?: number) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('employee_attendance')
        .insert({
          user_id: user?.id,
          campus_id: matchedCampus && !matchedCampus.isCustom ? matchedCampus.campusId : null,
          geofence_location_id: matchedCampus?.isCustom ? matchedCampus.campusId : null,
          date: today,
          punch_in: now,
          selfie_url: pendingSelfieUrl,
          location_lat: userLocation?.lat,
          location_lng: userLocation?.lng,
          face_match_score: faceMatchResult?.confidence || null,
          face_match_result: faceMatchResult ? (faceMatchResult.match ? 'match' : 'no_match') : null,
          liveness_score: livenessConfidence || null,
        });
      if (error) throw error;
      setPunchTime(now);
      setIsPunchedIn(true);
      setStep('done');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to record attendance.');
      setStep('error');
    }
  };

  const handleRetry = () => { setErrorMsg(null); setSelfieUri(null); checkLocation(); };
  const handlePunchOut = () => {
    Alert.alert('Punch Out', 'Are you sure you want to punch out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Punch Out',
        onPress: async () => {
          setStep('submitting');
          try {
            const today = new Date().toISOString().slice(0, 10);
            const now = new Date().toISOString();
            // Update the latest open record (no punch_out)
            const { data: openRecord } = await supabase
              .from('employee_attendance')
              .select('id')
              .eq('user_id', user?.id)
              .eq('date', today)
              .is('punch_out', null)
              .order('punch_in', { ascending: false })
              .limit(1)
              .single();

            if (!openRecord) throw new Error('No open punch record found');

            const { error } = await supabase
              .from('employee_attendance')
              .update({ punch_out: now })
              .eq('id', openRecord.id);
            if (error) throw error;
            setPunchOutTime(now);
            setIsPunchedIn(false);
            setStep('done');
          } catch (err: any) {
            setErrorMsg(err?.message || 'Failed to punch out.');
            setStep('error');
          }
        },
      },
    ]);
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  // ── Determine if we're in face-register selfie mode or punch selfie mode ──
  const isFaceRegMode = faceRegistered === 'none' || faceRegistered === 'pending';

  return (
    <SafeAreaView style={styles.container}>
      {/* Loading */}
      {step === 'loading' && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.subText}>Loading...</Text>
        </View>
      )}

      {/* Face Registration Required */}
      {step === 'face_register' && (
        <View style={styles.centered}>
          <View style={[styles.iconCircle, { backgroundColor: colors.primaryLight }]}>
            <UserCheck size={40} color={colors.primary} />
          </View>
          <Text style={styles.mainText}>Register Your Face</Text>
          <Text style={styles.subText}>
            Take a clear selfie to register for attendance verification. Your photo will be reviewed by an admin.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={handleFaceRegister} activeOpacity={0.7}>
            <Camera size={20} color="#fff" />
            <Text style={styles.primaryButtonText}>Take Registration Selfie</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Face Pending Approval */}
      {step === 'face_pending' && (
        <View style={styles.centered}>
          <View style={[styles.iconCircle, { backgroundColor: colors.warningLight }]}>
            <UserCheck size={40} color={colors.warning} />
          </View>
          <Text style={styles.mainText}>Pending Approval</Text>
          <Text style={styles.subText}>
            Your face registration is pending admin approval. You'll be able to punch in once approved.
          </Text>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={init}
            activeOpacity={0.7}
          >
            <RefreshCw size={16} color={colors.textSecondary} />
            <Text style={styles.secondaryButtonText}>Check Status</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Checking location */}
      {step === 'checking_location' && (
        <View style={styles.centered}>
          <View style={styles.iconCircle}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
          <Text style={styles.mainText}>Checking location...</Text>
          <Text style={styles.subText}>Verifying you are on campus</Text>
        </View>
      )}

      {/* Location confirmed */}
      {step === 'location_ok' && (
        <View style={styles.centered}>
          <View style={[styles.iconCircle, { backgroundColor: colors.successLight }]}>
            <MapPin size={40} color={colors.success} />
          </View>
          <Text style={styles.mainText}>On Campus</Text>
          <Text style={styles.subText}>{matchedCampus?.campusName}</Text>
          <Text style={styles.subText}>Preparing camera...</Text>
        </View>
      )}

      {/* Selfie capture (for both face reg and punch) */}
      {step === 'selfie' && (
        <View style={styles.cameraContainer}>
          <CameraView ref={cameraRef} style={styles.camera} facing="front" />
          <View style={styles.cameraOverlay}>
            {isFaceRegMode ? (
              <>
                <View style={styles.regStepBadge}>
                  <Text style={styles.regStepBadgeText}>Photo {regStep + 1} of 3</Text>
                </View>
                <Text style={styles.cameraText}>{REG_PROMPTS[regStep]}</Text>
              </>
            ) : (
              <Text style={styles.cameraText}>Quick selfie for attendance</Text>
            )}
            <View style={styles.cameraCircle} />
            {isFaceRegMode && regPhotos.length > 0 && (
              <View style={styles.regPreviewRow}>
                {regPhotos.map((uri, i) => (
                  <Image key={i} source={{ uri }} style={styles.regPreviewThumb} />
                ))}
              </View>
            )}
            <TouchableOpacity
              style={styles.captureButton}
              onPress={isFaceRegMode ? captureFaceRegistration : capturePunchSelfie}
              activeOpacity={0.7}
            >
              <Camera size={24} color="#fff" />
              <Text style={styles.captureText}>
                {isFaceRegMode ? `Capture ${regStep + 1}/3` : 'Punch In'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* AWS Rekognition Liveness WebView */}
      {step === 'liveness' && livenessUrlRef.current && (
        <View style={styles.cameraContainer}>
          <WebView
            source={{ uri: livenessUrlRef.current }}
            style={{ flex: 1 }}
            onMessage={handleLivenessMessage}
            javaScriptEnabled
            domStorageEnabled
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            mediaCapturePermissionGrantType="grant"
          />
        </View>
      )}

      {/* Submitting */}
      {step === 'submitting' && (
        <View style={styles.centered}>
          <View style={styles.iconCircle}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
          <Text style={styles.mainText}>
            {isFaceRegMode ? 'Registering face...' : 'Verifying...'}
          </Text>
          <Text style={styles.subText}>
            {isFaceRegMode ? 'Uploading your photo' : 'Uploading selfie and verifying face match'}
          </Text>
        </View>
      )}

      {/* Done */}
      {step === 'done' && (
        <View style={styles.centered}>
          <View style={[styles.iconCircle, { backgroundColor: colors.successLight }]}>
            <CheckCircle size={48} color={colors.success} />
          </View>

          {isPunchedIn ? (
            <>
              <Text style={styles.mainText}>Punched In</Text>
              {punchTime && <Text style={styles.timeText}>{formatTime(punchTime)}</Text>}
              {faceMatchResult && (
                <View style={[styles.matchBadge, { backgroundColor: faceMatchResult.match ? '#dcfce7' : '#fef3c7' }]}>
                  <Text style={[styles.matchText, { color: faceMatchResult.match ? '#16a34a' : '#92400e' }]}>
                    {faceMatchResult.match ? `Face verified (${faceMatchResult.confidence}%)` : `Low confidence (${faceMatchResult.confidence}%)`}
                  </Text>
                </View>
              )}
            </>
          ) : punchOutTime ? (
            <>
              <Text style={styles.mainText}>Day Complete</Text>
              <View style={styles.timeRow}>
                <View style={styles.timeBlock}>
                  <Text style={styles.timeLabel}>In</Text>
                  <Text style={styles.timeValue}>{punchTime ? formatTime(punchTime) : '—'}</Text>
                </View>
                <View style={styles.timeDivider} />
                <View style={styles.timeBlock}>
                  <Text style={styles.timeLabel}>Out</Text>
                  <Text style={styles.timeValue}>{formatTime(punchOutTime)}</Text>
                </View>
              </View>
            </>
          ) : (
            <Text style={styles.mainText}>Not Punched In</Text>
          )}

          <Text style={styles.subText}>
            {profile?.display_name} — {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
          </Text>

          {isPunchedIn && (
            <TouchableOpacity style={styles.secondaryButton} onPress={handlePunchOut} activeOpacity={0.7}>
              <LogOut size={18} color={colors.textSecondary} />
              <Text style={styles.secondaryButtonText}>Punch Out</Text>
            </TouchableOpacity>
          )}

          {!isPunchedIn && (
            <TouchableOpacity style={styles.primaryButton} onPress={() => {
              // Reset state for a new punch cycle
              setFaceMatchResult(null);
              setSelfieUri(null);
              setPunchTime(null);
              setPunchOutTime(null);
              checkLocation();
            }} activeOpacity={0.7}>
              <Fingerprint size={18} color="#fff" />
              <Text style={styles.primaryButtonText}>Punch In{punchTime ? ' Again' : ''}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Error */}
      {step === 'error' && (
        <View style={styles.centered}>
          <View style={[styles.iconCircle, { backgroundColor: colors.destructiveLight }]}>
            {errorMsg?.includes('outside campus') || errorMsg?.includes('away') ? (
              <MapPin size={40} color={colors.destructive} />
            ) : errorMsg?.includes('connection') ? (
              <WifiOff size={40} color={colors.destructive} />
            ) : (
              <AlertTriangle size={40} color={colors.destructive} />
            )}
          </View>
          <Text style={styles.mainText}>
            {errorMsg?.includes('outside') || errorMsg?.includes('away') ? 'Outside Campus' :
             errorMsg?.includes('geofence') || errorMsg?.includes('configured') ? 'Setup Required' : 'Error'}
          </Text>
          <Text style={styles.errorText}>{errorMsg}</Text>
          {!errorMsg?.includes('configured') && (
            <TouchableOpacity style={styles.primaryButton} onPress={handleRetry} activeOpacity={0.7}>
              <Text style={styles.primaryButtonText}>Try Again</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  iconCircle: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  mainText: { fontSize: 24, fontWeight: '700', color: colors.text, textAlign: 'center', letterSpacing: -0.5 },
  subText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, paddingHorizontal: 16 },
  timeText: { fontSize: 20, fontWeight: '600', color: colors.success },
  errorText: { fontSize: 14, color: colors.destructive, textAlign: 'center', paddingHorizontal: 24, lineHeight: 20 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 8 },
  timeBlock: { alignItems: 'center' },
  timeLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  timeValue: { fontSize: 18, fontWeight: '600', color: colors.text, marginTop: 2 },
  timeDivider: { width: 1, height: 32, backgroundColor: colors.border },
  // Buttons
  primaryButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: 12,
    paddingHorizontal: 24, paddingVertical: 14,
    marginTop: 20, minWidth: 180, justifyContent: 'center',
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    paddingHorizontal: 24, paddingVertical: 14,
    marginTop: 20, minWidth: 180, justifyContent: 'center',
  },
  secondaryButtonText: { fontSize: 15, fontWeight: '500', color: colors.textSecondary },
  // Camera
  cameraContainer: { flex: 1 },
  camera: { flex: 1 },
  cameraOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  cameraText: {
    color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 24, textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
    paddingHorizontal: 24,
  },
  cameraCircle: {
    width: 220, height: 220, borderRadius: 110,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.6)',
    borderStyle: 'dashed', marginBottom: 32,
  },
  captureButton: {
    position: 'absolute', bottom: 80,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: 999,
    paddingHorizontal: 28, paddingVertical: 16,
  },
  captureText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  skipButton: {
    position: 'absolute', bottom: 36,
  },
  skipText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '500' },
  matchBadge: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginTop: 4 },
  matchText: { fontSize: 12, fontWeight: '600' },
  livenessBanner: {
    backgroundColor: 'rgba(251,191,36,0.9)',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
    marginBottom: 16,
  },
  livenessBannerText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  regStepBadge: {
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 6, marginBottom: 8,
  },
  regStepBadgeText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  regPreviewRow: {
    flexDirection: 'row', gap: 8, position: 'absolute', top: 60,
    right: 16,
  },
  regPreviewThumb: {
    width: 48, height: 48, borderRadius: 8,
    borderWidth: 2, borderColor: '#fff',
  },
});
