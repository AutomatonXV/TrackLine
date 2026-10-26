import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Hud from './Hud.tsx'

const isHud = window.location.hash.startsWith('#/hud')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isHud ? <Hud /> : <App />}
  </StrictMode>,
)
