import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import { iniciarSincronizacion } from './sync';

createRoot(document.getElementById('root')!).render(<App />);
iniciarSincronizacion();
