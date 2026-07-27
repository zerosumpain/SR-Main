#!/usr/bin/env python3
"""Local speech-to-text via faster-whisper.

Invoked by src/lib/jkai/extract/stt-local.ts as:

    python stt.py <audio-path> [--model base] [--language en]

Emits a single JSON object on stdout: {"text": ..., "language": ..., "duration": ...}
Any failure exits non-zero with the reason on stderr, which the TS caller treats
as "fall back to the OpenRouter transcription path".

Runs on the CPU with int8 compute — homeserv has no usable GPU for this and the
box already needed earlyoom/zram mitigation, so a modest, predictable footprint
matters more than latency here. The model is cached by faster-whisper after the
first call (~150MB for `base`).
"""

import argparse
import json
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--model", default="base")
    ap.add_argument("--language", default=None)
    args = ap.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        print(f"faster-whisper not installed: {exc}", file=sys.stderr)
        return 2

    try:
        model = WhisperModel(args.model, device="cpu", compute_type="int8")
        segments, info = model.transcribe(
            args.audio,
            language=args.language,
            vad_filter=True,
        )
        text = "".join(seg.text for seg in segments).strip()
    except Exception as exc:  # noqa: BLE001 — any failure is a fallback signal
        print(f"transcription failed: {exc}", file=sys.stderr)
        return 1

    json.dump(
        {
            "text": text,
            "language": getattr(info, "language", None),
            "duration": getattr(info, "duration", None),
        },
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
