import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, Route, Routes} from 'react-router-dom';
import {App} from '@wearables-ui-toolkit/mrbd';
import {
  ReactRouterNavigationProvider,
  ReactRouterPageTransition,
} from '@wearables-ui-toolkit/mrbd/react-router';
import {RecipesProvider} from './RecipesContext';
import {CookPage} from './pages/CookPage';
import {NewRecipePage} from './pages/NewRecipePage';
import {RecipeListPage} from './pages/RecipeListPage';
import './styles.css';

// Pick a recipe (/) or ask for a new one (/new), then cook it (/cook/:id).
function Root() {
  return (
    <RecipesProvider>
      <BrowserRouter>
        <ReactRouterNavigationProvider>
          <App>
            <ReactRouterPageTransition>
              {({location}) => (
                <Routes location={location}>
                  <Route path="/" element={<RecipeListPage />} />
                  <Route path="/new" element={<NewRecipePage />} />
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

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
