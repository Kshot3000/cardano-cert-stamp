// Camera QR scanning in the browser / Android WebView. Uses the native
// BarcodeDetector when available, otherwise jsQR on video frames.
import jsQR from 'jsqr';

export async function decodeImageFile(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const r = jsQR(img.data, img.width, img.height);
  return r ? r.data : null;
}

/** Start scanning into `video`; resolves with the first QR text. Call stop() to cancel. */
export function startScan(video, onResult, onError) {
  let stream, raf, stopped = false, detector = null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const stop = () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access. Paste the link or upload a photo of the QR instead.');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      await video.play();
      if ('BarcodeDetector' in globalThis) {
        try { detector = new globalThis.BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; }
      }
      const tick = async () => {
        if (stopped) return;
        if (video.readyState >= 2) {
          let text = null;
          if (detector) {
            try { const codes = await detector.detect(video); text = codes[0]?.rawValue || null; } catch { detector = null; }
          } else {
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data || null;
          }
          if (text) { stop(); onResult(text); return; }
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      stop();
      onError(e.name === 'NotAllowedError' ? new Error('Camera permission was denied. Allow camera access, or paste the link instead.') : e);
    }
  })();
  return stop;
}
