export type ObservationVideo = {
  codec: string
  width: number
  height: number
  frames: { blobId: string; type: EncodedVideoChunkType; timestamp: number }[]
}

const CODEC = 'avc1.640033' // H.264 High, level 5.1 (up to 4K); native WebCodecs implementation.
export const MAX_VIDEO_FRAMES = 10

/** Same message as a plain compression-failed Error, plus a diagnostic-only detail string for logs/state. */
export class CompressionFailedError extends Error {
  detail: string
  constructor(detail: string) {
    super('compression-failed')
    this.name = 'CompressionFailedError'
    this.detail = detail
  }
}

/** One serial recorder. Encoded chunks use standard Annex B, including SPS/PPS on key frames. */
export class ObservationVideoEncoder {
  private encoder?: VideoEncoder
  private dimensions = ''
  private sequence = 0
  private chunk?: EncodedVideoChunk
  private failed = false
  private lastEncoderError = ''
  private closed = false

  async encode(imageBytes: Uint8Array, keyFrame: boolean) {
    if (this.closed) throw new CompressionFailedError('encoder-closed:pre-decode')
    if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
      throw new Error('compression-unavailable')
    }
    const image = await createImageBitmap(new Blob([imageBytes.slice().buffer]))
    let frame: VideoFrame | undefined
    try {
      if (this.closed) throw new CompressionFailedError('encoder-closed:pre-encode')
      const width = image.width
      const height = image.height
      const codedWidth = width + width % 2
      const codedHeight = height + height % 2
      const dimensions = `${codedWidth}:${codedHeight}`
      if (!this.encoder || dimensions !== this.dimensions) {
        this.encoder?.close()
        this.encoder = undefined
        const config: VideoEncoderConfig = {
          codec: CODEC, width: codedWidth, height: codedHeight,
          // Logical frame clock, not elapsed screen time: samples remain indexed by capturedAt.
          framerate: 30, bitrate: Math.max(1_000_000, codedWidth * codedHeight * 6),
          bitrateMode: 'variable', latencyMode: 'realtime', contentHint: 'text',
          avc: { format: 'annexb' },
        }
        const [encoding, decoding] = await Promise.all([
          VideoEncoder.isConfigSupported(config), VideoDecoder.isConfigSupported({ codec: CODEC }),
        ])
        if (this.closed) throw new CompressionFailedError('encoder-closed:post-config-check')
        if (!encoding.supported || !decoding.supported) throw new Error('compression-unavailable')
        this.failed = false
        this.lastEncoderError = ''
        this.encoder = new VideoEncoder({
          output: (chunk) => { this.chunk = chunk },
          error: (e) => { this.failed = true; this.lastEncoderError = e instanceof Error ? `${e.name}:${e.message}` : String(e) },
        })
        this.encoder.configure(config)
        this.dimensions = dimensions
        keyFrame = true
      }
      const timestamp = this.sequence++ * 33333
      if (width !== codedWidth || height !== codedHeight) {
        // Pad an odd-sized window; never scale UI text to satisfy the codec's even dimensions.
        const canvas = new OffscreenCanvas(codedWidth, codedHeight)
        canvas.getContext('2d')!.drawImage(image, 0, 0)
        frame = new VideoFrame(canvas, { timestamp, duration: 33333 })
      } else {
        frame = new VideoFrame(image, { timestamp, duration: 33333 })
      }
      this.chunk = undefined
      this.encoder.encode(frame, { keyFrame })
      await this.encoder.flush()
      const chunk = this.chunk as EncodedVideoChunk | undefined
      const context = `dims=${dimensions}:keyFrame=${keyFrame}`
      if (this.closed) throw new CompressionFailedError(`encoder-closed:post-flush:${context}`)
      if (this.failed) throw new CompressionFailedError(`encoder-error:${this.lastEncoderError || 'unknown'}:${context}`)
      if (!chunk) throw new CompressionFailedError(`no-chunk-emitted:${context}`)
      if (chunk.timestamp !== timestamp) throw new CompressionFailedError(`timestamp-mismatch:expected=${timestamp}:got=${chunk.timestamp}:${context}`)
      const bytes = new Uint8Array(chunk.byteLength)
      chunk.copyTo(bytes)
      return { bytes, codec: CODEC, width, height, type: chunk.type, timestamp: chunk.timestamp }
    } catch (error) {
      if (error instanceof CompressionFailedError) throw error
      if (error instanceof Error && error.message === 'compression-unavailable') throw error
      const detail = error instanceof Error ? `${error.name}:${error.message}` : String(error)
      throw new CompressionFailedError(`unexpected:${detail}`)
    } finally {
      frame?.close()
      image.close()
    }
  }

  close() {
    this.closed = true
    if (this.encoder && this.encoder.state !== 'closed') this.encoder.close()
    this.encoder = undefined
  }
}

/** Rebuild one saved sample from a bounded key-frame group, without a playback timeline. */
export async function decodeObservationVideo(
  video: ObservationVideo,
  readBlob: (id: string) => Promise<Uint8Array | undefined>,
): Promise<Blob> {
  if (typeof VideoDecoder === 'undefined') throw new Error('compression-unavailable')
  if (video.codec !== CODEC || !video.frames.length || video.frames.length > MAX_VIDEO_FRAMES
    || video.frames[0].type !== 'key' || !Number.isInteger(video.width) || !Number.isInteger(video.height)
    || video.width < 1 || video.height < 1 || video.width * video.height > 9_437_184) {
    throw new Error('compression-failed')
  }
  let output: VideoFrame | undefined
  let failed = false
  const decoder = new VideoDecoder({
    output: (frame) => { output?.close(); output = frame },
    error: () => { failed = true },
  })
  try {
    decoder.configure({ codec: video.codec })
    for (const ref of video.frames) {
      const data = await readBlob(ref.blobId)
      if (!data?.length) throw new Error('compression-failed')
      decoder.decode(new EncodedVideoChunk({ type: ref.type, timestamp: ref.timestamp, data }))
    }
    await decoder.flush()
    const image = output as VideoFrame | undefined
    if (failed || !image || image.timestamp !== video.frames.at(-1)!.timestamp) throw new Error('compression-failed')
    const canvas = new OffscreenCanvas(video.width, video.height)
    canvas.getContext('2d')!.drawImage(image, 0, 0)
    return await canvas.convertToBlob({ type: 'image/png' })
  } finally {
    if (decoder.state !== 'closed') decoder.close()
    output?.close()
  }
}
