@echo off
cd /d "%~dp0\.."
start "" "http://localhost:8088/demo/"
py -m http.server 8088
