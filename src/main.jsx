import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './css/global.css'
import './css/shared.css'
import './css/mobile.css'
import './css/animations.css'
import App from './App.jsx'
import './css/theme.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
