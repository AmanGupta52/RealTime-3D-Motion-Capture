import { create } from 'zustand';

interface State {
  trackingFps: number; latencyMs: number; renderFps: number;
  status: string; error: string | null;
  set: (p: Partial<Omit<State, 'set'>>) => void;
}
export const useStore = create<State>((set) => ({
  trackingFps: 0, latencyMs: 0, renderFps: 0, status: 'idle', error: null,
  set: (p) => set(p),
}));
