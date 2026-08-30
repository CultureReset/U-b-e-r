/**
 * Simulation controls. Pausing here freezes every surface at the same instant,
 * which is what lets you hand a job from rider to driver to merchant and watch
 * each side of it.
 */
import { useState } from 'react';
import { marketConfigs } from '@config';
import { useWorld } from '@platform/store';
import { Button, Segmented } from '@ui/primitives';
import { Icon } from '@ui/Icon';

export function WorldControls() {
  const running = useWorld((s) => s.sim.running);
  const speed = useWorld((s) => s.sim.speed);
  const marketId = useWorld((s) => s.state.marketId);
  const [busy, setBusy] = useState(false);

  const setRunning = useWorld((s) => s.setRunning);
  const setSpeed = useWorld((s) => s.setSpeed);
  const step = useWorld((s) => s.step);
  const setMarket = useWorld((s) => s.setMarket);
  const reseed = useWorld((s) => s.reseed);

  const changeMarket = async (id: string) => {
    setBusy(true);
    await setMarket(id);
    setBusy(false);
  };

  return (
    <div className="row gap-2">
      <select
        className="select"
        style={{ height: 32, width: 'auto', fontSize: 13 }}
        value={marketId}
        disabled={busy}
        onChange={(e) => void changeMarket(e.target.value)}
        aria-label="Market"
      >
        {marketConfigs.map((market) => (
          <option key={market.id} value={market.id}>
            {market.name}
          </option>
        ))}
      </select>

      <Segmented
        value={String(speed)}
        onChange={(value) => setSpeed(Number(value))}
        options={[
          { value: '0.5', label: '½×' },
          { value: '1', label: '1×' },
          { value: '4', label: '4×' },
          { value: '12', label: '12×' },
        ]}
      />

      <Button
        variant="ghost"
        size="sm"
        icon={running ? 'pause' : 'play'}
        onClick={() => setRunning(!running)}
        title={running ? 'Pause the world' : 'Resume the world'}
        aria-label={running ? 'Pause' : 'Play'}
      />
      <Button
        variant="ghost"
        size="sm"
        icon="chevron"
        onClick={() => step()}
        disabled={running}
        title="Advance one tick"
        aria-label="Step"
      />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setBusy(true);
          void reseed().finally(() => setBusy(false));
        }}
        disabled={busy}
        title="Regenerate the world from config"
        aria-label="Reseed"
      >
        <Icon name="refresh" size={15} />
      </Button>
    </div>
  );
}
