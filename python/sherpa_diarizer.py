"""
Sherpa-ONNX based speaker diarization (no HuggingFace token required)

This module provides a drop-in replacement for pyannote diarization that
works with whisperx.assign_word_speakers() without requiring a HuggingFace token.

Models used:
- Segmentation: pyannote-segmentation-3-0 (converted to ONNX)
- Embedding: 3dspeaker_speech_eres2net_base_200k_sv_zh-cn_16k-common
"""

import os
import sys
import multiprocessing
import numpy as np
import pandas as pd

# Log to stderr to avoid corrupting JSON IPC on stdout
def log(msg):
    print(f"[sherpa_diarizer] {msg}", file=sys.stderr)


class SherpaDiarizer:
    """
    Speaker diarization using sherpa-onnx.

    Returns output compatible with whisperx.assign_word_speakers().
    """

    def __init__(self, models_dir: str, num_threads: int = None):
        """
        Initialize the diarizer with ONNX models.

        Args:
            models_dir: Directory containing segmentation.onnx and embedding model
            num_threads: Number of CPU threads to use (default: auto-detect)
        """
        import sherpa_onnx

        self.models_dir = models_dir
        self.sample_rate = 16000

        # Auto-detect thread count if not specified
        # Use ~50% of available cores to keep system responsive during processing
        if num_threads is None:
            num_threads = max(2, multiprocessing.cpu_count() // 2)
        log(f"Using {num_threads} threads for diarization")

        # Check for required model files
        seg_model = os.path.join(models_dir, "segmentation.onnx")
        emb_model = os.path.join(models_dir, "3dspeaker_speech_eres2net_base_200k_sv_zh-cn_16k-common.onnx")

        if not os.path.exists(seg_model):
            raise FileNotFoundError(f"Segmentation model not found: {seg_model}")
        if not os.path.exists(emb_model):
            raise FileNotFoundError(f"Embedding model not found: {emb_model}")

        log(f"Loading models from {models_dir}")

        # Create pyannote segmentation config
        pyannote_config = sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
            model=seg_model
        )

        # Create segmentation model config
        seg_config = sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=pyannote_config
        )

        # Create embedding extractor config
        emb_config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=emb_model,
            num_threads=num_threads
        )

        # Create clustering config
        # threshold controls speaker separation sensitivity
        # Lower = more speakers detected, Higher = fewer speakers
        cluster_config = sherpa_onnx.FastClusteringConfig(
            num_clusters=-1,  # Auto-detect number of speakers
            threshold=0.5     # Clustering threshold
        )

        # Create main config
        config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
            segmentation=seg_config,
            embedding=emb_config,
            clustering=cluster_config,
            min_duration_on=0.3,   # Min speech segment duration
            min_duration_off=0.5   # Min silence between segments
        )

        if not config.validate():
            raise ValueError("Invalid diarization configuration")

        self.diarizer = sherpa_onnx.OfflineSpeakerDiarization(config)
        self.num_threads = num_threads
        log(f"Diarizer ready (sample_rate={self.diarizer.sample_rate})")

    def __call__(self, audio, sample_rate: int = None, num_speakers: int = None, progress_callback=None):
        """
        Run speaker diarization on audio.

        Args:
            audio: Audio waveform as numpy array (mono, float32)
                   Can be a dict with 'waveform' and 'sample_rate' keys
            sample_rate: Sample rate (default 16000)
            num_speakers: Optional hint for number of speakers (not currently used)
            progress_callback: Optional callback function(percent: float) for progress updates
                               Called with progress percentage (0-100) during processing

        Returns:
            pandas DataFrame compatible with whisperx.assign_word_speakers()
        """
        # Handle dict input format (whisperx style)
        if isinstance(audio, dict):
            waveform = audio.get('waveform', audio)
            sr = audio.get('sample_rate', sample_rate or self.sample_rate)
        else:
            waveform = audio
            sr = sample_rate or self.sample_rate

        # Ensure audio is numpy array
        if not isinstance(waveform, np.ndarray):
            waveform = np.array(waveform, dtype=np.float32)

        # Ensure float32
        if waveform.dtype != np.float32:
            waveform = waveform.astype(np.float32)

        # Ensure mono (take first channel if stereo)
        if len(waveform.shape) > 1:
            waveform = waveform.mean(axis=0) if waveform.shape[0] <= 2 else waveform[:, 0]

        # Flatten if needed
        waveform = waveform.flatten()

        audio_duration = len(waveform) / sr
        log(f"Processing audio: {audio_duration:.1f}s, {len(waveform)} samples")

        # Create sherpa-onnx progress callback wrapper
        def sherpa_progress_callback(current_pos, total_samples):
            if progress_callback and total_samples > 0:
                percent = (current_pos / total_samples) * 100
                try:
                    progress_callback(percent)
                except Exception as e:
                    log(f"Progress callback error: {e}")
            return 0  # Return 0 to continue processing

        # Run diarization
        if progress_callback:
            result = self.diarizer.process(waveform, callback=sherpa_progress_callback)
        else:
            result = self.diarizer.process(waveform)

        # Get segments sorted by start time
        sorted_segments = result.sort_by_start_time()

        log(f"Diarization complete: {result.num_segments} segments, {result.num_speakers} speakers")

        # Convert to whisperx-compatible format
        segments = []
        for seg in sorted_segments:
            segments.append({
                'start': float(seg.start),
                'end': float(seg.end),
                'speaker': f'SPEAKER_{seg.speaker:02d}'
            })

        # Return a pandas DataFrame
        if segments:
            return pd.DataFrame({
                'start': [seg['start'] for seg in segments],
                'end': [seg['end'] for seg in segments],
                'speaker': [seg['speaker'] for seg in segments]
            })
        else:
            return pd.DataFrame({'start': [], 'end': [], 'speaker': []})


def create_diarizer(models_dir: str = None):
    """
    Factory function to create a SherpaDiarizer.

    Args:
        models_dir: Path to models directory. If None, uses default location.

    Returns:
        SherpaDiarizer instance
    """
    if models_dir is None:
        # Default to models/diarization relative to this file
        models_dir = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..", "models", "diarization"
        )

    return SherpaDiarizer(models_dir)


if __name__ == "__main__":
    # Test the diarizer
    import sys

    if len(sys.argv) < 2:
        print("Usage: python sherpa_diarizer.py <audio_file>")
        sys.exit(1)

    audio_file = sys.argv[1]

    # Load audio using whisperx if available
    try:
        import whisperx
        audio = whisperx.load_audio(audio_file)
        sample_rate = 16000
    except ImportError:
        import soundfile as sf
        audio, sample_rate = sf.read(audio_file)

    # Create diarizer
    diarizer = create_diarizer()

    # Run diarization
    result = diarizer(audio, sample_rate=sample_rate)

    print("\nDiarization results:")
    for seg in result['segments']:
        print(f"  {seg['start']:.2f} - {seg['end']:.2f}: {seg['speaker']}")
