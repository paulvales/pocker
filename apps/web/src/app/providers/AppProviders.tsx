import { RouterProvider } from 'react-router-dom';

import { router } from '@/app/router';

export function AppProviders() {
  return <RouterProvider router={router} />;
}
