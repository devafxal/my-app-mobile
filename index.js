/**
 * @format
 */

import { AppRegistry } from 'react-native';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';

// Android renders the notification itself from the payload the backend sends.
// This handler must still be registered, otherwise Firebase warns on every
// background message — and it gives us a place to react to one later.
setBackgroundMessageHandler(getMessaging(), async remoteMessage => {
  console.log('🔔 Background message received:', remoteMessage?.messageId);
});

AppRegistry.registerComponent(appName, () => App);
