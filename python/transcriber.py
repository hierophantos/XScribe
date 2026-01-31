#!/usr/bin/env python3
"""
WhisperX Transcription Worker

This script provides transcription using WhisperX with:
- Word-level timestamps via wav2vec2 forced alignment
- Built-in speaker diarization with pyannote.audio
- Automatic speaker-word alignment

GPU Auto-Detection:
- CUDA (NVIDIA GPUs) - Best performance
- MPS (Apple Metal - M1/M2/M3) - Native macOS acceleration (limited support)
- CPU - Fallback for all systems

Communication via JSON messages over stdin/stdout.
"""

# =============================================================================
# CRITICAL: Redirect ALL warnings/output to stderr BEFORE any other imports
# This ensures only JSON goes to stdout for IPC communication
# =============================================================================
import sys
import os
import warnings

# Redirect all warnings to stderr
def _warning_to_stderr(message, category, filename, lineno, file=None, line=None):
    sys.stderr.write(warnings.formatwarning(message, category, filename, lineno, line))

warnings.showwarning = _warning_to_stderr

# Suppress specific noisy warnings
warnings.filterwarnings("ignore", message=".*torchcodec.*")
warnings.filterwarnings("ignore", category=UserWarning, module="pyannote")
warnings.filterwarnings("ignore", category=FutureWarning)

# Disable HuggingFace progress bars (they go to stdout and corrupt JSON)
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
os.environ["TRANSFORMERS_NO_ADVISORY_WARNINGS"] = "1"
os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"

# =============================================================================
# PyTorch 2.6+ changed torch.load default to weights_only=True for security.
# This breaks pyannote model loading which uses omegaconf and other classes.
# Setting this env var restores the old behavior (weights_only=False).
# This is safe because we only load models from trusted sources (HuggingFace).
# See: https://github.com/m-bain/whisperX/issues/1304
# =============================================================================
os.environ["TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD"] = "1"

# Now safe to import other modules
import contextlib
import json
import math
import threading
import time
from datetime import datetime
from pathlib import Path
import torch


# =============================================================================
# Debug log file setup - writes to same location as Electron app logs
# =============================================================================
def get_log_path():
    """Get platform-appropriate log path matching Electron's userData location"""
    if sys.platform == 'win32':
        # Windows: %APPDATA%/xscribe/logs/
        base = os.environ.get('APPDATA', os.path.expanduser('~'))
        log_dir = Path(base) / 'xscribe' / 'logs'
    elif sys.platform == 'darwin':
        # macOS: ~/Library/Application Support/xscribe/logs/
        log_dir = Path.home() / 'Library' / 'Application Support' / 'xscribe' / 'logs'
    else:
        # Linux: ~/.config/xscribe/logs/
        log_dir = Path.home() / '.config' / 'xscribe' / 'logs'

    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / 'debug.log'

LOG_FILE = None  # Initialized lazily on first log call


# =============================================================================
# Define log() early so it can be used throughout the script
# =============================================================================
def log(message):
    """Log message to stderr AND debug file for persistent diagnostics"""
    global LOG_FILE
    timestamp = datetime.now().isoformat(timespec='milliseconds')
    formatted = f"[{timestamp}] [transcriber.py] {message}"

    # Always write to stderr for console output
    sys.stderr.write(formatted + "\n")
    sys.stderr.flush()

    # Also write to debug log file
    try:
        if LOG_FILE is None:
            LOG_FILE = get_log_path()
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(formatted + '\n')
    except Exception:
        pass  # Don't fail if logging fails


def send(msg):
    """Send JSON message to stdout (bypasses any redirect_stdout context managers)"""
    # Use sys.__stdout__ to ensure we write to the original stdout,
    # even when inside a contextlib.redirect_stdout() context
    sys.__stdout__.write(json.dumps(msg) + '\n')
    sys.__stdout__.flush()


def send_progress(msg_id, percent, stage, message=None):
    """Send progress update"""
    send({
        "type": "progress",
        "id": msg_id,
        "percent": percent,
        "stage": stage,
        "message": message or stage
    })


class ProgressHeartbeat:
    """
    Context manager that sends periodic progress updates during blocking operations.

    This addresses the UX issue where long operations (transcribe, align) appear to
    hang because WhisperX doesn't expose progress callbacks. Sends updates every
    few seconds so users know the app is still working.

    Usage:
        with ProgressHeartbeat(msg_id, 10, 38, "transcribing", "Running..."):
            result = model.transcribe(audio)  # Blocking operation
    """

    def __init__(self, msg_id, start_percent, end_percent, stage, message,
                 interval=3.0, expected_duration=60.0):
        """
        Args:
            msg_id: Message ID for IPC
            start_percent: Starting progress percentage
            end_percent: Maximum progress percentage (won't exceed this)
            stage: Stage name (e.g., "transcribing", "aligning")
            message: Message to display to user
            interval: Seconds between heartbeat updates
            expected_duration: Estimated operation duration for progress calculation
        """
        self.msg_id = msg_id
        self.start_percent = start_percent
        self.end_percent = end_percent
        self.stage = stage
        self.message = message
        self.interval = interval
        self.expected_duration = expected_duration
        self._stop_event = threading.Event()
        self._thread = None
        self._start_time = None

    def _heartbeat_loop(self):
        """Background thread that sends periodic progress updates."""
        tick_count = 0
        log(f"Heartbeat loop started for '{self.stage}' (thread={threading.current_thread().name})")
        while not self._stop_event.is_set():
            elapsed = time.time() - self._start_time
            progress_range = self.end_percent - self.start_percent

            # Asymptotic progress: approaches but never reaches end_percent
            # At expected_duration, we're at ~63% of the range
            # At 2x expected_duration, we're at ~86% of the range
            progress_fraction = 1 - math.exp(-elapsed / self.expected_duration)
            current_percent = self.start_percent + (progress_range * 0.95 * progress_fraction)

            tick_count += 1
            log(f"Heartbeat tick #{tick_count}: {self.stage} elapsed={int(elapsed)}s percent={current_percent:.1f}%")

            send_progress(self.msg_id, current_percent, self.stage,
                         f"{self.message} ({int(elapsed)}s)")

            self._stop_event.wait(self.interval)
        log(f"Heartbeat loop ended for '{self.stage}' after {tick_count} ticks")

    def __enter__(self):
        """Start the heartbeat thread."""
        log(f"Starting heartbeat for '{self.stage}': {self.start_percent}%->{self.end_percent}%, interval={self.interval}s")
        self._start_time = time.time()
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Stop the heartbeat thread."""
        elapsed = time.time() - self._start_time if self._start_time else 0
        log(f"Stopping heartbeat for '{self.stage}' after {elapsed:.1f}s total")
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=1.0)
            if self._thread.is_alive():
                log(f"WARNING: Heartbeat thread for '{self.stage}' did not stop cleanly")
        return False  # Don't suppress exceptions


def get_device():
    """Auto-detect best available GPU, fallback to CPU"""
    if torch.cuda.is_available():
        device = "cuda"
        device_name = f"cuda ({torch.cuda.get_device_name(0)})"
        compute_type = "float16"  # Best for CUDA
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        # MPS support in WhisperX is limited, fall back to CPU for now
        # WhisperX uses faster-whisper which doesn't support MPS
        device = "cpu"
        device_name = "cpu (MPS not supported by faster-whisper)"
        compute_type = "int8"
    else:
        device = "cpu"
        device_name = "cpu"
        compute_type = "int8"  # Best for CPU

    return device, device_name, compute_type


def get_diarization_models_dir():
    """
    Find diarization models directory, checking multiple locations.

    Checks in order:
    1. User data directory (~/.xscribe/models/diarization/) - for lite/packaged builds
    2. Relative to script (../models/diarization) - for development
    3. Returns user data dir as default (will be created during download)
    """
    # 1. User data directory (works for all build types)
    if sys.platform == 'win32':
        user_data = os.environ.get('APPDATA', os.path.expanduser('~'))
        user_models = os.path.join(user_data, 'xscribe', 'models', 'diarization')
    elif sys.platform == 'darwin':
        user_models = os.path.expanduser('~/Library/Application Support/xscribe/models/diarization')
    else:
        user_models = os.path.expanduser('~/.config/xscribe/models/diarization')

    # Check if models exist in user directory
    segmentation_file = os.path.join(user_models, 'segmentation.onnx')
    if os.path.exists(user_models) and os.path.exists(segmentation_file):
        log(f"Found diarization models in user directory: {user_models}")
        return user_models

    # 2. Relative to script (development mode)
    dev_models = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'models', 'diarization')
    dev_models = os.path.normpath(dev_models)
    segmentation_file = os.path.join(dev_models, 'segmentation.onnx')
    if os.path.exists(dev_models) and os.path.exists(segmentation_file):
        log(f"Found diarization models in development directory: {dev_models}")
        return dev_models

    # 3. Return user_models anyway (will be created during download)
    log(f"Diarization models not found, will use: {user_models}")
    return user_models


def download_diarization_models(models_dir, msg_id=None):
    """
    Download sherpa-onnx diarization models from HuggingFace.

    Downloads:
    - segmentation.onnx (~5MB) - pyannote segmentation model
    - 3dspeaker_speech_eres2net...onnx (~45MB) - speaker embedding model
    """
    import urllib.request

    os.makedirs(models_dir, exist_ok=True)

    models = {
        'segmentation.onnx': {
            'url': 'https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx',
            'size': '~5MB'
        },
        '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx': {
            'url': 'https://huggingface.co/csukuangfj/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k/resolve/main/model.onnx',
            'size': '~45MB'
        },
    }

    total_models = len(models)
    for idx, (filename, info) in enumerate(models.items(), 1):
        dest = os.path.join(models_dir, filename)
        if not os.path.exists(dest):
            log(f"Downloading {filename} ({info['size']})...")
            if msg_id:
                send_progress(msg_id, 56, "diarizing",
                             f"Downloading diarization model {idx}/{total_models} ({info['size']})...")
            try:
                urllib.request.urlretrieve(info['url'], dest)
                log(f"Downloaded {filename} successfully")
            except Exception as e:
                log(f"Failed to download {filename}: {e}")
                raise RuntimeError(f"Failed to download diarization model {filename}: {e}")
        else:
            log(f"Model {filename} already exists")


def format_text_with_paragraphs(text, words, pause_threshold=0.7, sentences_per_paragraph=3):
    """
    Format segment text with paragraph breaks based on natural pauses.

    Uses word-level timestamps to detect natural pauses in speech,
    then inserts paragraph breaks at pause boundaries when enough
    sentences have accumulated.

    Args:
        text: Original segment text (used as fallback)
        words: List of word dicts with 'word', 'start', 'end' keys
        pause_threshold: Minimum gap (seconds) to consider as a pause
        sentences_per_paragraph: Minimum sentences before allowing break

    Returns:
        Text with paragraph breaks (double newlines) inserted
    """
    if not words or len(words) < 2:
        return text

    paragraphs = []
    current_paragraph_words = []
    sentence_count = 0

    for i, word in enumerate(words):
        word_text = word.get('word', '')
        current_paragraph_words.append(word_text)

        # Count sentences (ends with . ! ?)
        if word_text.rstrip().endswith(('.', '!', '?')):
            sentence_count += 1

        # Check for pause to next word
        if i < len(words) - 1:
            current_end = word.get('end', 0)
            next_start = words[i + 1].get('start', 0)
            gap = next_start - current_end

            # If significant pause AND we have enough sentences, break paragraph
            if gap > pause_threshold and sentence_count >= sentences_per_paragraph:
                paragraph_text = ' '.join(current_paragraph_words)
                paragraphs.append(paragraph_text.strip())
                current_paragraph_words = []
                sentence_count = 0

    # Add remaining words
    if current_paragraph_words:
        paragraph_text = ' '.join(current_paragraph_words)
        paragraphs.append(paragraph_text.strip())

    # If we only have one paragraph, return original text to preserve formatting
    if len(paragraphs) <= 1:
        return text

    return '\n\n\n'.join(paragraphs)


class WhisperXTranscriber:
    def __init__(self):
        self.model = None
        self.diarize_model = None
        self.align_model = None
        self.align_metadata = None
        self.device, self.device_name, self.compute_type = get_device()
        self.current_model_size = None

    def _is_model_cached(self, model_size):
        """Check if a whisper model is already downloaded in HuggingFace cache"""
        cache_dir = os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub")
        if not os.path.exists(cache_dir):
            return False

        # Model directory naming convention: models--Systran--faster-whisper-{size}
        model_dir_name = f"models--Systran--faster-whisper-{model_size}"
        model_path = os.path.join(cache_dir, model_dir_name)
        return os.path.exists(model_path)

    def load_model(self, msg_id, model_size="base", language="en"):
        """Load the WhisperX transcription model"""
        try:
            import whisperx

            # Check if model is already cached
            is_cached = self._is_model_cached(model_size)

            if is_cached:
                send_progress(msg_id, 10, "loading", f"Loading {model_size} model...")
                log(f"Loading WhisperX model: {model_size} on {self.device_name} (cached)")
            else:
                # Model needs to be downloaded - use indeterminate progress (-1)
                send_progress(msg_id, -1, "downloading", f"Downloading {model_size} model from HuggingFace...")
                log(f"Downloading WhisperX model: {model_size} from HuggingFace...")

            # Load whisper model (redirect stdout to stderr to avoid corrupting JSON IPC)
            with contextlib.redirect_stdout(sys.stderr):
                self.model = whisperx.load_model(
                    model_size,
                    device=self.device,
                    compute_type=self.compute_type,
                    language=language if language != "auto" else None
                )
            self.current_model_size = model_size

            send_progress(msg_id, 80, "loading", "Loading alignment model...")

            # Load alignment model for word-level timestamps
            # We'll load this with the actual language during transcription
            # For now, just mark model as loaded

            send_progress(msg_id, 100, "loading", "Model ready")

            return {
                "type": "modelLoaded",
                "id": msg_id,
                "device": self.device_name,
                "modelSize": model_size
            }

        except Exception as e:
            error_str = str(e)
            log(f"Model load error: {error_str}")

            return {
                "type": "error",
                "id": msg_id,
                "error": f"Failed to load model: {error_str}"
            }

    def load_diarization_model(self, msg_id):
        """Load the sherpa-onnx diarization model (no HuggingFace token required)"""
        try:
            from sherpa_diarizer import SherpaDiarizer

            send_progress(msg_id, 10, "downloading", "Loading diarization model...")
            log("Loading sherpa-onnx diarization model (no HF token required)...")

            # Find or download diarization models
            models_dir = get_diarization_models_dir()
            segmentation_file = os.path.join(models_dir, 'segmentation.onnx')

            if not os.path.exists(segmentation_file):
                log(f"Diarization models not found at {models_dir}, downloading...")
                download_diarization_models(models_dir, msg_id)

            self.diarize_model = SherpaDiarizer(models_dir)

            send_progress(msg_id, 100, "downloading", "Diarization model loaded")

            return {
                "type": "diarizationModelLoaded",
                "id": msg_id,
                "device": self.device_name
            }

        except Exception as e:
            error_str = str(e)
            log(f"Diarization model load error: {error_str}")

            return {
                "type": "error",
                "id": msg_id,
                "error": f"Failed to load diarization model: {error_str}"
            }

    def transcribe(self, msg_id, audio_path, language="en", enable_diarization=True, num_speakers=None):
        """
        Transcribe audio file with word-level timestamps and optional speaker diarization

        Returns segments with word-level timing and speaker labels
        """
        try:
            import whisperx

            if not self.model:
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

            log(f"Starting transcription: {audio_path}")
            log(f"File exists check: {os.path.exists(audio_path)}, is_file: {os.path.isfile(audio_path)}")

            # Check for UNC paths on Windows which may cause issues
            if sys.platform == 'win32' and audio_path.startswith('\\\\'):
                log(f"WARNING: UNC network path detected. This may cause issues with ffmpeg.")

            send_progress(msg_id, 5, "transcribing", "Loading audio file...")

            # Load audio with better error handling
            try:
                audio = whisperx.load_audio(audio_path)
            except Exception as audio_err:
                log(f"Failed to load audio file: {audio_err}")
                return {
                    "type": "error",
                    "id": msg_id,
                    "error": f"Failed to load audio file: {audio_err}. If using a network path, try copying the file to a local folder first."
                }

            # Transcribe with whisper
            # Use heartbeat for progress since WhisperX doesn't expose callbacks
            # Expected duration varies: ~30s for short clips, 2-5 min for long files on CPU
            expected_transcribe_time = 60.0 if self.device == "cpu" else 20.0

            with ProgressHeartbeat(
                msg_id, 10, 38, "transcribing",
                "Running speech recognition...",
                expected_duration=expected_transcribe_time
            ):
                result = self.model.transcribe(
                    audio,
                    batch_size=16 if self.device == "cuda" else 4,
                    language=language if language != "auto" else None
                )

            detected_language = result.get("language", language)
            log(f"Detected language: {detected_language}")

            # Load alignment model and align for word-level timestamps
            # Use heartbeat since alignment can take 30-120s on CPU
            expected_align_time = 90.0 if self.device == "cpu" else 30.0

            try:
                with ProgressHeartbeat(
                    msg_id, 40, 54, "aligning",
                    "Aligning words for precise timestamps...",
                    expected_duration=expected_align_time
                ):
                    # Redirect stdout to stderr to avoid corrupting JSON IPC
                    with contextlib.redirect_stdout(sys.stderr):
                        align_model, align_metadata = whisperx.load_align_model(
                            language_code=detected_language,
                            device=self.device
                        )

                        # Align whisper output for word-level timestamps
                        result = whisperx.align(
                            result["segments"],
                            align_model,
                            align_metadata,
                            audio,
                            self.device,
                            return_char_alignments=False
                        )
            except Exception as align_error:
                log(f"Alignment failed (language {detected_language} may not be supported): {align_error}")
                # Continue without word-level alignment

            send_progress(msg_id, 55, "processing", "Processing segments...")

            # Run diarization if requested
            if enable_diarization:
                send_progress(msg_id, 56, "diarizing", "Running speaker diarization...")

                # Load diarization model if not loaded
                if not self.diarize_model:
                    log("Loading sherpa-onnx diarization model...")
                    from sherpa_diarizer import SherpaDiarizer

                    # Find or download diarization models
                    models_dir = get_diarization_models_dir()
                    segmentation_file = os.path.join(models_dir, 'segmentation.onnx')

                    if not os.path.exists(segmentation_file):
                        log(f"Diarization models not found at {models_dir}, downloading...")
                        download_diarization_models(models_dir, msg_id)

                    self.diarize_model = SherpaDiarizer(models_dir)

                send_progress(msg_id, 58, "diarizing", "Identifying speakers...")

                # Progress callback for real-time diarization updates
                # Maps 0-100% diarization progress to 58-88% overall progress
                DIARIZATION_START = 58
                DIARIZATION_END = 88
                DIARIZATION_RANGE = DIARIZATION_END - DIARIZATION_START

                def diarization_progress(percent):
                    # Map diarization progress (0-100%) to overall progress (58-88%)
                    overall_percent = DIARIZATION_START + (percent / 100) * DIARIZATION_RANGE
                    send_progress(msg_id, overall_percent, "diarizing", "Identifying speakers...")

                # Run diarization with progress callback
                diarize_kwargs = {"progress_callback": diarization_progress}
                if num_speakers and num_speakers > 0:
                    diarize_kwargs["num_speakers"] = num_speakers

                diarize_segments = self.diarize_model(audio, **diarize_kwargs)

                send_progress(msg_id, 90, "assigning", "Assigning speakers to words...")

                # Assign speakers to words
                result = whisperx.assign_word_speakers(diarize_segments, result)

                # Extract unique speakers
                speakers = set()
                for seg in result.get("segments", []):
                    if "speaker" in seg:
                        speakers.add(seg["speaker"])
                    for word in seg.get("words", []):
                        if "speaker" in word:
                            speakers.add(word["speaker"])
                speakers = sorted(list(speakers))
                log(f"Found {len(speakers)} speakers: {speakers}")
            else:
                speakers = []

            send_progress(msg_id, 96, "formatting", "Formatting results...")

            # Format segments for output
            segments = []
            for seg in result.get("segments", []):
                original_text = seg.get("text", "").strip()
                seg_words = seg.get("words", [])

                # Format text with paragraph breaks if we have word-level data
                if seg_words:
                    formatted_text = format_text_with_paragraphs(
                        original_text,
                        seg_words,
                        pause_threshold=0.7,
                        sentences_per_paragraph=3
                    )
                else:
                    formatted_text = original_text

                segment_data = {
                    "start": float(seg.get("start", 0)),
                    "end": float(seg.get("end", 0)),
                    "text": formatted_text,
                }

                # Add speaker if available
                if "speaker" in seg:
                    segment_data["speaker"] = seg["speaker"]

                # Add word-level data if available
                if seg_words:
                    words = []
                    for word in seg_words:
                        word_data = {
                            "word": word.get("word", ""),
                            "start": float(word.get("start", 0)),
                            "end": float(word.get("end", 0))
                        }
                        if "speaker" in word:
                            word_data["speaker"] = word["speaker"]
                        if "score" in word:
                            word_data["confidence"] = float(word.get("score", 0))
                        words.append(word_data)
                    segment_data["words"] = words

                segments.append(segment_data)

            # Calculate total duration
            duration = 0
            if segments:
                duration = max(seg["end"] for seg in segments)

            log(f"Transcription complete: {len(segments)} segments, {duration:.2f}s duration")

            # Debug: show sample of results
            for i, seg in enumerate(segments[:3]):
                speaker = seg.get("speaker", "N/A")
                log(f"  [{i}] {speaker}: {seg['start']:.2f}s-{seg['end']:.2f}s: {seg['text'][:50]}...")

            send_progress(msg_id, 100, "complete", "Transcription complete")

            return {
                "type": "transcriptionResult",
                "id": msg_id,
                "segments": segments,
                "language": detected_language,
                "duration": duration,
                "speakers": speakers
            }

        except Exception as e:
            error_str = str(e)
            log(f"Transcription error: {error_str}")
            import traceback
            traceback.print_exc(file=sys.stderr)

            return {
                "type": "error",
                "id": msg_id,
                "error": f"Transcription failed: {error_str}"
            }


def main():
    """Main loop - read JSON messages from stdin, process, write responses to stdout"""

    # Send ready message with device info
    device, device_name, compute_type = get_device()
    log(f"WhisperX transcriber ready on device: {device_name}")
    send({
        "type": "ready",
        "device": device_name,
        "computeType": compute_type,
        "version": "1.0.0"
    })

    transcriber = WhisperXTranscriber()

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
                result = transcriber.load_model(
                    msg_id,
                    model_size=msg.get("modelSize", "base"),
                    language=msg.get("language", "en")
                )
                send(result)

            elif msg_type == "loadDiarizationModel":
                result = transcriber.load_diarization_model(msg_id)
                send(result)

            elif msg_type == "transcribe":
                result = transcriber.transcribe(
                    msg_id,
                    audio_path=msg.get("filePath"),
                    language=msg.get("language", "en"),
                    enable_diarization=msg.get("enableDiarization", True),
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
            log(f"Unexpected error: {str(e)}")
            import traceback
            traceback.print_exc(file=sys.stderr)
            send({
                "type": "error",
                "error": f"Unexpected error: {str(e)}"
            })


if __name__ == "__main__":
    main()
