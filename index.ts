import './src/bootstrap/quiet'; // first on purpose: hides Expo Go's remote-push warning before it fires
import './src/services/background'; // defines the background task at module scope
import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
