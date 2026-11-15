#!/bin/bash
set -eu
shadepath_directory="$(cd -- "$(dirname -- "$0")" && pwd)"
shadepath_page="$shadepath_directory/ShadePath-preview.html"
if [ ! -f "$shadepath_page" ]; then
  echo '未找到 ShadePath-preview.html。请先在项目目录运行 npm run build。'
  read -r -p '按回车关闭…' _
  exit 1
fi
open "$shadepath_page"
