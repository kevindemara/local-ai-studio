"""One-shot local audio generation for Local AI Studio.

Each job runs in its model's isolated Python environment so model dependencies
and GPU memory are released after the clip is saved.
"""

import argparse
import json
import math
import os
import sys
from pathlib import Path


def generate_effect(args):
    import numpy as np
    import soundfile as sf
    import torch
    from moss_soundeffect_v2 import MossSoundEffectPipeline

    pipe = MossSoundEffectPipeline.from_pretrained(
        str(args.models / "sfx"), torch_dtype=torch.bfloat16, device="cuda"
    )
    audio = pipe(
        prompt=args.prompt,
        seconds=args.duration,
        max_inference_seconds=max(1, math.ceil(args.duration)),
        num_inference_steps=args.steps,
        cfg_scale=4.0,
        seed=args.seed,
    )
    # torchaudio's Windows writer requires a separate FFmpeg/TorchCodec DLL.
    # SoundFile writes the same PCM waveform without that extra runtime.
    waveform = audio[0].detach().cpu().float().numpy().T
    peak = float(np.max(np.abs(waveform)))
    if not np.isfinite(peak):
        raise RuntimeError("The effect model returned invalid samples.")
    if peak > 0.95:
        waveform *= 0.95 / peak
    sf.write(args.output, waveform, pipe.sample_rate)


def generate_voice(args):
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel

    model = Qwen3TTSModel.from_pretrained(
        str(args.models / "voice"),
        device_map="cuda:0",
        dtype=torch.bfloat16,
        attn_implementation="sdpa",
    )
    wavs, sample_rate = model.generate_voice_design(
        text=args.prompt,
        language=args.language,
        instruct=args.style,
    )
    sf.write(args.output, wavs[0], sample_rate)


def generate_music(args):
    import soundfile as sf
    from acestep.handler import AceStepHandler
    from acestep.llm_inference import LLMHandler
    from acestep.inference import GenerationConfig, GenerationParams, generate_music

    os.environ["ACESTEP_CHECKPOINTS_DIR"] = str(args.models / "music")
    handler = AceStepHandler()
    status, ready = handler.initialize_service(
        project_root=str(args.models.parent),
        config_path="acestep-v15-turbo",
        device="cuda",
        offload_to_cpu=True,
    )
    if not ready:
        raise RuntimeError(f"ACE-Step model initialization failed: {status}")

    planner = LLMHandler()
    status, ready = planner.initialize(
        checkpoint_dir=str(args.models / "music"),
        lm_model_path="acestep-5Hz-lm-1.7B",
        backend="pt",
        device="cuda",
        offload_to_cpu=True,
    )
    if not ready:
        print(f"Music planner unavailable; using prompt directly: {status}", file=sys.stderr)
        planner = None

    params = GenerationParams(
        caption=args.prompt,
        lyrics=args.lyrics if args.lyrics else "[Instrumental]",
        instrumental=not bool(args.lyrics),
        duration=args.duration,
        inference_steps=8,
        shift=3.0,
        thinking=bool(planner),
        seed=args.seed,
    )
    config = GenerationConfig(batch_size=1, audio_format="wav")
    result = generate_music(handler, planner, params, config, save_dir=str(args.output.parent))
    if not result.success or not result.audios:
        raise RuntimeError(f"ACE-Step generation failed: {result.error}")
    produced = Path(result.audios[0]["path"])
    if produced.resolve() != args.output.resolve():
        waveform, sample_rate = sf.read(produced, dtype="float32")
        sf.write(args.output, waveform, sample_rate, subtype="PCM_16")
        if produced.resolve().parent == args.output.resolve().parent:
            produced.unlink()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=["effect", "music", "voice"])
    parser.add_argument("--models", required=True, type=Path)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--duration", type=float, default=10)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--steps", type=int, default=24)
    parser.add_argument("--style", default="A clear, expressive speaking voice.")
    parser.add_argument("--language", default="English")
    parser.add_argument("--lyrics", default="")
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    {"effect": generate_effect, "music": generate_music, "voice": generate_voice}[args.mode](args)
    if not args.output.is_file() or args.output.stat().st_size < 1024:
        raise RuntimeError("The model did not produce an audio clip.")
    print(json.dumps({"output": str(args.output), "bytes": args.output.stat().st_size}))


if __name__ == "__main__":
    main()
