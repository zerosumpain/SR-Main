#!/usr/bin/env python3
"""Prepare a Drive animation once; never transcode on a homepage request."""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def run(*args):
    subprocess.run(args, check=True)


def probe(path):
    return json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_format', '-show_streams',
        '-of', 'json', str(path),
    ]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Animation downloaded from /drive/siteherobackground')
    parser.add_argument('--output', type=Path, default=ROOT / 'static/hero-background')
    parser.add_argument('--manifest', type=Path, default=ROOT / 'src/lib/constants/hero-background-asset.json')
    args = parser.parse_args()
    for binary in ('ffmpeg', 'ffprobe'):
        if not shutil.which(binary):
            parser.error(f'{binary} is required')
    duration = float(probe(args.source)['format']['duration'])
    if not 0 < duration <= 60:
        parser.error('Use an animation between 0 and 60 seconds for the hero')
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = {'duration': duration}
    with tempfile.TemporaryDirectory(prefix='sr-hero-') as temporary:
        work = Path(temporary)
        for variant, width, budget in [('desktop', 960, 2_000_000), ('mobile', 480, 1_000_000)]:
            target = work / f'{variant}.mp4'
            rate = int(budget * 8 * 0.85 / duration)
            # Cap both dimensions, retain aspect ratio, and never upscale.
            scale = f'scale=w=min({width}\\,iw):h=min({width}\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2'
            run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(args.source),
                '-map', '0:v:0', '-an', '-sn', '-dn', '-map_metadata', '-1',
                '-vf', f'{scale},fps=24', '-c:v', 'libx264', '-preset', 'slow',
                '-crf', '30', '-maxrate', str(rate), '-bufsize', str(rate * 2),
                '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(target))
            size = target.stat().st_size
            if size > budget:
                raise SystemExit(f'{variant} exceeded its {budget:,}-byte budget; use a shorter source')
            digest = hashlib.sha256(target.read_bytes()).hexdigest()[:12]
            filename = f'hero-{variant}-{digest}.mp4'
            shutil.copyfile(target, args.output / filename)
            manifest[variant] = f'/hero-background/{filename}'
            manifest[f'{variant}Bytes'] = size
        # Extract the exact last decoded desktop frame, without reversing the video in memory.
        desktop = work / 'desktop.mp4'
        frames = int(probe(desktop)['streams'][0]['nb_frames'])
        poster = work / 'poster.webp'
        run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(desktop),
            '-vf', f'select=eq(n\\,{frames - 1})', '-frames:v', '1', '-quality', '70', str(poster))
        digest = hashlib.sha256(poster.read_bytes()).hexdigest()[:12]
        filename = f'hero-final-{digest}.webp'
        shutil.copyfile(poster, args.output / filename)
        manifest['poster'] = f'/hero-background/{filename}'
    # Only switch the manifest once every deliverable is ready. Original is untouched.
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    temporary_manifest = args.manifest.with_suffix('.json.tmp')
    temporary_manifest.write_text(json.dumps(manifest, indent=2) + '\n')
    temporary_manifest.replace(args.manifest)
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
