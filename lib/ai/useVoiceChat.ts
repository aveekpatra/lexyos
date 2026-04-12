"use client";

/**
 * useVoiceChat — two modes:
 *
 * 1. **Normal mode** (default): Press mic → speak → transcript fills input → user sends manually.
 * 2. **Call mode**: Continuous listening. Detects silence pause → auto-submits →
 *    waits for AI response → resumes listening. Like a phone call with an assistant.
 *
 * Call mode lifecycle:
 *   listening → silence detected → auto-submit → waiting for AI → AI responds → listening again
 */

import { useState, useRef, useCallback, useEffect } from "react";

const CARTESIA_API_KEY = process.env.NEXT_PUBLIC_CARTESIA_API_KEY || "";
const STT_MODEL = "ink-whisper";
const TTS_MODEL = "sonic-2";
const TTS_VOICE_ID = process.env.NEXT_PUBLIC_CARTESIA_VOICE_ID || "69267136-1bdc-412f-ad78-0caad210fb40";

/** How long of silence (ms) before auto-submitting in call mode */
const SILENCE_TIMEOUT_MS = 1800;

export type VoiceMode = "normal" | "call";

interface UseVoiceChatOpts {
  onTranscript: (text: string) => void;
  /** Called in call mode when silence is detected and we have text to submit */
  onAutoSubmit?: (text: string) => Promise<void>;
}

export function useVoiceChat({ onTranscript, onAutoSubmit }: UseVoiceChatOpts) {
  const [listening, setListening] = useState(false);
  const [callMode, setCallMode] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [waitingForAI, setWaitingForAI] = useState(false);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sttWsRef = useRef<WebSocket | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullTextRef = useRef("");
  const callModeRef = useRef(false);
  const waitingRef = useRef(false);
  const isListeningRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { callModeRef.current = callMode; }, [callMode]);
  useEffect(() => { waitingRef.current = waitingForAI; }, [waitingForAI]);
  useEffect(() => { isListeningRef.current = listening; }, [listening]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearSilenceTimer();
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current?.state !== "closed") {
      audioContextRef.current?.close();
      audioContextRef.current = null;
    }
    if (sttWsRef.current?.readyState === WebSocket.OPEN) {
      sttWsRef.current.send("done");
      sttWsRef.current.close();
    }
    sttWsRef.current = null;
  }, [clearSilenceTimer]);

  const stopListening = useCallback(() => {
    cleanup();
    setListening(false);
    fullTextRef.current = "";
  }, [cleanup]);

  /** Fully exit call mode and stop everything */
  const stopCallMode = useCallback(() => {
    setCallMode(false);
    callModeRef.current = false;
    setWaitingForAI(false);
    waitingRef.current = false;
    stopListening();
  }, [stopListening]);

  const startCartesiaListening = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      mediaStreamRef.current = stream;

      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const nativeRate = audioCtx.sampleRate;

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      const sttUrl = `wss://api.cartesia.ai/stt/websocket?cartesia_version=2025-04-16&model=${STT_MODEL}&language=en&encoding=pcm_s16le&sample_rate=${nativeRate}&min_volume=0.05&api_key=${CARTESIA_API_KEY}`;
      const sttWs = new WebSocket(sttUrl);
      sttWsRef.current = sttWs;

      fullTextRef.current = "";

      sttWs.onopen = () => {
        setListening(true);
        isListeningRef.current = true;
        setTranscript("");

        processor.onaudioprocess = (e) => {
          if (sttWs.readyState !== WebSocket.OPEN) return;
          const float32 = e.inputBuffer.getChannelData(0);
          const int16 = new Int16Array(float32.length);
          for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          sttWs.send(int16.buffer);
        };

        source.connect(processor);
        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0;
        processor.connect(silentGain);
        silentGain.connect(audioCtx.destination);
      };

      sttWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "transcript" && data.text) {
            // Reset silence timer on any transcript activity
            clearSilenceTimer();

            if (data.is_final) {
              fullTextRef.current = (fullTextRef.current + " " + data.text).trim();
              setTranscript(fullTextRef.current);
              onTranscript(fullTextRef.current);

              // In call mode, start silence timer after each final segment
              if (callModeRef.current && fullTextRef.current.trim()) {
                silenceTimerRef.current = setTimeout(() => {
                  // Silence detected — auto-submit
                  const text = fullTextRef.current.trim();
                  if (text && callModeRef.current && onAutoSubmit) {
                    fullTextRef.current = "";
                    setTranscript("");

                    // Pause listening while AI processes
                    cleanup();
                    setListening(false);
                    isListeningRef.current = false;
                    setWaitingForAI(true);
                    waitingRef.current = true;

                    onAutoSubmit(text).finally(() => {
                      // After AI responds, resume listening if still in call mode
                      if (callModeRef.current) {
                        setWaitingForAI(false);
                        waitingRef.current = false;
                        // Small delay before resuming to avoid picking up speaker audio
                        setTimeout(() => {
                          if (callModeRef.current) {
                            startCartesiaListening();
                          }
                        }, 500);
                      }
                    });
                  }
                }, SILENCE_TIMEOUT_MS);
              }
            } else {
              // Interim result
              const interim = (fullTextRef.current + " " + data.text).trim();
              setTranscript(interim);
              onTranscript(interim);

              // In call mode, also reset silence timer on interim results
              if (callModeRef.current && fullTextRef.current.trim()) {
                clearSilenceTimer();
                silenceTimerRef.current = setTimeout(() => {
                  const text = fullTextRef.current.trim();
                  if (text && callModeRef.current && onAutoSubmit) {
                    fullTextRef.current = "";
                    setTranscript("");
                    cleanup();
                    setListening(false);
                    isListeningRef.current = false;
                    setWaitingForAI(true);
                    waitingRef.current = true;

                    onAutoSubmit(text).finally(() => {
                      if (callModeRef.current) {
                        setWaitingForAI(false);
                        waitingRef.current = false;
                        setTimeout(() => {
                          if (callModeRef.current) {
                            startCartesiaListening();
                          }
                        }, 500);
                      }
                    });
                  }
                }, SILENCE_TIMEOUT_MS);
              }
            }
          }
        } catch { /* ignore */ }
      };

      sttWs.onerror = () => {
        console.error("[STT] WebSocket error");
        cleanup();
        setListening(false);
        isListeningRef.current = false;
      };

      sttWs.onclose = () => {
        // Only fully stop if not in call mode (call mode will reconnect)
        if (!callModeRef.current || !waitingRef.current) {
          cleanup();
          setListening(false);
          isListeningRef.current = false;
        }
      };
    } catch (err) {
      console.error("[STT] Mic access error:", err);
      setListening(false);
      isListeningRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onTranscript, onAutoSubmit, cleanup, clearSilenceTimer]);

  const startListening = useCallback(async () => {
    if (!CARTESIA_API_KEY) {
      // Fallback to Web Speech API (no call mode support)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) { alert("Speech recognition not supported"); return; }
      const recognition = new SR();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = (e: { results: { [key: number]: { [key: number]: { transcript: string } }; length: number } }) => {
        let text = "";
        for (let i = 0; i < e.results.length; i++) {
          text += e.results[i][0].transcript;
        }
        setTranscript(text);
        onTranscript(text);
      };
      recognition.onend = () => setListening(false);
      recognition.onerror = () => setListening(false);
      setListening(true);
      setTranscript("");
      recognition.start();
      return;
    }

    await startCartesiaListening();
  }, [onTranscript, startCartesiaListening]);

  /** Toggle normal voice mode (press to talk) */
  const toggleVoice = useCallback(() => {
    if (callMode) {
      // If in call mode, stop call mode
      stopCallMode();
    } else if (listening) {
      stopListening();
    } else {
      startListening();
    }
  }, [callMode, listening, startListening, stopListening, stopCallMode]);

  /** Enter call mode — continuous listen/submit/listen loop */
  const startCallMode = useCallback(async () => {
    if (!CARTESIA_API_KEY) {
      alert("Call mode requires Cartesia API key");
      return;
    }
    setCallMode(true);
    callModeRef.current = true;
    await startCartesiaListening();
  }, [startCartesiaListening]);

  /** Toggle call mode on/off */
  const toggleCallMode = useCallback(() => {
    if (callMode) {
      stopCallMode();
    } else {
      startCallMode();
    }
  }, [callMode, startCallMode, stopCallMode]);

  return {
    listening,
    transcript,
    callMode,
    waitingForAI,
    toggleVoice,
    toggleCallMode,
    stopCallMode,
  };
}

/**
 * Play text as speech using Cartesia TTS REST API.
 * Returns a promise that resolves when playback finishes.
 */
export async function playCartesiaTTS(text: string): Promise<void> {
  if (!CARTESIA_API_KEY || !text.trim()) return;

  const SAMPLE_RATE = 24000;

  const res = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      "X-API-Key": CARTESIA_API_KEY,
      "Cartesia-Version": "2024-06-10",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: TTS_MODEL,
      transcript: text,
      voice: { mode: "id", id: TTS_VOICE_ID },
      output_format: { container: "raw", encoding: "pcm_f32le", sample_rate: SAMPLE_RATE },
    }),
  });

  if (!res.ok) {
    console.error("[TTS] Cartesia error:", res.status, await res.text().catch(() => ""));
    return;
  }

  // Stream raw PCM f32le chunks into AudioContext for instant playback
  const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const reader = res.body?.getReader();
  if (!reader) return;

  let scheduledTime = audioCtx.currentTime;
  const BUFFER_AHEAD = 0.05; // schedule 50ms ahead to prevent gaps
  let leftover = new Uint8Array(0);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Combine leftover bytes from previous chunk
      let data: Uint8Array;
      if (leftover.length > 0) {
        data = new Uint8Array(leftover.length + value.length);
        data.set(leftover);
        data.set(value, leftover.length);
      } else {
        data = value;
      }

      // f32le = 4 bytes per sample
      const completeBytes = data.length - (data.length % 4);
      leftover = data.slice(completeBytes);

      if (completeBytes === 0) continue;

      const samples = new Float32Array(data.buffer, data.byteOffset, completeBytes / 4);
      const audioBuffer = audioCtx.createBuffer(1, samples.length, SAMPLE_RATE);
      audioBuffer.getChannelData(0).set(samples);

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);

      const now = audioCtx.currentTime;
      if (scheduledTime < now) scheduledTime = now;
      source.start(scheduledTime + BUFFER_AHEAD);
      scheduledTime += audioBuffer.duration;
    }

    // Wait for all scheduled audio to finish
    const remaining = scheduledTime + BUFFER_AHEAD - audioCtx.currentTime;
    if (remaining > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remaining * 1000));
    }
  } finally {
    await audioCtx.close();
  }
}
