import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, Route, Routes} from 'react-router-dom';
import {App} from '@wearables-ui-toolkit/mrbd';
import {
  ReactRouterNavigationProvider,
  ReactRouterPageTransition,
} from '@wearables-ui-toolkit/mrbd/react-router';
import {mountDevToolbar} from './devToolbar';
import {RecipesProvider} from './RecipesContext';
import {CookPage} from './pages/CookPage';
import {HomePage} from './pages/HomePage';
import {RecipesPage} from './pages/RecipesPage';
import './styles.css';

// Say a dish, or reopen the last recipe (/), or pick one of your recipes (/recipes), then
// cook it (/cook/:id).
function Root() {
  return (
    <RecipesProvider>
      <BrowserRouter>
        <ReactRouterNavigationProvider>
          <App>
            <ReactRouterPageTransition>
              {({location}) => (
                <Routes location={location}>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/recipes" element={<RecipesPage />} />
                  <Route path="/cook/:id" element={<CookPage />} />
                </Routes>
              )}
            </ReactRouterPageTransition>
          </App>
        </ReactRouterNavigationProvider>
      </BrowserRouter>
    </RecipesProvider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root mount element');

mountDevToolbar();

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
