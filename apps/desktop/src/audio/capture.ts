export interface AudioCapture {
  stop: () => Promise<void>;
}

export async function startAudioCapture(
  onFrame: (frame: ArrayBuffer) => void,
): Promise<AudioCapture> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone capture is not available in this environment.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const context = new AudioContext({ latencyHint: "interactive" });
  const workletModule = new Blob([PCM_CAPTURE_WORKLET_SOURCE], {
    type: "text/javascript",
  });
  const workletUrl = URL.createObjectURL(workletModule);

  try {
    await context.audioWorklet.addModule(workletUrl);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
    throw new Error("ZeroLag could not initialize its microphone processor.", {
      cause: error,
    });
  } finally {
    URL.revokeObjectURL(workletUrl);
  }

  const source = context.createMediaStreamSource(stream);
  const processor = new AudioWorkletNode(context, "pcm-capture-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { targetSampleRate: 16_000 },
  });
  const mute = context.createGain();
  mute.gain.value = 0;

  processor.port.onmessage = (event: MessageEvent<ArrayBuffer>) =>
    onFrame(event.data);
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);
  await context.resume();

  let stopped = false;
  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      processor.port.onmessage = null;
      source.disconnect();
      processor.disconnect();
      mute.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      await context.close();
    },
  };
}
import { PCM_CAPTURE_WORKLET_SOURCE } from "./pcm-capture-worklet";
