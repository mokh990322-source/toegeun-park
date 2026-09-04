@echo off
title 모코파크 - 깃허브에 올리기
cd /d "%~dp0"
set PATH=%PATH%;C:\Program Files\GitHub CLI

echo.
echo   고친 것을 깃허브에 올립니다...
echo.

git add -A
git commit -m "업데이트"
git push

echo.
echo   완료. 1~2분 뒤 반영됩니다:
echo     https://mokh990322-source.github.io/toegeun-park/
echo.
pause
