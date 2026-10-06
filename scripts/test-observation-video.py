"""Real WebCodecs smoke check; run against the existing Vite server, no screen capture."""
import json
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    # Never connect this synthetic check to the user's desktop data.
    page.route('http://127.0.0.1:19246/**', lambda route: route.abort())
    page.goto('http://localhost:1420/', wait_until='domcontentloaded')
    result = page.evaluate("""async () => {
      const {ObservationVideoEncoder, decodeObservationVideo} = await import('/src/observation/video.ts');
      const encoder = new ObservationVideoEncoder();
      const canvas = new OffscreenCanvas(641, 359), ctx = canvas.getContext('2d');
      const blobs = new Map(), frames = [], sizes = [];
      let video;
      try {
        for (let i = 0; i < 2; i++) {
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 641, 359);
          ctx.fillStyle = '#111'; ctx.font = '18px monospace';
          ctx.fillText('hiven screenshot 0123456789 AaBb', 20, 40);
          ctx.fillText('Local capture / OCR / H.264', 20, 70);
          ctx.fillStyle = '#306090'; ctx.fillRect(20 + i * 5, 100, 80, 40);
          const png = await canvas.convertToBlob({type: 'image/png'});
          const encoded = await encoder.encode(new Uint8Array(await png.arrayBuffer()), i === 0);
          const blobId = String(i);
          blobs.set(blobId, encoded.bytes); sizes.push(encoded.bytes.length);
          frames.push({blobId, type: encoded.type, timestamp: encoded.timestamp});
          video = {codec: encoded.codec, width: encoded.width, height: encoded.height, frames};
        }
      } finally { encoder.close(); }
      const image = await createImageBitmap(await decodeObservationVideo(video, async id => blobs.get(id)));
      const restored = new OffscreenCanvas(image.width, image.height), out = restored.getContext('2d');
      out.drawImage(image, 0, 0); image.close();
      const source = ctx.getImageData(0, 0, 641, 359).data;
      const actual = out.getImageData(0, 0, 641, 359).data;
      let squaredError = 0;
      for (let i = 0; i < source.length; i++) if (i % 4 !== 3) squaredError += (source[i] - actual[i]) ** 2;
      let missingRejected = false;
      try { await decodeObservationVideo(video, async () => undefined); }
      catch { missingRejected = true; }
      return {types: frames.map(f => f.type), sizes, width: restored.width, height: restored.height,
        mse: squaredError / (641 * 359 * 3), missingRejected};
    }""")
    browser.close()
    assert result['types'] == ['key', 'delta'], result
    assert (result['width'], result['height']) == (641, 359), result
    assert result['mse'] < 36, result
    assert result['missingRejected'], result
    print('WebCodecs key/delta round-trip + missing reference:', json.dumps(result))
