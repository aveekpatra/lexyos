"use client";

/**
 * useVoiceChat — simple speech-to-text that fills an input box.
 * Press mic → speak → transcript appears in callback → user edits and sends manually.
 * No auto-submit, no TTS, no conversation loop.
 */

import { useState, useRef, useCallback } from "react";

const CARTESIA_API_KEY = process.env.NEXT_PUBLIC_CARTESIA_API_KEY || "";
const STT_MODEL = "ink-whisper";

export function useVoiceChat(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sttWsRef = useRef<WebSocket | null>(null);

  const cleanup = useCallback(() => {
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
  }, []);

  const stopListening = useCallback(() => {
    // Send finalize to get final transcript
    if (sttWsRef.current?.readyState === WebSocket.OPEN) {
      sttWsRef.current.send("done");
    }
    cleanup();
    setListening(false);
  }, [cleanup]);

  const startListening = useCallback(async () => {
    if (!CARTESIA_API_KEY) {
      // Fallback to Web Speech API if no Cartesia key
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

      // Connect to Cartesia STT at native sample rate
      const sttUrl = `wss://api.cartesia.ai/stt/websocket?cartesia_version=2025-04-16&model=${STT_MODEL}&language=en&encoding=pcm_s16le&sample_rate=${nativeRate}&min_volume=0.05&api_key=${CARTESIA_API_KEY}`;
      const sttWs = new WebSocket(sttUrl);
      sttWsRef.current = sttWs;

      let fullText = "";

      sttWs.onopen = () => {
        setListening(true);
        setTranscript("");

        processor.onaudioprocess = (e) => {
          if (sttWs.readyState !== WebSocket.OPEN) return;
          const float32 = e.inputBuffer.getChannelData(0);
          // Float32 → Int16 PCM
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
            if (data.is_final) {
              // Append final segment with a space
              fullText = (fullText + " " + data.text).trim();
            } else {
              // Show interim: full confirmed text + current partial
              setTranscript((fullText + " " + data.text).trim());
              onTranscript((fullText + " " + data.text).trim());
              return;
            }
            setTranscript(fullText);
            onTranscript(fullText);
          }
        } catch { /* ignore */ }
      };

      sttWs.onerror = () => {
        console.error("[STT] WebSocket error");
        cleanup();
        setListening(false);
      };

      sttWs.onclose = () => {
        cleanup();
        setListening(false);
      };
    } catch (err) {
      console.error("[STT] Mic access error:", err);
      setListening(false);
    }
  }, [onTranscript, cleanup]);

  const toggleVoice = useCallback(() => {
    if (listening) {
      stopListening();
    } else {
      startListening();
    }
  }, [listening, startListening, stopListening]);

  return { listening, transcript, toggleVoice };
}
