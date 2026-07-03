// Kept inline so AudioWorklet does not have to import a module through Tauri's
// custom production protocol. Blob URLs work in both WKWebView and WebView2.
export const PCM_CAPTURE_WORKLET_SOURCE = String.raw`
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = options.processorOptions?.targetSampleRate ?? 16000;
    this.phase = 0;
    this.batch = [];
    this.batchSize = Math.round(this.targetSampleRate * 0.02);
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    const step = this.targetSampleRate / sampleRate;
    for (let index = 0; index < channel.length; index += 1) {
      this.phase += step;
      if (this.phase < 1) continue;
      this.phase -= 1;
      const sample = Math.max(-1, Math.min(1, channel[index]));
      this.batch.push(sample < 0 ? sample * 0x8000 : sample * 0x7fff);

      if (this.batch.length >= this.batchSize) {
        const pcm = new Int16Array(this.batch);
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
        this.batch = [];
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
`;
