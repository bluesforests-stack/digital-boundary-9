#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
 echo '需要Python 3，也可将整个文件夹部署到HTTPS静态网站。'
 read -r -p '按回车退出' answer
 exit 1
fi
echo '浏览器打开 http://localhost:8000 ，按Control+C停止服务。'
python3 -m http.server 8000 --bind 127.0.0.1
