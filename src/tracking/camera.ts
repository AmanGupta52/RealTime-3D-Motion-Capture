export type Res = '480p' | '720p' | '1080p';
const SIZES: Record<Res, [number, number]> = { '480p': [640, 480], '720p': [1280, 720], '1080p': [1920, 1080] };

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
}

/** Opens the webcam. Throws a readable Error for permission/device problems. */
export async function openCamera(video: HTMLVideoElement, res: Res = '720p', deviceId?: string): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera is not available here (needs a secure context: HTTPS or localhost).');
  const [w, h] = SIZES[res];
  const ask = (id?: string) => navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 60 }, ...(id ? { deviceId: { exact: id } } : {}) },
    audio: false,
  });
  try {
    let stream: MediaStream;
    try { stream = await ask(deviceId); }
    catch (e) {
      // FIX: a saved camera that was unplugged (or whose id changed) made Start fail forever. Fall back to the default camera.
      const n = (e as DOMException).name;
      if (deviceId && (n === 'OverconstrainedError' || n === 'NotFoundError')) stream = await ask(undefined);
      else throw e;
    }
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    const n = (e as DOMException).name;
    if (n === 'NotAllowedError' || n === 'SecurityError') throw new Error('Camera permission denied. Allow camera access for this app (Windows: Settings > Privacy & security > Camera; macOS: System Settings > Privacy & Security > Camera) and retry.');
    if (n === 'NotFoundError') throw new Error('No camera found.');
    if (n === 'NotReadableError') throw new Error('Camera is in use by another app.');
    throw e;
  }
}

/** Use a video file as the tracking input instead of the webcam. */
export async function openFile(video: HTMLVideoElement, file: File): Promise<void> {
  stopStream(video);
  video.src = URL.createObjectURL(file); video.loop = true; video.muted = true;
  await video.play();
}
export function stopStream(video: HTMLVideoElement) {
  (video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
  const old = video.src; // FIX: revoke the blob URL of a previously opened video file (memory leak)
  video.srcObject = null; video.removeAttribute('src'); video.load();
  if (old.startsWith('blob:')) URL.revokeObjectURL(old);
}
