import { createBrowserRouter, Navigate } from 'react-router-dom';
import { appConfig } from '@config';
import { Shell } from './Shell';
import { RiderSurface } from '@surfaces/rider';
import { EatsSurface } from '@surfaces/eats';
import { DriverSurface } from '@surfaces/driver';
import { MerchantSurface } from '@surfaces/merchant';
import { BusinessSurface } from '@surfaces/business';
import { AdminSurface } from '@surfaces/admin';

const SURFACE_COMPONENTS = {
  rider: RiderSurface,
  eats: EatsSurface,
  driver: DriverSurface,
  merchant: MerchantSurface,
  business: BusinessSurface,
  admin: AdminSurface,
} as const;

/** Routes are generated from app.config — disable a surface and it disappears. */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <Navigate to={appConfig.surfaces.find((s) => s.enabled)?.route ?? '/rider'} replace /> },
      ...appConfig.surfaces
        .filter((surface) => surface.enabled)
        .map((surface) => {
          const Component = SURFACE_COMPONENTS[surface.id];
          return { path: `${surface.route.replace(/^\//, '')}/*`, element: <Component /> };
        }),
      { path: '*', element: <Navigate to="/rider" replace /> },
    ],
  },
]);
