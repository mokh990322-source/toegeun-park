@echo off
title 퇴근파크 - 이 창을 닫으면 게임이 꺼집니다
cd /d "%~dp0"

echo.
echo   ==========================================
echo      퇴근파크 TOEGEUN PARK
echo   ==========================================
echo.
echo   서버를 켜는 중입니다. 브라우저가 곧 열립니다.
echo   안 열리면 주소창에 직접:  http://localhost:8895/
echo.
echo   * 혼자 놀려면: 방 만들기 - 대기실에서 [+ AI] - 시작
echo   * 게임을 끝내려면 이 창을 닫으세요.
echo.

start /b "" powershell -NoProfile -Command "Start-Sleep -Milliseconds 1200; Start-Process 'http://localhost:8895/'"
python -m http.server 8895

echo.
echo   서버가 멈췄습니다. 8895 포트를 이미 쓰고 있는 것은 아닌지 확인하세요.
pause
