#!/usr/bin/env python3
"""Upload original photos with AWS CLI (S3 / Cloudflare R2). No image conversion."""
import argparse
import json
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser(description='上传原图至 S3 兼容图片存储。需先安装并配置 AWS CLI。')
parser.add_argument('--assets', required=True, type=Path, help='解压后的 assets 文件夹，包含 photos 和 home-photos')
parser.add_argument('--bucket', required=True, help='目标 bucket 名称')
parser.add_argument('--endpoint-url', help='例如 Cloudflare R2 的 S3 API endpoint')
parser.add_argument('--profile', help='已配置的 AWS CLI profile')
parser.add_argument('--dry-run', action='store_true')
args = parser.parse_args()
manifest = json.loads((Path(__file__).resolve().parents[1] / 'site/photo-manifest.json').read_text())
if not args.bucket or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789.-' for c in args.bucket):
    parser.error('bucket 名称只能包含小写字母、数字、点和连字符')
for photo in manifest:
    path = args.assets / photo['id']
    if not path.is_file() or path.stat().st_size != photo['bytes']:
        parser.error(f'原图缺失或文件大小不一致：{path}')
base = ['aws']
if args.profile: base += ['--profile', args.profile]
if args.endpoint_url: base += ['--endpoint-url', args.endpoint_url]
for folder in ['photos', 'home-photos']:
    cmd = base + ['s3', 'sync', str(args.assets / folder), f's3://{args.bucket}/assets/{folder}', '--exclude', '*', '--include', '*.jpg', '--include', '*.JPG', '--include', '*.jpeg', '--include', '*.JPEG', '--include', '*.png', '--include', '*.PNG', '--include', '*.webp', '--include', '*.WEBP', '--cache-control', 'public,max-age=3600', '--no-follow-symlinks', '--only-show-errors']
    if args.dry_run: cmd += ['--dryrun']
    subprocess.run(cmd, check=True)
print('原图同步完成。请启用存储的公开读取域名，并验证 assets/photos/IMG_6093.JPG 能够打开。' if not args.dry_run else '试运行完成，未上传文件。')
