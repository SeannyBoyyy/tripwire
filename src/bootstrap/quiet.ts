import { LogBox } from 'react-native';

// Tripwire only uses local notifications, which Expo Go supports. Expo Go warns
// about *remote* push when expo-notifications loads, which doesn't apply here.
LogBox.ignoreLogs([
  '`expo-notifications` functionality is not fully supported in Expo Go',
  '[expo-notifications] Push notifications',
  'expo-notifications: Android Push notifications',
]);
