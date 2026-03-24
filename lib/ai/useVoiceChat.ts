"use client";

/**
 * useVoiceChat — full voice pipeline:
 * 1. Mic capture → PCM audio chunks
 * 2. Cartesia Ink-Whisper STT → real-time transcript
 * 3. On silence/done → send transcript to AI chat API
 * 4. AI response text → Cartesia Sonic-3 TTS → audio playback
 *
 * All WebSocket connections are direct browser → Cartesia (no server proxy).
 */

import { useState, useRef, useCallback } from "react";

const CARTESIA_API_KEY = process.env.NEXT_PUBLIC_CARTESIA_API_KEY || "";
const STT_MODEL = "ink-whisper";
const TTS_MODEL = "sonic-3";
const TTS_VOICE_ID = "71a7ad14-091c-4e8e-a314-022ece01c121"; // "Barbershop Man" — warm, clear male voice
const SAMPLE_RATE = 16000;

type VoiceState = "idle" | "listening" | "processing" | "speaking";

export function useVoiceChat(onSendMessage: (text: string) => void) {
  const [voiceState, _setVoiceState] = useState<VoiceState>("idle");
  const voiceStateRef = useRef<VoiceState>("idle");
  const setVoiceState = useCallback((s: VoiceState) => { voiceStateRef.current = s; _setVoiceState(s); }, []);
  const [transcript, setTranscript] = useState("");

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sttWsRef = useRef<WebSocket | null>(null);
  const ttsWsRef = useRef<WebSocket | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const conversationModeRef = useRef(false); // true = auto-listen after TTS

  // ─── STT: Start listening ───
  const startListening = useCallback(async () => {
    if (!CARTESIA_API_KEY) {
      console.error("Missing NEXT_PUBLIC_CARTESIA_API_KEY");
      return;
    }

    try {
      // Get mic access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: SAMPLE_RATE, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      mediaStreamRef.current = stream;

      // Create AudioContext at the browser's native rate — don't force 16kHz
      // (browsers may ignore the sampleRate option or produce artifacts)
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const nativeRate = audioCtx.sampleRate;
      console.log("[STT] Native sample rate:", nativeRate, "target:", SAMPLE_RATE);

      // Use the NATIVE rate for the WebSocket — send audio at whatever rate we capture
      // Cartesia accepts any sample_rate, so just tell it what we're sending
      const sendRate = nativeRate;

      const source = audioCtx.createMediaStreamSource(stream);

      // ScriptProcessor for raw PCM (deprecated but widely supported)
      const bufferSize = 4096;
      const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
      processorRef.current = processor;

      // Connect STT WebSocket with the NATIVE sample rate
      const sttUrl = `wss://api.cartesia.ai/stt/websocket?cartesia_version=2025-04-16&model=${STT_MODEL}&language=en&encoding=pcm_s16le&sample_rate=${sendRate}&max_silence_duration_secs=1.5&min_volume=0.05&api_key=${CARTESIA_API_KEY}`;
      const sttWs = new WebSocket(sttUrl);
      sttWsRef.current = sttWs;

      let fullTranscript = "";

      sttWs.onopen = () => {
        setVoiceState("listening");
        setTranscript("");

        // Start sending audio chunks — NO resampling, just Float32→Int16 conversion
        processor.onaudioprocess = (e) => {
          if (sttWs.readyState !== WebSocket.OPEN) return;
          const float32 = e.inputBuffer.getChannelData(0);

          // Convert Float32 [-1, 1] to Int16 PCM [-32768, 32767]
          const int16 = new Int16Array(float32.length);
          for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          sttWs.send(int16.buffer);
        };

        source.connect(processor);
        // Connect to destination with zero gain — required for ScriptProcessor to fire
        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0;
        processor.connect(silentGain);
        silentGain.connect(audioCtx.destination);
      };

      let autoSubmitted = false;

      sttWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("[STT]", data.type, data.is_final, data.text?.slice(0, 80) || "");

          if (data.type === "transcript" && data.text) {
            fullTranscript = data.text;
            setTranscript(fullTranscript);

            // Auto-submit: Cartesia sends is_final=true when silence detected
            if (data.is_final && fullTranscript.trim() && !autoSubmitted) {
              autoSubmitted = true;
              console.log("[STT] Auto-submitting on silence:", fullTranscript.trim());
              // Stop mic and submit
              stopListeningInternal();
              setVoiceState("processing");
              onSendMessage(fullTranscript.trim());
            }
          } else if (data.type === "flush_done") {
            // Manual finalize complete — submit if not already auto-submitted
            if (!autoSubmitted && fullTranscript.trim()) {
              autoSubmitted = true;
              setVoiceState("processing");
              onSendMessage(fullTranscript.trim());
            } else if (!autoSubmitted) {
              setVoiceState("idle");
            }
          }
        } catch {
          // ignore
        }
      };

      sttWs.onerror = (err) => {
        console.error("STT WebSocket error:", err);
        stopListening();
      };

      sttWs.onclose = () => {
        // Fallback: if flush_done didn't fire, submit on close
        if (voiceStateRef.current === "listening" && fullTranscript.trim()) {
          setVoiceState("processing");
          onSendMessage(fullTranscript.trim());
        } else if (voiceStateRef.current === "listening") {
          setVoiceState("idle");
        }
      };
    } catch (err) {
      console.error("Mic access error:", err);
      setVoiceState("idle");
    }
  }, [onSendMessage]);

  // ─── Internal: just stop mic/processor without sending finalize ───
  const stopListeningInternal = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sttWsRef.current?.readyState === WebSocket.OPEN) {
      sttWsRef.current.close();
      sttWsRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current?.state !== "closed") {
      audioContextRef.current?.close();
      audioContextRef.current = null;
    }
  }, []);

  // ─── STT: Stop listening (user-initiated, sends finalize) ───
  const stopListening = useCallback(() => {
    if (sttWsRef.current?.readyState === WebSocket.OPEN) {
      sttWsRef.current.send("finalize");
      setTimeout(() => {
        if (sttWsRef.current?.readyState === WebSocket.OPEN) {
          sttWsRef.current.send("done");
        }
      }, 200);
    }
    stopListeningInternal();
  }, [stopListeningInternal]);

  // ─── TTS: Speak text ───
  const speak = useCallback(async (text: string) => {
    if (!text.trim() || !CARTESIA_API_KEY) return;

    setVoiceState("speaking");
    audioQueueRef.current = [];
    isPlayingRef.current = false;

    const ttsUrl = `wss://api.cartesia.ai/tts/websocket?cartesia_version=2024-11-13&api_key=${CARTESIA_API_KEY}`;
    const ttsWs = new WebSocket(ttsUrl);
    ttsWsRef.current = ttsWs;

    const playbackCtx = new AudioContext({ sampleRate: 24000 });

    ttsWs.onopen = () => {
      ttsWs.send(JSON.stringify({
        model_id: TTS_MODEL,
        transcript: text,
        voice: { mode: "id", id: TTS_VOICE_ID },
        output_format: {
          container: "raw",
          encoding: "pcm_f32le",
          sample_rate: 24000,
        },
        context_id: crypto.randomUUID(),
      }));
    };

    ttsWs.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "chunk" && data.data) {
          // Decode base64 audio
          const binary = atob(data.data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const float32 = new Float32Array(bytes.buffer);
          audioQueueRef.current.push(float32);

          // Start playback if not already playing
          if (!isPlayingRef.current) {
            isPlayingRef.current = true;
            playAudioQueue(playbackCtx);
          }
        } else if (data.type === "done") {
          ttsWs.close();
        }
      } catch {
        // ignore
      }
    };

    ttsWs.onclose = () => {
      // Wait for audio queue to finish, then auto-listen if in conversation mode
      const checkDone = setInterval(() => {
        if (audioQueueRef.current.length === 0 && !isPlayingRef.current) {
          clearInterval(checkDone);
          playbackCtx.close();
          if (conversationModeRef.current) {
            // Auto-restart listening for continuous conversation
            setTranscript("");
            startListening();
          } else {
            setVoiceState("idle");
          }
        }
      }, 100);
    };

    ttsWs.onerror = (err) => {
      console.error("TTS WebSocket error:", err);
      setVoiceState("idle");
    };
  }, []);

  // ─── Audio playback from queue ───
  function playAudioQueue(ctx: AudioContext) {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }

    const chunk = audioQueueRef.current.shift()!;
    const buffer = ctx.createBuffer(1, chunk.length, 24000);
    buffer.getChannelData(0).set(chunk);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => playAudioQueue(ctx);
    source.start();
  }

  // ─── Toggle: start/stop conversation mode ───
  const toggleVoice = useCallback(() => {
    if (voiceState === "idle") {
      conversationModeRef.current = true;
      startListening();
    } else {
      // Stop everything — end conversation mode
      conversationModeRef.current = false;
      stopListeningInternal();
      // Stop TTS playback
      if (ttsWsRef.current?.readyState === WebSocket.OPEN) {
        ttsWsRef.current.close();
      }
      audioQueueRef.current = [];
      isPlayingRef.current = false;
      setVoiceState("idle");
      setTranscript("");
    }
  }, [voiceState, startListening, stopListeningInternal]);

  return {
    voiceState,
    transcript,
    toggleVoice,
    speak,
    startListening,
    stopListening,
  };
}
