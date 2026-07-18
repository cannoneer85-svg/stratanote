/**
 * @packageDocumentation
 * @module main
 * Client-side application entry point.
 * Mounts the React virtual DOM tree, initializes global CSS stylesheets,
 * and boots the root {@link App} component inside the `#root` container.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

export {};
