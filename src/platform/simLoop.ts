/**
 * Drives the world clock from a single interval. Mounted once by the app shell;
 * pausing it freezes every surface at the same instant, which is exactly what
 * you want when demonstrating a hand-off between rider, driver and merchant.
 */
import { useEffect } from 'react';
import { appConfig } from '@config';
import { useWorld } from './store';

export function useSimulationLoop(): void {
  const running = useWorld((s) => s.sim.running);
  const ready = useWorld((s) => s.ready);

  useEffect(() => {
    if (!ready || !running || !appConfig.simulation.enabled) return;
    const id = setInterval(() => {
      useWorld.getState().step();
    }, appConfig.simulation.tickMs);
    return () => clearInterval(id);
  }, [running, ready]);
}
