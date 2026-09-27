import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import 'pretendard/dist/web/static/Pretendard-Regular.css';
import 'pretendard/dist/web/static/Pretendard-Medium.css';
import 'pretendard/dist/web/static/Pretendard-SemiBold.css';
import 'pretendard/dist/web/static/Pretendard-Bold.css';
import './styles/tokens.css';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
