import type { ConfigContext, ExpoConfig } from 'expo/config';

// One Expo project, two store apps (see DESIGN.md + docs plan):
//   APP_VARIANT=staff  -> "NIMT Staff"  in.ac.nimt.unios.staff  uniosstaff://
//   APP_VARIANT=family -> "NIMT Campus" in.ac.nimt.unios        unios://
// Family variant must never request location (Play/App Store privacy posture);
// camera/location are staff-only needs (geofence punch, scanning).
const variant = process.env.APP_VARIANT === 'staff' ? 'staff' : 'family';
const isStaff = variant === 'staff';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: isStaff ? 'NIMT Staff' : 'NIMT Campus',
  slug: 'unios',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: isStaff ? 'uniosstaff' : 'unios',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  splash: {
    image: './assets/images/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: isStaff ? '#17161A' : '#0035C5',
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: isStaff ? 'in.ac.nimt.unios.staff' : 'in.ac.nimt.unios',
    infoPlist: {
      NSFaceIDUsageDescription:
        'Unlock the app quickly with Face ID instead of entering your password.',
      ...(isStaff
        ? {
            NSLocationWhenInUseUsageDescription:
              'NIMT Staff needs your location to verify you are on campus when punching attendance.',
            NSCameraUsageDescription:
              'NIMT Staff uses the camera to scan book barcodes, gatepass QR codes, and for attendance verification.',
          }
        : {}),
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: isStaff ? '#17161A' : '#0035C5',
    },
    package: isStaff ? 'in.ac.nimt.unios.staff' : 'in.ac.nimt.unios',
    permissions: isStaff ? ['ACCESS_FINE_LOCATION', 'CAMERA', 'USE_BIOMETRIC'] : ['USE_BIOMETRIC'],
    blockedPermissions: isStaff ? [] : ['android.permission.ACCESS_FINE_LOCATION', 'android.permission.CAMERA'],
    edgeToEdgeEnabled: true,
  },
  web: {
    bundler: 'metro',
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    'expo-web-browser',
    'expo-notifications',
    [
      'expo-local-authentication',
      { faceIDPermission: 'Unlock the app quickly with Face ID.' },
    ],
    ...(isStaff
      ? ([
          [
            'expo-location',
            {
              locationWhenInUsePermission:
                'NIMT Staff needs your location to verify campus attendance.',
            },
          ],
          [
            'expo-camera',
            {
              cameraPermission:
                'NIMT Staff uses the camera to scan barcodes and QR codes.',
            },
          ],
        ] as Array<[string, Record<string, string>]>)
      : []),
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    appVariant: variant,
  },
});
