#!/usr/bin/env python3
"""
Pyannote Speaker Diarization Worker

This script provides speaker diarization using pyannote.audio.
It communicates with the Electron main process via JSON messages over stdin/stdout.

GPU Auto-Detection:
- CUDA (NVIDIA GPUs) - Best performance
- MPS (Apple Metal - M1/M2/M3) - Native macOS acceleration
- CPU - Fallback for all systems
"""

import sys
import json
import os

# Suppress warnings before importing torch
os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"

import torch
from pyannote.audio import Pipeline


def get_device():
    """Auto-detect best available GPU, fallback to CPU"""
    if torch.cuda.is_available():
        device = torch.device("cuda")
        device_name = torch.cuda.get_device_name(0)
        return device, f"cuda ({device_name})"
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps"), "mps (Apple Metal)"
    return torch.device("cpu"), "cpu"


def send(msg):
    """Send JSON message to stdout"""
    print(json.dumps(msg), flush=True)


def send_progress(msg_id, percent, stage, message=None):
    """Send progress update"""
    send({
        "type": "progress",
        "id": msg_id,
        "percent": percent,
        "stage": stage,
        "message": message or stage
    })


class Diarizer:
    def __init__(self):
        self.pipeline = None
        self.device, self.device_name = get_device()
        self.hf_token = None

    def load_model(self, msg_id, hf_token=None):
        """Load the pyannote speaker diarization pipeline"""
        try:
            send_progress(msg_id, 10, "loading", "Loading diarization model...")

            self.hf_token = hf_token

            # Load the pipeline
            # Note: pyannote/speaker-diarization-3.1 requires accepting terms on HuggingFace
            self.pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                use_auth_token=hf_token
            )

            send_progress(msg_id, 50, "loading", f"Moving model to {self.device_name}...")

            # Move to GPU if available
            self.pipeline.to(self.device)

            send_progress(msg_id, 100, "loading", "Model loaded successfully")

            return {
                "type": "modelLoaded",
                "id": msg_id,
                "device": self.device_name
            }

        except Exception as e:
            return {
                "type": "error",
                "id": msg_id,
                "error": f"Failed to load model: {str(e)}"
            }

    def diarize(self, msg_id, audio_path, num_speakers=None):
        """Run speaker diarization on an audio file"""
        try:
            if not self.pipeline:
                return {
                    "type": "error",
                    "id": msg_id,
                    "error": "Model not loaded. Call loadModel first."
                }

            if not os.path.exists(audio_path):
                return {
                    "type": "error",
                    "id": msg_id,
                    "error": f"Audio file not found: {audio_path}"
                }

            send_progress(msg_id, 10, "processing", "Starting diarization...")

            # Run diarization
            # Optional: specify number of speakers if known
            if num_speakers and num_speakers > 0:
                diarization = self.pipeline(audio_path, num_speakers=num_speakers)
            else:
                diarization = self.pipeline(audio_path)

            send_progress(msg_id, 80, "processing", "Extracting speaker segments...")

            # Extract segments
            segments = []
            speakers = set()

            for turn, _, speaker in diarization.itertracks(yield_label=True):
                segments.append({
                    "speaker": speaker,
                    "start": float(turn.start),
                    "end": float(turn.end)
                })
                speakers.add(speaker)

            send_progress(msg_id, 100, "complete", "Diarization complete")

            return {
                "type": "diarizationResult",
                "id": msg_id,
                "segments": segments,
                "speakers": sorted(list(speakers))
            }

        except Exception as e:
            return {
                "type": "error",
                "id": msg_id,
                "error": f"Diarization failed: {str(e)}"
            }


def main():
    """Main loop - read JSON messages from stdin, process, write responses to stdout"""

    # Send ready message with device info
    device, device_name = get_device()
    send({
        "type": "ready",
        "device": device_name,
        "version": "1.0.0"
    })

    diarizer = Diarizer()

    # Read messages from stdin
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            msg = json.loads(line)
            msg_type = msg.get("type")
            msg_id = msg.get("id")

            if msg_type == "loadModel":
                result = diarizer.load_model(
                    msg_id,
                    hf_token=msg.get("hfToken")
                )
                send(result)

            elif msg_type == "diarize":
                result = diarizer.diarize(
                    msg_id,
                    audio_path=msg.get("filePath"),
                    num_speakers=msg.get("numSpeakers")
                )
                send(result)

            elif msg_type == "ping":
                send({"type": "pong", "id": msg_id})

            else:
                send({
                    "type": "error",
                    "id": msg_id,
                    "error": f"Unknown message type: {msg_type}"
                })

        except json.JSONDecodeError as e:
            send({
                "type": "error",
                "error": f"Invalid JSON: {str(e)}"
            })
        except Exception as e:
            send({
                "type": "error",
                "error": f"Unexpected error: {str(e)}"
            })


if __name__ == "__main__":
    main()
