@echo off
cd /d "%~dp0"
py -3 -m pip install -r requirements.txt
if errorlevel 1 (
    echo Could not install the hardware connector requirements.
    pause
    exit /b 1
)
py -3 hardware_bridge.py --server https://smartlab-7387.onrender.com
if errorlevel 1 pause
